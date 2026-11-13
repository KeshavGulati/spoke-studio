import UPNG from 'upng-js';
import { readJSON } from './state.js';

const PREFIX = 'recently_deleted/';
const SESSION_DAYS = 30;
const MAX_BYTES = 50_000_000;

class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const response = (data, status = 200, headers = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
});
const publicUser = user => ({ id: user.id, email: user.email, username: user.username, created: user.created });
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');

function token(request) {
  return request.headers.get('Cookie')?.match(/(?:^|;\s*)spoke_session=([^;]+)/)?.[1];
}

function cookie(value, maxAge = SESSION_DAYS * 86400) {
  return `spoke_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function currentUser(request, env) {
  const value = token(request);
  if (!value) return null;
  const key = `_system/sessions/${await hash(value)}.json`;
  const session = await readJSON(env.BUCKET, key, null);
  if (!session) return null;
  if (Date.parse(session.expires) <= Date.now()) {
    await env.BUCKET.delete(key);
    return null;
  }
  const users = await readJSON(env.BUCKET, 'users.json', {});
  return users[session.user_id] || null;
}

async function issueSession(user, env) {
  const value = crypto.randomUUID() + crypto.randomUUID();
  await env.BUCKET.put(`_system/sessions/${await hash(value)}.json`, JSON.stringify({
    user_id: user.id, expires: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
  }));
  return cookie(value);
}

async function coordinate(env, input) {
  const id = env.METADATA.idFromName('shared-metadata');
  const result = await env.METADATA.get(id).fetch('https://metadata/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const body = await result.json();
  if (!result.ok) throw new RequestError(body.error || 'Metadata operation failed', result.status);
  return body.result;
}

async function bodyBytes(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BYTES) throw new RequestError('Payload must be at most 50 MB');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new RequestError('Payload must be at most 50 MB');
  return bytes;
}

function png(bytes) {
  try { return UPNG.decode(bytes); }
  catch (error) {
    console.error('PNG validation failed', error.message);
    throw new RequestError('Only valid PNG images are supported');
  }
}

function blackMask(width, height) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  return UPNG.encode([pixels.buffer], width, height, 0);
}

function binaryMask(bytes, frame) {
  const source = png(bytes);
  if (source.width !== frame.width || source.height !== frame.height) {
    throw new RequestError('Mask dimensions do not match source');
  }
  const mask = new Uint8Array(source.width * source.height * 4);
  for (let i = 0; i < source.data.length; i += 4) {
    const value = source.data[i + 3] && (source.data[i] || source.data[i + 1] || source.data[i + 2]) ? 255 : 0;
    mask[i] = mask[i + 1] = mask[i + 2] = value;
    mask[i + 3] = 255;
  }
  return UPNG.encode([mask.buffer], source.width, source.height, 0);
}

function projectName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 120 || /[/\\\x00-\x1f]/.test(name)) {
    throw new RequestError('Enter a valid project name of 1–120 characters, without slashes');
  }
  return name;
}

function filename(value) {
  if (typeof value !== 'string' || !value || /[/\\]/.test(value) || !value.toLowerCase().endsWith('.png')) {
    throw new RequestError('Invalid PNG filename');
  }
  return value.slice(0, -4) + '.png';
}

async function project(env, id) {
  const projects = await readJSON(env.BUCKET, 'projects.json', {});
  const item = projects[id];
  if (!item || item.deleted) throw new RequestError('Project not found', 404);
  return item;
}

async function frames(env, id) {
  return readJSON(env.BUCKET, `_system/projects/${id}/images.json`, []);
}

async function inventory(env, id, projectItem = null) {
  const item = projectItem || await project(env, id);
  const [list, attribution] = await Promise.all([
    frames(env, id), readJSON(env.BUCKET, `_system/attribution/${id}.json`, { images: {}, masks: {} }),
  ]);
  return list.map(frame => ({ ...frame, saved: Boolean(frame.saved),
    image_attribution: attribution.images?.[frame.name] || null,
    mask_attribution: attribution.masks?.[frame.name] || null,
  }));
}

async function projectList(env) {
  const [projects, users] = await Promise.all([
    readJSON(env.BUCKET, 'projects.json', {}), readJSON(env.BUCKET, 'users.json', {}),
  ]);
  return Object.values(projects).filter(item => !item.deleted).map(item => ({ ...item,
    creator: users[item.created_by] ? { id: item.created_by, username: users[item.created_by].username } : null,
    count: item.count || 0, annotated: item.annotated || 0,
  }));
}

function route(path) {
  const parts = path.slice(1).split('/');
  if (parts.length === 2) parts.splice(1, 0, 'default');
  if (parts.length !== 3 || !['frame', 'mask'].includes(parts[0])) {
    throw new RequestError('Invalid route', 404);
  }
  const index = Number(parts[2]);
  if (!Number.isInteger(index) || index < 0) throw new RequestError('Invalid frame', 404);
  return { kind: parts[0], id: parts[1], index };
}

async function frameResponse(request, env, ctx) {
  const { id, index } = route(new URL(request.url).pathname);
  const cached = globalThis.caches?.default && await caches.default.match(request);
  if (cached) return cached;
  const item = await project(env, id);
  const list = await frames(env, id);
  const frame = list[index];
  if (!frame) throw new RequestError('Invalid frame', 404);
  const object = await env.BUCKET.get(`${item.r2_prefix}/images/${frame.name}`);
  if (!object) throw new RequestError('Image not found in R2', 404);
  const result = new Response(object.body, { headers: {
    'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: object.etag,
  } });
  if (globalThis.caches?.default) ctx.waitUntil(caches.default.put(request, result.clone()));
  return result;
}

async function maskResponse(request, env) {
  const { id, index } = route(new URL(request.url).pathname);
  const item = await project(env, id);
  const list = await frames(env, id);
  const frame = list[index];
  if (!frame) throw new RequestError('Invalid frame', 404);
  const object = await env.BUCKET.get(`${item.r2_prefix}/masks/${frame.name}`);
  if (object) return new Response(object.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  return new Response(blackMask(frame.width, frame.height), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  });
}

async function importMetadata(env, id, user) {
  const metadata = await readJSON(env.BUCKET, `_system/imports/${id}.json`, null);
  if (!metadata) throw new RequestError('Import session not found', 404);
  if (metadata.user_id !== user.id) throw new RequestError('Only the user who started this import can finish it');
  return metadata;
}

async function finishImport(request, env, id, user) {
  const metadata = await importMetadata(env, id, user);
  let item;
  if (metadata.target) item = await project(env, metadata.target);
  else {
    const first = Object.keys(metadata.files).sort()[0];
    if (!first) throw new RequestError('Choose at least one PNG image');
    item = await coordinate(env, { action: 'create-project', id,
      title: 'Imported sequence ' + first.slice(0, -4), user });
  }
  if (item.count) throw new RequestError('Images can only be imported into an empty project');
  const list = [];
  for (const name of Object.keys(metadata.files).sort()) {
    const key = `_system/imports/${id}/images/${name}`;
    const object = await env.BUCKET.get(key);
    if (!object) throw new RequestError('Imported file is missing: ' + name);
    await env.BUCKET.put(`${item.r2_prefix}/images/${name}`, object.body, {
      httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
    });
    list.push({ name, width: metadata.files[name].width, height: metadata.files[name].height, saved: false });
  }
  const timestamp = new Date().toISOString();
  const attribution = await coordinate(env, { action: 'finish-import', id: item.id, frames: list,
    prefix: item.r2_prefix, user, timestamp });
  await env.BUCKET.delete(Object.keys(metadata.files).map(name => `_system/imports/${id}/images/${name}`));
  await env.BUCKET.delete(`_system/imports/${id}.json`);
  return { id: item.id, name: item.name, masks: item.masks,
    frames: list.map(frame => ({ ...frame, image_attribution: attribution.images[frame.name], mask_attribution: null })) };
}

async function moveProject(env, item) {
  const keys = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: item.r2_prefix + '/', cursor, limit: 1000 });
    for (const object of page.objects) keys.push(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const destination = `${PREFIX}${item.r2_prefix}/${crypto.randomUUID().replaceAll('-', '')}/`;
  for (const key of keys) {
    const object = await env.BUCKET.get(key);
    if (!object) continue;
    await env.BUCKET.put(destination + key.slice(item.r2_prefix.length + 1), object.body);
  }
  for (let start = 0; start < keys.length; start += 1000) {
    await env.BUCKET.delete(keys.slice(start, start + 1000));
  }
  return destination;
}

async function post(request, env, user) {
  const path = new URL(request.url).pathname;
  if (path === '/api/auth/logout') {
    const value = token(request);
    if (value) await env.BUCKET.delete(`_system/sessions/${await hash(value)}.json`);
    return response({ success: true }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  if (path === '/api/projects') {
    const body = await request.json();
    const item = await coordinate(env, { action: 'create-project', id: crypto.randomUUID().replaceAll('-', ''),
      title: projectName(body.name), user });
    return response(item);
  }
  if (path.startsWith('/api/projects/')) {
    const [, , , id, action] = path.split('/');
    const item = await project(env, id);
    if (!['rename', 'delete'].includes(action)) throw new RequestError('Unknown project action');
    const patch = action === 'delete'
      ? { deleted: true, r2_deleted_prefix: await moveProject(env, item) }
      : { name: projectName((await request.json()).name) };
    await coordinate(env, { action: 'update-project', id, patch });
    return response({ success: true });
  }
  if (path === '/api/import') {
    const target = request.headers.get('X-Project-Id');
    if (target) {
      const item = await project(env, target);
      if (item.count) throw new RequestError('Images can only be imported into an empty project');
    }
    const id = crypto.randomUUID().replaceAll('-', '');
    await coordinate(env, { action: 'import-init', id, target, user_id: user.id });
    return response({ id });
  }
  const importMatch = path.match(/^\/import\/([a-f0-9]+)\/(image|finish)$/);
  if (importMatch) {
    const [, id, action] = importMatch;
    if (action === 'finish') return response(await finishImport(request, env, id, user));
    await importMetadata(env, id, user);
    const name = filename(JSON.parse(decodeURIComponent(request.headers.get('X-Image-Name') || '""')));
    const bytes = await bodyBytes(request);
    if (!bytes.byteLength) throw new RequestError('Empty PNG upload');
    const image = png(bytes);
    const key = `_system/imports/${id}/images/${name}`;
    if (await env.BUCKET.head(key)) throw new RequestError('Duplicate filename: ' + name);
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
    await coordinate(env, { action: 'import-image', id, file: {
      name, width: image.width, height: image.height,
    } });
    return response({ uploaded_by: user.id, imported: true });
  }
  const { kind, id, index } = route(path);
  if (kind !== 'mask') throw new RequestError('Invalid request');
  const item = await project(env, id);
  const frame = (await frames(env, id))[index];
  if (!frame) throw new RequestError('Invalid frame', 404);
  const bytes = await bodyBytes(request);
  if (!bytes.byteLength) throw new RequestError('Invalid mask request');
  const mask = binaryMask(bytes, frame);
  const timestamp = new Date().toISOString();
  await env.BUCKET.put(`${item.r2_prefix}/masks/${frame.name}`, mask, {
    httpMetadata: { contentType: 'image/png', cacheControl: 'no-store' },
  });
  const attribution = await coordinate(env, { action: 'save-mask', id, prefix: item.r2_prefix,
    filename: frame.name, user, timestamp });
  return response({ saved: true, attribution });
}

export async function handleRequest(request, env, ctx) {
  try {
    const path = new URL(request.url).pathname;
    if (path === '/' || !['/api', '/frame', '/mask', '/import'].some(prefix => path.startsWith(prefix))) {
      return env.ASSETS.fetch(request);
    }
    if (request.method === 'GET') {
      if (path === '/api/auth') {
        const user = await currentUser(request, env);
        return response({ user: user ? publicUser(user) : null });
      }
      const user = await currentUser(request, env);
      if (!user) return response({ error: 'Please log in' }, 401);
      if (path === '/api/projects' || path === '/api/frames') {
        return path === '/api/projects' ? response(await projectList(env))
          : response(await inventory(env, 'default'));
      }
      const match = path.match(/^\/api\/projects\/([a-f0-9]+)$/);
      if (match) {
        const item = await project(env, match[1]);
        const list = await inventory(env, match[1], item);
        return response({ ...item, count: list.length, annotated: list.filter(frame => frame.saved).length,
          frames: list, creator: (await projectList(env)).find(p => p.id === item.id)?.creator || null });
      }
      if (path.startsWith('/frame/')) return frameResponse(request, env, ctx);
      if (path.startsWith('/mask/')) return maskResponse(request, env);
      throw new RequestError('Not found', 404);
    }
    if (request.method === 'POST') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin) return response({ error: 'Forbidden origin' }, 403);
      if (path === '/api/signup' || path === '/api/login') {
        const body = await request.json();
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError('Enter a valid email address');
        const users = await readJSON(env.BUCKET, 'users.json', {});
        let user = Object.values(users).find(item => item.email === email);
        if (path === '/api/login') {
          if (!user) throw new RequestError('No account uses this email; please sign up');
        } else if (user) throw new RequestError('An account with this email already exists; please log in');
        else user = await coordinate(env, { action: 'signup', email, username: (() => {
          if (typeof body.username !== 'string' || !body.username.trim() || body.username.trim().length > 40) {
            throw new RequestError('Choose a username of 1–40 characters');
          }
          return body.username.trim();
        })() });
        return response({ user: publicUser(user) }, 200, { 'Set-Cookie': await issueSession(user, env) });
      }
      const user = await currentUser(request, env);
      if (!user) return response({ error: 'Please log in' }, 401);
      return post(request, env, user);
    }
    throw new RequestError('Method not allowed', 405);
  } catch (error) {
    if (!(error instanceof RequestError)) console.error(error);
    return response({ error: error.message || 'Request failed' }, error.status || 500);
  }
}

export async function cleanup(env, now = new Date()) {
  const cutoff = now.getTime() - 30 * 86400000;
  let cursor, expired = [];
  do {
    const page = await env.BUCKET.list({ prefix: PREFIX, cursor, limit: 1000 });
    expired.push(...page.objects.filter(object => object.uploaded.getTime() <= cutoff).map(object => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (let start = 0; start < expired.length; start += 1000) {
    await env.BUCKET.delete(expired.slice(start, start + 1000));
  }
  return expired.length;
}
