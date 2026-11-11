import io
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from PIL import Image
from server import make_handler


class AuthenticationTests(unittest.TestCase):
    def test_login_signup_and_image_mask_attribution(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            handler = make_handler(root / 'images', root / 'masks', root / 'imports', root / 'projects',
                                   require_login=True)

            def request(path, data=b'', cookie=None, method='do_POST', headers=None):
                obj = handler.__new__(handler)
                obj.path = path
                obj.headers = {'Content-Length': str(len(data)), **(headers or {})}
                if cookie:
                    obj.headers['Cookie'] = cookie.split(';', 1)[0]
                obj.rfile = io.BytesIO(data)
                replies = []
                obj.reply = lambda body, mime='application/json', status=200, cookie=None: replies.append((status, body, cookie))
                getattr(obj, method)()
                return replies[0]

            self.assertEqual(request('/api/projects', method='do_GET')[0], 401)

            def signup(email, username):
                data = json.dumps({'email': email, 'username': username}).encode()
                status, body, cookie = request('/api/signup', data)
                self.assertEqual(status, 200)
                return json.loads(body)['user'], cookie

            alice, alice_cookie = signup('Alice@Example.com', 'Alice')
            bob, bob_cookie = signup('bob@example.com', 'Bob')
            self.assertNotEqual(alice['id'], bob['id'])
            uuid.UUID(alice['id'])
            self.assertEqual(request('/api/signup', b'{"email":"alice@example.com","username":"Other"}')[0], 400)
            status, body, new_cookie = request('/api/login', b'{"email":"ALICE@example.com"}')
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['user']['id'], alice['id'])
            self.assertNotEqual(new_cookie, alice_cookie)
            alice_cookie = new_cookie
            status, body, _ = request('/api/auth', method='do_GET', cookie=alice_cookie)
            self.assertEqual(json.loads(body)['user']['username'], 'Alice')
            users = json.loads((root / 'users.json').read_text())
            self.assertEqual(users[alice['id']]['email'], 'alice@example.com')
            self.assertNotIn('password', users[alice['id']])

            status, body, _ = request('/api/projects', b'{"name":"Attribution project"}', alice_cookie)
            self.assertEqual(status, 200)
            project = json.loads(body)
            self.assertEqual(project['created_by'], alice['id'])
            self.assertEqual(project['creator']['username'], 'Alice')
            status, body, _ = request('/api/import', cookie=alice_cookie,
                                      headers={'X-Project-Id': project['id']})
            self.assertEqual(status, 200)
            import_key = json.loads(body)['id']

            image = io.BytesIO()
            Image.new('RGB', (8, 5), (25, 50, 75)).save(image, format='PNG')
            status, body, _ = request(f'/import/{import_key}/image', image.getvalue(), alice_cookie,
                                      headers={'X-Image-Name': '"frame.png"'})
            self.assertEqual(status, 200)
            status, body, _ = request(f'/import/{import_key}/finish', cookie=alice_cookie)
            self.assertEqual(status, 200)

            mask = io.BytesIO()
            Image.new('L', (8, 5), 255).save(mask, format='PNG')
            status, body, _ = request(f'/mask/{project["id"]}/0', mask.getvalue(), bob_cookie)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['attribution']['user_id'], bob['id'])

            status, body, _ = request(f'/api/projects/{project["id"]}', cookie=alice_cookie, method='do_GET')
            result = json.loads(body)
            frame = result['frames'][0]
            self.assertEqual(frame['image_attribution']['user_id'], alice['id'])
            self.assertEqual(frame['image_attribution']['username'], 'Alice')
            self.assertEqual(frame['mask_attribution']['user_id'], bob['id'])
            self.assertEqual(frame['mask_attribution']['username'], 'Bob')
            self.assertNotIn('email', frame['image_attribution'])
            metadata = json.loads((root / 'projects' / project['id'] / 'attribution.json').read_text())
            self.assertIn('timestamp', metadata['images']['frame.png'])
            status, _, cookie = request('/api/auth/logout', cookie=alice_cookie)
            self.assertEqual(status, 200)
            self.assertIn('Max-Age=0', cookie)
            self.assertEqual(request('/api/projects', method='do_GET', cookie=alice_cookie)[0], 401)

    def test_invalid_accounts_and_unknown_email(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            handler = make_handler(root / 'images', root / 'masks', root / 'imports', root / 'projects',
                                   require_login=True)
            for body in ({'email': 'not-an-email', 'username': 'Test'},
                         {'email': 'test@example.com', 'username': ''}):
                obj = handler.__new__(handler)
                obj.path = '/api/signup'
                obj.headers = {'Content-Length': str(len(json.dumps(body)))}
                obj.rfile = io.BytesIO(json.dumps(body).encode())
                replies = []
                obj.reply = lambda body, mime='application/json', status=200, cookie=None: replies.append(status)
                obj.do_POST()
                self.assertEqual(replies[0], 400)
            obj.path = '/api/login'
            obj.headers['Content-Length'] = '31'
            obj.rfile = io.BytesIO(b'{"email":"missing@example.com"}')
            obj.do_POST()
            self.assertEqual(replies[-1], 400)
            self.assertFalse((root / 'users.json').exists())


if __name__ == '__main__':
    unittest.main()
