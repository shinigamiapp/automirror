import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import * as realtime from '../services/realtime.js';

const authQuerySchema = z.object({
  manga_id: z.string().min(1).optional(),
});

export const realtimeRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.route({
    method: 'GET',
    url: '/auth',
    schema: {
      tags: ['realtime'],
      description: 'Get Ably token request for realtime subscriptions',
      querystring: authQuerySchema,
      response: {
        200: z.object({
          tokenRequest: z.unknown(),
        }),
        503: z.object({
          error: z.string(),
        }),
      },
    },
    handler: async (request, reply) => {
      if (!realtime.isRealtimeConfigured()) {
        return reply.code(503).send({ error: 'Realtime not configured' });
      }

      const channelPrefix = CONFIG.ABLY_CHANNEL_PREFIX;
      const capabilities: Record<string, string[]> = {
        [`${channelPrefix}.registry`]: ['subscribe'],
      };

      if (request.query.manga_id) {
        capabilities[`${channelPrefix}.registry.${request.query.manga_id}`] = ['subscribe'];
      } else {
        capabilities[`${channelPrefix}.registry.*`] = ['subscribe'];
      }

      const tokenRequest = await realtime.createTokenRequest(
        `worker-client-${Date.now()}`,
        capabilities,
      );

      return { tokenRequest };
    },
  });
};
