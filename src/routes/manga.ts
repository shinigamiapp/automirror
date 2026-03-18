import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createMangaSchema,
  updateMangaSchema,
  mangaIdParamSchema,
  listMangaQuerySchema,
  mangaResponseSchema,
  bulkCreateMangaSchema,
  updateDomainSchema,
  unauthorizedResponseSchema,
  internalErrorResponseSchema,
} from '../schemas/manga.js';
import * as mangaRepo from '../db/repositories/manga.js';
import { publishMangaEvent, toRealtimePayload } from '../services/realtime.js';
import { scanManga } from '../workers/scanner.js';

export const mangaRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // POST /manga - Register manga for auto-sync
  app.route({
    method: 'POST',
    url: '/',
    schema: {
      tags: ['manga'],
      description: 'Register a manga for auto-sync',
      security: [{ apiKey: [] }],
      body: createMangaSchema,
      response: {
        201: z.object({ success: z.literal(true), data: mangaResponseSchema }),
        401: unauthorizedResponseSchema,
        409: z.object({ success: z.literal(false), error: z.string() }),
        500: internalErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const existing = await mangaRepo.getMangaByMangaId(request.body.manga_id);
      if (existing) {
        return reply.code(409).send({ success: false, error: 'Manga already registered' });
      }

      const manga = await mangaRepo.createManga(request.body);

      // Trigger immediate scan in background (don't await to avoid blocking response)
      scanManga(manga, request.log).catch((err) => {
        request.log.error({ mangaId: manga.manga_id, err }, 'Initial scan failed');
      });

      // Publish realtime event with enriched payload (non-blocking)
      publishMangaEvent(manga.manga_id, 'manga.created', toRealtimePayload(manga)).catch(() => {});

      return reply.code(201).send({ success: true, data: manga });
    },
  });

  // GET /manga - List all manga
  app.route({
    method: 'GET',
    url: '/',
    schema: {
      tags: ['manga'],
      description: 'List all registered manga',
      security: [{ apiKey: [] }],
      querystring: listMangaQuerySchema,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            manga: z.array(mangaResponseSchema),
            total: z.number(),
            page: z.number(),
            page_size: z.number(),
          }),
        }),
        401: unauthorizedResponseSchema,
        500: internalErrorResponseSchema,
      },
    },
    handler: async (request) => {
      const { status, title, domain, sort_by, sort_order, page, page_size } = request.query;
      const result = await mangaRepo.listManga({
        status,
        title_query: title,
        domain,
        sort_by,
        sort_order,
        page,
        page_size,
      });
      return {
        success: true as const,
        data: { ...result, page, page_size },
      };
    },
  });

  // GET /manga/:id - Get manga details
  app.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['manga'],
      description: 'Get manga details and failed tasks',
      security: [{ apiKey: [] }],
      params: mangaIdParamSchema,
      response: {
        200: z.object({
          success: z.literal(true),
          data: mangaResponseSchema.extend({
            failed_tasks: z.array(z.object({
              id: z.string(),
              chapter_url: z.string(),
              chapter_number: z.number(),
              error: z.string().nullable(),
              retry_count: z.number(),
            })),
          }),
        }),
        401: unauthorizedResponseSchema,
        404: z.object({ success: z.literal(false), error: z.string() }),
        500: internalErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const manga = await mangaRepo.getMangaById(request.params.id);
      if (!manga) {
        return reply.code(404).send({ success: false, error: 'Manga not found' });
      }
      const failedTasks = await mangaRepo.getFailedSyncTasks(manga.id);
      return {
        success: true as const,
        data: {
          ...manga,
          failed_tasks: failedTasks.map((t) => ({
            id: t.id,
            chapter_url: t.chapter_url,
            chapter_number: t.chapter_number,
            error: t.error,
            retry_count: t.retry_count,
          })),
        },
      };
    },
  });

  // PUT /manga/:id - Update manga settings
  app.route({
    method: 'PUT',
    url: '/:id',
    schema: {
      tags: ['manga'],
      description: 'Update manga settings (interval, enabled, priority)',
      security: [{ apiKey: [] }],
      params: mangaIdParamSchema,
      body: updateMangaSchema,
      response: {
        200: z.object({ success: z.literal(true), data: mangaResponseSchema }),
        401: unauthorizedResponseSchema,
        404: z.object({ success: z.literal(false), error: z.string() }),
        500: internalErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const updated = await mangaRepo.updateManga(request.params.id, request.body);
      if (!updated) {
        return reply.code(404).send({ success: false, error: 'Manga not found' });
      }

      // Publish realtime event with enriched payload (non-blocking)
      publishMangaEvent(updated.manga_id, 'manga.updated', toRealtimePayload(updated)).catch(() => {});

      return { success: true as const, data: updated };
    },
  });

  // DELETE /manga/:id - Remove from registry
  app.route({
    method: 'DELETE',
    url: '/:id',
    schema: {
      tags: ['manga'],
      description: 'Remove manga from registry (cancels active sync)',
      security: [{ apiKey: [] }],
      params: mangaIdParamSchema,
      response: {
        200: z.object({ success: z.literal(true), message: z.string(), data: z.object({}) }),
        401: unauthorizedResponseSchema,
        404: z.object({ success: z.literal(false), error: z.string() }),
        500: internalErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      // Get manga details before deletion for the event
      const manga = await mangaRepo.getMangaById(request.params.id);
      if (!manga) {
        return reply.code(404).send({ success: false, error: 'Manga not found' });
      }

      const deleted = await mangaRepo.deleteManga(request.params.id);
      if (!deleted) {
        return reply.code(404).send({ success: false, error: 'Manga not found' });
      }

      // Publish realtime event (minimal payload for deletion)
      publishMangaEvent(manga.manga_id, 'manga.deleted', {
        id: manga.id,
        manga_id: manga.manga_id,
      }).catch(() => {});

      return { success: true as const, message: 'Manga deleted successfully', data: {} };
    },
  });

  // POST /manga/:id/force-scan - Trigger immediate scan
  app.route({
    method: 'POST',
    url: '/:id/force-scan',
    schema: {
      tags: ['manga'],
      description: 'Trigger an immediate scan for this manga',
      security: [{ apiKey: [] }],
      params: mangaIdParamSchema,
      response: {
        200: z.object({
          success: z.literal(true),
          message: z.string(),
          data: z.object({ status: z.string() }),
        }),
        401: unauthorizedResponseSchema,
        404: z.object({ success: z.literal(false), error: z.string() }),
        500: internalErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const manga = await mangaRepo.getMangaById(request.params.id);
      if (!manga) {
        return reply.code(404).send({ success: false, error: 'Manga not found' });
      }
      await mangaRepo.triggerForceScan(manga.id);
      return { success: true as const, message: 'Scan initiated', data: { status: 'scanning' } };
    },
  });

  // POST /manga/:id/retry - Retry failed tasks
  app.route({
    method: 'POST',
    url: '/:id/retry',
    schema: {
      tags: ['manga'],
      description: 'Retry failed sync tasks for this manga',
      security: [{ apiKey: [] }],
      params: mangaIdParamSchema,
      response: {
        200: z.object({
          success: z.literal(true),
          message: z.string(),
          data: z.object({ retrying: z.number(), status: z.string() }),
        }),
        400: z.object({ success: z.literal(false), error: z.string() }),
        401: unauthorizedResponseSchema,
        404: z.object({ success: z.literal(false), error: z.string() }),
        500: internalErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const manga = await mangaRepo.getMangaById(request.params.id);
      if (!manga) {
        return reply.code(404).send({ success: false, error: 'Manga not found' });
      }

      const retriedCount = await mangaRepo.retryFailedTasks(manga.id);
      if (retriedCount === 0) {
        return reply.code(400).send({ success: false, error: 'No failed tasks to retry' });
      }

      return {
        success: true as const,
        message: `Retrying ${retriedCount} failed task(s)`,
        data: { retrying: retriedCount, status: 'syncing' },
      };
    },
  });

  // POST /manga/bulk - Register multiple manga
  app.route({
    method: 'POST',
    url: '/bulk',
    schema: {
      tags: ['manga'],
      description: 'Register multiple manga for auto-sync',
      security: [{ apiKey: [] }],
      body: bulkCreateMangaSchema,
      response: {
        201: z.object({
          success: z.literal(true),
          data: z.object({
            created: z.number(),
            skipped: z.number(),
            results: z.array(z.object({
              manga_id: z.string(),
              status: z.enum(['created', 'skipped']),
            })),
          }),
        }),
        401: unauthorizedResponseSchema,
        500: internalErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const results: Array<{ manga_id: string; status: 'created' | 'skipped' }> = [];
      let created = 0;
      let skipped = 0;

      for (const item of _request.body.manga) {
        const existing = await mangaRepo.getMangaByMangaId(item.manga_id);
        if (existing) {
          results.push({ manga_id: item.manga_id, status: 'skipped' });
          skipped++;
        } else {
          const manga = await mangaRepo.createManga(item);
          results.push({ manga_id: item.manga_id, status: 'created' });
          created++;

          // Trigger immediate scan in background for each new manga
          scanManga(manga, _request.log).catch((err) => {
            _request.log.error({ mangaId: manga.manga_id, err }, 'Initial scan failed');
          });
        }
      }

      return reply.code(201).send({
        success: true,
        data: { created, skipped, results },
      });
    },
  });

  // PUT /manga/update-domain - Bulk domain migration
  app.route({
    method: 'PUT',
    url: '/update-domain',
    schema: {
      tags: ['manga'],
      description: 'Bulk domain migration for all manga',
      security: [{ apiKey: [] }],
      body: updateDomainSchema,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ updated: z.number() }),
        }),
        401: unauthorizedResponseSchema,
        500: internalErrorResponseSchema,
      },
    },
    handler: async (request) => {
      const updated = await mangaRepo.updateDomain(request.body.old_domain, request.body.new_domain);
      return {
        success: true as const,
        data: { updated },
      };
    },
  });

  // GET /manga/domains - List all source domains with manga counts by status
  app.route({
    method: 'GET',
    url: '/domains',
    schema: {
      tags: ['manga'],
      description: 'List all source domains with aggregated manga counts by status',
      security: [{ apiKey: [] }],
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.array(z.object({
            domain: z.string(),
            total: z.number(),
            idle: z.number(),
            scanning: z.number(),
            syncing: z.number(),
            error: z.number(),
          })),
        }),
        401: unauthorizedResponseSchema,
        500: internalErrorResponseSchema,
      },
    },
    handler: async () => {
      const domainStats = await mangaRepo.getDomainStats();
      return { success: true as const, data: domainStats };
    },
  });
};
