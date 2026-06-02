from app.i18n import load_locale, translate


def test_translate_he():
    assert translate("errors.not_found", "he") == "הפריט לא נמצא"
    assert translate("roles.manager", "he") == "מנהל תיק"


def test_translate_en():
    assert translate("errors.not_found", "en") == "Item not found"


def test_unknown_locale_falls_back_to_default():
    # unsupported locale -> default (he)
    assert translate("errors.forbidden", "fr") == "אין הרשאה לבצע פעולה זו"


def test_unknown_key_returns_key():
    assert translate("errors.does_not_exist", "en") == "errors.does_not_exist"


def test_locale_has_direction():
    assert load_locale("he")["direction"] == "rtl"
    assert load_locale("en")["direction"] == "ltr"
