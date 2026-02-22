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
      description: 'Webhook ping/health check',
      response: {
        200: z.object({ success: z.literal(true) }),
      },
    },
    handler: async () => {
      return { success: true as const };
    },
  });
};
