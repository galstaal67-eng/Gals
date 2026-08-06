/* =========================================================================
   אתר הטיול — לוגיקת צד לקוח
   תלוי ב-data.js (המשתנה TRIP) וב-Leaflet (אופציונלי — יש נפילה חיננית).
   ========================================================================= */
(function () {
  "use strict";

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STORE_KEY = "scotland2026:v1";

  /* ==================================================================== */
  /*  עזרי פורמט                                                          */
  /* ==================================================================== */

  const nfILS = new Intl.NumberFormat("he-IL", {
    style: "currency", currency: "ILS", maximumFractionDigits: 0,
  });
  const nfILS2 = new Intl.NumberFormat("he-IL", {
    style: "currency", currency: "ILS", minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const nfNum = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 });

  const ils  = (n) => nfILS.format(Math.round(n || 0));
  const ils2 = (n) => nfILS2.format(n || 0);

  /** טווח סכומים. הפורמט העברי מוסיף סימני כיווניות סביב כל מספר, ולכן
   *  מקף בין שניים נשבר בגלישת שורה ומתהפך. bdi + nowrap מבודדים אותו. */
  const ilsRange = (a, b) => `<bdi class="rng">${ils(a)} – ${ils(b)}</bdi>`;

  /** dd/mm — לתצוגה קומפקטית */
  function shortDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }

  function fullDate(iso) {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("he-IL", { day: "numeric", month: "long" });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ==================================================================== */
  /*  אחסון מקומי                                                         */
  /* ==================================================================== */

  const DEFAULT_STATE = {
    theme: "dark",
    rates: { "£": 4.65, "€": 4.00, "$": 3.45, "₪": 1 },
    people: [
      { name: "גל",  group: 1 },
      { name: "נועה", group: 1 },
      { name: "חזי",  group: 2 },
      { name: "שרון", group: 2 },
    ],
    expenses: [],
    budget: null,
    packing: {},
    costOverrides: {},        // "groupKey:index" -> { low, high }
    costIncludeExtras: true,
  };

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return structuredClone(DEFAULT_STATE);
      const parsed = JSON.parse(raw);
      return Object.assign(structuredClone(DEFAULT_STATE), parsed);
    } catch (err) {
      console.warn("שחזור הנתונים נכשל, מתחילים מחדש:", err);
      return structuredClone(DEFAULT_STATE);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("שמירת הנתונים נכשלה:", err);
    }
  }

  /* ==================================================================== */
  /*  ערכת נושא                                                           */
  /* ==================================================================== */

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    $("#themeToggle").textContent = state.theme === "dark" ? "🌙" : "☀️";
  }

  $("#themeToggle").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    save();
  });

  $("#printBtn").addEventListener("click", () => window.print());

  /* ==================================================================== */
  /*  לשוניות                                                             */
  /* ==================================================================== */

  const tabs = $$(".tab");

  function selectTab(tabEl) {
    tabs.forEach((t) => {
      const on = t === tabEl;
      t.setAttribute("aria-selected", String(on));
      $("#" + t.getAttribute("aria-controls")).classList.toggle("is-active", on);
    });
    // Leaflet מחשב גודל שגוי כשהמכל היה מוסתר — מרעננים בעת חשיפה
    if (tabEl.id === "tab-map" && map) setTimeout(() => map.invalidateSize(), 60);

    // בנייד סרגל הלשוניות נגלל אופקית; מוודאים שהנבחרת נראית במלואה
    tabEl.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  tabs.forEach((t) => t.addEventListener("click", () => selectTab(t)));

  /* ==================================================================== */
  /*  ספירה לאחור                                                         */
  /* ==================================================================== */

  function tickCountdown() {
    const el = $("#countdown");
    const start = new Date(TRIP.meta.startDate).getTime();
    const end = new Date(TRIP.meta.endDate).getTime();
    const now = Date.now();

    if (now < start) {
      const days = Math.ceil((start - now) / 86400000);
      el.textContent = days === 1 ? "מחר!" : days + " ימים";
    } else if (now <= end) {
      const dayNum = Math.floor((now - start) / 86400000) + 1;
      el.textContent = "יום " + dayNum;
      el.nextElementSibling.textContent = "בטיול עכשיו";
    } else {
      el.textContent = "הסתיים";
      el.nextElementSibling.textContent = "טיול שהיה";
    }
  }

  /* ==================================================================== */
  /*  מפה                                                                 */
  /* ==================================================================== */

  let map = null;
  const dayLayers = new Map();   // מספר יום -> L.LayerGroup
  let activeDay = "all";

  const TYPE_ICON = {
    airport: "✈️", station: "🚆", hotel: "🛏️", sight: "📷",
    hike: "🥾", food: "🍽️", town: "🏘️", car: "🚗",
  };

  function initMap() {
    if (typeof L === "undefined") {
      $("#map").style.display = "none";
      $("#mapFallback").classList.add("is-on");
      return;
    }

    const touch = window.matchMedia("(pointer: coarse)").matches;

    map = L.map("map", {
      scrollWheelZoom: false,
      zoomControl: true,
      // במסך מגע הגרירה כבויה עד שמקישים, אחרת אצבע על המפה חוטפת את
      // גלילת הדף ואי אפשר לעבור את המפה בכלל
      dragging: !touch,
      tap: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    map.on("click", () => map.scrollWheelZoom.enable());
    map.on("mouseout", () => map.scrollWheelZoom.disable());

    if (touch) {
      const shell = $("#mapShell");
      const guard = $("#mapGuard");
      shell.classList.add("is-locked");

      const unlock = () => {
        map.dragging.enable();
        shell.classList.remove("is-locked");
      };
      guard.addEventListener("click", unlock);
      guard.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); unlock(); }
      });
    }

    const allBounds = [];

    TRIP.days.forEach((day) => {
      const group = L.layerGroup();
      const mode = TRIP.modes[day.pathMode] || TRIP.modes.drive;

      if (day.path && day.path.length > 1) {
        L.polyline(day.path, {
          color: mode.color,
          weight: mode.weight,
          opacity: 0.85,
          dashArray: mode.dash || undefined,
          lineJoin: "round",
        }).addTo(group);
      }

      (day.points || []).forEach((pt) => {
        const icon = L.divIcon({
          className: "",
          html: `<div class="pin" style="background:${mode.color}"><span>${TYPE_ICON[pt.type] || "📍"}</span></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 28],
          popupAnchor: [0, -26],
        });

        L.marker([pt.lat, pt.lng], { icon, title: pt.name })
          .bindPopup(
            `<b>${esc(pt.name)}</b>` +
            `<small>יום ${day.n} · ${esc(day.title)}</small>`
          )
          .addTo(group);

        allBounds.push([pt.lat, pt.lng]);
      });

      dayLayers.set(day.n, group);
      group.addTo(map);
    });

    map.fitBounds(allBounds, { padding: [30, 30] });
    map.__allBounds = allBounds;
  }

  function focusDay(which) {
    activeDay = which;

    $$("#mapFilter .chip").forEach((c) =>
      c.classList.toggle("is-on", c.dataset.day === String(which))
    );

    if (!map) return;

    dayLayers.forEach((layer, n) => {
      const show = which === "all" || String(n) === String(which);
      if (show) { if (!map.hasLayer(layer)) layer.addTo(map); }
      else if (map.hasLayer(layer)) map.removeLayer(layer);
    });

    if (which === "all") {
      map.fitBounds(map.__allBounds, { padding: [30, 30] });
    } else {
      const day = TRIP.days.find((d) => String(d.n) === String(which));
      const pts = (day.points || []).map((p) => [p.lat, p.lng]);
      if (pts.length === 1) map.setView(pts[0], 11);
      else if (pts.length) map.fitBounds(pts, { padding: [50, 50] });
    }
  }

  function renderMapControls() {
    const filter = $("#mapFilter");
    filter.innerHTML =
      `<button class="chip is-on" data-day="all">כל הימים</button>` +
      TRIP.days
        .map((d) => `<button class="chip" data-day="${d.n}">${d.n} · ${esc(d.region)}</button>`)
        .join("");

    filter.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (chip) focusDay(chip.dataset.day);
    });

    $("#mapLegend").innerHTML = Object.values(TRIP.modes)
      .map(
        (m) =>
          `<span><i class="legend-swatch" style="background:${m.color};${
            m.dash ? "opacity:.85" : ""
          }"></i> ${m.icon} ${esc(m.label)}</span>`
      )
      .join("");
  }

  /* ==================================================================== */
  /*  סטטיסטיקות מסלול                                                    */
  /* ==================================================================== */

  function renderRouteStats() {
    // ק"מ נהיגה לפי אזור. מסתמך על pathMode ולא על mode, כדי לתפוס גם את יום
    // החזרה — שמסומן כיום טיסה אבל כולל נסיעה מפיטלוכרי לשדה התעופה.
    const byRegion = {};
    TRIP.days
      .filter((d) => d.pathMode === "drive")
      .forEach((d) => {
        byRegion[d.region] = (byRegion[d.region] || 0) + (d.drive?.km || 0);
      });

    const maxKm = Math.max(...Object.values(byRegion), 1);
    const colors = [ "var(--moss)", "var(--sky)", "var(--heather)", "var(--gold)", "var(--rose)" ];

    $("#regionBars").innerHTML = Object.entries(byRegion)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([region, km], i) => `
        <div class="bar-row">
          <span>${esc(region)}</span>
          <span class="bar-track"><i class="bar-fill" style="width:${(km / maxKm) * 100}%;background:${colors[i % colors.length]}"></i></span>
          <span class="bar-val">${nfNum.format(km)} ק"מ</span>
        </div>`
      )
      .join("");

    // שעות נהיגה יומיות
    const maxH = Math.max(...TRIP.days.map((d) => d.drive?.hours || 0), 1);
    $("#driveSpark").innerHTML = TRIP.days
      .map((d) => {
        const h = d.drive?.hours || 0;
        const pct = (h / maxH) * 100;
        const heavy = h >= 4.5;
        return `
        <div class="spark__col" title="יום ${d.n}: ${h} שעות נהיגה">
          <div class="spark__bar" style="height:${Math.max(pct, 2)}%;${
            heavy ? "background:linear-gradient(180deg,var(--danger),rgba(255,107,107,.3))" : ""
          }"></div>
          <div class="spark__lbl">${d.n}</div>
        </div>`;
      })
      .join("");
  }

  /* ==================================================================== */
  /*  מסלול יומי                                                          */
  /* ==================================================================== */

  function gmapsLink(day) {
    const pts = (day.points || []).filter((p) => p.lat && p.lng);
    if (!pts.length) return null;
    const origin = pts[0];
    const dest = pts[pts.length - 1];
    const mid = pts.slice(1, -1).slice(0, 9);

    let url =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${origin.lat},${origin.lng}` +
      `&destination=${dest.lat},${dest.lng}`;
    if (mid.length) {
      url += `&waypoints=` + mid.map((p) => `${p.lat},${p.lng}`).join("|");
    }
    return url;
  }

  function renderDays() {
    $("#dayList").innerHTML = TRIP.days
      .map((day) => {
        const mode = TRIP.modes[day.mode] || TRIP.modes.drive;

        const plan = day.plan
          .map(
            (p) =>
              `<li>${p.time ? `<time>${esc(p.time)}</time>` : `<time>·</time>`} ${esc(p.text)}</li>`
          )
          .join("");

        const tips = day.tips?.length
          ? `<div class="panel">
               <h4>💡 טיפים ליום הזה</h4>
               <ul>${day.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
             </div>`
          : "";

        const hotel = day.hotel
          ? `<div class="panel panel--hotel">
               <h4>🛏️ לינה</h4>
               <div class="hotel-name">${esc(day.hotel.name)}</div>
               <div class="muted">${esc(day.hotel.area)}</div>
               ${day.hotel.booked ? `<span class="badge badge--booked mt-1">✓ מוזמן</span>` : ""}
               <div class="mt-1">
                 <a class="btn btn--sm" target="_blank" rel="noopener"
                    href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(day.hotel.name + " " + day.hotel.area)}">
                    פתח במפות
                 </a>
               </div>
             </div>`
          : `<div class="panel"><h4>🛏️ לינה</h4><div class="muted">טיסה חזרה — אין לינה</div></div>`;

        const dirLink = gmapsLink(day);

        return `
        <article class="day" data-day="${day.n}">
          <button class="day__head" aria-expanded="false">
            <span class="day__num"><b>${day.n}</b><small>${esc(day.dow)}</small></span>
            <span>
              <h3 class="day__title">${esc(day.title)}</h3>
              <span class="day__meta">
                <span>📆 ${fullDate(day.date)}</span>
                <span>${mode.icon} ${esc(mode.label)}</span>
                ${day.drive?.km ? `<span>🚗 ${nfNum.format(day.drive.km)} ק"מ · ${day.drive.hours} ש'</span>` : ""}
                ${day.hotel ? `<span>🛏️ ${esc(day.hotel.area)}</span>` : ""}
              </span>
            </span>
            <span class="day__chev">⌄</span>
          </button>

          <div class="day__body">
            <p class="day__summary">${esc(day.summary)}</p>
            <ul class="timeline">${plan}</ul>
            <div class="panels">
              ${hotel}
              ${tips}
              ${day.drive?.note ? `<div class="panel"><h4>🚗 נהיגה</h4><ul><li>${esc(day.drive.note)}</li></ul></div>` : ""}
            </div>
            <div class="day__actions">
              <button class="btn btn--sm" data-focus="${day.n}">🗺️ הצג במפה</button>
              ${dirLink ? `<a class="btn btn--sm" target="_blank" rel="noopener" href="${dirLink}">🧭 ניווט ב-Google Maps</a>` : ""}
            </div>
          </div>
        </article>`;
      })
      .join("");

    $("#dayList").addEventListener("click", (e) => {
      const head = e.target.closest(".day__head");
      if (head) {
        const card = head.closest(".day");
        const open = card.classList.toggle("is-open");
        head.setAttribute("aria-expanded", String(open));
        return;
      }

      const focusBtn = e.target.closest("[data-focus]");
      if (focusBtn) {
        selectTab($("#tab-map"));
        focusDay(focusBtn.dataset.focus);
      }
    });

    $("#expandAll").addEventListener("click", () =>
      $$(".day").forEach((d) => {
        d.classList.add("is-open");
        $(".day__head", d).setAttribute("aria-expanded", "true");
      })
    );
    $("#collapseAll").addEventListener("click", () =>
      $$(".day").forEach((d) => {
        d.classList.remove("is-open");
        $(".day__head", d).setAttribute("aria-expanded", "false");
      })
    );
  }

  /* ==================================================================== */
  /*  המלצות לשיפור                                                       */
  /* ==================================================================== */

  const LEVEL_LABEL = { critical: "קריטי", high: "חשוב", medium: "כדאי", low: "לתשומת לב" };
  const STATUS_LABEL = {
    applied: { text: "✓ יושם במסלול", cls: "imp__status--applied" },
    action:  { text: "↗ דורש פעולה",  cls: "imp__status--action" },
  };

  function renderImprovements() {
    const applied = TRIP.improvements.filter((i) => i.status === "applied").length;
    const action = TRIP.improvements.length - applied;
    $("#impCounts").innerHTML =
      `<span class="badge" style="color:var(--moss)">✓ ${applied} יושמו במסלול</span>` +
      `<span class="badge" style="color:var(--gold)">↗ ${action} דורשות פעולה מכם</span>`;

    $("#impList").innerHTML = TRIP.improvements
      .map((imp) => {
        const st = STATUS_LABEL[imp.status] || STATUS_LABEL.action;
        return `
        <article class="imp imp--${imp.level}">
          <h3>
            <span class="imp__level">${LEVEL_LABEL[imp.level]}</span>
            <span class="imp__status ${st.cls}">${st.text}</span>
            ${esc(imp.title)}
          </h3>
          <p>${esc(imp.body)}</p>
        </article>`;
      })
      .join("");
  }

  /* ==================================================================== */
  /*  מידע וציוד                                                          */
  /* ==================================================================== */

  function renderInfo() {
    $("#infoGrid").innerHTML = TRIP.practical
      .map(
        (sec) => `
        <article class="card info-card">
          <h3>${sec.icon} ${esc(sec.title)}</h3>
          <ul>${sec.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
        </article>`
      )
      .join("");
  }

  function renderPacking() {
    $("#packGrid").innerHTML = TRIP.packing
      .map(
        (grp) => `
        <article class="card pack-card">
          <h3>${esc(grp.group)}</h3>
          ${grp.items
            .map((item) => {
              const key = grp.group + "|" + item;
              const done = !!state.packing[key];
              return `<label class="pack-item ${done ? "is-done" : ""}">
                        <input type="checkbox" data-pack="${esc(key)}" ${done ? "checked" : ""} />
                        <span>${esc(item)}</span>
                      </label>`;
            })
            .join("")}
        </article>`
      )
      .join("");

    $("#packGrid").addEventListener("change", (e) => {
      const box = e.target.closest("[data-pack]");
      if (!box) return;
      state.packing[box.dataset.pack] = box.checked;
      box.closest(".pack-item").classList.toggle("is-done", box.checked);
      save();
      updatePackProgress();
    });

    updatePackProgress();
  }

  function updatePackProgress() {
    const total = TRIP.packing.reduce((n, g) => n + g.items.length, 0);
    const done = TRIP.packing.reduce(
      (n, g) => n + g.items.filter((i) => state.packing[g.group + "|" + i]).length,
      0
    );
    const pct = total ? (done / total) * 100 : 0;
    $("#packBar").style.width = pct + "%";
    $("#packText").textContent = `${done} מתוך ${total} פריטים ארוזים`;
  }

  /* ==================================================================== */
  /*  תכנון עלויות מראש                                                   */
  /* ==================================================================== */

  /** הערך בפועל של שורה — override של המשתמש אם קיים, אחרת האומדן מהנתונים */
  function costValue(groupKey, idx, item) {
    const o = state.costOverrides[groupKey + ":" + idx];
    return {
      low: o && Number.isFinite(o.low) ? o.low : item.low,
      high: o && Number.isFinite(o.high) ? o.high : item.high,
    };
  }

  const rate = (cur) => Number(state.rates[cur]) || 1;

  function computeCost() {
    const groups = TRIP.costPlan.groups.map((g) => {
      let low = 0, high = 0;
      g.items.forEach((item, i) => {
        const v = costValue(g.key, i, item);
        low += v.low * rate(item.currency);
        high += v.high * rate(item.currency);
      });
      return { ...g, lowILS: low, highILS: high };
    });

    const included = groups.filter((g) => g.core || state.costIncludeExtras);
    const low = included.reduce((s, g) => s + g.lowILS, 0);
    const high = included.reduce((s, g) => s + g.highILS, 0);

    return { groups, low, high, mid: (low + high) / 2 };
  }

  function renderCostPlan() {
    $("#costNote").textContent = TRIP.costPlan.note;
    $("#costIncludeExtras").checked = state.costIncludeExtras;

    const c = computeCost();
    const nights = TRIP.days.filter((d) => d.hotel).length;

    $("#costSummary").innerHTML = `
      <div class="exp-tile exp-tile--settle">
        <div class="exp-tile__lbl">סה"כ לזוג</div>
        <div class="exp-tile__val">${ils(c.mid)}</div>
        <div class="exp-tile__sub">טווח ${ilsRange(c.low, c.high)} · ללא אוכל</div>
      </div>
      <div class="exp-tile">
        <div class="exp-tile__lbl">לאדם</div>
        <div class="exp-tile__val">${ils(c.mid / 2)}</div>
        <div class="exp-tile__sub">טווח ${ilsRange(c.low / 2, c.high / 2)}</div>
      </div>
      <div class="exp-tile">
        <div class="exp-tile__lbl">ללילה לזוג</div>
        <div class="exp-tile__val">${ils(c.mid / nights)}</div>
        <div class="exp-tile__sub">על פני ${nights} לילות</div>
      </div>
      <div class="exp-tile">
        <div class="exp-tile__lbl">ליום לזוג</div>
        <div class="exp-tile__val">${ils(c.mid / TRIP.days.length)}</div>
        <div class="exp-tile__sub">על פני ${TRIP.days.length} ימים</div>
      </div>`;

    const maxGroup = Math.max(...c.groups.map((g) => g.highILS), 1);

    $("#costGroups").innerHTML = c.groups
      .map((g) => {
        const dimmed = !g.core && !state.costIncludeExtras;
        const rows = g.items
          .map((item, i) => {
            const v = costValue(g.key, i, item);
            const id = g.key + ":" + i;
            return `
            <tr>
              <td class="note row-title">
                <strong>${esc(item.label)}</strong>
                <div class="muted" style="white-space:normal">${esc(item.detail)}</div>
              </td>
              <td data-label="מ־">
                <input type="number" class="cost-input" data-cost="${id}" data-bound="low"
                       value="${v.low}" min="0" step="10" aria-label="מינימום — ${esc(item.label)}" />
              </td>
              <td data-label="עד">
                <input type="number" class="cost-input" data-cost="${id}" data-bound="high"
                       value="${v.high}" min="0" step="10" aria-label="מקסימום — ${esc(item.label)}" />
              </td>
              <td data-label="מטבע">${esc(item.currency)}</td>
              <td class="num" data-label="בש&quot;ח">${ilsRange(v.low * rate(item.currency), v.high * rate(item.currency))}</td>
            </tr>`;
          })
          .join("");

        return `
        <div class="card mb-2 cost-group${dimmed ? " is-dimmed" : ""}">
          <div class="pad row-between" style="padding-bottom:.5rem">
            <h3 style="margin:0">${g.icon} ${esc(g.title)}${
              g.core ? "" : ' <span class="badge" style="color:var(--txt-mute)">אופציונלי</span>'
            }</h3>
            <strong style="font-variant-numeric:tabular-nums">${ilsRange(g.lowILS, g.highILS)}</strong>
          </div>
          <div class="pad" style="padding-top:0;padding-bottom:.6rem">
            <span class="bar-track"><i class="bar-fill" style="width:${(g.highILS / maxGroup) * 100}%;background:var(--moss)"></i></span>
          </div>
          <div class="table-scroll">
            <table class="data cost-table">
              <thead>
                <tr><th>סעיף</th><th>מ־</th><th>עד</th><th>מטבע</th><th>בש"ח</th></tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
      })
      .join("");

    $$("[data-cost]").forEach((inp) =>
      inp.addEventListener("input", () => {
        const key = inp.dataset.cost;
        const val = parseFloat(inp.value);
        if (!Number.isFinite(val) || val < 0) return;
        state.costOverrides[key] = state.costOverrides[key] || {};
        state.costOverrides[key][inp.dataset.bound] = val;
        save();
        renderCostSummaryOnly();
      })
    );
  }

  /** מרענן רק את הסיכומים, כדי לא לאבד פוקוס בשדה שעורכים כרגע */
  function renderCostSummaryOnly() {
    const c = computeCost();
    const nights = TRIP.days.filter((d) => d.hotel).length;
    const tiles = $$("#costSummary .exp-tile__val");
    const subs = $$("#costSummary .exp-tile__sub");
    if (tiles.length === 4) {
      tiles[0].textContent = ils(c.mid);
      tiles[1].textContent = ils(c.mid / 2);
      tiles[2].textContent = ils(c.mid / nights);
      tiles[3].textContent = ils(c.mid / TRIP.days.length);
      subs[0].innerHTML = `טווח ${ilsRange(c.low, c.high)} · ללא אוכל`;
      subs[1].innerHTML = `טווח ${ilsRange(c.low / 2, c.high / 2)}`;
    }
    const maxGroup = Math.max(...c.groups.map((g) => g.highILS), 1);
    $$("#costGroups .cost-group").forEach((el, i) => {
      const g = c.groups[i];
      if (!g) return;
      $(".row-between strong", el).innerHTML = ilsRange(g.lowILS, g.highILS);
      $(".bar-fill", el).style.width = (g.highILS / maxGroup) * 100 + "%";
      el.classList.toggle("is-dimmed", !g.core && !state.costIncludeExtras);
      $$("tbody tr", el).forEach((tr, j) => {
        const item = g.items[j];
        const v = costValue(g.key, j, item);
        $("td.num", tr).innerHTML =
          ilsRange(v.low * rate(item.currency), v.high * rate(item.currency));
      });
    });
  }

  $("#costIncludeExtras").addEventListener("change", (e) => {
    state.costIncludeExtras = e.target.checked;
    save();
    renderCostSummaryOnly();
  });

  /* ==================================================================== */
  /*  הוצאות                                                              */
  /* ==================================================================== */

  const CATEGORIES = [
    { name: "אוכל",      color: "#4cc9a4" },
    { name: "דלק",       color: "#c0d860" },
    { name: "לינה",      color: "#f4845f" },
    { name: "טיסות",     color: "#5ec8e5" },
    { name: "נסיעות",    color: "#8ab4f8" },
    { name: "אטרקציות",  color: "#b088f9" },
    { name: "חניה",      color: "#e0a458" },
    { name: "קניות",     color: "#f0a202" },
    { name: "בילויים",   color: "#e06c9f" },
    { name: "רפואה",     color: "#ff6b6b" },
    { name: "אחר",       color: "#8898aa" },
  ];

  const CURRENCIES = ["£", "€", "$", "₪"];
  const CURRENCY_LABEL = { "£": "ליש\"ט", "€": "אירו", "$": "דולר", "₪": "שקל" };

  const catColor = (name) =>
    (CATEGORIES.find((c) => c.name === name) || { color: "#8898aa" }).color;

  /** המרה לשקל לפי השערים הנוכחיים */
  const toILS = (item) => (Number(item.amount) || 0) * (Number(state.rates[item.currency]) || 1);

  /* ------------------------------------------------------ טופס הזנה -- */

  function fillSelects() {
    $("#exCurrency").innerHTML = CURRENCIES.map(
      (c) => `<option value="${c}">${c} ${CURRENCY_LABEL[c]}</option>`
    ).join("");

    $("#exCategory").innerHTML = CATEGORIES.map(
      (c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`
    ).join("");

    const prev = $("#exPayer").value;
    $("#exPayer").innerHTML = state.people
      .map((p) => `<option value="${esc(p.name)}">${esc(p.name)} (זוג ${p.group})</option>`)
      .join("");
    if (prev && state.people.some((p) => p.name === prev)) $("#exPayer").value = prev;
  }

  $("#expForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = parseFloat($("#exAmount").value);
    if (!Number.isFinite(amount) || amount <= 0) return;

    state.expenses.push({
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
      date: $("#exDate").value,
      amount,
      currency: $("#exCurrency").value,
      category: $("#exCategory").value,
      payer: $("#exPayer").value,
      note: $("#exNote").value.trim(),
    });

    save();
    $("#exAmount").value = "";
    $("#exNote").value = "";
    $("#exAmount").focus();
    renderExpenses();
  });

  /* ------------------------------------------------------- מטיילים --- */

  function renderPeople() {
    $("#peopleList").innerHTML = state.people.length
      ? `<div class="pill-row">${state.people
          .map(
            (p, i) =>
              `<span class="chip is-on" style="background:var(--ink-700);border-color:var(--line-strong);color:var(--txt)">
                 ${esc(p.name)} · זוג ${p.group}
                 <button class="btn btn--sm btn--ghost" data-del-person="${i}" title="הסרה"
                         style="padding:0 .25rem;border:0;color:var(--txt-mute)">✕</button>
               </span>`
          )
          .join("")}</div>`
      : `<p class="muted">לא הוגדרו מטיילים.</p>`;

    $$("[data-del-person]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.people.splice(Number(btn.dataset.delPerson), 1);
        save();
        fillSelects();
        renderPeople();
        renderExpenses();
      })
    );
  }

  $("#personForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#pName").value.trim();
    if (!name) return;
    if (state.people.some((p) => p.name === name)) {
      alert("מטייל בשם הזה כבר קיים.");
      return;
    }
    state.people.push({ name, group: Number($("#pGroup").value) });
    $("#pName").value = "";
    save();
    fillSelects();
    renderPeople();
    renderExpenses();
  });

  /* --------------------------------------------------------- שערים --- */

  function renderRates() {
    // אותם שערים משמשים את שתי הלשוניות — התכנון מראש וההוצאות בפועל
    ["#rateGrid", "#costRateGrid"].forEach((sel, gridIdx) => {
      $(sel).innerHTML = CURRENCIES.filter((c) => c !== "₪")
        .map(
          (c) => `
          <div class="field">
            <label for="rate-${gridIdx}-${c}">1 ${c} = ₪</label>
            <input type="number" id="rate-${gridIdx}-${c}" data-rate="${c}" step="0.001" min="0"
                   value="${state.rates[c]}" />
          </div>`
        )
        .join("");
    });

    $$("[data-rate]").forEach((inp) =>
      inp.addEventListener("input", () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v) || v <= 0) return;
        const cur = inp.dataset.rate;
        state.rates[cur] = v;
        save();
        // משקפים את השינוי בשדה המקביל בלשונית השנייה
        $$(`[data-rate="${cur}"]`).forEach((other) => {
          if (other !== inp) other.value = v;
        });
        renderExpenses();
        renderCostSummaryOnly();
      })
    );
  }

  /* ------------------------------------------------------- חישובים --- */

  /**
   * מחשב סיכומים: לפי אדם, לפי זוג, ואת ההעברות הנדרשות לאיזון.
   * החלוקה שוויונית לנפש — בדיוק כמו בגיליון המקורי.
   */
  function computeTotals() {
    const total = state.expenses.reduce((s, e) => s + toILS(e), 0);

    const byPerson = {};
    state.people.forEach((p) => (byPerson[p.name] = 0));
    state.expenses.forEach((e) => {
      byPerson[e.payer] = (byPerson[e.payer] || 0) + toILS(e);
    });

    const headcount = state.people.length || 1;
    const perHead = total / headcount;

    // צבירה לפי זוג
    const groups = {};
    state.people.forEach((p) => {
      groups[p.group] = groups[p.group] || { id: p.group, members: [], paid: 0, size: 0 };
      groups[p.group].members.push(p.name);
      groups[p.group].size += 1;
      groups[p.group].paid += byPerson[p.name] || 0;
    });

    // תשלומים של מי שכבר לא ברשימת המטיילים — לא משויכים לזוג
    Object.values(groups).forEach((g) => {
      g.fairShare = perHead * g.size;
      g.balance = g.paid - g.fairShare; // חיובי = שילם יותר מהחלק שלו
    });

    const groupList = Object.values(groups).sort((a, b) => a.id - b.id);

    // אלגוריתם קיזוז חמדני בין הזוגות
    const debtors = groupList.filter((g) => g.balance < -0.5).map((g) => ({ ...g }));
    const creditors = groupList.filter((g) => g.balance > 0.5).map((g) => ({ ...g }));
    const transfers = [];

    let di = 0, ci = 0;
    while (di < debtors.length && ci < creditors.length) {
      const amount = Math.min(-debtors[di].balance, creditors[ci].balance);
      if (amount > 0.5) {
        transfers.push({ from: debtors[di], to: creditors[ci], amount });
      }
      debtors[di].balance += amount;
      creditors[ci].balance -= amount;
      if (Math.abs(debtors[di].balance) < 0.5) di++;
      if (Math.abs(creditors[ci].balance) < 0.5) ci++;
    }

    return { total, perHead, byPerson, groupList, transfers, headcount };
  }

  /* -------------------------------------------------------- תצוגה --- */

  function renderExpenses() {
    const t = computeTotals();
    const days = TRIP.days.length;

    /* --- אריחי סיכום --- */
    $("#expSummary").innerHTML = `
      <div class="exp-tile">
        <div class="exp-tile__lbl">סה"כ הוצאות</div>
        <div class="exp-tile__val">${ils(t.total)}</div>
        <div class="exp-tile__sub">${state.expenses.length} רשומות</div>
      </div>
      <div class="exp-tile">
        <div class="exp-tile__lbl">לאדם</div>
        <div class="exp-tile__val">${ils(t.perHead)}</div>
        <div class="exp-tile__sub">${t.headcount} מטיילים</div>
      </div>
      <div class="exp-tile">
        <div class="exp-tile__lbl">ממוצע ליום</div>
        <div class="exp-tile__val">${ils(t.total / days)}</div>
        <div class="exp-tile__sub">על פני ${days} ימים</div>
      </div>
      <div class="exp-tile">
        <div class="exp-tile__lbl">לאדם ליום</div>
        <div class="exp-tile__val">${ils(t.total / days / t.headcount)}</div>
        <div class="exp-tile__sub">כולל הכול</div>
      </div>
      ${t.groupList
        .map(
          (g) => `
        <div class="exp-tile">
          <div class="exp-tile__lbl">זוג ${g.id} — ${esc(g.members.join(", "))}</div>
          <div class="exp-tile__val">${ils(g.paid)}</div>
          <div class="exp-tile__sub">חלק הוגן ${ils(g.fairShare)} · ${
            g.balance >= 0 ? "זכאי ל" : "חייב "
          }${ils(Math.abs(g.balance))}</div>
        </div>`
        )
        .join("")}
    `;

    /* --- שורת הקיזוז --- */
    $("#settleNote").innerHTML = !state.expenses.length
      ? `עדיין לא הוזנו הוצאות. הוסיפו את ההוצאה הראשונה כדי לראות את הקיזוז.`
      : t.transfers.length
      ? `<strong>סגירת חשבון:</strong> ` +
        t.transfers
          .map(
            (tr) =>
              `זוג ${tr.from.id} (${esc(tr.from.members.join(" ו"))}) מעביר
               <strong>${ils2(tr.amount)}</strong>
               לזוג ${tr.to.id} (${esc(tr.to.members.join(" ו"))})`
          )
          .join(" · ")
      : `<strong>מאוזן.</strong> אין צורך בהעברה בין הזוגות.`;

    /* --- טבלה --- */
    const sorted = [...state.expenses].sort((a, b) =>
      (a.date || "").localeCompare(b.date || "")
    );

    $("#expCount").textContent = state.expenses.length;
    $("#expBody").innerHTML = sorted.length
      ? sorted
          .map(
            (e) => `
        <tr>
          <td class="num" data-label="תאריך">${e.date ? shortDate(e.date) : "—"}</td>
          <td data-label="סעיף"><i class="cat-dot" style="background:${catColor(e.category)}"></i>${esc(e.category)}</td>
          <td data-label="מי שילם">${esc(e.payer)}</td>
          <td class="num" data-label="סכום">${nfNum.format(e.amount)}</td>
          <td data-label="מטבע">${esc(e.currency)}</td>
          <td class="num" data-label="בש&quot;ח">${ils2(toILS(e))}</td>
          <td class="note" data-label="הערות">${esc(e.note) || "—"}</td>
          <td class="row-action"><button class="btn btn--sm btn--ghost btn--danger" data-del="${e.id}">✕ מחיקה</button></td>
        </tr>`
          )
          .join("")
      : `<tr class="empty-row"><td colspan="8">אין הוצאות עדיין.</td></tr>`;

    $$("[data-del]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.expenses = state.expenses.filter((x) => x.id !== btn.dataset.del);
        save();
        renderExpenses();
      })
    );

    /* --- חלוקה לסעיפים --- */
    const byCat = {};
    state.expenses.forEach((e) => {
      byCat[e.category] = (byCat[e.category] || 0) + toILS(e);
    });
    const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const maxCat = Math.max(...catEntries.map((c) => c[1]), 1);

    $("#catBars").innerHTML = catEntries.length
      ? catEntries
          .map(
            ([name, sum]) => `
        <div class="bar-row">
          <span>${esc(name)}</span>
          <span class="bar-track"><i class="bar-fill" style="width:${(sum / maxCat) * 100}%;background:${catColor(name)}"></i></span>
          <span class="bar-val">${ils(sum)} · ${Math.round((sum / (t.total || 1)) * 100)}%</span>
        </div>`
          )
          .join("")
      : `<p class="muted">אין נתונים עדיין.</p>`;

    /* --- לפי אדם --- */
    const personEntries = Object.entries(t.byPerson).sort((a, b) => b[1] - a[1]);
    const maxPerson = Math.max(...personEntries.map((p) => p[1]), 1);

    $("#personBars").innerHTML = personEntries.length
      ? personEntries
          .map(
            ([name, sum]) => `
        <div class="bar-row">
          <span>${esc(name)}</span>
          <span class="bar-track"><i class="bar-fill" style="width:${(sum / maxPerson) * 100}%;background:var(--sky)"></i></span>
          <span class="bar-val">${ils(sum)}</span>
        </div>`
          )
          .join("")
      : `<p class="muted">אין נתונים עדיין.</p>`;

    /* --- הוצאה יומית --- */
    const byDate = {};
    state.expenses.forEach((e) => {
      if (e.date) byDate[e.date] = (byDate[e.date] || 0) + toILS(e);
    });
    const maxDay = Math.max(...Object.values(byDate), 1);

    $("#dailySpark").innerHTML = TRIP.days
      .map((d) => {
        const sum = byDate[d.date] || 0;
        return `
        <div class="spark__col" title="${fullDate(d.date)}: ${ils(sum)}">
          <div class="spark__bar" style="height:${Math.max((sum / maxDay) * 100, 2)}%"></div>
          <div class="spark__lbl">${d.n}</div>
        </div>`;
      })
      .join("");

    /* --- תקציב --- */
    renderBudget(t.total);
  }

  function renderBudget(total) {
    const input = $("#budgetInput");
    if (document.activeElement !== input) input.value = state.budget ?? "";

    const budget = Number(state.budget) || 0;
    if (!budget) {
      $("#budgetBar").style.width = "0%";
      $("#budgetText").textContent = "לא הוגדר תקציב.";
      return;
    }

    const pct = Math.min((total / budget) * 100, 100);
    $("#budgetBar").style.width = pct + "%";
    $("#budgetBar").style.background =
      total > budget ? "var(--danger)" : total > budget * 0.8 ? "var(--gold)" : "var(--moss)";
    $("#budgetText").textContent =
      total > budget
        ? `חריגה של ${ils(total - budget)} מהתקציב (${ils(budget)}).`
        : `נוצלו ${ils(total)} מתוך ${ils(budget)} — נותרו ${ils(budget - total)}.`;
  }

  $("#budgetInput").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    state.budget = Number.isFinite(v) && v > 0 ? v : null;
    save();
    renderBudget(computeTotals().total);
  });

  /* ------------------------------------------------------ CSV I/O --- */

  const csvCell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  $("#exportCsv").addEventListener("click", () => {
    const header = ["תאריך", "סכום", "מטבע", "סעיף הוצאה", "מי שילם", 'בש"ח', "הערות"];
    const rows = [...state.expenses]
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .map((e) => [e.date, e.amount, e.currency, e.category, e.payer, toILS(e).toFixed(2), e.note]);

    // BOM כדי ש-Excel יזהה UTF-8 ויציג עברית תקינה
    const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "הוצאות-סקוטלנד-2026.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#importCsv").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCsv(String(reader.result).replace(/^﻿/, ""));
        const [header, ...body] = rows;
        const idx = (name) => header.findIndex((h) => h.trim() === name);

        const iDate = idx("תאריך"), iAmt = idx("סכום"), iCur = idx("מטבע");
        const iCat = idx("סעיף הוצאה"), iPay = idx("מי שילם"), iNote = idx("הערות");

        if (iDate < 0 || iAmt < 0) {
          alert('הקובץ לא בפורמט הצפוי. נדרשות לפחות עמודות "תאריך" ו"סכום".');
          return;
        }

        let added = 0;
        body.forEach((r) => {
          const amount = parseFloat(r[iAmt]);
          if (!Number.isFinite(amount) || amount <= 0) return;
          state.expenses.push({
            id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
            date: normalizeDate(r[iDate]),
            amount,
            currency: CURRENCIES.includes(r[iCur]?.trim()) ? r[iCur].trim() : "£",
            category: r[iCat]?.trim() || "אחר",
            payer: r[iPay]?.trim() || state.people[0]?.name || "",
            note: r[iNote]?.trim() || "",
          });
          added++;
        });

        save();
        renderExpenses();
        alert(`יובאו ${added} רשומות.`);
      } catch (err) {
        console.error(err);
        alert("קריאת הקובץ נכשלה.");
      }
      e.target.value = "";
    };
    reader.readAsText(file, "utf-8");
  });

  /** מנתח CSV פשוט התומך בשדות מצוטטים ובפסיקים בתוכם */
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQuotes = false;
        } else cell += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  /** מקבל yyyy-mm-dd או dd/mm/yyyy ומחזיר yyyy-mm-dd */
  function normalizeDate(raw) {
    const s = String(raw || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
    if (m) {
      return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
    }
    return TRIP.days[0].date;
  }

  $("#clearExp").addEventListener("click", () => {
    if (!state.expenses.length) return;
    if (confirm(`למחוק את כל ${state.expenses.length} ההוצאות? הפעולה אינה הפיכה.`)) {
      state.expenses = [];
      save();
      renderExpenses();
    }
  });

  /* ==================================================================== */
  /*  אתחול                                                               */
  /* ==================================================================== */

  function init() {
    applyTheme();
    tickCountdown();
    setInterval(tickCountdown, 60_000);

    renderMapControls();
    initMap();
    renderRouteStats();
    renderDays();
    renderImprovements();
    renderInfo();
    renderPacking();

    fillSelects();
    renderPeople();
    renderRates();
    renderCostPlan();

    // ברירת מחדל לתאריך: היום אם אנחנו בטווח הטיול, אחרת היום הראשון
    const today = new Date().toISOString().slice(0, 10);
    const inTrip = TRIP.days.some((d) => d.date === today);
    $("#exDate").value = inTrip ? today : TRIP.days[0].date;

    renderExpenses();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
