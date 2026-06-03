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


def get_storage() -> LocalStorage:
    # An AzureBlobStorage backend implementing the same .save() slots in here
    # when azure_storage_connection_string is configured.
    return LocalStorage(settings.evidence_storage_dir)


def save_evidence(*, tenant_id: uuid.UUID, filename: str, content: bytes) -> StoredFile:
    return get_storage().save(tenant_id=tenant_id, filename=filename, content=content)
