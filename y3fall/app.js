"use strict";
// 课程 dashboard —— 纯前端，只展示「算分的东西」。
//   #/            首页：概览 + 总日程 + 课程卡片
//   #/c/COMP4211  课程页：这门课本学期剩下的全部计分项（未公布的写 TBA）
//   #/a/COMP4211-quiz1  参考答案 / 复习提纲（a/*.html，构建时预渲染好的 MathML 片段）
// 数据：优先 data.json（明文）；没有则 data.enc.json（口令解密）。所有文本走 textContent。

const TZ = "Asia/Hong_Kong";
const KEY_STORE = "cd.key.v1";
const WD = ["一", "二", "三", "四", "五", "六", "日"];
const HUES = { COMP3211: 262, COMP3511: 18, COMP4211: 338, COMP4212: 292, COMP4900: 40,
  ELEC2100: 186, MATH2131: 146, MATH3423: 96, PHYS1003: 4, COMP2211: 212 };
const KIND = { exam: "考试", quiz: "测验", hw: "作业", lab: "实验", attend: "签到", essay: "论文",
  project: "项目", bonus: "加分", teach: "带课", other: "其他" };
const FILTERS = [["all", "全部"], ["exam", "考试 · 测验"], ["work", "作业 · 论文"], ["attend", "签到"], ["teach", "带课"]];
const $ = (s) => document.querySelector(s);

// ---------- DOM ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "hue") { el.classList.add("hue"); if (HUES[v] != null) el.style.setProperty("--h", HUES[v]); }
    else if (k === "grow") el.style.flexGrow = String(v);          // CSSOM，不受 CSP 的 style 属性限制
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// ---------- 时间（一律按香港时间） ----------
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
const WDN = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function hkt(d) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, wd: WDN[p.weekday] };
}
const at = (date, time) => new Date(`${date}T${time || "12:00"}:00+08:00`);
const wdOf = (date) => hkt(at(date)).wd;
const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
const daysBetween = (a, b) => Math.round((at(b) - at(a)) / 864e5);
function addDays(date, n) { const d = at(date); d.setUTCDate(d.getUTCDate() + n); return hkt(d).date; }
function rel(date, today) {
  const n = daysBetween(today, date);
  return n === 0 ? "今天" : n === 1 ? "明天" : n === 2 ? "后天" : n > 0 ? `${n} 天后` : n === -1 ? "昨天" : `${-n} 天前`;
}
function endTime(t) {                     // "10:30–11:50" → "11:50"；"23:59" → "23:59"
  if (!t) return "23:59";
  const m = t.match(/(\d{1,2}:\d{2})\s*$/); return m ? m[1].padStart(5, "0") : "23:59";
}
function startTime(t) { const m = (t || "").match(/^(\d{1,2}:\d{2})/); return m ? m[1].padStart(5, "0") : null; }

// ---------- 数据派生 ----------
let DATA = null, ENV = null, TERMS = null, ANS = null;
const state = { filter: "all" };

function flatten() {
  const out = [];
  for (const c of DATA.courses) for (const p of c.parts) for (const it of p.items) out.push({ c, p, it });
  return out;
}
// 状态：done 已完成 · overdue 逾期未交 · open 待交（Canvas 已发布）· upcoming 未到 · tba 未公布
function statusOf(it, now) {
  const cv = it.canvas;
  if (cv) {
    if (["submitted", "graded", "pending_review"].includes(cv.status)) return "done";
    if (cv.due) return new Date(cv.due) < now ? "overdue" : "open";
    // 没有截止时间的 Canvas 项（如 COMP4900 签到记录）：按它自己的日期，过了就算已过
    if (it.date) return at(it.date, endTime(it.time)) < now ? "done" : "upcoming";
    return "tba";
  }
  if (!it.date) return "tba";
  return at(it.date, endTime(it.time)) < now ? "done" : "upcoming";
}
const isLeft = (s) => s !== "done";
const bucket = (k) => (k === "exam" || k === "quiz" ? "exam" : k === "attend" ? "attend" : k === "teach" ? "teach" : "work");
const pct = (w) => `${Number.isInteger(w) ? w : w.toFixed(1)}%`;
// 单项权重算得出就写单项；算不出（总次数未知）就写整项「共 x%」
const weightText = (p, it) => {
  if (it.placeholder) return null;
  if (p.item_weight === 0) return "+";
  if (p.item_weight != null) return pct(p.item_weight);
  return p.weight ? `共 ${pct(p.weight)}` : null;
};
// 日程右侧的状态字：每一行都有
function stateText(p, it, s) {
  if (s === "tba") return "TBA";
  if (s === "open") return "待提交";
  if (p.todo) return p.todo;
  if (p.kind === "exam" || p.kind === "quiz") return "待考";
  if (p.kind === "attend") return "待签到";
  if (p.kind === "teach") return "待上课";
  return it.canvas ? "待提交" : "未发布";
}
function weekNo(date) { return Math.floor(daysBetween(DATA.term_start, date) / 7) + 1; }
function weekRange(date) {
  const mon = addDays(date, -wdOf(date));
  return [mon, addDays(mon, 6)];
}
function nextOf(c, now) {
  const items = c.parts.flatMap((p) => p.items.map((it) => ({ p, it, s: statusOf(it, now) })))
    .filter((x) => (x.s === "open" || x.s === "upcoming") && x.it.date);   // 逾期的在首页红框里单独提醒
  items.sort((a, b) => at(a.it.date, startTime(a.it.time)) - at(b.it.date, startTime(b.it.time)));
  return items[0] || null;
}
function partState(p, now) {
  const ss = p.items.map((it) => statusOf(it, now));
  if (ss.length && ss.every((s) => s === "done")) return "done";
  if (ss.length && ss.filter(isLeft).every((s) => s === "tba")) return "tba";
  return "open";
}

// ---------- 参考答案 ----------
const ansKey = (code, part, item) => `${code}|${part}|${item}`;
// 一个计分项可以挂多份：答案 / 提纲 / 模拟题
const AK = { answer: ["答案", "有答案", "参考答案", 0], outline: ["提纲", "有提纲", "复习提纲", 1], mock: ["模拟题", "有模拟题", "模拟题 + 答案", 2], drill: ["默写", "有默写", "默写 + 答案", 3], review: ["总复习", "有总复习", "总复习 · 中英对照", 4], notes: ["讲义提纲", "有提纲", "讲义提纲", 5] };
function ansFor(c, p, it) {
  if (!ANS || it.placeholder) return [];
  return ANS.map.get(ansKey(c.code, p.name, it.key || "")) || ANS.map.get(ansKey(c.code, p.name, it.title)) || [];
}
async function loadAnswers() {
  try {
    const j = await fetchJSON("a/index.json");
    if (!j || !Array.isArray(j.items)) return;
    const map = new Map(), byId = new Map();
    for (const a of j.items) {
      if (!/^[A-Z]{4}\d{4}-[a-z0-9_-]+$/.test(a.id)) continue;
      if (!AK[a.kind]) continue;
      byId.set(a.id, a);
      if (a.kind === "notes") continue;                 // 讲义提纲挂在「讲课进度」的框上，不挂计分项
      const k = ansKey(a.course, a.part, a.item);
      map.set(k, [...(map.get(k) || []), a].sort((x, y) => AK[x.kind][3] - AK[y.kind][3])); byId.set(a.id, a);
    }
    ANS = { map, byId, html: new Map() };
    render();
  } catch {}
}

// 片段是自己构建的，但仍只放行白名单里的标签和属性（MathML + 基础排版），其余全部丢掉
const HTML_OK = new Set("h2 h3 h4 p ul ol li strong em code pre table thead tbody tr th td blockquote hr br div del sup sub".split(" "));
const MATH_OK = new Set(("math mrow mi mn mo ms mtext mspace msub msup msubsup mfrac msqrt mroot mstyle mtable mtr mtd mlabeledtr " +
  "mover munder munderover menclose mpadded mphantom merror").split(" "));
const MATH_ATTR = new Set(("display mathvariant stretchy fence separator lspace rspace notation columnalign rowalign rowspacing " +
  "columnspacing columnlines rowlines scriptlevel displaystyle accent accentunder largeop movablelimits minsize maxsize " +
  "width height depth linethickness symmetric frame framespacing equalrows equalcolumns align voffset").split(" "));
function clean(node) {
  for (const el of [...node.children]) {
    const tag = el.localName, isMath = el.namespaceURI === "http://www.w3.org/1998/Math/MathML";
    if (isMath ? !MATH_OK.has(tag) : !HTML_OK.has(tag)) { el.remove(); continue; }
    for (const a of [...el.attributes]) {
      const keep = isMath ? MATH_ATTR.has(a.name)
        : (a.name === "class" && ((tag === "div" && a.value === "eqn") || (tag === "code" && /^(language-[\w+-]+|texerr)$/.test(a.value))))
          || (a.name === "start" && tag === "ol" && /^\d+$/.test(a.value));
      if (!keep) el.removeAttribute(a.name);
    }
    clean(el);
  }
  return node;
}
function fragment(html) {
  const body = clean(new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html").body);
  for (const t of body.querySelectorAll("table")) { const w = h("div", { class: "tw" }); t.replaceWith(w); w.append(t); }
  for (const el of body.querySelectorAll("p, li")) if (el.textContent.trimStart().startsWith("⚠️")) el.classList.add("warn");
  // Chrome 的 MathML Core 不认 columnalign / columnspacing / rowspacing → 翻译成每个 mtd 的 CSS（CSSOM，不受 CSP 限制）
  for (const t of body.querySelectorAll("mtable")) {
    const al = (t.getAttribute("columnalign") || "center").split(/\s+/);
    const cs = (t.getAttribute("columnspacing") || "0.8em").split(/\s+/);
    const rs = (t.getAttribute("rowspacing") || "0.5ex").split(/\s+/)[0];
    [...t.children].forEach((tr, r) => [...tr.children].forEach((td, i) => {
      td.style.textAlign = al[Math.min(i, al.length - 1)];
      td.style.paddingLeft = i ? `calc(${cs[Math.min(i - 1, cs.length - 1)]} / 2)` : "0";
      td.style.paddingRight = i < tr.children.length - 1 ? `calc(${cs[Math.min(i, cs.length - 1)]} / 2)` : "0";
      td.style.paddingTop = r ? `calc(${rs} / 2)` : "0";
      td.style.paddingBottom = r < t.children.length - 1 ? `calc(${rs} / 2)` : "0";
    }));
  }
  // \bar / \overline：Chrome 把横线画得又短又细，几乎看不见 → 去掉那个 mo，改成在底字上画一条上边框
  for (const mo of body.querySelectorAll("mover > mo:last-child")) {
    if (!/^[‾¯ˉ]$/.test(mo.textContent.trim()) || mo.parentElement.children.length !== 2) continue;
    const mover = mo.parentElement, base = mover.firstElementChild;
    const row = document.createElementNS("http://www.w3.org/1998/Math/MathML", "mrow");
    row.append(base);
    row.style.borderTop = "0.065em solid currentColor"; row.style.paddingTop = "0.08em";
    mover.replaceWith(row);
  }
  return [...body.childNodes];
}
async function answerBody(id) {
  if (ANS.html.has(id)) return ANS.html.get(id);
  const r = await fetch(`a/${id}.html`, { cache: "no-store" });
  if (!r.ok) throw new Error(r.status);
  const t = await r.text();
  ANS.html.set(id, t);
  return t;
}
// 行内公式比所在段落还宽时（手机上常见），单独包一层让它自己横滚，页面不横滚
function fitInline(root) {
  for (const m of root.querySelectorAll("math")) {
    if (m.closest(".eqn, .tw, .imw")) continue;
    const w = Math.max(m.getBoundingClientRect().width, m.scrollWidth, ...[...m.querySelectorAll("mtable, mrow")].slice(0, 20).map((x) => x.getBoundingClientRect().width));
    if (w <= m.parentElement.clientWidth) continue;
    const block = m.getAttribute("display") === "block";          // 列表里的 $$…$$ 不会被包成 .eqn
    const s = document.createElement(block ? "div" : "span"); s.className = block ? "eqn" : "imw"; m.replaceWith(s); s.append(m);
  }
  // 公式略宽时先缩小字号（最多到 75%），还放不下才让它自己横滚
  for (const e of root.querySelectorAll(".eqn, .imw")) {
    const m = e.querySelector("math");
    if (!m || e.scrollWidth <= e.clientWidth + 1) continue;
    const r = Math.max(0.75, (e.clientWidth - 8) / e.scrollWidth);
    m.style.setProperty("font-size", `${(r * parseFloat(getComputedStyle(m).fontSize)).toFixed(1)}px`);
  }
}
function ansChip(a) {
  return h("a", { class: `anschip ${a.kind}`, href: `#/a/${a.id}` }, AK[a.kind][0], h("span", null, "→"));
}

// ---------- 个人行程 ----------
const tripOf = (date) => date && (DATA.events || []).find((e) => e.start <= date && date <= e.end) || null;
function tripRow(e, today) {
  const days = daysBetween(e.start, e.end) + 1;
  return h("div", { class: "trip" },
    h("div", { class: "trip-h" }, h("span", { class: "trip-ic" }, "✈"),
      h("div", null, h("b", null, e.title),
        h("div", { class: "m" }, `${md(e.start)} 周${WD[wdOf(e.start)]} → ${md(e.end)} 周${WD[wdOf(e.end)]} · ${days} 天${e.note ? " · " + e.note : ""}`)),
      h("span", { class: "tag trip-tag" }, e.start <= today ? "进行中" : rel(e.start, today))),
    e.conflicts?.length ? h("ul", { class: "trip-c" }, e.conflicts.map((c) => h("li", { class: /^🔴/.test(c) ? "bad" : "" }, c))) : null);
}

// ---------- 通用组件 ----------
function pillFor(it, s, today) {
  const cv = it.canvas;
  if (s === "done") {
    if (cv && cv.status === "graded" && cv.score != null) return h("span", { class: "pill green" }, `${cv.score} / ${cv.points}`);
    const label = cv && cv.status === "graded" ? "已评" : cv && ["submitted", "pending_review"].includes(cv.status) ? "已交" : "已过";
    return h("span", { class: `pill ${label === "已过" ? "grey" : "green"}` }, label);
  }
  if (s === "overdue") return h("span", { class: "pill red" }, "逾期未交");
  if (s === "tba") return h("span", { class: "pill grey" }, "TBA");
  const n = daysBetween(today, it.date);
  const txt = n <= 0 ? "今天" : rel(it.date, today);
  return h("span", { class: `pill ${n <= 2 ? "red" : n <= 7 ? "amber" : cv ? "blue" : "grey"}` }, cv && n > 7 ? "已发布" : txt);
}
function metaLine(it) {
  return [it.time, it.place, it.note].filter(Boolean).join(" · ");
}
function wbar(c, now, big) {
  const parts = c.parts.filter((p) => p.weight);
  if (!parts.length) return c.grading ? h("div", { class: "pf" }, c.grading) : null;
  return h("div", { class: `wbar ${big ? "big" : ""}` },
    parts.map((p) => h("i", { class: partState(p, now), grow: p.weight, title: `${p.name} ${p.weight}%` })));
}

// ---------- 首页 ----------
function viewHome(now) {
  const T = hkt(now), today = T.date;
  const all = flatten().map((x) => ({ ...x, s: statusOf(x.it, now) }));
  const graded = all.filter((x) => !x.p.optional);
  const overdue = graded.filter((x) => x.s === "overdue" && x.p.timeline !== false);
  const in72 = graded.filter((x) => (x.s === "open" || x.s === "upcoming") && x.it.date &&
    at(x.it.date, endTime(x.it.time)) - now < 72 * 36e5);
  const exams = graded.filter((x) => ["exam", "quiz"].includes(x.p.kind) && x.s === "upcoming")
    .sort((a, b) => at(a.it.date, startTime(a.it.time)) - at(b.it.date, startTime(b.it.time)));
  const left = graded.filter((x) => isLeft(x.s) && !x.it.placeholder);
  const tba = left.filter((x) => x.s === "tba");
  const ne = exams[0];

  const mast = h("header", { class: "mast rise" },
    h("div", null,
      h("div", { class: "eyebrow" }, `${DATA.term_label || DATA.term} · 第 ${weekNo(today)} 周`),
      h("h1", { class: "display" }, `${+today.slice(5, 7)} 月 ${+today.slice(8, 10)} 日`, h("span", { class: "wd" }, `周${WD[T.wd]}`))),
    h("div", { class: "mast-side" }, syncedText(now), termLinks()));

  const stats = h("section", { class: "stats rise" },
    h("div", { class: "stat" }, h("div", { class: "k" }, "72 小时内"),
      h("div", { class: `v ${in72.length ? "red" : ""}` }, in72.length, h("small", null, "项")),
      h("div", { class: "s" }, in72.length ? in72.map((x) => x.c.code).filter((v, i, a) => a.indexOf(v) === i).join(" · ") : "没有要交的")),
    h("div", { class: "stat" }, h("div", { class: "k" }, "下一场考试"),
      h("div", { class: "v" }, ne ? rel(ne.it.date, today) : "—"),
      h("div", { class: "s" }, ne ? `${ne.c.code} ${ne.it.title} · ${md(ne.it.date)}` : "暂无已公布的考试")),
    h("div", { class: "stat" }, h("div", { class: "k" }, "本学期剩余"),
      h("div", { class: "v" }, left.length, h("small", null, "项")),
      h("div", { class: "s" }, `其中 ${tba.length} 项 TBA`)),
    h("div", { class: "stat" }, h("div", { class: "k" }, "逾期未交"),
      h("div", { class: `v ${overdue.length ? "red" : ""}` }, overdue.length, h("small", null, "项")),
      h("div", { class: "s" }, overdue.length ? overdue.map((x) => x.c.code).join(" · ") : "全部按时")));

  const alert = overdue.length ? h("section", { class: "alert rise" }, h("div", { class: "eyebrow" }, "逾期未交"),
    h("ul", null, overdue.map((x) => h("li", { hue: x.c.code },
      h("span", { class: "code" }, x.c.code),
      x.it.canvas?.url ? h("a", { href: x.it.canvas.url, target: "_blank", rel: "noopener noreferrer" }, x.it.title) : h("span", null, x.it.title),
      h("span", { class: "muted" }, `${md(x.it.date)} ${x.it.time || ""} 截止 · ${rel(x.it.date, today)}`))))) : null;

  return [mast, stats, alert,
    h("div", { class: "layout" },
      h("section", { class: "col-tl" }, timeline(all, now, today)),
      h("aside", { class: "col-co" },
        h("div", { class: "sec-h" }, h("h2", null, "课程"), h("span", { class: "muted" }, `${DATA.courses.length} 门`)),
        h("div", { class: "cgrid" }, DATA.courses.map((c) => courseCard(c, now, today))))),
    footer()];
}

function courseCard(c, now, today) {
  const n = nextOf(c, now);
  const left = c.parts.filter((p) => !p.optional).flatMap((p) => p.items).filter((it) => isLeft(statusOf(it, now)) && !it.placeholder).length;
  const d = n ? daysBetween(today, n.it.date) : null;
  return h("a", { class: "ccard rise", href: `#/c/${c.code}`, hue: c.code },
    h("div", { class: "top" }, h("span", { class: "code" }, c.code), h("span", { class: "left" }, h("b", null, left), "项剩余")),
    h("div", { class: "cname" }, c.name),
    wbar(c, now),
    lectureCount(c) ? h("div", { class: "lprog" }, `已学 ${lectureCount(c).join(" / ")} 讲`) : null,
    h("div", { class: "next" },
      h("span", null, n ? n.it.title : "暂无已定日期的计分项"),
      n ? h("em", { class: d <= 2 ? "hot" : "" }, rel(n.it.date, today)) : null));
}

function timeline(all, now, today) {
  const items = all.filter((x) => isLeft(x.s) && x.s !== "overdue" && x.it.date && x.p.timeline !== false && !x.it.placeholder)
    .filter((x) => state.filter === "all" || bucket(x.p.kind) === state.filter)
    .sort((a, b) => a.it.date.localeCompare(b.it.date) || (startTime(a.it.time) || "99").localeCompare(startTime(b.it.time) || "99"));
  const head = h("div", { class: "sec-h" }, h("h2", null, "总日程"), h("span", { class: "muted" }, "只含计分项 · 已完成的不显示"));
  const filters = h("div", { class: "filters" }, FILTERS.map(([k, label]) =>
    h("button", { class: state.filter === k ? "on" : "", type: "button", on: { click: () => { state.filter = k; render(); } } }, label)));
  const trips = state.filter === "all" ? (DATA.events || []).filter((e) => e.end >= today) : [];
  if (!items.length && !trips.length) return [head, filters, h("div", { class: "empty" }, "这个分类下没有待办的计分项")];

  const entries = [...items.map((x) => ({ date: x.it.date, x })),
    ...trips.map((e) => ({ date: e.start < today ? today : e.start, trip: e }))]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.trip ? -1 : b.trip ? 1 : 0));
  const weeks = new Map();
  for (const en of entries) {
    const [mon] = weekRange(en.date);
    if (!weeks.has(mon)) weeks.set(mon, new Map());
    const days = weeks.get(mon);
    if (!days.has(en.date)) days.set(en.date, []);
    days.get(en.date).push(en);
  }
  const curMon = weekRange(today)[0];
  const blocks = [];
  for (const [mon, days] of weeks) {
    blocks.push(h("div", { class: "week" },
      h("div", { class: "week-h" }, h("b", null, `第 ${weekNo(mon)} 周`), h("span", null, `${md(mon)} – ${md(addDays(mon, 6))}`),
        mon === curMon ? h("span", { class: "now" }, "本周") : null),
      [...days].map(([date, xs]) => {
        const n = daysBetween(today, date);
        return h("div", { class: `day ${n === 0 ? "today" : n <= 2 ? "soon" : ""}` },
          h("div", { class: "dnum" }, h("b", null, +date.slice(8, 10)), h("span", null, `${+date.slice(5, 7)}月 · 周${WD[wdOf(date)]}`),
            n <= 7 ? h("em", null, rel(date, today)) : null),
          h("div", null, xs.map((en) => en.trip ? tripRow(en.trip, today) : eventRow(en.x))));
      })));
  }
  return [head, filters, blocks];
}

function eventRow(x) {
  const { c, p, it } = x;
  const w = weightText(p, it);
  const k = p.kind;
  return h("a", { class: `ev ${p.optional ? "opt" : ""} ${bucket(k) === "exam" ? "exam" : ""}`, hue: c.code, href: `#/c/${c.code}` },
    h("span", { class: "bar" }),
    h("div", null,
      h("div", { class: "t" }, h("span", { class: "code" }, c.code), it.title,
        h("span", { class: `tag ${bucket(k) === "exam" ? "exam" : k === "attend" ? "attend" : k === "teach" ? "teach" : ""}` }, KIND[k] || k),
        it.tentative ? h("span", { class: "tag tent" }, "暂定") : null,
        p.optional ? h("span", { class: "tag opt" }, "可选") : null,
        tripOf(it.date) ? h("span", { class: "tag trip-tag" }, "出行中") : null,
        ...ansFor(c, p, it).map((a) => h("span", { class: "tag ans" }, AK[a.kind][1]))),
      metaLine(it) ? h("div", { class: "m" }, metaLine(it)) : null),
    h("div", { class: "r" }, w ? h("span", { class: `w ${w.startsWith("共") ? "part" : ""}` }, w) : null, stateText(p, it, x.s)));
}

// ---------- 课程页 ----------
function viewCourse(code, now) {
  const c = DATA.courses.find((x) => x.code === code);
  if (!c) return [h("a", { class: "back", href: "#/" }, "← 全部课程"), h("div", { class: "empty" }, `没有 ${code} 这门课`)];
  const today = hkt(now).date;
  const scored = c.parts.filter((p) => !p.optional);
  const itemsAll = scored.flatMap((p) => p.items.map((it) => ({ p, it, s: statusOf(it, now) })));
  const left = itemsAll.filter((x) => isLeft(x.s) && !x.it.placeholder);
  const tba = left.filter((x) => x.s === "tba");
  const doneW = scored.reduce((acc, p) => acc + (p.item_weight ? p.items.filter((it) => statusOf(it, now) === "done").length * p.item_weight : 0), 0);
  const n = nextOf(c, now);

  return [
    h("a", { class: "back", href: "#/" }, "← 全部课程"),
    h("header", { class: "c-head rise", hue: c.code },
      h("div", { class: "eyebrow" }, h("span", { class: "code" }, c.code), DATA.term_label || DATA.term,
        c.url ? h("a", { href: c.url, target: "_blank", rel: "noopener noreferrer" }, "Canvas ↗") : null),
      h("h1", { class: "display" }, c.name),
      c.note ? h("p", { class: "c-note" }, c.note) : null,
      h("div", { class: "c-kpis" },
        h("div", null, scored.every((p) => p.kind === "teach") ? "剩余场次" : "剩余计分项", h("b", null, left.length)),
        h("div", null, "其中 TBA", h("b", null, tba.length)),
        c.grading ? h("div", null, "评分", h("b", null, c.grading)) : h("div", null, "已完成权重", h("b", null, `${Math.round(doneW)}%`)),
        h("div", null, "下一项", h("b", null, n ? rel(n.it.date, today) : "—"))),
      c.parts.some((p) => p.weight) ? h("div", { class: "c-bar" }, wbar(c, now, true),
        h("div", { class: "legend" }, c.parts.filter((p) => p.weight).map((p) =>
          h("span", { class: partState(p, now) }, `${p.name} ${p.weight}%`)))) : null),
    infoBlock(c),
    lectureBlock(c),
    h("section", { class: "parts" }, answersBlock(c), c.parts.map((p) => partBlock(c, p, now, today))),
    materialsBlock(c, today),
    footer()];
}

// 讲课进度：lectures/<CODE>.toml。每讲一个框，点开看提纲；学过的（done）标绿，没发布的虚线框
function lectureCount(c) {
  const L = (c.lectures?.units || []).filter((u) => u.kind === "lecture");
  return L.length ? [L.filter((u) => u.done).length, L.length] : null;
}
function lectureBlock(c) {
  const units = c.lectures?.units;
  if (!units?.length) return null;
  const groups = [["lecture", "讲课"], ["lab", "Lab"]].map(([k, name]) => [name, units.filter((u) => u.kind === k)]).filter(([, us]) => us.length);
  const count = (us) => `${us.filter((u) => u.done).length} / ${us.length}`;
  const box = (u) => {
    const head = [h("span", { class: "lid" }, u.id), h("span", { class: "lt" }, u.title),
      u.done ? h("span", { class: "lok" }, "✓ 已学") : u.pending ? h("span", { class: "lpend" }, "未发布") : null];
    const note = ANS && [...ANS.byId.values()].find((a) => a.kind === "notes" && a.course === c.code && a.unit === u.id);
    if (note) return h("li", { class: `lu${u.done ? " learned" : ""}` }, h("a", { class: "lh", href: `#/a/${note.id}` }, head, h("span", { class: "lgo" }, "提纲 →")));
    if (!u.outline.length) return h("li", { class: `lu${u.done ? " learned" : ""}${u.pending ? " pending" : ""}` }, h("div", { class: "lh" }, head));
    return h("li", { class: `lu${u.done ? " learned" : ""}` }, h("details", null, h("summary", { class: "lh" }, head),
      h("ul", { class: "lol" }, u.outline.map((t) => h("li", null, richText(t))))));
  };
  return h("details", { class: "part lect rise", hue: c.code, open: true },
    h("summary", { class: "part-h" }, h("h3", null, "讲课进度"),
      h("span", { class: "pc" }, groups.map(([name, us]) => `${name} ${count(us)}`).join(" · "))),
    groups.map(([name, us]) => {
      const bar = h("div", { class: "lbar" }, h("i"));
      bar.firstChild.style.setProperty("width", `${(100 * us.filter((u) => u.done).length) / us.length}%`);
      return h("div", { class: "lgroup" },
        groups.length > 1 ? h("h4", null, name, h("span", null, `已学 ${count(us)}`)) : null,
        bar, h("ol", { class: "lgrid" }, us.map(box)));
    }),
    c.lectures.source ? h("p", { class: "lsrc" }, c.lectures.source) : null);
}

// 课程须知：info/<CODE>.md（作业要求、考试规则、迟交政策…）。只支持 **加粗** 和 `代码`，纯文本插入
function richText(t) {
  return t.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map((x) =>
    x.startsWith("**") ? h("b", null, x.slice(2, -2)) : x.startsWith("`") ? h("code", null, x.slice(1, -1)) : x);
}
function infoBlock(c) {
  if (!c.info?.length) return null;
  const n = c.info.reduce((a, g) => a + g.items.length, 0);
  return h("details", { class: "part cinfo rise", hue: c.code, open: true },
    h("summary", { class: "part-h" }, h("h3", null, "课程须知"), h("span", { class: "pc" }, `${n} 条`)),
    c.info.map((g) => h("div", { class: "cig" }, g.h ? h("h4", null, g.h) : null,
      h("ul", null, g.items.map((t) => h("li", null, richText(t)))))));
}

// 这门课的全部答案 / 提纲一览（已截止的项在折叠区里，不列出来就不好找）
function answersBlock(c) {
  if (!ANS) return null;
  const list = [...ANS.byId.values()].filter((a) => a.course === c.code && a.kind !== "notes");
  if (!list.length) return null;
  const order = new Map(c.parts.flatMap((p, i) => p.items.map((it, j) => [`${p.name}|${it.key || it.title}`, i * 1000 + j])));
  const pos = (a) => order.get(`${a.part}|${a.item}`) ?? order.get(`${a.part}|${c.parts.find((p) => p.name === a.part)?.items.find((it) => it.title === a.item)?.key}`) ?? 1e9;
  list.sort((x, y) => pos(x) - pos(y) || AK[x.kind][3] - AK[y.kind][3]);
  return h("details", { class: "part alist rise", hue: c.code, open: true },
    h("summary", { class: "part-h" }, h("h3", null, "参考答案 · 提纲"), h("span", { class: "pc" }, `${list.length} 份`)),
    h("ol", null, list.map((a) => h("li", null, h("a", { href: `#/a/${a.id}` },
      h("span", { class: `k ${a.kind}` }, AK[a.kind][0]), h("span", { class: "t" }, a.title),
      a.status === "已核对" ? h("span", { class: "ok" }, "✓") : null)))));
}

function partBlock(c, p, now, today) {
  const rows = p.items.map((it) => ({ it, s: statusOf(it, now) }));
  const left = rows.filter((r) => isLeft(r.s));
  const done = rows.filter((r) => !isLeft(r.s));
  const countTxt = p.count ? `共 ${p.count} 次` : p.items.length ? `已知 ${p.items.filter((i) => !i.placeholder).length} 次` : "";
  return h("div", { class: "part rise", hue: c.code },
    h("div", { class: "part-h" }, h("h3", null, p.name),
      h("span", { class: "pc" }, [KIND[p.kind], countTxt, p.optional ? "可选" : null].filter(Boolean).join(" · ")),
      p.weight ? h("span", { class: "pw" }, `${p.weight}%`) : null),
    left.length ? h("ol", { class: "rows" }, left.map((r) => itemRow(c, p, r.it, r.s, today)))
      : h("div", { class: "empty" }, "这一项已经全部完成"),
    done.length ? h("details", { class: "done" }, h("summary", null, `已完成 ${done.length} 项`,
        (() => { const n = done.filter((r) => ansFor(c, p, r.it).length).length; return n ? ` · ${n} 项有答案` : ""; })()),
      h("ol", { class: "rows" }, done.map((r) => itemRow(c, p, r.it, r.s, today)))) : null);
}

function itemRow(c, p, it, s, today) {
  const as = ansFor(c, p, it), a = as.length > 0;
  const cov = it.covers?.length ? it.covers : null;
  const url = a || cov ? null : it.canvas?.url;       // 行内还有别的链接时整行不再是链接（不能嵌套 <a>），Canvas 链接挪到标题上
  const w = weightText(p, it);
  const tag = url ? "a" : "li";
  const title = (a || cov) && it.canvas?.url ? h("a", { class: "cv", href: it.canvas.url, target: "_blank", rel: "noopener noreferrer" }, it.title) : it.title;
  return h(tag, { class: `row ${it.placeholder ? "ph" : ""}`, href: url || null, target: url ? "_blank" : null, rel: url ? "noopener noreferrer" : null },
    it.date ? h("div", { class: "dt" }, h("b", null, md(it.date)), h("span", null, `周${WD[wdOf(it.date)]}`))
      : h("div", { class: "dt tba" }, h("b", null, "TBA")),
    h("div", null,
      h("div", { class: "ti" }, title, it.tentative ? h("span", { class: "tag tent" }, "暂定") : null,
        tripOf(it.date) && s !== "done" ? h("span", { class: "tag trip-tag" }, "出行中") : null),
      it.subtitle ? h("div", { class: "sub" }, it.subtitle) : null,
      metaLine(it) ? h("div", { class: "m" }, metaLine(it)) : null,
      cov ? coversLine(cov) : null),
    h("div", { class: "st" }, w ? h("span", { class: "w" }, w) : null, pillFor(it, s, today), ...as.map(ansChip)));
}

function coversLine(cov) {
  return h("div", { class: "cov" }, h("span", { class: "k" }, "范围"),
    cov.map((m) => m.url ? h("a", { href: m.url, target: "_blank", rel: "noopener noreferrer" }, stem(m.name)) : h("span", null, stem(m.name))));
}
const stem = (n) => n.replace(/\.(pdf|pptx?|docx?|ipynb|zip)$/i, "");
const EXT = (n) => (n.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
function fsize(b) { return b == null ? "" : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`; }

// ---------- 讲义 ----------
function materialsBlock(c, today) {
  const ms = c.materials || [];
  if (!ms.length) return null;
  const groups = new Map();
  for (const m of ms) { const k = m.folder || "课件"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
  const host = ms.some((m) => !m.url.startsWith("https://canvas.ust.hk/")) ? "课程官网（CSE 登录）" : "Canvas";
  return h("section", { class: "mats rise", hue: c.code },
    h("div", { class: "part-h" }, h("h3", null, "讲义与资料"), h("span", { class: "pc" }, `${ms.length} 个文件 · 链接到 ${host}`)),
    [...groups].map(([name, list], i) => h("details", { class: "mgroup", open: i === 0 || /lecture|slide|note|课件/i.test(name) },
      h("summary", null, h("span", null, name.replace(/\//g, " / ")), h("em", null, list.length)),
      h("ol", { class: "mlist" }, list.map((m) => {
        const fresh = m.updated && daysBetween(m.updated, today) <= 7;
        return h("li", null, h("a", { href: m.url, target: "_blank", rel: "noopener noreferrer" },
          h("span", { class: `ext ${EXT(m.name)}` }, EXT(m.name) || "file"),
          h("span", { class: "mn" }, stem(m.name)),
          fresh ? h("span", { class: "tag ans" }, "新") : null,
          m.locked ? h("span", { class: "tag tent" }, "未开放") : null,
          h("span", { class: "ms" }, [m.updated ? md(m.updated) : null, fsize(m.size)].filter(Boolean).join(" · "))));
      })))));
}

// ---------- 答案页 ----------
function viewAnswer(id, now) {
  const code = id.slice(0, 8);
  const back = h("a", { class: "back", href: `#/c/${code}` }, `← ${code}`);
  if (!ANS) return [back, h("div", { class: "empty" }, "加载中…")];
  const a = ANS.byId.get(id);
  if (!a) return [back, h("div", { class: "empty" }, "没有这份答案")];
  const c = DATA.courses.find((x) => x.code === a.course);
  const p = c?.parts.find((x) => x.name === a.part);
  const it = p?.items.find((x) => x.key === a.item || x.title === a.item);
  const today = hkt(now).date;
  const body = h("article", { class: "ans-body" }, h("div", { class: "empty" }, "加载中…"));
  answerBody(id).then((html) => { if (location.hash === `#/a/${id}`) { body.replaceChildren(...fragment(html)); requestAnimationFrame(() => fitInline(body)); } })
    .catch(() => body.replaceChildren(h("div", { class: "empty" }, "读取失败，稍后再试")));
  return [
    back,
    h("header", { class: "c-head ans-head rise", hue: a.course },
      h("div", { class: "eyebrow" }, h("span", { class: "code" }, a.course), a.kind === "notes" ? `讲课 ${a.unit}` : a.part,
        h("span", { class: `tag ${a.kind === "answer" ? "ans" : "exam"}` }, AK[a.kind][2])),
      h("h1", { class: "display" }, a.title),
      h("div", { class: "ans-meta" },
        it?.date ? h("span", null, `${a.kind === "answer" ? "截止" : "考试"} ${md(it.date)} 周${WD[wdOf(it.date)]}${it.time ? " " + it.time : ""} · ${rel(it.date, today)}`) : null,
        a.kind === "notes" ? null : h("span", { class: a.status === "已核对" ? "ok" : "unk" }, a.status),
        a.warn ? h("span", { class: "unk" }, `⚠️ ${a.warn} 处待确认`) : null,
        a.updated ? h("span", null, `更新于 ${a.updated}`) : null,
        it?.canvas?.url ? h("a", { href: it.canvas.url, target: "_blank", rel: "noopener noreferrer" }, "Canvas ↗") : null)),
    it?.covers?.length ? h("div", { class: "ans-cov" }, coversLine(it.covers)) : null,
    body,
    footer()];
}

// ---------- 页脚 / 学期 ----------
function syncedText(now) {
  const s = DATA.synced ? new Date(DATA.synced) : null;
  if (!s) return h("div", null, "同步时间未知");
  const hrs = (now - s) / 36e5;
  const t = hrs < 1 ? "不到 1 小时前" : hrs < 48 ? `${Math.floor(hrs)} 小时前` : `${Math.floor(hrs / 24)} 天前`;
  return h("div", { class: hrs > 36 ? "stale" : "" }, `同步于 ${t}`, hrs > 36 ? " · 数据可能已过期" : "");
}
async function loadTerms() {
  const ok = (j) => j && Array.isArray(j.terms) && j.terms.every((t) => /^y\d+(fall|spring|summer|winter)$/.test(t));
  const inTerm = /\/y\d+(fall|spring|summer|winter)\/(index\.html)?$/.test(location.pathname);
  const [url, prefix] = inTerm ? ["../terms.json", "../"] : ["terms.json", ""];
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    if (ok(j)) { TERMS = { ...j, prefix }; render(); }
  } catch {}
}
function termLinks() {
  if (!TERMS || TERMS.terms.length < 2) return null;
  return h("div", { class: "terms" }, TERMS.terms.slice().reverse().map((t) =>
    t === DATA.term ? h("b", null, t) : h("a", { href: `${TERMS.prefix}${t}/` }, t)));
}
function footer() {
  const g = DATA.generated ? hkt(new Date(DATA.generated)) : null;
  return h("footer", { class: "foot" },
    h("span", null, `数据来自 Canvas + assessments.toml · 生成于 ${g ? `${g.date} ${g.time}` : "未知"} HKT`),
    ENV ? h("button", { type: "button", on: { click: () => { forgetKey(); location.reload(); } } }, "锁定") : null);
}

// ---------- 路由 / 渲染 ----------
const scrollMemo = {};
function route() {
  const a = location.hash.match(/^#\/a\/([A-Z]{4}\d{4}-[a-z0-9_-]+)$/);
  if (a) return { answer: a[1] };
  const m = location.hash.match(/^#\/c\/([A-Z]{4}\d{4})$/);
  return m ? { course: m[1] } : { home: true };
}
function render() {
  if (!DATA) return;
  const now = new Date(), r = route();
  const app = $("#app");
  const view = r.answer ? viewAnswer(r.answer, now) : r.course ? viewCourse(r.course, now) : viewHome(now);
  app.replaceChildren(...[view].flat(Infinity).filter(Boolean));
  const a = r.answer && ANS?.byId.get(r.answer);
  document.title = a ? `${a.course} ${a.title}` : r.course ? `${r.course} · 课程` : `课程 · ${DATA.term_label || DATA.term}`;
}
let lastRoute = location.hash;
window.addEventListener("hashchange", () => {
  scrollMemo[lastRoute] = window.scrollY;
  lastRoute = location.hash;
  render();
  window.scrollTo(0, scrollMemo[location.hash] || 0);
});

function showMain(data) {
  DATA = data;
  $("#lock").hidden = true;
  $("#app").hidden = false;
  render();
  loadTerms();
  loadAnswers();
  setInterval(() => document.visibilityState === "visible" && !route().answer && render(), 60_000);
}

// ---------- 加密模式（可选） ----------
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
async function fetchJSON(url) { const r = await fetch(url, { cache: "no-store" }); return r.ok ? r.json() : null; }
async function deriveKey(pass, env, extractable) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64d(env.salt), iterations: env.iter },
    base, { name: "AES-GCM", length: 256 }, extractable, ["decrypt"]);
}
async function decrypt(key, env) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(env.iv) }, key, b64d(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
function storedKey() { try { return JSON.parse(localStorage.getItem(KEY_STORE) || "null"); } catch { return null; } }
function forgetKey() { try { localStorage.removeItem(KEY_STORE); } catch {} }
async function tryStoredKey() {
  const s = storedKey();
  if (!s || s.salt !== ENV.salt || s.iter !== ENV.iter) return false;
  try { showMain(await decrypt(await crypto.subtle.importKey("raw", b64d(s.k), "AES-GCM", false, ["decrypt"]), ENV)); return true; }
  catch { forgetKey(); return false; }
}

async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  const plain = await fetchJSON("data.json").catch(() => null);
  if (plain) {
    showMain(plain);
    document.addEventListener("visibilitychange", () => {     // 回到前台时拉一次新数据
      if (document.visibilityState !== "visible") return;
      fetchJSON("data.json").then((d) => {
        if (d && d.generated !== DATA.generated) { DATA = d; if (ANS) ANS.html.clear(); loadAnswers(); render(); }
      }).catch(() => {});
    });
    return;
  }
  $("#lock").hidden = false;
  const msg = $("#lock-msg");
  if (!crypto?.subtle) { msg.textContent = "这个浏览器不支持 WebCrypto（需要 HTTPS）"; return; }
  ENV = await fetchJSON("data.enc.json").catch(() => null);
  if (!ENV) { msg.textContent = "数据文件读取失败"; return; }
  if (await tryStoredKey()) return;
  $("#unlock").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("#go"), remember = $("#remember").checked;
    btn.disabled = true; msg.textContent = ""; btn.textContent = "解锁中…";
    try {
      const key = await deriveKey($("#pass").value, ENV, remember);
      const data = await decrypt(key, ENV);
      if (remember) {
        const raw = await crypto.subtle.exportKey("raw", key);
        try { localStorage.setItem(KEY_STORE, JSON.stringify({ salt: ENV.salt, iter: ENV.iter, k: b64e(raw) })); } catch {}
      }
      $("#pass").value = "";
      showMain(data);
    } catch { msg.textContent = "口令不对"; btn.disabled = false; btn.textContent = "解锁"; }
  });
  $("#pass").focus();
}
init();
