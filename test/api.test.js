import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { PNG } from 'pngjs';
import { handleRequest, cleanup } from '../src/api.js';
import { coordinate, readJSON } from '../src/state.js';

class MockR2 {
  constructor() { this.objects = new Map(); }
  stored(object, uploaded = new Date()) {
    return { etag: object.etag, uploaded, bytes: object.bytes };
  }
  async get(key) {
    const item = this.objects.get(key);
    if (!item) return null;
    return {
      key, etag: item.etag, uploaded: item.uploaded,
      get body() { return new Response(item.bytes).body; },
      async arrayBuffer() { return item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.length); },
      async text() { return Buffer.from(item.bytes).toString(); },
    };
  }
  async head(key) { return this.objects.has(key) ? { key } : null; }
  async put(key, body) {
    let bytes;
    if (typeof body === 'string') bytes = Buffer.from(body);
    else if (body instanceof ArrayBuffer) bytes = Buffer.from(body);
    else if (ArrayBuffer.isView(body)) bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    else bytes = Buffer.from(await new Response(body).arrayBuffer());
    const item = this.stored({ etag: crypto.randomUUID(), bytes });
    this.objects.set(key, item);
    return item;
  }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key); }
  async list({ prefix = '', cursor, limit = 1000 } = {}) {
    const keys = [...this.objects.keys()].filter(key => key.startsWith(prefix)).sort();
    const start = Number(cursor || 0);
    const selected = keys.slice(start, start + limit);
    return { objects: await Promise.all(selected.map(async key => ({ key, ...(await this.get(key)) }))),
      truncated: start + limit < keys.length, cursor: String(start + limit) };
  }
}

function environment(bucket) {
  return {
    BUCKET: bucket,
    ASSETS: { fetch: () => new Response('<!doctype html><title>Spoke Studio</title>') },
    METADATA: {
      idFromName: () => 'test',
      get: () => ({ fetch: async (_url, init) => {
        try { return Response.json({ result: await coordinate(bucket, JSON.parse(init.body)) }); }
        catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
      } }),
    },
  };
}

const context = { waitUntil: promise => promise };
async function request(env, path, { method = 'GET', body, cookie, headers = {} } = {}) {
  if (cookie) headers.Cookie = cookie.split(';')[0];
  return handleRequest(new Request('https://spoke-studio.keshavgulati785.workers.dev' + path,
    { method, body, headers }), env, context);
}
async function json(response) { return { response, data: await response.json() }; }

function image(width, height, red = 25) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = red; png.data[i + 1] = 50; png.data[i + 2] = 75; png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

test('R2 collaboration lifecycle', async () => {
  const bucket = new MockR2();
  const env = environment(bucket);
  assert.equal((await request(env, '/api/projects')).status, 401);
  let response = await request(env, '/api/signup', { method: 'POST',
    body: JSON.stringify({ email: 'Alice@Example.com', username: 'Alice' }) });
  assert.equal(response.status, 200);
  const alice = (await response.json()).user;
  const aliceCookie = response.headers.get('Set-Cookie');
  assert.match(aliceCookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await json(await request(env, '/api/auth', { cookie: aliceCookie }))).data.user.username, 'Alice');
  const users = await readJSON(bucket, 'users.json', {});
  assert.equal(users[alice.id].email, 'alice@example.com');
  assert.equal('password' in users[alice.id], false);
  response = await request(env, '/api/signup', { method: 'POST',
    body: JSON.stringify({ email: 'alice@example.com', username: 'Someone else' }) });
  assert.equal(response.status, 400);
  response = await request(env, '/api/signup', { method: 'POST',
    body: JSON.stringify({ email: 'bob@example.com', username: 'Bob' }) });
  const bob = (await response.json()).user;
  const bobCookie = response.headers.get('Set-Cookie');

  response = await request(env, '/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Shared project' }), cookie: aliceCookie });
  const created = (await response.json());
  assert.equal(response.status, 200);
  assert.equal(created.r2_prefix, 'Shared project');
  assert.equal(bucket.objects.has('Shared project/images/'), true);
  assert.equal(bucket.objects.has('Shared project/masks/'), true);
  const start = (await (await request(env, '/api/import', { method: 'POST', cookie: aliceCookie,
    headers: { 'X-Project-Id': created.id } })).json());
  for (const [name, data] of [['b.png', image(8, 5)], ['a.png', image(6, 4)]]) {
    response = await request(env, `/import/${start.id}/image`, { method: 'POST', body: data, cookie: aliceCookie,
      headers: { 'X-Image-Name': encodeURIComponent(JSON.stringify(name)) } });
    assert.equal(response.status, 200);
  }
  response = await request(env, `/import/${start.id}/finish`, { method: 'POST', cookie: aliceCookie });
  const imported = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(imported.frames.map(frame => frame.name), ['a.png', 'b.png']);
  assert.equal(bucket.objects.has(`_system/imports/${start.id}.json`), false);
  response = await request(env, `/frame/${created.id}/0`, { cookie: aliceCookie });
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  const downloaded = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
  assert.deepEqual([downloaded.width, downloaded.height], [6, 4]);
  const empty = PNG.sync.read(Buffer.from(await (await request(env, `/mask/${created.id}/0`, { cookie: aliceCookie })).arrayBuffer()));
  assert.deepEqual([empty.width, empty.height], [6, 4]);

  const mask = new PNG({ width: 6, height: 4 });
  for (let i = 0; i < mask.data.length; i += 4) {
    mask.data[i] = 255; mask.data[i + 1] = 255; mask.data[i + 2] = 255;
    mask.data[i + 3] = i < 16 ? 255 : 0;
  }
  let result = await json(await request(env, `/mask/${created.id}/0`, { method: 'POST',
    body: PNG.sync.write(mask), cookie: aliceCookie }));
  assert.equal(result.response.status, 200);
  assert.equal(result.data.attribution?.user_id, alice.id, JSON.stringify(result.data));
  result = await json(await request(env, `/mask/${created.id}/0`, { method: 'POST',
    body: PNG.sync.write(mask), cookie: bobCookie }));
  assert.equal(result.data.attribution.user_id, bob.id);
  const stored = PNG.sync.read(bucket.objects.get('Shared project/masks/a.png').bytes);
  assert.equal(stored.depth, 8);
  assert.equal(Math.max(...stored.data), 255);
  assert.equal(Math.min(...stored.data), 0);
  const details = (await (await request(env, `/api/projects/${created.id}`, { cookie: bobCookie })).json());
  assert.equal(details.count, 2);
  assert.equal(details.annotated, 1);
  assert.equal(details.frames[0].image_attribution.username, 'Alice');
  assert.equal(details.frames[0].mask_attribution.username, 'Bob');
  assert.equal('email' in details.frames[0].image_attribution, false);
  const remoteAttribution = await readJSON(bucket, 'Shared project/attribution.json', {});
  assert.equal(remoteAttribution.masks['a.png'].username, 'Bob');

  response = await request(env, `/api/projects/${created.id}/rename`, { method: 'POST',
    body: JSON.stringify({ name: 'Renamed project' }), cookie: aliceCookie });
  assert.equal(response.status, 200);
  response = await request(env, `/api/projects/${created.id}/delete`, { method: 'POST', cookie: aliceCookie });
  assert.equal(response.status, 200);
  assert.equal([...bucket.objects.keys()].some(key => key.startsWith('Shared project/')), false);
  const deletedKeys = [...bucket.objects.keys()].filter(key => key.startsWith('recently_deleted/Shared project/'));
  assert.equal(deletedKeys.some(key => key.endsWith('/images/a.png')), true);
  assert.equal(deletedKeys.some(key => key.endsWith('/masks/a.png')), true);
  assert.equal(deletedKeys.some(key => key.endsWith('/attribution.json')), true);
  const movedDate = new Date(Math.max(...deletedKeys.map(key => bucket.objects.get(key).uploaded.getTime())));
  assert.equal(await cleanup(env, new Date(+movedDate + 29 * 86400000)), 0);
  assert.equal(await cleanup(env, new Date(+movedDate + 30 * 86400000)), deletedKeys.length);
  assert.equal([...bucket.objects.keys()].some(key => key.startsWith('recently_deleted/')), false);
  response = await request(env, '/api/auth/logout', { method: 'POST', cookie: aliceCookie });
  assert.equal(response.status, 200);
  assert.equal((await request(env, '/api/projects', { cookie: aliceCookie })).status, 401);
});
