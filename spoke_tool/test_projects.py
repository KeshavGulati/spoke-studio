import io
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from server import make_handler


class ProjectTests(unittest.TestCase):
    def test_persistence_and_project_mask_isolation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source'
            source.mkdir()
            Image.new('L', (8, 5)).save(source / 'sample.png')

            def start():
                return make_handler(source, root / 'masks', root / 'imports', root / 'projects')

            handler = start()

            def request(path, data=b'', headers=None, method='do_POST'):
                obj = handler.__new__(handler)
                obj.path = path
                obj.headers = {'Content-Length': str(len(data)), **(headers or {})}
                obj.rfile = io.BytesIO(data)
                replies = []
                obj.reply = lambda body, mime='application/json', status=200: replies.append((status, body))
                getattr(obj, method)()
                return replies[0]

            def get(path):
                status, body = request(path, method='do_GET')
                self.assertEqual(status, 200)
                return json.loads(body)

            def png(value):
                buf = io.BytesIO()
                Image.new('L', (8, 5), value).save(buf, format='PNG')
                return buf.getvalue()

            ids = []
            for name in ['Observation A', 'Observation B']:
                status, body = request('/api/projects', json.dumps({'name': name}).encode())
                self.assertEqual(status, 200)
                project = json.loads(body)
                self.assertEqual(project['count'], 0)
                ids.append(project['id'])
                status, body = request('/api/import', headers={'X-Project-Id': project['id']})
                key = json.loads(body)['id']
                self.assertEqual(request(f'/import/{key}/image', png(20), {'X-Image-Name': '"sample.png"'})[0], 200)
                status, body = request(f'/import/{key}/finish')
                self.assertEqual(json.loads(body)['id'], project['id'])

            self.assertEqual(request(f'/mask/{ids[0]}/0', png(255))[0], 200)
            self.assertEqual(get(f'/api/projects/{ids[0]}')['annotated'], 1)
            self.assertEqual(get(f'/api/projects/{ids[1]}')['annotated'], 0)
            self.assertEqual(get('/api/projects/default')['annotated'], 0)
            self.assertEqual(request('/api/import', headers={'X-Project-Id': ids[0]})[0], 400)
            handler = start()
            projects = get('/api/projects')
            self.assertEqual(len(projects), 3)
            self.assertEqual(get(f'/api/projects/{ids[0]}')['name'], 'Observation A')
            self.assertTrue(get(f'/api/projects/{ids[0]}')['frames'][0]['saved'])
            status, image = request(f'/mask/{ids[0]}/0', method='do_GET')
            self.assertEqual(Image.open(io.BytesIO(image)).getextrema(), (255, 255))
            self.assertEqual(request('/api/projects', b'{"name":"  "}')[0], 400)
            self.assertEqual(request(f'/api/projects/{ids[0]}/rename', b'{"name":"Renamed observation"}')[0], 200)
            self.assertEqual(request(f'/api/projects/{ids[0]}/rename', b'{"name":" "}')[0], 400)
            preserved_mask = Path(get(f'/api/projects/{ids[0]}')['masks']) / 'sample.png'
            self.assertEqual(request(f'/api/projects/{ids[0]}/delete')[0], 200)
            self.assertEqual(request('/api/projects/default/delete')[0], 200)
            handler = start()
            remaining = get('/api/projects')
            self.assertEqual([p['id'] for p in remaining], [ids[1]])
            self.assertTrue(preserved_mask.exists())
            self.assertTrue((source / 'sample.png').exists())
            self.assertEqual(request(f'/api/projects/{ids[0]}', method='do_GET')[0], 404)
            self.assertEqual(request(f'/mask/{ids[0]}/0', png(0))[0], 400)
            self.assertEqual(request(f'/api/projects/{ids[1]}/rename', b'{"name":"Still here"}')[0], 200)
            handler = start()
            self.assertEqual(get(f'/api/projects/{ids[1]}')['name'], 'Still here')


if __name__ == '__main__':
    unittest.main()
