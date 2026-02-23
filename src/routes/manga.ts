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
} from '../schemas/manga.js';
import * as mangaRepo from '../db/repositories/manga.js';
import { publishMangaEvent } from '../services/realtime.js';

export const mangaRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // POST /manga - Register manga for auto-sync
  app.route({
    method: 'POST',
    url: '/',
    schema: {
      tags: ['manga'],
      description: 'Register a manga for auto-sync',
      body: createMangaSchema,
      response: {
        201: z.object({ success: z.literal(true), data: mangaResponseSchema }),
        409: z.object({ success: z.literal(false), error: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const existing = await mangaRepo.getMangaByMangaId(request.body.manga_id);
      if (existing) {
        return reply.code(409).send({ success: false, error: 'Manga already registered' });
      }

      const manga = await mangaRepo.createManga(request.body);

      // Publish realtime event (non-blocking)
      publishMangaEvent(manga.manga_id, 'manga.created', {
        id: manga.id,
        series_title: manga.series_title,
        status: manga.status,
      }).catch(() => {});

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
      },
    },
    handler: async (request) => {
      const { status, page, page_size } = request.query;
      const result = await mangaRepo.listManga({ status, page, page_size });
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
      params: mangaIdParamSchema,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            manga: mangaResponseSchema,
            failed_tasks: z.array(z.object({
              id: z.string(),
              chapter_url: z.string(),
              chapter_number: z.number(),
              error: z.string().nullable(),
              retry_count: z.number(),
            })),
          }),
        }),
        404: z.object({ success: z.literal(false), error: z.string() }),
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
          manga,
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
      params: mangaIdParamSchema,
      body: updateMangaSchema,
      response: {
        200: z.object({ success: z.literal(true), data: mangaResponseSchema }),
        404: z.object({ success: z.literal(false), error: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const updated = await mangaRepo.updateManga(request.params.id, request.body);
      if (!updated) {
        return reply.code(404).send({ success: false, error: 'Manga not found' });
      }

      // Publish realtime event (non-blocking)
      publishMangaEvent(updated.manga_id, 'manga.updated', {
        id: updated.id,
        series_title: updated.series_title,
        status: updated.status,
        auto_sync_enabled: updated.auto_sync_enabled,
      }).catch(() => {});

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
      params: mangaIdParamSchema,
      response: {
        200: z.object({ success: z.literal(true), message: z.string() }),
        404: z.object({ success: z.literal(false), error: z.string() }),
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

      // Publish realtime event (non-blocking)
      publishMangaEvent(manga.manga_id, 'manga.deleted', {
        id: manga.id,
        series_title: manga.series_title,
      }).catch(() => {});

      return { success: true as const, message: 'Manga removed from registry' };
    },
  });

  // POST /manga/:id/force-scan - Trigger immediate scan
  app.route({
    method: 'POST',
    url: '/:id/force-scan',
    schema: {
      tags: ['manga'],
      description: 'Trigger an immediate scan for this manga',
      params: mangaIdParamSchema,
      response: {
        200: z.object({ success: z.literal(true), message: z.string() }),
        404: z.object({ success: z.literal(false), error: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const manga = await mangaRepo.getMangaById(request.params.id);
      if (!manga) {
        return reply.code(404).send({ success: false, error: 'Manga not found' });
      }
      await mangaRepo.triggerForceScan(manga.id);
      return { success: true as const, message: 'Scan triggered' };
    },
  });

  // POST /manga/:id/retry - Retry failed tasks
  app.route({
    method: 'POST',
    url: '/:id/retry',
    schema: {
      tags: ['manga'],
      description: 'Retry failed sync tasks for this manga',
      params: mangaIdParamSchema,
      response: {
        200: z.object({
          success: z.literal(true),
          message: z.string(),
          data: z.object({ retried_count: z.number() }),
        }),
        400: z.object({ success: z.literal(false), error: z.string() }),
        404: z.object({ success: z.literal(false), error: z.string() }),
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
        data: { retried_count: retriedCount },
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
          await mangaRepo.createManga(item);
          results.push({ manga_id: item.manga_id, status: 'created' });
          created++;
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
      body: updateDomainSchema,
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({ updated: z.number() }),
        }),
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
};
