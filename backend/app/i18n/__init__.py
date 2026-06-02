import json
from functools import lru_cache
from pathlib import Path

from app.config import settings

_I18N_DIR = Path(__file__).parent


@lru_cache
def load_locale(locale: str) -> dict:
    locale = locale if locale in settings.locales else settings.default_locale
    path = _I18N_DIR / f"{locale}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def translate(key: str, locale: str | None = None) -> str:
    """Dot-path lookup, e.g. translate('errors.not_found', 'he')."""
    data = load_locale(locale or settings.default_locale)
    node: object = data
    for part in key.split("."):
        if isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return key
    return node if isinstance(node, str) else key
