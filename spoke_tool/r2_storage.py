"""Cloudflare R2 project storage. Credentials stay outside the application code."""
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path


class R2Error(Exception):
    """An R2 request or configuration failed."""


class R2Storage:
    def __init__(self, client, bucket):
        self.client = client
        self.bucket = bucket

    @classmethod
    def from_env(cls, env_file=None):
        values = {}
        env_file = env_file or Path(__file__).resolve().parent.parent / '.env'
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    name, value = line.split('=', 1)
                    values[name.removeprefix('export ').strip()] = value.strip().strip('"\'')
        missing = [name for name in ('CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY')
                   if not os.environ.get(name) and not values.get(name)]
        if missing:
            raise R2Error('Missing R2 configuration: ' + ', '.join(missing))
        try:
            import boto3
            from botocore.config import Config
            from botocore.exceptions import BotoCoreError, ClientError
        except ImportError as error:
            raise R2Error('Install the Python requirements to enable R2 storage') from error
        cls.api_error = (BotoCoreError, ClientError)
        account_id = os.environ.get('CLOUDFLARE_ACCOUNT_ID', values.get('CLOUDFLARE_ACCOUNT_ID'))
        client = boto3.client(
            's3',
            endpoint_url=f'https://{account_id}.r2.cloudflarestorage.com',
            aws_access_key_id=os.environ.get('R2_ACCESS_KEY_ID', values.get('R2_ACCESS_KEY_ID')),
            aws_secret_access_key=os.environ.get('R2_SECRET_ACCESS_KEY', values.get('R2_SECRET_ACCESS_KEY')),
            region_name='auto',
            config=Config(signature_version='s3v4', retries={'max_attempts': 3, 'mode': 'standard'}),
        )
        return cls(client, os.environ.get('R2_BUCKET', values.get('R2_BUCKET', 'spoke-studio')))

    def list_keys(self, prefix):
        try:
            pages = self.client.get_paginator('list_objects_v2').paginate(
                Bucket=self.bucket, Prefix=prefix)
            return [item['Key'] for page in pages for item in page.get('Contents', [])]
        except self.api_error as error:
            raise R2Error(f'R2 listing failed: {error}') from error

    @staticmethod
    def prefix(name):
        if not isinstance(name, str) or not name or len(name) > 120:
            raise R2Error('Project name must contain 1–120 characters')
        if any(ord(char) < 32 for char in name) or '\\' in name or '/' in name:
            raise R2Error('R2 project names cannot contain slashes or control characters')
        if name in ('.', '..'):
            raise R2Error('Invalid R2 project name')
        return name

    def call(self, operation, **kwargs):
        try:
            return getattr(self.client, operation)(Bucket=self.bucket, **kwargs)
        except self.api_error as error:
            raise R2Error(f'R2 upload failed: {error}') from error

    def create_project(self, name, existing=False):
        prefix = self.prefix(name)
        if not existing:
            result = self.call('list_objects_v2', Prefix=prefix + '/', MaxKeys=1)
            if result.get('KeyCount'):
                raise R2Error(f'R2 already contains a project named {name!r}; choose another name')
        for folder in ('images', 'masks'):
            self.call('put_object', Key=f'{prefix}/{folder}/', Body=b'')
        return prefix

    def upload(self, project, folder, filename, data):
        if folder not in ('images', 'masks'):
            raise ValueError('Invalid R2 folder')
        self.call('put_object', Key=f'{self.prefix(project)}/{folder}/{filename}',
                  Body=data, ContentType='image/png')

    def save_attribution(self, project, data):
        self.call('put_object', Key=f'{self.prefix(project)}/attribution.json',
                  Body=data, ContentType='application/json')

    def move_to_recently_deleted(self, project):
        prefix = self.prefix(project)
        destination = f'recently_deleted/{prefix}/{uuid.uuid4().hex}'
        try:
            pages = self.client.get_paginator('list_objects_v2').paginate(
                Bucket=self.bucket, Prefix=prefix + '/')
            key_batches, batch = [], []
            for page in pages:
                for item in page.get('Contents', []):
                    key = item['Key']
                    self.call('copy_object', CopySource={'Bucket': self.bucket, 'Key': key},
                              Key=destination + key[len(prefix):])
                    batch.append({'Key': key})
                    if len(batch) == 1000:
                        key_batches.append(batch)
                        batch = []
            if batch:
                key_batches.append(batch)
            for batch in key_batches:
                result = self.call('delete_objects', Delete={'Objects': batch, 'Quiet': True})
                if result.get('Errors'):
                    raise R2Error('R2 could not remove all original project objects after copying')
        except self.api_error as error:
            raise R2Error(f'R2 deletion failed: {error}') from error
        return destination + '/'

    def cleanup_deleted(self, now=None):
        """Expire recycle-bin objects using their move (LastModified) timestamps."""
        cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=30)
        expired = []
        try:
            pages = self.client.get_paginator('list_objects_v2').paginate(
                Bucket=self.bucket, Prefix='recently_deleted/')
            for page in pages:
                for item in page.get('Contents', []):
                    modified = item.get('LastModified')
                    if modified is not None and modified <= cutoff:
                        expired.append({'Key': item['Key']})
        except self.api_error as error:
            raise R2Error(f'R2 cleanup failed: {error}') from error
        for start in range(0, len(expired), 1000):
            result = self.call('delete_objects',
                               Delete={'Objects': expired[start:start + 1000], 'Quiet': True})
            if result.get('Errors'):
                raise R2Error('R2 cleanup could not remove every expired object')
        return len(expired)
