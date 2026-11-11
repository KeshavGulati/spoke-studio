import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from PIL import Image
from r2_storage import R2Storage
from server import make_handler


class FakeR2:
    def __init__(self):
        self.objects = {}
        self.calls = []

    def list_keys(self, prefix):
        return [key for key in self.objects if key.startswith(prefix)]

    def create_project(self, name, existing=False):
        name = R2Storage.prefix(name)
        if not existing and any(key.startswith(name + '/') for key in self.objects):
            raise ValueError('duplicate')
        for folder in ('images', 'masks'):
            self.objects[f'{name}/{folder}/'] = b''
        self.calls.append(('create', name, existing))
        return name

    def upload(self, project, folder, filename, data):
        self.objects[f'{project}/{folder}/{filename}'] = data
        self.calls.append(('upload', project, folder, filename))

    def save_attribution(self, project, data):
        self.objects[f'{project}/attribution.json'] = data

    def move_to_recently_deleted(self, project):
        destination = f'recently_deleted/{project}/test-deletion'
        for key in list(self.objects):
            if key.startswith(project + '/'):
                self.objects[destination + key[len(project):]] = self.objects.pop(key)
        self.calls.append(('delete', project))
        return destination + '/'


class R2Tests(unittest.TestCase):
    def test_project_image_mask_uploads_and_existing_sync(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cloud = FakeR2()
            source = root / 'source'
            source.mkdir()
            Image.new('L', (8, 5), 25).save(source / 'source.png')
            local_masks = root / 'masks'
            local_masks.mkdir()
            Image.new('L', (8, 5), 255).save(local_masks / 'mask.png')
            project_root = root / 'projects'
            project_root.mkdir()
            (project_root / 'projects.json').write_text(json.dumps({'default': {
                'id': 'default', 'name': 'Existing', 'images': str(source), 'masks': str(local_masks),
            }}))
            handler = make_handler(source, local_masks, root / 'imports', project_root,
                                   cloud=cloud, sync_projects=('Existing',))

            def request(path, data=b'', headers=None, method='do_POST'):
                obj = handler.__new__(handler)
                obj.path = path
                obj.headers = {'Content-Length': str(len(data)), **(headers or {})}
                obj.rfile = io.BytesIO(data)
                replies = []
                obj.reply = lambda body, mime='application/json', status=200: replies.append((status, body))
                getattr(obj, method)()
                return replies[0]

            self.assertIn('Existing/images/source.png', cloud.objects)
            self.assertIn('Existing/masks/mask.png', cloud.objects)
            status, body = request('/api/projects', b'{"name":"New Project"}')
            self.assertEqual(status, 200)
            key = json.loads(body)['id']
            creates = [call for call in cloud.calls if call[0] == 'create']
            self.assertEqual(creates, [('create', 'Existing', True), ('create', 'New Project', False)])
            self.assertIn('New Project/images/', cloud.objects)
            self.assertIn('New Project/masks/', cloud.objects)
            key = json.loads(request('/api/import', headers={'X-Project-Id': key})[1])['id']
            image = io.BytesIO()
            Image.new('RGB', (8, 5), (25, 50, 75)).save(image, format='PNG')
            request(f'/import/{key}/image', image.getvalue(), {'X-Image-Name': '"frame.png"'})
            self.assertEqual(cloud.objects['New Project/images/frame.png'], image.getvalue())
            mask = io.BytesIO()
            Image.new('L', (8, 5), 255).save(mask, format='PNG')
            request(f'/import/{key}/finish')
            status, _ = request(f'/mask/{json.loads(body)["id"]}/0', mask.getvalue())
            self.assertEqual(status, 200)
            self.assertEqual(cloud.objects['New Project/masks/frame.png'], mask.getvalue())
            projects = json.loads(request('/api/projects', method='do_GET')[1])
            new_project = next(project for project in projects if project['name'] == 'New Project')
            request(f'/api/projects/{new_project["id"]}/rename', b'{"name":"Renamed Project"}')
            request(f'/mask/{new_project["id"]}/0', mask.getvalue())
            self.assertIn('New Project/masks/frame.png', cloud.objects)
            self.assertFalse(any(key.startswith('Renamed Project/') for key in cloud.objects))
            status, _ = request(f'/api/projects/{new_project["id"]}/delete')
            self.assertEqual(status, 200)
            self.assertFalse(any(key.startswith('New Project/') for key in cloud.objects))
            self.assertIn('recently_deleted/New Project/test-deletion/images/frame.png', cloud.objects)
            self.assertIn('recently_deleted/New Project/test-deletion/masks/frame.png', cloud.objects)
            self.assertIn('recently_deleted/New Project/test-deletion/images/', cloud.objects)
            self.assertIn('recently_deleted/New Project/test-deletion/masks/', cloud.objects)
            projects = json.loads((root / 'projects' / 'projects.json').read_text())
            self.assertEqual(projects[new_project['id']]['r2_deleted_prefix'],
                             'recently_deleted/New Project/test-deletion/')
            self.assertTrue(projects[new_project['id']]['deleted'])

    def test_safe_r2_prefixes(self):
        for name in ('project', 'Project 2', 'temp-project', 'a.b_c'):
            self.assertEqual(R2Storage.prefix(name), name)
        for name in ('', '.', '..', 'project/images', 'project\\images', 'a\nb', 'x' * 121):
            with self.assertRaises(Exception):
                R2Storage.prefix(name)

    def test_cleanup_only_expires_recycle_bin_objects_after_30_days(self):
        class Client:
            def __init__(self):
                now = datetime(2026, 11, 11, tzinfo=timezone.utc)
                self.pages = [{'Contents': [
                    {'Key': 'recently_deleted/old/images/file.png', 'LastModified': now - timedelta(days=31)},
                    {'Key': 'recently_deleted/old/masks/', 'LastModified': now - timedelta(days=29)},
                ]}, {'Contents': [
                    {'Key': 'active/images/file.png', 'LastModified': now - timedelta(days=31)},
                ]}]
                self.deleted = []

            def get_paginator(self, operation):
                self.assert_paginator = operation
                return self

            def paginate(self, Bucket, Prefix):
                assert Bucket == 'spoke-studio'
                assert Prefix == 'recently_deleted/'
                assert self.assert_paginator == 'list_objects_v2'
                return [{**page, 'Contents': [item for item in page.get('Contents', [])
                                              if item['Key'].startswith(Prefix)]}
                        for page in self.pages]

            def delete_objects(self, Bucket, Delete):
                self.deleted.extend(Delete['Objects'])
                removed = {item['Key'] for item in Delete['Objects']}
                for page in self.pages:
                    page['Contents'] = [item for item in page['Contents'] if item['Key'] not in removed]
                return {'Deleted': Delete['Objects']}

        client = Client()
        storage = R2Storage(client, 'spoke-studio')
        now = datetime(2026, 11, 11, tzinfo=timezone.utc)
        self.assertEqual(storage.cleanup_deleted(now=now), 1)
        self.assertEqual(client.deleted, [{'Key': 'recently_deleted/old/images/file.png'}])
        self.assertEqual(storage.cleanup_deleted(now=now), 0)


if __name__ == '__main__':
    unittest.main()
