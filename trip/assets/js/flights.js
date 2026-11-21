/* =========================================================================
   לשונית הטיסות — פרטי הטיסות והמסמכים שלהן.

   המסמכים נשמרים במכשיר ולא בשרת, והנימוק המלא יושב ב-docs.js. כרטיס
   עלייה למטוס שייך לנוסע אחד; אין היגיון לסנכרן את זה של גל לטלפון של
   נועה, ובשדה התעופה חשוב שהכרטיס ייפתח גם בלי רשת.

   פרטי הטיסה — מספר, שעה, טרמינל, מושבים — כן יושבים במסמך הטיול
   שמסתנכרן, ולכן שניהם רואים את אותם פרטים.

   המאגר עצמו משותף עם שאר מסמכי הטיול (TripDocs): אותו טיול, אותו
   מקום, והסינון לפי רגל הטיסה נעשה כאן.
   ========================================================================= */

const FlightDocs = TripDocs;

/* =========================================================================
   הרינדור של הלשונית
   ========================================================================= */

const FlightsView = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const LEG = { out: "הלוך", back: "חזור" };

  let host = null;        // { getTrip, saveTrip }
  let docs = [];
  const urls = new Map(); // id -> objectURL, משוחררים ברינדור מחדש

  /* ------------------------------------------------------------------ */

  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("he-IL", { day: "numeric", month: "long", weekday: "long" });
  };

  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.round(n / 1024) + "KB");

  /** כמה זמן עד ההמראה, ומתי להיות בשדה */
  function countdown(leg, checkIn) {
    if (!leg.date || !leg.dep) return null;
    const dep = new Date(`${leg.date}T${leg.dep}:00`);
    const now = new Date();
    const ms = dep - now;
    if (ms < -4 * 3600000) return { past: true, text: "הטיסה הזו מאחורינו" };
    if (ms < 0) return { past: true, text: "ההמראה עברה" };

    const hours = ms / 3600000;
    const before = checkIn?.airportBefore ?? 3;
    const at = new Date(dep - before * 3600000);
    const atText = at.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

    const d = Math.floor(hours / 24);
    const h = Math.floor(hours % 24);
    return {
      past: false,
      urgent: hours < 36,
      text: d > 0 ? `עוד ${d} ימים ו-${h} שעות` : `עוד ${Math.floor(hours)} שעות`,
      airport: `להיות בשדה ב-${atText}`,
    };
  }

  /* ------------------------------------------------------------------ */

  function legCard(key, leg, f) {
    const cd = countdown(leg, f.checkIn);
    const mine = docs.filter((d) => d.leg === key);
    // טיול שנוצר באשף מגיע לכאן בלי פרטי טיסה בכלל
    const blank = !leg.flightNo && !leg.dep && !leg.arr;

    const seats = (leg.seats || [])
      .map((s) => `<span class="fl-seat"><b>${esc(s.seat)}</b> ${esc(s.who)}</span>`)
      .join("");

    const docList = mine.length
      ? mine.map((d) => {
          const url = urls.get(d.id);
          return `<li class="fl-doc">
            <span class="fl-doc__kind">${esc(TripDocs.label(d.kind))}</span>
            <a href="${url}" target="_blank" rel="noopener" class="fl-doc__name">
              ${esc(d.who ? d.who + " · " : "")}${esc(d.name)}</a>
            <span class="muted sm">${esc(kb(d.size))}</span>
            <button class="btn btn--sm" data-doc-read="${esc(d.id)}"
                    title="קריאת פרטי הטיסה מהמסמך">🔍 קרא פרטים</button>
            <button class="trip-row__del" data-doc-del="${esc(d.id)}"
                    aria-label="מחיקת המסמך">🗑️</button>
          </li>`;
        }).join("")
      : '<li class="muted sm">עדיין לא הועלו מסמכים לטיסה הזו.</li>';

    return `
    <article class="fl-card ${cd?.urgent ? "is-soon" : ""}">
      <header class="fl-card__head">
        <span class="fl-leg">${esc(LEG[key])}</span>
        <h3>${blank
          ? "טרם הוזנו פרטי טיסה"
          : `${esc(leg.flightNo || "")} · ${esc(leg.from)} → ${esc(leg.to)}`}</h3>
        ${cd && !blank ? `<span class="fl-cd ${cd.past ? "is-past" : ""}">${esc(cd.text)}</span>` : ""}
      </header>

      ${blank ? `<p class="fl-empty">העלו את כרטיס הטיסה ולחצו
        <b>קרא פרטים מהמסמך</b> — הפרטים ימולאו מעצמם, ותאשרו אותם.</p>` : ""}

      <div class="fl-grid" ${blank ? "hidden" : ""}>
        <div><b>תאריך</b><span>${esc(fmtDate(leg.date))}</span></div>
        <div><b>המראה</b><span class="fl-big">${esc(leg.dep)}</span></div>
        <div><b>נחיתה</b><span class="fl-big">${esc(leg.arr)}</span></div>
        <div><b>משך</b><span>${esc(leg.duration || "—")}</span></div>
        <div><b>טרמינל</b><span>${esc(leg.terminal || "—")}</span></div>
        <div><b>מושבים</b><span class="fl-seats">${seats || "—"}</span></div>
      </div>

      ${cd && !cd.past ? `<p class="fl-note">🕐 ${esc(cd.airport)}</p>` : ""}

      <div class="fl-docs">
        <h4>מסמכים <span class="muted sm">(נשמרים במכשיר הזה)</span></h4>
        <ul>${docList}</ul>
        <div class="fl-upload">
          <label class="btn btn--sm">
            📎 העלאת מסמך
            <input type="file" data-upload="${key}" hidden
                   accept="application/pdf,image/*" multiple />
          </label>
          <select data-kind="${key}" aria-label="סוג המסמך">
            <option value="boarding">כרטיס עלייה למטוס</option>
            <option value="ticket">כרטיס טיסה</option>
            <option value="other">מסמך אחר</option>
          </select>
          <select data-who="${key}" aria-label="של מי"></select>
        </div>
      </div>
    </article>`;
  }

  function paxTable(f) {
    const rows = (f.passengers || []).map(
      (p) => `<tr>
        <td>${esc(p.name)}</td>
        <td><code>${esc(p.pnr || "—")}</code></td>
        <td class="sm">${esc(p.ticket || "—")}</td>
      </tr>`
    ).join("");
    if (!rows) return "";
    return `<div class="card pad fl-pax">
      <h3>🎫 נוסעים והזמנות</h3>
      <table><thead><tr><th>נוסע</th><th>קוד הזמנה</th><th>מספר כרטיס</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <p class="muted sm">קוד ההזמנה הוא מה שצריך לצ'ק-אין המקוון ובדלפק.</p>
    </div>`;
  }

  /* ------------------------------------------------------------------ */

  async function render() {
    const trip = host.getTrip();
    const f = trip.flights;
    const box = $("#flightsView");
    if (!f || (!f.out && !f.back)) {
      box.innerHTML = '<p class="muted">לטיול הזה עדיין לא הוזנו טיסות.</p>';
      return;
    }

    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
    docs = FlightDocs.available() ? await FlightDocs.list(trip.id) : [];
    docs.forEach((d) => urls.set(d.id, URL.createObjectURL(d.blob)));

    box.innerHTML =
      (f.carrier ? `<p class="fl-carrier">✈️ ${esc(f.carrier)}${f.fare ? " · " + esc(f.fare) : ""}</p>` : "") +
      `<div class="fl-cards">
        ${f.out ? legCard("out", f.out, f) : ""}
        ${f.back ? legCard("back", f.back, f) : ""}
      </div>` +
      paxTable(f) +
      (f.note ? `<div class="card pad"><h3>⚠️ שימו לב</h3><p>${esc(f.note)}</p></div>` : "") +
      (FlightDocs.available()
        ? ""
        : '<p class="muted sm">הדפדפן הזה אינו תומך באחסון מסמכים מקומי.</p>');

    // רשימת הנוסעים בבוחר "של מי"
    const names = (f.passengers || []).map((p) => p.name);
    $$("[data-who]", box).forEach((sel) => {
      sel.innerHTML = (names.length ? names : ["—"])
        .map((n) => `<option>${esc(n)}</option>`).join("");
    });
  }

  /* ------------------------------------------------------------------ */

  async function handleUpload(input) {
    const leg = input.dataset.upload;
    const root = input.closest(".fl-card");
    const kind = $(`[data-kind="${leg}"]`, root).value;
    const who = $(`[data-who="${leg}"]`, root).value;
    const trip = host.getTrip();

    for (const file of Array.from(input.files || [])) {
      try {
        await FlightDocs.add(trip.id, { leg, kind, who, file });
      } catch (err) {
        alert(err.message || "העלאת הקובץ נכשלה.");
      }
    }
    input.value = "";
    await render();
  }

  /**
   * שולח מסמך שהועלה ל-Claude ומבקש את פרטי הטיסה.
   * התשובה אינה נשמרת מיד — היא מוצגת לאישור, כמו כל שאר השינויים.
   */
  async function readDoc(id) {
    const doc = await FlightDocs.get(id);
    if (!doc) return;

    const btn = $(`[data-doc-read="${id}"]`);
    const was = btn.textContent;
    btn.disabled = true;
    btn.textContent = "קורא…";

    try {
      const res = await fetch("/api/flight-doc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leg: doc.leg,
          mediaType: doc.type,
          data: await FlightDocs.toBase64(doc.blob),
          code: localStorage.getItem("ai:code") || "",
        }),
      });
      const out = await TripAPI.readJson(res);
      // גם כאן השגיאה יכולה לנסוע בגוף של תשובה מוזרמת, לא רק בסטטוס
      if (!res.ok || !out || out.error) {
        throw new Error(
          out?.error || (res.ok ? "התשובה מהשרת לא נקראה." : `הקריאה נכשלה (${res.status})`)
        );
      }

      const lines = [
        out.flightNo && `טיסה: ${out.flightNo}`,
        out.date && `תאריך: ${out.date}`,
        out.dep && `המראה: ${out.dep}`,
        out.arr && `נחיתה: ${out.arr}`,
        out.from && `מוצא: ${out.from}`,
        out.to && `יעד: ${out.to}`,
        out.terminal && `טרמינל: ${out.terminal}`,
        (out.seats || []).length && "מושבים: " + out.seats.map((s) => `${s.who} ${s.seat}`).join(", "),
        out.note,
      ].filter(Boolean).join("\n");

      if (!confirm(`נקרא מהמסמך:\n\n${lines}\n\nלעדכן את פרטי ה${LEG[doc.leg]}?`)) return;

      const trip = host.getTrip();
      const leg = trip.flights[doc.leg] || (trip.flights[doc.leg] = {});
      ["flightNo", "date", "dep", "arr", "from", "to", "terminal", "duration"].forEach((k) => {
        if (out[k]) leg[k] = out[k];
      });
      if ((out.seats || []).length) leg.seats = out.seats;
      if (out.date) leg.dow = TripStore.dowOf(out.date);
      host.saveTrip();
      await render();
    } catch (err) {
      alert(err.message || "קריאת המסמך נכשלה.");
    } finally {
      if (btn.isConnected) { btn.disabled = false; btn.textContent = was; }
    }
  }

  return {
    init(hostApi) {
      host = hostApi;

      $("#flightsView").addEventListener("change", (e) => {
        const up = e.target.closest("[data-upload]");
        if (up) handleUpload(up);
      });

      $("#flightsView").addEventListener("click", async (e) => {
        const read = e.target.closest("[data-doc-read]");
        if (read) return readDoc(read.dataset.docRead);

        const del = e.target.closest("[data-doc-del]");
        if (!del) return;
        if (!confirm("למחוק את המסמך מהמכשיר הזה?")) return;
        await FlightDocs.remove(del.dataset.docDel);
        await render();
      });
    },
    render,
  };
})();
