import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import scalarReference from '@scalar/fastify-api-reference';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CONFIG } from './config.js';
import { mangaRoutes } from './routes/manga.js';
import { webhooksRoutes } from './routes/webhooks.js';
import { realtimeRoutes } from './routes/realtime.js';
import { requireApiKey } from './hooks/auth.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: CONFIG.LOG_LEVEL,
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' } }
          : undefined,
    },
  });

  // Zod type provider
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // CORS
  await app.register(fastifyCors, {
    origin: '*',
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-KEY',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
  });

  // Swagger / OpenAPI
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Scraper Worker API',
        description: 'Manga scraper pipeline with auto-sync',
        version: '3.0.0',
      },
      servers: [
        { url: CONFIG.API_URL, description: 'API Server' },
      ],
      tags: [
        { name: 'manga', description: 'Manga registry and auto-sync' },
        { name: 'realtime', description: 'Ably realtime authentication' },
        { name: 'health', description: 'Health and status' },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-KEY',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  // Scalar API Reference (replaces Swagger UI)
  await app.register(scalarReference, {
    routePrefix: '/reference',
  });

  // Register route plugins
  await app.register(async (instance) => {
    instance.addHook('onRequest', requireApiKey);
    await instance.register(mangaRoutes);
  }, { prefix: '/manga' });

  await app.register(webhooksRoutes, { prefix: '/webhooks' });

  // Realtime routes (no auth required - frontend needs unauthenticated access for token requests)
  await app.register(realtimeRoutes, { prefix: '/realtime' });

  // Health check
  app.get('/health', {
    schema: {
      tags: ['health'],
      description: 'Basic health check',
      response: {
        200: z.object({
          status: z.string(),
          uptime: z.number(),
          timestamp: z.string(),
        }),
      },
    },
  }, async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });

  return app;
}
