import type { FastifyRequest, FastifyReply } from 'fastify';
import { CONFIG } from '../config.js';

export async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-api-key'];

  if (!apiKey || apiKey !== CONFIG.ADMIN_API_KEY) {
    return reply.code(401).send({
      success: false,
      error: 'Invalid or missing X-API-KEY header',
    });
  }
}
