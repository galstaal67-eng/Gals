/* =========================================================================
   מקורות המידע החיצוניים.

   לשונית "עכשיו" מרכזת את מה שמשתנה בלי קשר למסלול: מזג אוויר לכל יום
   לפי המקום שבאמת קובע באותו יום, מה קורה בעיר בתאריכים האלה, חגים
   רשמיים, שערי מטבע, איכות אוויר ורעידות אדמה.

   כל הקריאות החוצה נעשות מהשרת (/api/live), לא מכאן. כך המטמון משותף
   בין המכשירים, ושום שירות חיצוני לא רואה את כתובת ה-IP של טלפון בחו"ל.

   ההתרעות אינן נבנות כאן אלא בשרת, כדי ששני הטלפונים יראו בדיוק את אותו
   דבר. התפקיד של הקובץ הזה הוא להציג.
   ========================================================================= */

const LiveView = (() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );

  let host = null;
  let data = null;
  let loading = false;
  let lastLoad = 0;
  let briefPoll = null;
  let briefError = "";
  /** הטיול שהנתונים שבזיכרון שייכים לו. בלי זה טיול חדש היה מציג את
      התחזית של הקודם, כי הנתונים עדיין "טריים". */
  let dataTripId = "";

  const FRESH_MS = 30 * 60_000;

  /* ------------------------------------------------------------------ */
  /*  איזו נקודה מייצגת כל יום                                           */
  /* ------------------------------------------------------------------ */

  const distKm = (a, b) => {
    const dLat = (a.lat - b.lat) * 111;
    const dLng = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLng);
  };

  /**
   * התחזית של היום היא זו של המקום שבו באמת מבלים אותו.
   *
   * ביום עירוני זה המלון. ביום נסיעה ארוכה זו הנקודה הרחוקה — ואם יש
   * בדרך מעבר הררי, המעבר קודם לכול: הוא זה שנסגר, והטמפרטורה בעיר
   * אינה אומרת עליו דבר.
   */
  function dayPoint(day) {
    const pts = (day.points || []).filter((p) => p.lat && p.lng);
    const hotel = day.hotel && day.hotel.lat ? { ...day.hotel, type: "hotel" } : null;
    if (!pts.length && !hotel) return null;

    const far = (day.drive?.km || 0) >= 80;
    if (far) {
      const pass = pts.find((p) => p.type === "pass");
      if (pass) return pass;
      const base = hotel || pts[0];
      let best = pts[0];
      let bestD = -1;
      for (const p of pts) {
        const d = distKm(base, p);
        if (d > bestD) { bestD = d; best = p; }
      }
      return best;
    }
    return hotel || pts.find((p) => p.type !== "airport") || pts[0];
  }

  function payload(trip) {
    const points = [];
    for (const day of trip.days) {
      const pt = dayPoint(day);
      if (!pt) continue;
      points.push({
        n: day.n,
        date: day.date,
        label: pt.name || day.region || trip.meta.title,
        lat: pt.lat,
        lng: pt.lng,
        kind: pt.type || "",
        driveKm: day.drive?.km || 0,
        mode: day.mode || "",
      });
    }
    return {
      title: trip.meta.title,
      countryCode: trip.meta.countryCode || "",
      from: trip.days[0]?.date || "",
      to: trip.days[trip.days.length - 1]?.date || "",
      bbox: trip.meta.bbox || null,
      points,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  טעינה                                                              */
  /* ------------------------------------------------------------------ */

  async function load(force = false) {
    const trip = host?.getTrip();
    if (!trip || loading) return;

    // מעבר טיול — או טיול חדש שנוצר זה עתה — פוסל את מה שבזיכרון
    if (trip.id !== dataTripId) {
      clear();
      dataTripId = trip.id;
      force = true;
    }
    if (!force && data && Date.now() - lastLoad < FRESH_MS) return;

    loading = true;
    render();
    try {
      const body = payload(trip);
      if (!body.points.length) {
        data = { empty: true };
        return;
      }
      const res = await fetch(TripAPI.tripUrl("/api/live"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, force }),
      });
      const out = await TripAPI.readJson(res);
      if (!res.ok || !out || out.error) {
        data = { failed: out?.error || `השרת החזיר ${res.status}` };
        return;
      }
      data = out;
      lastLoad = Date.now();
      maybeRequestBrief(body, out);
    } catch (err) {
      data = { failed: "אין חיבור לשרת. הנתונים החיצוניים אינם זמינים כרגע." };
      console.warn("live: הטעינה נכשלה", err);
    } finally {
      loading = false;
      render();
      decorateDays();
    }
  }

  /**
   * "מה קורה בעיר" נבנה ברקע ולא בבקשה הזו — חיפוש ברשת לוקח יותר ממה
   * שבקשה רגילה יכולה להחזיק. לכן כאן רק מבקשים שייבנה, וממשיכים לבדוק
   * אם הוא הגיע.
   */
  function maybeRequestBrief(body, out, force = false) {
    const stale = !out.brief || (out.briefAgeMs ?? Infinity) > 12 * 60 * 60_000;
    if (!stale && !force) return;

    briefError = "";
    fetch(TripAPI.tripUrl("/api/brief-run"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: body.title,
        from: body.from,
        to: body.to,
        regions: [...new Set((host.getTrip().days || []).map((d) => d.region).filter(Boolean))],
        code: localStorage.getItem("ai:code") || "",
        force,
      }),
    })
      .then((res) => {
        // פונקציית רקע מחזירה 202 מיד. כל דבר אחר אומר שהיא לא רצה —
        // ועדיף לומר את זה מאשר להשאיר מסך "מחפש…" שלא ייגמר לעולם
        if (res.ok || res.status === 202) return pollBrief();
        briefError = `החיפוש ברקע אינו זמין (${res.status}).`;
        render();
      })
      .catch(() => {
        briefError = "אין חיבור לשרת, ולכן אין חיפוש אירועים.";
        render();
      });
  }

  function pollBrief() {
    clearInterval(briefPoll);
    let tries = 0;
    briefPoll = setInterval(async () => {
      if (++tries > 20) return clearInterval(briefPoll); // כ-3 דקות
      try {
        const trip = host.getTrip();
        const res = await fetch(TripAPI.tripUrl("/api/live"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload(trip)),
        });
        const out = await TripAPI.readJson(res);
        if (out && out.brief && (!data.brief || out.brief.generatedAt !== data.brief.generatedAt)) {
          data = out;
          clearInterval(briefPoll);
          render();
        }
      } catch { /* ננסה שוב בפעימה הבאה */ }
    }, 9_000);
  }

  /* ------------------------------------------------------------------ */
  /*  תצוגה                                                              */
  /* ------------------------------------------------------------------ */

  const ago = (ms) => {
    if (ms == null) return "";
    const m = Math.round(ms / 60_000);
    if (m < 1) return "ממש עכשיו";
    if (m < 60) return `לפני ${m} דק׳`;
    const h = Math.round(m / 60);
    if (h < 24) return `לפני ${h} שעות`;
    return `לפני ${Math.round(h / 24)} ימים`;
  };

  const LEVEL = {
    urgent: { cls: "is-urgent", icon: "⛔" },
    warn: { cls: "is-warn", icon: "⚠️" },
    info: { cls: "is-info", icon: "ℹ️" },
  };

  function alertCard(a) {
    const l = LEVEL[a.level] || LEVEL.info;
    return `<div class="live-alert ${l.cls}">
      <b>${l.icon} ${esc(a.title)}</b>
      <p>${esc(a.detail)}</p>
      <span class="live-src">${esc(a.source)}${a.day ? ` · יום ${a.day}` : ""}</span>
    </div>`;
  }

  function weatherRow(d) {
    const temps =
      d.tMax === null && d.tMin === null
        ? "—"
        : `${Math.round(d.tMax ?? 0)}° / ${Math.round(d.tMin ?? 0)}°`;
    const rain = d.rainChance != null && d.rainChance > 0 ? `💧 ${d.rainChance}%` : "";
    const wind = d.windKmh != null && d.windKmh >= 25 ? `💨 ${Math.round(d.windKmh)}` : "";
    return `<tr>
      <td><b>${d.n}</b></td>
      <td>${esc(d.date.slice(8))}/${esc(d.date.slice(5, 7))}</td>
      <td>${esc(d.place)}</td>
      <td class="live-wx">${d.icon} ${esc(d.text)}</td>
      <td>${temps}</td>
      <td class="muted">${rain} ${wind}</td>
      <td class="muted">${esc(d.sunrise)}–${esc(d.sunset)}</td>
    </tr>`;
  }

  function briefSection(brief, ageMs) {
    if (!brief) {
      return briefError
        ? `<p class="muted">${esc(briefError)}</p>`
        : `<p class="muted">מחפש מה קורה בעיר בתאריכים האלה… החיפוש רץ ברקע ולוקח עד דקה או שתיים.</p>`;
    }
    const head = `<p class="live-meta">עודכן ${ago(ageMs)}${brief.note ? ` · ${esc(brief.note)}` : ""}</p>`;
    if (!brief.items?.length) {
      return head + `<p class="muted">${esc(brief.summary || "לא נמצאו אירועים או הפרעות לתאריכים האלה.")}</p>`;
    }
    const items = brief.items
      .map((it) => {
        const l = LEVEL[it.level] || LEVEL.info;
        return `<div class="live-item ${l.cls}">
          <b>${l.icon} ${esc(it.title)}</b>
          <span class="live-when">${esc([it.when, it.where].filter(Boolean).join(" · "))}</span>
          ${it.detail ? `<p>${esc(it.detail)}</p>` : ""}
          ${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">מקור ↗</a>` : ""}
        </div>`;
      })
      .join("");
    return (
      head +
      (brief.summary ? `<p class="live-summary">${esc(brief.summary)}</p>` : "") +
      `<div class="live-items">${items}</div>`
    );
  }

  function ratesSection(rates) {
    const keys = Object.keys(rates || {});
    if (!keys.length) return `<p class="muted">שערי המטבע אינם זמינים כרגע.</p>`;
    const mine = host.getRates();
    const rows = keys
      .map((sign) => {
        const live = rates[sign];
        const used = mine[sign];
        const diff = used ? Math.round(((live - used) / used) * 1000) / 10 : null;
        return `<tr>
          <td><b>${esc(sign)}</b></td>
          <td>${live.toFixed(3)} ₪</td>
          <td class="muted">${used ? `${used} ₪` : "—"}</td>
          <td class="${diff && Math.abs(diff) >= 2 ? "live-diff" : "muted"}">${
            diff === null ? "" : `${diff > 0 ? "+" : ""}${diff}%`
          }</td>
        </tr>`;
      })
      .join("");
    return `<table class="live-table">
        <thead><tr><th>מטבע</th><th>שער חי</th><th>באפליקציה</th><th>פער</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <button class="btn btn--sm" id="liveRates">עדכן את השערים באפליקציה</button>`;
  }

  function render() {
    const view = $("#liveView");
    if (!view) return;

    if (loading && !data) {
      view.innerHTML = `<div class="live-busy"><span class="ai-spin"></span><p>מביא נתונים…</p></div>`;
      return;
    }
    if (!data) {
      view.innerHTML = `<p class="muted">לחצו רענון כדי להביא את הנתונים.</p>`;
      return;
    }
    if (data.empty) {
      // טיול בלי קואורדינטות אינו מקרה קצה אלא ברירת המחדל של טיול ישן:
      // במקום להודיע שאין נתונים, נותנים כאן את הפעולה שפותרת את זה.
      const trip = host.getTrip();
      view.innerHTML = `
        <div class="live-alert is-info">
          <b>ℹ️ לטיול הזה אין עדיין מיקום</b>
          <p>בלי קואורדינטות אין תחזית, אין חגים ואין התרעות. אתרו את היעד
             פעם אחת — זה יעדכן גם את המפה.</p>
        </div>
        <div class="live-locate">
          <input type="text" id="liveWhere" value="${esc(trip.meta.title || "")}"
                 placeholder="שם העיר או היעד" autocomplete="off" />
          <button class="btn btn--primary btn--sm" id="liveLocate">אתר את היעד</button>
        </div>
        <p class="muted" id="liveLocateOut"></p>`;

      $("#liveLocate").addEventListener("click", locate);
      $("#liveWhere").addEventListener("keydown", (e) => {
        if (e.key === "Enter") locate();
      });
      return;
    }
    if (data.failed) {
      view.innerHTML = `<div class="live-alert is-warn"><b>⚠️ הנתונים החיצוניים אינם זמינים</b>
        <p>${esc(data.failed)}</p></div>`;
      return;
    }

    const alerts = data.alerts || [];
    const sources = (data.sources || [])
      .map(
        (s) =>
          `<li class="${s.ok ? "is-ok" : "is-off"}">${s.ok ? "●" : "○"} ${esc(s.label)}
             <span class="muted">${esc(s.note)}</span></li>`
      )
      .join("");

    view.innerHTML = `
      <div class="live-head">
        <p class="live-meta">עודכן ${ago(Date.now() - Date.parse(data.fetchedAt))}${
          data.cached ? " · מהמטמון" : ""
        }</p>
        <button class="btn btn--sm" id="liveRefresh">🔄 רענן</button>
      </div>

      ${
        alerts.length
          ? `<section class="live-block">
               <h3>התרעות</h3>
               ${alerts.map(alertCard).join("")}
             </section>`
          : `<section class="live-block"><h3>התרעות</h3>
               <p class="muted">אין התרעות פעילות. מזג האוויר, החגים והרעידות נבדקו.</p></section>`
      }

      <section class="live-block">
        <h3>מזג אוויר לכל יום</h3>
        ${
          data.days?.length
            ? `<table class="live-table live-wx-table">
                 <thead><tr><th>יום</th><th>תאריך</th><th>מקום</th><th>מזג אוויר</th>
                   <th>מקס׳ / מינ׳</th><th>גשם · רוח</th><th>זריחה–שקיעה</th></tr></thead>
                 <tbody>${data.days.map(weatherRow).join("")}</tbody>
               </table>
               <p class="muted">התחזית היא למקום שקובע באותו יום — ביום נסיעה זו הנקודה
                 הרחוקה או המעבר ההררי, ולא העיר.</p>`
            : `<p class="muted">אף יום בטיול אינו בטווח התחזית (16 יום קדימה).</p>`
        }
      </section>

      <section class="live-block">
        <h3>מה קורה שם בתאריכים האלה</h3>
        ${briefSection(data.brief, data.briefAgeMs)}
        <button class="btn btn--sm btn--ghost" id="liveBrief">חפש מחדש</button>
      </section>

      ${
        data.holidays?.length
          ? `<section class="live-block"><h3>חגים רשמיים</h3>
               <ul class="live-list">${data.holidays
                 .map(
                   (h) =>
                     `<li><b>${esc(h.date.slice(8))}/${esc(h.date.slice(5, 7))}</b> ${esc(
                       h.local || h.name
                     )}${h.local && h.name && h.local !== h.name ? ` <span class="muted">(${esc(h.name)})</span>` : ""}</li>`
                 )
                 .join("")}</ul></section>`
          : ""
      }

      <section class="live-block">
        <h3>שערי מטבע</h3>
        ${ratesSection(data.rates)}
      </section>

      ${
        data.air
          ? `<section class="live-block"><h3>איכות אוויר</h3>
               <p>מדד ${data.air.aqi ?? "—"} · <b>${esc(data.air.text)}</b>${
                 data.air.pm25 != null ? ` · PM2.5 ${data.air.pm25}` : ""
               }</p></section>`
          : ""
      }

      ${
        data.quakes?.length
          ? `<section class="live-block"><h3>רעידות אדמה בשבוע האחרון</h3>
               <ul class="live-list">${data.quakes
                 .slice(0, 6)
                 .map(
                   (q) =>
                     `<li><b>${q.mag}</b> ${esc(q.place)} <span class="muted">${esc(
                       q.when.slice(0, 10)
                     )}</span></li>`
                 )
                 .join("")}</ul></section>`
          : ""
      }

      <section class="live-block live-sources">
        <h3>המקורות</h3>
        <ul>${sources}</ul>
      </section>`;

    $("#liveRefresh")?.addEventListener("click", () => load(true));
    $("#liveBrief")?.addEventListener("click", (e) => {
      e.target.disabled = true;
      e.target.textContent = "מחפש…";
      maybeRequestBrief(payload(host.getTrip()), data, true);
    });
    $("#liveRates")?.addEventListener("click", (e) => {
      host.applyRates(data.rates);
      e.target.textContent = "✓ עודכן";
      e.target.disabled = true;
    });

    strip();
  }

  /** איתור היעד של טיול שנוצר בלי מיקום, והחלתו על המסלול */
  async function locate() {
    const input = $("#liveWhere");
    const out = $("#liveLocateOut");
    const q = input.value.trim();
    if (q.length < 2) { out.textContent = "צריך שם יעד."; return; }

    out.textContent = "מאתר…";
    $("#liveLocate").disabled = true;
    try {
      const res = await fetch(`/api/geo?q=${encodeURIComponent(q)}`);
      const found = await TripAPI.readJson(res);
      if (!found || !found.found) {
        out.textContent = found?.error || "לא מצאתי את היעד הזה. נסו שם אחר או כתיב אחר.";
        return;
      }
      host.applyPlace(found.place);
      data = null;
      await load(true);
    } catch {
      out.textContent = "אין חיבור לשרת, ולכן אי אפשר לאתר כרגע.";
    } finally {
      const btn = $("#liveLocate");
      if (btn) btn.disabled = false;
    }
  }

  /** פס ההתרעה שמופיע בכל לשונית, לא רק כאן */
  function strip() {
    const el = $("#liveStrip");
    if (!el) return;
    const top = (data?.alerts || []).filter((a) => a.level !== "info")[0];
    if (!top) { el.hidden = true; return; }
    const l = LEVEL[top.level];
    el.className = `live-strip ${l.cls}`;
    el.innerHTML = `<span>${l.icon} <b>${esc(top.title)}</b> — ${esc(top.detail)}</span>
      <button class="btn btn--sm" data-go-live>לפרטים</button>`;
    el.hidden = false;
    el.querySelector("[data-go-live]").addEventListener("click", () => host.openTab("live"));
  }

  /** צ'יפ מזג אוויר על כרטיס היום בלשונית המסלול */
  function decorateDays() {
    if (!data?.days?.length) return;
    for (const d of data.days) {
      const meta = document.querySelector(`.day[data-day="${d.n}"] .day__meta`);
      if (!meta) continue;
      meta.querySelector(".day__wx")?.remove();
      const span = document.createElement("span");
      span.className = "day__wx";
      span.title = `${d.text} ב${d.place}`;
      span.textContent = `${d.icon} ${Math.round(d.tMax ?? 0)}° / ${Math.round(d.tMin ?? 0)}°`;
      meta.appendChild(span);
    }
  }

  /* ------------------------------------------------------------------ */

  function clear() {
    data = null;
    lastLoad = 0;
    briefError = "";
    dataTripId = "";
    clearInterval(briefPoll);
    const el = $("#liveStrip");
    if (el) el.hidden = true;
  }

  function init(options) {
    host = options;
    // רענון כל חצי שעה כל עוד הדף פתוח, ובכל חזרה אליו אחרי הפסקה
    setInterval(() => load(false), FRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && Date.now() - lastLoad > FRESH_MS) load(false);
    });
  }

  return {
    init,
    load,
    render,
    decorateDays,
    /** נקרא כשעוברים טיול — הנתונים של הטיול הקודם אינם רלוונטיים */
    reset: clear,
  };
})();
