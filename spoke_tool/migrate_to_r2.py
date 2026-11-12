#!/usr/bin/env python3
"""One-time migration from local Spoke Studio storage to the Cloudflare Worker schema."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image
from r2_storage import R2Error, R2Storage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resume', action='store_true', help='Merge into an earlier migration of this local registry')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    projects = json.loads((root / 'spoke_projects' / 'projects.json').read_text())
    cloud = R2Storage.from_env(root / '.env')
    try:
        cloud.call('head_object', Key='projects.json')
        if not args.resume:
            raise R2Error('R2 projects.json already exists; use --resume only to continue this migration')
        registry = json.loads(cloud.call('get_object', Key='projects.json')['Body'].read())
    except R2Error as error:
        if getattr(error.__cause__, 'response', {}).get('Error', {}).get('Code') not in ('404', 'NoSuchKey'):
            raise
        registry = {}

    local_users_path = root / 'users.json'
    if local_users_path.exists():
        try:
            object = cloud.call('get_object', Key='users.json')
            users = json.loads(object['Body'].read())
        except R2Error as error:
            if getattr(error.__cause__, 'response', {}).get('Error', {}).get('Code') not in ('404', 'NoSuchKey'):
                raise
            users = {}
        users.update(json.loads(local_users_path.read_text()))
        cloud.call('put_object', Key='users.json', Body=json.dumps(users, indent=2).encode(),
                   ContentType='application/json')

    def upload(key, path, folder):
        data = path.read_bytes()
        try:
            existing = cloud.call('head_object', Key=key)
            if existing['ContentLength'] == len(data) and existing['ETag'].strip('"') == hashlib.md5(data).hexdigest():
                return False
            raise R2Error(f'Refusing to overwrite a different existing object: {key}')
        except R2Error as error:
            if getattr(error.__cause__, 'response', {}).get('Error', {}).get('Code') not in ('404', 'NoSuchKey'):
                raise
        cache_control = 'public, max-age=31536000, immutable' if folder == 'images' else 'no-store'
        cloud.call('put_object', Key=key, Body=data, ContentType='image/png', CacheControl=cache_control)
        return True

    total_images = total_masks = 0
    for key, project in projects.items():
        prefix = project.get('r2_prefix', project['name'])
        source = Path(project['images'])
        mask_dir = Path(project['masks'])
        if project.get('deleted'):
            registry[key] = {**project, 'r2_prefix': prefix}
            continue
        images = []
        for path in sorted(source.glob('*.png')):
            with Image.open(path) as image:
                width, height = image.size
                image.verify()
            destination = f'{prefix}/images/{path.name}'
            total_images += upload(destination, path, 'images')
            images.append({'name': path.name, 'width': width, 'height': height,
                           'saved': (mask_dir / path.name).exists()})
        for path in sorted(mask_dir.glob('*.png')):
            total_masks += upload(f'{prefix}/masks/{path.name}', path, 'masks')
        cloud.call('put_object', Key=prefix + '/images/', Body=b'')
        cloud.call('put_object', Key=prefix + '/masks/', Body=b'')
        cloud.call('put_object', Key=f'_system/projects/{key}/images.json',
                   Body=json.dumps(images, indent=2).encode(), ContentType='application/json')
        attribution_path = root / 'spoke_projects' / key / 'attribution.json'
        if attribution_path.exists():
            attribution = json.loads(attribution_path.read_text())
        else:
            attribution = {'images': {}, 'masks': {}}
        attribution.setdefault('images', {})
        attribution.setdefault('masks', {})
        for destination in (f'_system/attribution/{key}.json', f'{prefix}/attribution.json'):
            cloud.call('put_object', Key=destination, Body=json.dumps(attribution, indent=2).encode(),
                       ContentType='application/json')
        registry[key] = {**project, 'r2_prefix': prefix,
                         'images': f'r2://spoke-studio/{prefix}/images',
                         'masks': f'r2://spoke-studio/{prefix}/masks',
                         'count': len(images), 'annotated': sum(image['saved'] for image in images)}
        print(f"Migrated {project['name']}: {len(images)} images, {sum(image['saved'] for image in images)} masks", flush=True)
    cloud.call('put_object', Key='projects.json', Body=json.dumps(registry, indent=2).encode(),
               ContentType='application/json')
    print(f'Migration complete: {total_images} new image objects, {total_masks} new mask objects. Local files were not deleted.')


if __name__ == '__main__':
    main()
