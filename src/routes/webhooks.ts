import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const webhooksRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Health / ping webhook endpoint
  app.route({
    method: 'POST',
    url: '/ping',
    schema: {
      tags: ['webhooks'],
      description: 'Webhook ping/health check',
      response: {
        200: z.object({ success: z.literal(true) }),
        500: z.object({ success: z.literal(false), error: z.string() }),
      },
    },
    handler: async () => {
      return { success: true as const };
    },
  });
};
