FROM python:3.12-slim

WORKDIR /app

# System deps for asyncpg/bcrypt are wheels; keep the image lean.
COPY pyproject.toml ./
COPY backend ./backend
COPY alembic.ini ./

RUN pip install --no-cache-dir -e .

ENV PYTHONUNBUFFERED=1

# Entry: run migrations, seed a demo tenant (idempotent), then serve.
COPY backend/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000
CMD ["/app/entrypoint.sh"]
