import { DurableObject } from 'cloudflare:workers';
import { handleRequest, cleanup } from './api.js';
import { coordinate } from './state.js';

export class MetadataCoordinator extends DurableObject {
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const input = await request.json();
        const result = await coordinate(this.env.BUCKET, input);
        return Response.json({ result });
      } catch (error) {
        console.error('Metadata operation failed', error);
        return Response.json({ error: error.message }, { status: 400 });
      }
    });
  }
}

export default {
  fetch: handleRequest,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(cleanup(env, new Date(controller.scheduledTime)));
  },
};
