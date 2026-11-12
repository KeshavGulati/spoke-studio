export async function readJSON(bucket, key, fallback) {
  const object = await bucket.get(key);
  return object ? JSON.parse(await object.text()) : fallback;
}

export async function putJSON(bucket, key, value) {
  await bucket.put(key, JSON.stringify(value, null, 2) + '\n', {
    httpMetadata: { contentType: 'application/json' },
  });
}

function userAttribution(entry) {
  return { user_id: entry.id || entry.user_id, username: entry.username, timestamp: entry.timestamp };
}

export async function coordinate(bucket, input) {
  const now = input.timestamp || new Date().toISOString();
  if (input.action === 'signup') {
    const users = await readJSON(bucket, 'users.json', {});
    const existing = Object.values(users).find(user => user.email === input.email);
    if (existing) return existing;
    const id = crypto.randomUUID().replaceAll('-', '');
    const user = { id, email: input.email, username: input.username, created: now };
    users[id] = user;
    await putJSON(bucket, 'users.json', users);
    return user;
  }
  if (input.action === 'create-project') {
    const projects = await readJSON(bucket, 'projects.json', {});
    if (Object.values(projects).some(p => !p.deleted && p.name === input.title)) {
      throw new Error('A project with this name already exists');
    }
    const existing = await bucket.list({ prefix: input.title + '/', limit: 1 });
    if (existing.objects.length) throw new Error('R2 already contains this project name');
    const project = {
      id: input.id, name: input.title, created: now, updated: now,
      created_by: input.user.id, r2_prefix: input.title, count: 0, annotated: 0,
      images: `r2://spoke-studio/${input.title}/images`,
      masks: `r2://spoke-studio/${input.title}/masks`,
    };
    projects[input.id] = project;
    await putJSON(bucket, 'projects.json', projects);
    await putJSON(bucket, `_system/projects/${input.id}/images.json`, []);
    await bucket.put(`${input.title}/images/`, '');
    await bucket.put(`${input.title}/masks/`, '');
    return project;
  }
  if (input.action === 'update-project') {
    const projects = await readJSON(bucket, 'projects.json', {});
    const project = projects[input.id];
    if (!project || project.deleted) throw new Error('Project not found');
    Object.assign(project, input.patch, { updated: now });
    await putJSON(bucket, 'projects.json', projects);
    return project;
  }
  if (input.action === 'import-init') {
    const metadata = { target: input.target || null, user_id: input.user_id,
      created: now, files: {} };
    await putJSON(bucket, `_system/imports/${input.id}.json`, metadata);
    return metadata;
  }
  if (input.action === 'import-image') {
    const key = `_system/imports/${input.id}.json`;
    const metadata = await readJSON(bucket, key, null);
    if (!metadata) throw new Error('Import session not found');
    if (metadata.files[input.file.name]) throw new Error('Duplicate filename: ' + input.file.name);
    metadata.files[input.file.name] = input.file;
    await putJSON(bucket, key, metadata);
    return metadata;
  }
  if (input.action === 'finish-import') {
    const frames = input.frames.sort((a, b) => a.name.localeCompare(b.name));
    await putJSON(bucket, `_system/projects/${input.id}/images.json`, frames);
    const key = `_system/attribution/${input.id}.json`;
    const attribution = await readJSON(bucket, key, { images: {}, masks: {} });
    attribution.images ||= {};
    attribution.masks ||= {};
    for (const frame of frames) attribution.images[frame.name] = userAttribution(input.user);
    await putJSON(bucket, key, attribution);
    await putJSON(bucket, `${input.prefix}/attribution.json`, attribution);
    const projects = await readJSON(bucket, 'projects.json', {});
    projects[input.id].count = frames.length;
    projects[input.id].updated = now;
    await putJSON(bucket, 'projects.json', projects);
    return attribution;
  }
  if (input.action === 'save-mask') {
    const key = `_system/attribution/${input.id}.json`;
    const attribution = await readJSON(bucket, key, { images: {}, masks: {} });
    attribution.images ||= {};
    attribution.masks ||= {};
    attribution.masks[input.filename] = userAttribution(input.user);
    await putJSON(bucket, key, attribution);
    await putJSON(bucket, `${input.prefix}/attribution.json`, attribution);
    const frameKey = `_system/projects/${input.id}/images.json`;
    const frames = await readJSON(bucket, frameKey, []);
    const frame = frames.find(frame => frame.name === input.filename);
    if (frame) frame.saved = true;
    await putJSON(bucket, frameKey, frames);
    const projects = await readJSON(bucket, 'projects.json', {});
    if (projects[input.id]) {
      projects[input.id].updated = now;
      projects[input.id].annotated = frames.filter(item => item.saved).length;
      await putJSON(bucket, 'projects.json', projects);
    }
    return attribution.masks[input.filename];
  }
  throw new Error('Invalid metadata operation');
}
