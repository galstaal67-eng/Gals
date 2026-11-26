/* =========================================================================
   FoodFinder — איפה אוכלים ליד המקום שבו אנחנו.

   אוכל הוא השאלה שחוזרת שלוש פעמים ביום, ובכל פעם ממקום אחר. "בדוק
   עכשיו" יודע לענות עליה, אבל כשאלה חופשית שצריך לנסח. כאן היא מסך:

     איפה   — המיקום שלי, המלון, או כל תחנה במסלול
     מה     — מסעדות, בתי קפה או ברים
     איך    — מקומי · לא תיירותי · אוכל מהיר · מסעדת שף · עממי
     ועוד   — שורה חופשית ("צמחוני", "חינקלי", "עם נוף")

   והתשובה היא רשימה של מקומות, שכל אחד מהם נפתח במפות בלחיצה.

   ── שלוש החלטות ──
   **רק בלחיצה.** החיפוש רץ בשרת עם חיפוש ברשת, וכל הרצה עולה כסף. אין
   כאן רענון אוטומטי, ושינוי של צ'יפ אינו מריץ דבר עד שלוחצים "חפש".

   **המקום נפתח במפות לפי שם, סביב נקודת המוצא.** השרת מחזיר שמות ולא
   קואורדינטות — קואורדינטה מומצאת נראית כמו נכונה. במפות רואים אם
   המקום קיים, פתוח עכשיו וכמה הוא רחוק, ממקור שיודע.

   **התוצאה האחרונה נשמרת במכשיר.** מי שחיפש במלון ויצא לרחוב לא צריך
   קליטה כדי לראות שוב את הרשימה. היא נשמרת לכל טיול בנפרד, ועם השעה
   שבה נבדקה — המלצה מאתמול עדיין שימושית, אבל צריך לדעת שהיא מאתמול.
   ========================================================================= */

const FoodFinder = (() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );

  const KINDS = [
    { id: "restaurant", label: "מסעדות", icon: "🍽️" },
    { id: "cafe", label: "בתי קפה", icon: "☕" },
    { id: "bar", label: "ברים", icon: "🍸" },
  ];

  /* המזהים הם החוזה עם השרת: המשמעות של כל סגנון נכתבת שם, בפרומפט */
  const STYLES = [
    { id: "local", label: "מקומי" },
    { id: "hidden", label: "לא תיירותי" },
    { id: "fast", label: "אוכל מהיר" },
    { id: "chef", label: "מסעדת שף" },
    { id: "folk", label: "עממי" },
  ];

  let host = null;
  let q = { kind: "restaurant", styles: [], walk: true, extra: "", anchor: "" };
  let out = null;          // התשובה האחרונה: { ...answer, at, near }
  let busy = false;
  let error = "";
  let loadedFor = "";      // הטיול שהמצב שבזיכרון שייך לו

  const key = () => "food:" + (host?.tripId?.() || "");

  function restore() {
    const id = key();
    if (loadedFor === id) return;
    loadedFor = id;
    out = null;
    error = "";
    q = { kind: "restaurant", styles: [], walk: true, extra: "", anchor: "" };
    try {
      const saved = JSON.parse(localStorage.getItem(id) || "null");
      if (saved?.q) q = { ...q, ...saved.q, anchor: "" };   // המקום נבחר מחדש בכל פעם
      if (saved?.out) out = saved.out;
    } catch { /* אחסון פגום — מתחילים נקי */ }
  }

  function persist() {
    try { localStorage.setItem(key(), JSON.stringify({ q, out })); } catch { /* מלא */ }
  }

  /* ------------------------------------------------------------------ */
  /*  איפה                                                               */
  /* ------------------------------------------------------------------ */

  const hasGeo = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

  /**
   * כל המקומות שאפשר לחפש סביבם: המיקום שלי, המלון של היום, וכל תחנה
   * במסלול. שדות תעופה נשארים בחוץ — מי שמחפש אוכל בשדה אינו בוחר.
   */
  function anchors() {
    const trip = host.getTrip() || {};
    const here = host.here() || {};
    const list = [{ id: "me", label: "📍 איפה שאני עכשיו", mine: true }];

    const today = here.day || (trip.days || [])[0];
    if (hasGeo(today?.hotel)) {
      list.push({
        id: "hotel", label: `🛏️ ליד המלון — ${today.hotel.name || ""}`,
        name: today.hotel.name || "המלון", lat: +today.hotel.lat, lng: +today.hotel.lng,
        region: today.region || "",
      });
    }

    const groups = [];
    for (const day of trip.days || []) {
      const pts = (day.points || [])
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p && p.name && hasGeo(p) && p.type !== "airport" && p.type !== "hotel");
      if (!pts.length) continue;
      groups.push({
        label: `יום ${day.n}${day === here.day ? " · היום" : ""}`,
        items: pts.map(({ p, i }) => ({
          id: `p:${day.n}:${i}`, label: p.name,
          name: p.name, lat: +p.lat, lng: +p.lng, region: day.region || "",
        })),
      });
    }
    return { list, groups };
  }

  function findAnchor(id) {
    const { list, groups } = anchors();
    return list.find((a) => a.id === id) || groups.flatMap((g) => g.items).find((a) => a.id === id) || null;
  }

  /**
   * ברירת המחדל: המיקום שלי אם כבר ניתנה הרשאה, אחרת התחנה שבה אנחנו
   * לפי התוכנית, ואחרת המלון. מי שלא נתן הרשאת מיקום לא צריך לקבל
   * בקשת הרשאה רק מפני שפתח את הלשונית.
   */
  function defaultAnchor() {
    const here = host.here() || {};
    if (here.fix) return "me";
    if (here.day && Number.isInteger(here.stop)) {
      const id = `p:${here.day.n}:${here.stop}`;
      if (findAnchor(id)) return id;
    }
    return findAnchor("hotel") ? "hotel" : "me";
  }

  /** המיקום של המכשיר: הקיים אם הוא טרי, אחרת בקשה אחת, בלחיצה בלבד */
  function locate() {
    const fix = host.here()?.fix;
    if (fix && Date.now() - fix.at < 5 * 60_000) return Promise.resolve(fix);
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("במכשיר הזה אין שירות מיקום."));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() }),
        (err) =>
          reject(new Error(
            err.code === 1
              ? "אין הרשאת מיקום. אפשרו אותה בדפדפן, או בחרו תחנה או את המלון ברשימה."
              : "לא הצלחתי לקבל מיקום. נסו שוב, או בחרו תחנה או את המלון ברשימה."
          )),
        { enableHighAccuracy: true, timeout: 9000, maximumAge: 120_000 }
      );
    });
  }

  /** התחנה הקרובה ביותר למיקום — "ליד X" אומר למודל באיזו שכונה אנחנו */
  function nearestName(fix) {
    let best = null;
    for (const day of host.getTrip()?.days || []) {
      for (const p of [...(day.points || []), day.hotel]) {
        if (!hasGeo(p) || !p.name) continue;
        const dLat = (fix.lat - p.lat) * 111;
        const dLng = (fix.lng - p.lng) * 111 * Math.cos((fix.lat * Math.PI) / 180);
        const km = Math.hypot(dLat, dLng);
        if (!best || km < best.km) best = { km, name: p.name, region: day.region || "" };
      }
    }
    // מעבר לשלושה ק"מ "ליד" כבר מטעה, והקואורדינטות לבדן מדויקות יותר
    return best && best.km <= 3 ? best : null;
  }

  /* ------------------------------------------------------------------ */
  /*  החיפוש                                                             */
  /* ------------------------------------------------------------------ */

  async function search() {
    if (busy) return;
    busy = true;
    error = "";
    render();

    try {
      const pick = findAnchor(q.anchor) || findAnchor(defaultAnchor());
      let anchor;
      if (!pick || pick.mine) {
        const fix = await locate();
        const near = nearestName(fix);
        anchor = { name: near?.name || "", lat: fix.lat, lng: fix.lng, mine: true, region: near?.region || "" };
      } else {
        anchor = { name: pick.name, lat: pick.lat, lng: pick.lng, mine: false, region: pick.region };
      }

      const trip = host.getTrip() || {};
      const res = await fetch("/api/food", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: localStorage.getItem("ai:code") || "",
          kind: q.kind,
          styles: q.styles,
          walk: q.walk,
          extra: q.extra,
          anchor: { name: anchor.name, lat: anchor.lat, lng: anchor.lng, mine: anchor.mine },
          context: {
            trip: trip.meta?.title || "",
            place: (trip.meta?.countries || []).join(", "),
            region: anchor.region,
            when: new Date().toLocaleString("he-IL", {
              weekday: "long", hour: "2-digit", minute: "2-digit",
            }),
          },
        }),
      });
      const got = await TripAPI.readJson(res);
      if (!res.ok || !got || got.error) {
        throw new Error(got?.error || `החיפוש נכשל (${res.status})`);
      }
      out = {
        ...got,
        at: Date.now(),
        near: {
          name: anchor.name, lat: anchor.lat, lng: anchor.lng, mine: anchor.mine,
          region: anchor.region || "",
        },
        asked: { kind: q.kind, styles: [...q.styles], walk: q.walk },
      };
      persist();
    } catch (err) {
      error = err.message || "החיפוש נכשל.";
    } finally {
      busy = false;
      render();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  התצוגה                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * חיפוש השם **סביב** נקודת המוצא: שם לבדו עלול לנחות על מקום בעל אותו
   * שם בעיר אחרת, וקואורדינטה לבדה היא סיכה בלי שם ובלי שעות פתיחה.
   */
  function mapsLink(name, near) {
    const at = hasGeo(near) ? `/@${near.lat},${near.lng},16z` : "";
    return `https://www.google.com/maps/search/${encodeURIComponent(name)}${at}`;
  }

  /**
   * היעד שהמסלול צריך לכלול יחד עם המסעדה.
   *
   * מי שחיפש סביב תחנה חיפש שם כי הוא הולך לשם — התחנה היא היעד. מי
   * שחיפש סביב המיקום שלו מקבל את התחנה הבאה במסלול של היום. כשאין
   * לא זה ולא זה אין מסלול משולב, ונשאר רק "פתח במפות".
   */
  function routeTarget() {
    if (out?.near && !out.near.mine && hasGeo(out.near)) return out.near;
    const next = host.here()?.next;
    return hasGeo(next) ? next : null;
  }

  /**
   * מסלול אחד ב-Google Maps שעובר גם במסעדה וגם ביעד.
   *
   * בלי `origin`: כשהוא חסר המפות יוצאות מהמיקום של המכשיר, וזה מה
   * שרוצים. היעד נשלח כקואורדינטה — הוא מהמסלול שלנו ואנחנו יודעים
   * איפה הוא. המסעדה נשלחת כשם עם האזור, כי קואורדינטה שלה אין לנו,
   * ואת השם המפות יודעות לפתור טוב מאיתנו.
   *
   * @param first  true — קודם אוכלים ואז ממשיכים ליעד; false — להפך
   */
  function routeLink(place, target, first) {
    const eat = [place.name, out.near?.region].filter(Boolean).join(", ");
    const goal = `${target.lat},${target.lng}`;
    return (
      "https://www.google.com/maps/dir/?api=1" +
      `&destination=${encodeURIComponent(first ? goal : eat)}` +
      `&waypoints=${encodeURIComponent(first ? eat : goal)}` +
      `&travelmode=${out.asked?.walk === false ? "driving" : "walking"}`
    );
  }

  /** שם קצר לכפתור: בלי ההסבר שאחרי המקף ובלי הסוגריים */
  const shortName = (name) =>
    String(name || "").split(/\s[—–-]\s/)[0].replace(/\s*\(.*$/, "").trim();

  function ago(ts) {
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 2) return "עכשיו";
    if (min < 60) return `לפני ${min} דקות`;
    const h = Math.round(min / 60);
    if (h < 24) return `לפני ${h} שעות`;
    return new Date(ts).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
  }

  function resultsHTML() {
    if (busy) return '<p class="food__wait">מחפש ברשת מקומות שמתאימים… זה לוקח כחצי דקה.</p>';
    if (!out) {
      return '<p class="food__empty">בחרו מה מתחשק ולחצו "חפש". כל מקום ברשימה נפתח במפות בלחיצה.</p>';
    }

    const kind = KINDS.find((k) => k.id === out.asked?.kind) || KINDS[0];
    const styles = (out.asked?.styles || [])
      .map((id) => STYLES.find((s) => s.id === id)?.label)
      .filter(Boolean);
    const places = out.places || [];
    const target = routeTarget();
    const goal = target ? shortName(target.name) || "היעד הבא" : "";

    return `
      <div class="food__sum">
        <b>${esc(out.headline || "")}</b>
        <small>${kind.icon} ${esc(kind.label)}${styles.length ? " · " + esc(styles.join(" · ")) : ""}
          · ${out.near?.mine ? "ליד המיקום שלי" : "ליד " + esc(out.near?.name || "")}
          ${out.near?.mine && out.near?.name ? "(" + esc(out.near.name) + ")" : ""}</small>
      </div>
      ${places.length
        ? `<ol class="food__list">${places
            .map(
              (p) => `<li class="food__card">
                <div class="food__name">
                  <b dir="auto">${esc(p.name)}</b>
                  ${p.he ? `<small>${esc(p.he)}</small>` : ""}
                </div>
                ${p.why ? `<p class="food__why">${esc(p.why)}</p>` : ""}
                <ul class="food__facts">
                  ${p.order ? `<li><span>🍴</span>${esc(p.order)}</li>` : ""}
                  ${p.price ? `<li><span>💰</span>${esc(p.price)}</li>` : ""}
                  ${p.where ? `<li><span>📍</span>${esc(p.where)}</li>` : ""}
                </ul>
                <a class="btn btn--sm" target="_blank" rel="noopener"
                   title="שעות פתיחה, ביקורות וניווט — נפתח במפות"
                   href="${esc(mapsLink(p.name, out.near))}">🗺️ פתח במפות</a>
                ${target
                  ? `<div class="food__route">
                       <span>🧭 מסלול אחד עם ${esc(goal)}:</span>
                       <a class="btn btn--sm btn--primary" target="_blank" rel="noopener"
                          title="מהמיקום שלכם אל ${esc(p.name)}, ומשם אל ${esc(goal)}"
                          href="${esc(routeLink(p, target, true))}">קודם לאכול</a>
                       <a class="btn btn--sm" target="_blank" rel="noopener"
                          title="מהמיקום שלכם אל ${esc(goal)}, ומשם אל ${esc(p.name)}"
                          href="${esc(routeLink(p, target, false))}">לאכול אחר כך</a>
                     </div>`
                  : ""}
              </li>`
            )
            .join("")}</ol>`
        : '<p class="food__empty">לא נמצא מקום שאפשר להמליץ עליו בלב שלם. נסו פחות סגנונות, או מקום אחר.</p>'}
      ${out.caution ? `<p class="food__warn">⚠️ ${esc(out.caution)}</p>` : ""}
      <p class="food__src">
        ${out.fresh ? "נבדק ברשת" : "מידע כללי, בלי חיפוש"} · ${esc(ago(out.at))}
        · שעות פתיחה ומרחק מדויק — במפות
        ${(out.sources || [])
          .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`)
          .join("")}
      </p>`;
  }

  function render() {
    const root = $("#foodView");
    if (!root || !host) return;
    const trip = host.getTrip();
    if (!trip) { root.innerHTML = ""; return; }
    restore();
    if (!q.anchor || !findAnchor(q.anchor)) q.anchor = defaultAnchor();

    const { list, groups } = anchors();
    const opt = (a) =>
      `<option value="${esc(a.id)}"${a.id === q.anchor ? " selected" : ""}>${esc(a.label)}</option>`;

    root.innerHTML = `
      <form class="food card pad" id="foodForm">
        <label class="food__row">
          <span class="food__lbl">איפה</span>
          <select id="foodAnchor" ${busy ? "disabled" : ""}>
            ${list.map(opt).join("")}
            ${groups
              .map((g) => `<optgroup label="${esc(g.label)}">${g.items.map(opt).join("")}</optgroup>`)
              .join("")}
          </select>
        </label>

        <div class="food__row">
          <span class="food__lbl">מה</span>
          <div class="food__chips" role="radiogroup" aria-label="סוג המקום">
            ${KINDS.map(
              (k) => `<button type="button" class="chip${k.id === q.kind ? " is-on" : ""}"
                role="radio" aria-checked="${k.id === q.kind}" data-food-kind="${k.id}">${k.icon} ${k.label}</button>`
            ).join("")}
          </div>
        </div>

        <div class="food__row">
          <span class="food__lbl">איך</span>
          <div class="food__chips" role="group" aria-label="סגנון — אפשר לבחור כמה">
            ${STYLES.map(
              (s) => `<button type="button" class="chip${q.styles.includes(s.id) ? " is-on" : ""}"
                aria-pressed="${q.styles.includes(s.id)}" data-food-style="${s.id}">${s.label}</button>`
            ).join("")}
          </div>
        </div>

        <div class="food__row">
          <span class="food__lbl">ועוד</span>
          <input type="text" id="foodExtra" maxlength="160" value="${esc(q.extra)}"
                 placeholder="לא חובה: צמחוני, חינקלי, עם נוף…" />
        </div>

        <div class="food__go">
          <label class="food__walk">
            <input type="checkbox" id="foodWalk" ${q.walk ? "checked" : ""} />
            רק במרחק הליכה
          </label>
          <button type="submit" class="btn btn--primary" ${busy ? "disabled" : ""}>
            ${busy ? "מחפש…" : "🔎 חפש"}
          </button>
        </div>
        ${error ? `<p class="food__err">${esc(error)}</p>` : ""}
      </form>
      <div class="food__out" aria-live="polite">${resultsHTML()}</div>`;
  }

  function bind() {
    const root = $("#foodView");
    if (!root) return;

    root.addEventListener("click", (e) => {
      const kind = e.target.closest("[data-food-kind]");
      if (kind) {
        q.kind = kind.dataset.foodKind;
        persist();
        return render();
      }
      const style = e.target.closest("[data-food-style]");
      if (style) {
        const id = style.dataset.foodStyle;
        q.styles = q.styles.includes(id) ? q.styles.filter((s) => s !== id) : [...q.styles, id];
        persist();
        return render();
      }
    });

    root.addEventListener("change", (e) => {
      if (e.target.id === "foodAnchor") q.anchor = e.target.value;
      if (e.target.id === "foodWalk") { q.walk = e.target.checked; persist(); }
    });
    // input ולא change: מי שהקליד ולחץ מיד על "חפש" מצפה שהמילה תישלח
    root.addEventListener("input", (e) => {
      if (e.target.id === "foodExtra") q.extra = e.target.value;
    });

    root.addEventListener("submit", (e) => {
      if (e.target.id !== "foodForm") return;
      e.preventDefault();
      persist();
      search();
    });
  }

  return {
    init(options) {
      host = options;
      bind();
      render();
    },
    render,
    /** פתיחה מבחוץ עם מקום מוכן — מהחלון של תחנה או מהקוביה של עכשיו */
    open(anchorId) {
      if (!host) return;
      restore();
      q.anchor = anchorId && findAnchor(anchorId) ? anchorId : defaultAnchor();
      error = "";
      render();
      host.openTab("food");
    },
  };
})();
