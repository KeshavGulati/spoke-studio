import io
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from server import make_handler


class ImportTests(unittest.TestCase):
    def test_import_sort_save_isolation_and_reimport(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            handler = make_handler(root / 'empty', root / 'masks', root / 'imports')

            def request(path, data=b'', name=None, method='do_POST'):
                obj = handler.__new__(handler)
                obj.path = path
                obj.headers = {'Content-Length': str(len(data))}
                if name is not None:
                    obj.headers['X-Image-Name'] = json.dumps(name)
                obj.rfile = io.BytesIO(data)
                replies = []
                obj.reply = lambda body, mime='application/json', status=200: replies.append((status, body))
                getattr(obj, method)()
                return replies[0]

            def png(size, value):
                buf = io.BytesIO()
                Image.new('L', size, value).save(buf, format='PNG')
                return buf.getvalue()

            def import_sequence(value):
                key = json.loads(request('/api/import')[1])['id']
                self.assertEqual(request(f'/import/{key}/image', png((8, 5), value), 'b.PNG')[0], 200)
                self.assertEqual(request(f'/import/{key}/image', png((8, 4), value), 'a.png')[0], 200)
                self.assertEqual(request(f'/import/{key}/image', b'invalid', '../bad.png')[0], 400)
                self.assertEqual(request(f'/import/{key}/image', b'invalid', 'bad.png')[0], 400)
                result = json.loads(request(f'/import/{key}/finish')[1])
                self.assertEqual([f['name'] for f in result['frames']], ['a.png', 'b.png'])
                return key, result

            key, first = import_sequence(50)
            self.assertEqual(request(f'/mask/{key}/0', png((8, 4), 130))[0], 200)
            with Image.open(Path(first['masks']) / 'a.png') as mask:
                self.assertEqual(mask.mode, 'L')
                self.assertEqual(mask.getextrema(), (255, 255))
            self.assertEqual(request(f'/mask/{key}/0', png((8, 5), 255))[0], 400)
            _, repeat = import_sequence(50)
            self.assertEqual(first['masks'], repeat['masks'])
            self.assertTrue(repeat['frames'][0]['saved'])
            other_key, other = import_sequence(60)
            self.assertNotEqual(first['masks'], other['masks'])
            self.assertFalse(other['frames'][0]['saved'])
            status, data = request(f'/frame/{other_key}/0', method='do_GET')
            self.assertEqual(status, 200)
            self.assertEqual(Image.open(io.BytesIO(data)).size, (8, 4))
            self.assertEqual(json.loads(request('/api/frames', method='do_GET')[1]), [])


if __name__ == '__main__':
    unittest.main()
