"""Evidence file storage.

A pluggable backend: local filesystem for dev, Azure Blob in production (C4).
``save_evidence`` returns the stored path, SHA-256 and size. Files are never
overwritten — replacement creates a new object (SOX), enforced by the caller.
"""

import hashlib
import uuid
from dataclasses import dataclass
from pathlib import Path

from app.config import settings


@dataclass
class StoredFile:
    storage_path: str
    file_hash: str
    file_size: int


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


class LocalStorage:
    """Filesystem backend (dev)."""

    def __init__(self, base_dir: str) -> None:
        self.base = Path(base_dir)

    def save(self, *, tenant_id: uuid.UUID, filename: str, content: bytes) -> StoredFile:
        digest = _sha256(content)
        # content-addressed path keeps originals immutable and dedups identical files
        dest_dir = self.base / str(tenant_id)
        dest_dir.mkdir(parents=True, exist_ok=True)
        safe_name = f"{digest}_{Path(filename).name}"
        dest = dest_dir / safe_name
        if not dest.exists():
            dest.write_bytes(content)
        return StoredFile(storage_path=str(dest), file_hash=digest, file_size=len(content))


class AzureBlobStorage:
    """Azure Blob backend (C4). Lazy SDK import; used when a connection string
    is configured. Blob name is content-addressed so originals stay immutable.
    """

    def __init__(self, connection_string: str, container: str) -> None:
        self._conn = connection_string
        self._container = container

    def save(self, *, tenant_id: uuid.UUID, filename: str, content: bytes) -> StoredFile:
        from azure.storage.blob import BlobServiceClient

        digest = _sha256(content)
        blob_name = f"{tenant_id}/{digest}_{Path(filename).name}"
        service = BlobServiceClient.from_connection_string(self._conn)
        client = service.get_blob_client(container=self._container, blob=blob_name)
        if not client.exists():
            client.upload_blob(content)
        return StoredFile(
            storage_path=f"{self._container}/{blob_name}",
            file_hash=digest,
            file_size=len(content),
        )


def get_storage() -> LocalStorage | AzureBlobStorage:
    if settings.azure_storage_connection_string:
        return AzureBlobStorage(
            settings.azure_storage_connection_string, settings.azure_blob_container
        )
    return LocalStorage(settings.evidence_storage_dir)


def save_evidence(*, tenant_id: uuid.UUID, filename: str, content: bytes) -> StoredFile:
    return get_storage().save(tenant_id=tenant_id, filename=filename, content=content)
