#!/usr/bin/python3

"""Local PNG segmentation server; run with the workspace's Pillow environment."""
import argparse
import io
import json
import re
import secrets
import threading
import hashlib
import uuid
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote
from PIL import Image
from r2_storage import R2Error, R2Storage


def make_handler(source, output, import_root=None, project_root=None, cloud=None, sync_projects=(), require_login=False):
    source, output = source.resolve(), output.resolve()
    lock = threading.RLock()
    datasets = {}
    imports = {}
    import_root = import_root or Path(__file__).resolve().parent.parent / 'imported_images'
    project_root = project_root or import_root.parent / 'spoke_projects'
    registry_path = project_root / 'projects.json'
    users_path = project_root.parent / 'users.json'
    users = json.loads(users_path.read_text()) if users_path.exists() else {}
    sessions = {}
    projects = json.loads(registry_path.read_text()) if registry_path.exists() else {}
    attributions = {}
    for key in projects:
        attribution_path = project_root / key / 'attribution.json'
        attributions[key] = (json.loads(attribution_path.read_text()) if attribution_path.exists()
                             else {'images': {}, 'masks': {}})

    def now():
        return datetime.now(timezone.utc).isoformat()

    def persist_users():
        users_path.parent.mkdir(parents=True, exist_ok=True)
        temp = users_path.with_suffix('.tmp')
        temp.write_text(json.dumps(users, indent=2) + '\n')
        temp.replace(users_path)

    def public_user(user):
        return {field: user[field] for field in ('id', 'email', 'username', 'created')}

    def current_user(headers):
        if not require_login:
            return None
        cookie = SimpleCookie()
        cookie.load(headers.get('Cookie', ''))
        token = cookie.get('spoke_session')
        user_id = sessions.get(token.value) if token else None
        return users.get(user_id)

    def create_session(user):
        token = secrets.token_urlsafe(32)
        sessions[token] = user['id']
        return f'spoke_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000'

    def create_account(body, login_only=False):
        email = body.get('email', '')
        if not isinstance(email, str):
            raise ValueError('Enter a valid email address')
        email = email.strip().casefold()
        if len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
            raise ValueError('Enter a valid email address')
        with lock:
            for user in users.values():
                if user['email'].casefold() == email:
                    if login_only:
                        return public_user(user), create_session(user)
                    raise ValueError('An account with this email already exists; please log in')
            if login_only:
                raise ValueError('No account uses this email; please sign up')
            username = body.get('username', '')
            if not isinstance(username, str) or not 1 <= len(username.strip()) <= 40:
                raise ValueError('Choose a username of 1–40 characters')
            user = {'id': uuid.uuid4().hex, 'email': email, 'username': username.strip(), 'created': now()}
            users[user['id']] = user
            persist_users()
            return public_user(user), create_session(user)

    def person(user_id):
        user = users.get(user_id)
        return {'id': user_id, 'username': user['username']} if user else None

    def record_attribution(key, folder, filename, user):
        if not user:
            return
        attributions.setdefault(key, {'images': {}, 'masks': {}})
        attributions[key].setdefault(folder, {})[filename] = {
            'user_id': user['id'], 'username': user['username'], 'timestamp': now()}
        folder_path = project_root / key
        folder_path.mkdir(parents=True, exist_ok=True)
        path = folder_path / 'attribution.json'
        temp = path.with_suffix('.tmp')
        data = json.dumps(attributions[key], indent=2) + '\n'
        temp.write_text(data)
        temp.replace(path)
        if cloud and projects.get(key, {}).get('r2_prefix'):
            cloud.save_attribution(projects[key]['r2_prefix'], data.encode())
        return attributions[key][folder][filename]

    def persist():
        project_root.mkdir(parents=True, exist_ok=True)
        temp = registry_path.with_suffix('.tmp')
        temp.write_text(json.dumps(projects, indent=2) + '\n')
        temp.replace(registry_path)

    def register(key, title, image_dir, mask_dir, r2_prefix=None, owner=None):
        projects[key] = {'id': key, 'name': title, 'images': str(image_dir.resolve()),
                         'masks': str(mask_dir.resolve()), 'created': now(), 'updated': now()}
        if r2_prefix:
            projects[key]['r2_prefix'] = r2_prefix
        if owner:
            projects[key]['created_by'] = owner
        attributions.setdefault(key, {'images': {}, 'masks': {}})
        ff = sorted(image_dir.glob('*.png'))
        ss = []
        for image_path in ff:
            with Image.open(image_path) as image:
                ss.append(image.size)
        datasets[key] = (ff, ss, mask_dir)

    for key, project in projects.items():
        ff = sorted(Path(project['images']).glob('*.png'))
        ss = []
        for image_path in ff:
            with Image.open(image_path) as image:
                ss.append(image.size)
        datasets[key] = (ff, ss, Path(project['masks']))
    if 'default' not in projects:
        register('default', source.name or 'Sample sequence', source, output)
    elif projects['default']['images'] != str(source) or projects['default']['masks'] != str(output):
        register('default', source.name or 'Sample sequence', source, output)

    # Recover sequences imported before the dashboard existed, preserving their masks.
    known_dirs = {p['images'] for p in projects.values()}
    known_masks = {p['masks'] for p in projects.values()}
    if import_root.exists():
        for folder in sorted(import_root.iterdir()):
            if not folder.is_dir() or str(folder.resolve()) in known_dirs:
                continue
            ff = sorted(folder.glob('*.png'))
            if not ff:
                continue
            digest = hashlib.sha256()
            try:
                for image_path in ff:
                    with Image.open(image_path) as image:
                        image.verify()
                    digest.update(image_path.name.encode())
                    digest.update(hashlib.sha256(image_path.read_bytes()).digest())
            except OSError:
                continue
            dest = output.parent / (output.name + '_imports') / digest.hexdigest()
            if str(dest.resolve()) in known_masks:
                continue
            register(folder.name, 'Imported sequence ' + ff[0].stem, folder, dest)
            known_masks.add(str(dest.resolve()))
    if cloud:
        for title in sync_projects:
            matches = [key for key, project in projects.items()
                       if project['name'] == title and not project.get('deleted')]
            if len(matches) != 1:
                raise R2Error(f'Expected exactly one existing project named {title!r}')
            key = matches[0]
            prefix = cloud.create_project(projects[key].get('r2_prefix', title), existing=True)
            projects[key]['r2_prefix'] = prefix
            remote_keys = set(cloud.list_keys(prefix + '/'))
            ff, _, mask_dir = datasets[key]
            for image_path in ff:
                key = f'{prefix}/images/{image_path.name}'
                if key not in remote_keys:
                    cloud.upload(prefix, 'images', image_path.name, image_path.read_bytes())
            for mask_path in sorted(mask_dir.glob('*.png')):
                key = f'{prefix}/masks/{mask_path.name}'
                if key not in remote_keys:
                    cloud.upload(prefix, 'masks', mask_path.name, mask_path.read_bytes())
    persist()

    def project_summary(key):
        project = projects[key]
        ff, _, dest = datasets[key]
        return {**project, 'creator': person(project.get('created_by')),
                'count': len(ff), 'annotated': sum((dest / p.name).exists() for p in ff)}

    def inventory(dataset, key):
        ff, ss, dest = dataset
        attribution = attributions.get(key, {})
        return [{'name': p.name, 'width': z[0], 'height': z[1], 'saved': (dest / p.name).exists(),
                 'image_attribution': attribution.get('images', {}).get(p.name),
                 'mask_attribution': attribution.get('masks', {}).get(p.name)}
                for p, z in zip(ff, ss)]

    def route(path):
        parts = path.strip('/').split('/')
        if len(parts) == 2:
            kind, raw = parts
            key = 'default'
        elif len(parts) == 3:
            kind, key, raw = parts
        else:
            raise ValueError('Invalid route')
        if projects[key].get('deleted'):
            raise KeyError(key)
        ff, ss, dest = datasets[key]
        index = int(raw)
        if not 0 <= index < len(ff):
            raise ValueError('Invalid frame')
        return kind, index, ff, ss, dest

    class Handler(BaseHTTPRequestHandler):
        def reply(self, data, mime='application/json', status=200, cookie=None):
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(data)))
            if cookie:
                self.send_header('Set-Cookie', cookie)
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = urlparse(self.path).path
            if path == '/':
                return self.reply(Path(__file__).with_name('index.html').read_bytes(), 'text/html')
            if path == '/api/auth':
                user = current_user(self.headers)
                return self.reply(json.dumps({'user': public_user(user) if user else None}).encode())
            if require_login and not current_user(self.headers):
                return self.reply(json.dumps({'error': 'Please log in'}).encode(), status=401)
            if path == '/api/frames':
                return self.reply(json.dumps(inventory(datasets['default'], 'default')).encode())
            try:
                if path == '/api/projects':
                    return self.reply(json.dumps([project_summary(key) for key in projects if not projects[key].get('deleted')]).encode())
                if path.startswith('/api/projects/'):
                    key = path.rsplit('/', 1)[1]
                    if projects[key].get('deleted'):
                        raise KeyError(key)
                    return self.reply(json.dumps({**project_summary(key), 'frames': inventory(datasets[key], key)}).encode())
                kind, index, ff, ss, dest_dir = route(path)
                if kind == 'frame':
                    return self.reply(ff[index].read_bytes(), 'image/png')
                if kind == 'mask':
                    dest = dest_dir / ff[index].name
                    if dest.exists():
                        return self.reply(dest.read_bytes(), 'image/png')
                    buf = io.BytesIO()
                    Image.new('L', ss[index]).save(buf, format='PNG')
                    return self.reply(buf.getvalue(), 'image/png')
            except (ValueError, IndexError, KeyError):
                pass
            self.reply(b'Not found', 'text/plain', 404)

        def do_POST(self):
            try:
                if self.headers.get('Origin') and self.headers['Origin'] != 'http://' + self.headers.get('Host', ''):
                    return self.reply(b'Forbidden origin', 'text/plain', 403)
                path = urlparse(self.path).path
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 <= length <= 50_000_000:
                    raise ValueError('Payload must be at most 50 MB')
                if path in ('/api/signup', '/api/login'):
                    body = json.loads(self.rfile.read(length))
                    user, cookie = create_account(body, login_only=path == '/api/login')
                    return self.reply(json.dumps({'user': user}).encode(), cookie=cookie)
                user = current_user(self.headers)
                if require_login and not user:
                    return self.reply(json.dumps({'error': 'Please log in'}).encode(), status=401)
                if path == '/api/auth/logout':
                    cookie = SimpleCookie()
                    cookie.load(self.headers.get('Cookie', ''))
                    token = cookie.get('spoke_session')
                    if token:
                        sessions.pop(token.value, None)
                    return self.reply(b'{"success":true}',
                                      cookie='spoke_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
                if path.startswith('/api/projects/'):
                    _, _, key, action = path.strip('/').split('/')
                    with lock:
                        if key not in projects or projects[key].get('deleted'):
                            raise ValueError('Project not found')
                        if action == 'rename':
                            body = json.loads(self.rfile.read(length))
                            title = body.get('name', '')
                            if not isinstance(title, str) or not title.strip() or len(title.strip()) > 120:
                                raise ValueError('Enter a project name of 1–120 characters')
                            projects[key]['name'] = title.strip()
                        elif action == 'delete':
                            if cloud and projects[key].get('r2_prefix'):
                                deleted_prefix = cloud.move_to_recently_deleted(projects[key]['r2_prefix'])
                                projects[key]['r2_deleted_prefix'] = deleted_prefix
                            projects[key]['deleted'] = True
                        else:
                            raise ValueError('Unknown project action')
                        projects[key]['updated'] = now()
                        persist()
                    return self.reply(b'{"success":true}')
                if path == '/api/projects':
                    body = json.loads(self.rfile.read(length))
                    title = body.get('name', '').strip()
                    if not title or len(title) > 120:
                        raise ValueError('Enter a project name of 1–120 characters')
                    if cloud and any(not project.get('deleted') and project['name'] == title
                                     for project in projects.values()):
                        raise ValueError('A project with this name already exists; choose another name')
                    r2_prefix = cloud.create_project(title) if cloud else None
                    key = uuid.uuid4().hex
                    folder = project_root / key
                    (folder / 'images').mkdir(parents=True)
                    with lock:
                        register(key, title, folder / 'images', folder / 'masks', r2_prefix,
                                 owner=user['id'] if user else None)
                        persist()
                    return self.reply(json.dumps(project_summary(key)).encode())
                if path == '/api/import':
                    key = uuid.uuid4().hex
                    folder = import_root / key
                    folder.mkdir(parents=True)
                    target = self.headers.get('X-Project-Id')
                    if target and (target not in projects or projects[target].get('deleted') or datasets[target][0]):
                        raise ValueError('Images can only be imported into an empty project; create another project for a new sequence')
                    imports[key] = (folder, target)
                    return self.reply(json.dumps({'id': key}).encode())
                if path.startswith('/import/'):
                    _, key, action = path.strip('/').split('/')
                    folder, target = imports[key]
                    if action == 'finish':
                        ff = sorted(folder.glob('*.png'), key=lambda p: p.name)
                        if not ff:
                            raise ValueError('Choose at least one PNG image')
                        digest = hashlib.sha256()
                        ss = []
                        for image_path in ff:
                            digest.update(image_path.name.encode())
                            digest.update(hashlib.sha256(image_path.read_bytes()).digest())
                            with Image.open(image_path) as im:
                                ss.append(im.size)
                        dest_dir = output.parent / (output.name + '_imports') / digest.hexdigest()
                        with lock:
                            if target:
                                if projects[target].get('deleted') or datasets[target][0]:
                                    raise ValueError('Project already has images')
                                key_id = target
                                dest_dir = Path(projects[target]['masks'])
                                projects[target]['images'] = str(folder.resolve())
                                projects[target]['updated'] = now()
                                datasets[target] = (ff, ss, dest_dir)
                            else:
                                key_id = key
                                title = 'Imported sequence ' + ff[0].stem
                                r2_prefix = cloud.create_project(title) if cloud else None
                                register(key_id, title, folder, dest_dir, r2_prefix,
                                         owner=user['id'] if user else None)
                                if cloud:
                                    for image_path in ff:
                                        cloud.upload(r2_prefix, 'images', image_path.name, image_path.read_bytes())
                                    cloud.save_attribution(r2_prefix, json.dumps(attributions[key_id], indent=2).encode())
                            persist()
                            del imports[key]
                        return self.reply(json.dumps({'id': key_id, 'name': projects[key_id]['name'], 'frames': inventory(datasets[key_id], key_id), 'masks': str(dest_dir)}).encode())
                    if action != 'image':
                        raise ValueError('Invalid import action')
                    name = json.loads(unquote(self.headers.get('X-Image-Name', '""')))
                    if not isinstance(name, str) or not name or '/' in name or '\\' in name or not name.lower().endswith('.png'):
                        raise ValueError('Invalid PNG filename')
                    name = name[:-4] + '.png'
                    image_bytes = self.rfile.read(length)
                    with Image.open(io.BytesIO(image_bytes)) as im:
                        if im.format != 'PNG':
                            raise ValueError('Only PNG images are supported')
                        im.verify()
                    dest = folder / name
                    if dest.exists():
                        raise ValueError('Duplicate filename: ' + name)
                    dest.write_bytes(image_bytes)
                    record_attribution(target or key, 'images', name, user)
                    if cloud and target:
                        cloud.upload(projects[target]['r2_prefix'], 'images', name, image_bytes)
                    return self.reply(b'{"imported":true}')
                kind, index, ff, ss, dest_dir = route(path)
                if kind != 'mask' or length == 0:
                    raise ValueError('Invalid mask request')
                with Image.open(io.BytesIO(self.rfile.read(length))) as image:
                    if image.size != ss[index]:
                        raise ValueError('Mask dimensions do not match source')
                    mask = image.convert('L').point(lambda p: 255 if p > 0 else 0)
                with lock:
                    dest_dir.mkdir(parents=True, exist_ok=True)
                    dest = dest_dir / ff[index].name
                    temp = dest.with_suffix('.tmp')
                    mask.save(temp, format='PNG')
                    temp.replace(dest)
                    project_key = path.strip('/').split('/')[1] if len(path.strip('/').split('/')) == 3 else 'default'
                    projects[project_key]['updated'] = now()
                    record_attribution(project_key, 'masks', dest.name, user)
                    persist()
                    if cloud and 'r2_prefix' in projects[project_key]:
                        cloud.upload(projects[project_key]['r2_prefix'], 'masks', dest.name, dest.read_bytes())
                self.reply(json.dumps({'saved': True, 'attribution': attributions[project_key]['masks'].get(dest.name)}).encode())
            except R2Error as error:
                self.reply(json.dumps({'error': str(error)}).encode(), status=502)
            except (ValueError, OSError, KeyError) as error:
                self.reply(json.dumps({'error': str(error)}).encode(), status=400)

    return Handler


if __name__ == '__main__':
    studio_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser()
    parser.add_argument('--images', type=Path, default=studio_root.parent / '081_SPKMVLFLP' / 'png')
    parser.add_argument('--masks', type=Path, default=studio_root / 'spoke_masks')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-r2', action='store_true', help='Run with local storage only')
    args = parser.parse_args()
    if args.images.resolve() == args.masks.resolve():
        parser.error('Mask directory must differ from source directory')
    try:
        cloud = None if args.no_r2 else R2Storage.from_env()
        handler = make_handler(args.images, args.masks, cloud=cloud, require_login=True,
                               sync_projects=('temp-project', 'more masks') if cloud else ())
    except R2Error as error:
        parser.error(str(error))
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    if cloud:
        def clean_recycle_bin(stop):
            while not stop.is_set():
                try:
                    removed = cloud.cleanup_deleted()
                    if removed:
                        print(f'Removed {removed} expired objects from R2 recently_deleted/', flush=True)
                except R2Error as error:
                    print(str(error), flush=True)
                stop.wait(24 * 60 * 60)
        stop_cleanup = threading.Event()
        threading.Thread(target=clean_recycle_bin, args=(stop_cleanup,),
                         daemon=True, name='r2-retention').start()
    print(f'Spoke Studio: http://127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if cloud:
            stop_cleanup.set()
