import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isRealtimeConfigured, createTokenRequest } from '../services/realtime.js';

export const realtimeRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /realtime/auth - Get Ably token request for frontend
  app.route({
    method: 'GET',
    url: '/auth',
    schema: {
      tags: ['realtime'],
      description: 'Get Ably token request for frontend authentication',
      querystring: z.object({
        manga_id: z.string().optional(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          data: z.object({
            tokenRequest: z.any(),
          }),
        }),
        503: z.object({
          success: z.literal(false),
          error: z.string(),
        }),
      },
    },
    handler: async (request, reply) => {
      if (!isRealtimeConfigured()) {
        return reply.code(503).send({
          success: false,
          error: 'Realtime service is not configured',
        });
      }

      try {
        const tokenRequest = await createTokenRequest(request.query.manga_id);
        return {
          success: true as const,
          data: { tokenRequest },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return reply.code(503).send({
          success: false,
          error: message,
        });
      }
    },
  });

  // GET /realtime/status - Check if realtime is configured
  app.route({
    method: 'GET',
    url: '/status',
    schema: {
      tags: ['realtime'],
      description: 'Check realtime service status',
      response: {
        200: z.object({
          configured: z.boolean(),
        }),
      },
    },
    handler: async () => {
      return { configured: isRealtimeConfigured() };
    },
  });
};
