#!/usr/bin/env bash
set -e

echo "==> waiting for database..."
python - <<'PY'
import os, time, asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

url = os.environ["DATABASE_URL"]

async def wait():
    for _ in range(30):
        try:
            eng = create_async_engine(url)
            async with eng.connect() as c:
                await c.execute(text("SELECT 1"))
            await eng.dispose()
            print("db ready")
            return
        except Exception as e:  # noqa
            print("db not ready, retrying...", e)
            time.sleep(2)
    raise SystemExit("database never became ready")

asyncio.run(wait())
PY

echo "==> running migrations..."
alembic upgrade head

echo "==> seeding demo tenant (idempotent)..."
python -m app.scripts.bootstrap \
  --name "Entropy Demo" --subdomain demo \
  --admin-email admin@demo.com --admin-password "Demo12345!" || true

echo "==> starting API on :8000"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend
