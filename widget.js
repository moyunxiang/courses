// COURSES_WIDGET · 课程 DDL 小组件（Scriptable）
// 由手机上的加载器（scriptable.txt）从网站拉取后运行；改这里 + publish，手机端下次刷新自动更新。
// 支持：桌面 小 / 中 / 大，锁屏 矩形 / 单行 / 圆形。点小组件 → 打开 dashboard，中 / 大尺寸点某一行 → 那门课。
const SITE = "https://moyunxiang.com/courses/";
const HUES = { COMP3211: 262, COMP3511: 18, COMP4211: 338, COMP4212: 292, COMP4900: 40,
  ELEC2100: 186, MATH2131: 146, MATH3423: 96, PHYS1003: 4, COMP2211: 212 };
const WD = ["日", "一", "二", "三", "四", "五", "六"];
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), "courses-data.json");

// ---------- 数据 ----------
async function load() {
  try {
    const d = await new Request(SITE + "data.json?t=" + Date.now()).loadJSON();
    if (d && d.courses) { fm.writeString(CACHE, JSON.stringify(d)); return { d, offline: false }; }
  } catch (e) {}
  if (fm.fileExists(CACHE)) return { d: JSON.parse(fm.readString(CACHE)), offline: true };
  return { d: null, offline: true };
}
const at = (date, time) => new Date(`${date}T${(time || "12:00").padStart(5, "0")}:00+08:00`);
const endT = (t) => { const m = (t || "").match(/(\d{1,2}:\d{2})\s*$/); return m ? m[1] : "23:59"; };
const startT = (t) => { const m = (t || "").match(/^(\d{1,2}:\d{2})/); return m ? m[1] : null; };
const pct = (w) => `${Number.isInteger(w) ? w : w.toFixed(1)}%`;
function weight(p) {
  if (p.item_weight === 0) return "+";
  if (p.item_weight != null) return pct(p.item_weight);
  return p.weight ? `共${pct(p.weight)}` : "";
}
function items(d, now) {
  const out = [];
  for (const c of d.courses) for (const p of c.parts) {
    if (p.optional || p.timeline === false) continue;
    for (const it of p.items) {
      if (it.placeholder || !it.date) continue;
      const cv = it.canvas;
      if (cv && ["submitted", "graded", "pending_review"].includes(cv.status)) continue;
      const exam = p.kind === "exam" || p.kind === "quiz";
      const when = at(it.date, exam ? (startT(it.time) || endT(it.time)) : endT(it.time));
      const end = at(it.date, endT(it.time));
      const overdue = cv && cv.due ? new Date(cv.due) < now : false;
      if (!overdue && end < now) continue;                               // 已经过去（考完 / 截止且无需提交）
      if (overdue && now - new Date(cv.due) > 3 * 864e5) continue;       // 逾期超过 3 天的不再占位置
      out.push({ code: c.code, title: it.title, w: weight(p), when, exam, overdue, time: it.time || "" });
    }
  }
  return out.sort((a, b) => (b.overdue - a.overdue) || (a.when - b.when));
}

// ---------- 文案 ----------
function left(x, now) {
  const ms = x.when - now;
  if (x.overdue) return "逾期";
  if (ms < 36e5) return `${Math.max(1, Math.round(ms / 6e4))} 分钟`;
  if (ms < 48 * 36e5) return `${Math.round(ms / 36e5)} 小时`;             // 两天内按小时，避免「1 天」看着还早
  return `${Math.floor(ms / 864e5)} 天`;
}
function dayText(x) {
  const h = new Date(x.when.getTime() + 8 * 36e5);                      // 按香港时间
  return `${h.getUTCMonth() + 1}/${h.getUTCDate()} 周${WD[h.getUTCDay()]} ${x.exam ? (startT(x.time) || "") : endT(x.time)}`.trim();
}
const hot = (x, now) => x.overdue || x.when - now < 48 * 36e5;

// ---------- 颜色 ----------
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return "#" + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
const courseColor = (code) => { const h = HUES[code] ?? 30; return Color.dynamic(new Color(hsl(h, 48, 40)), new Color(hsl(h, 62, 72))); };
const C = {
  bg: Color.dynamic(new Color("#f3efe6"), new Color("#171614")),
  ink: Color.dynamic(new Color("#1c1a16"), new Color("#eeeae1")),
  ink2: Color.dynamic(new Color("#4a463e"), new Color("#c9c3b6")),
  muted: Color.dynamic(new Color("#8a8478"), new Color("#8e877a")),
  red: Color.dynamic(new Color("#b8321f"), new Color("#ff8a73")),
};
const serif = (n) => new Font("Georgia-Bold", n);          // iOS 自带；中文自动回落到系统字体
const mono = (n) => Font.boldMonospacedSystemFont(n);

function txt(stack, s, font, color, lines = 1) {
  const t = stack.addText(s); t.font = font; t.textColor = color; t.lineLimit = lines; t.minimumScaleFactor = 0.75; return t;
}

// ---------- 桌面：一行 ----------
function row(w, x, now, big) {
  const r = w.addStack(); r.layoutHorizontally(); r.centerAlignContent();
  r.url = `${SITE}#/c/${x.code}`;
  const bar = r.addStack(); bar.size = new Size(3, big ? 30 : 26); bar.cornerRadius = 1.5; bar.backgroundColor = courseColor(x.code);
  r.addSpacer(8);
  const mid = r.addStack(); mid.layoutVertically();
  const top = mid.addStack(); top.layoutHorizontally();
  txt(top, x.code, mono(9.5), courseColor(x.code));
  if (x.w) { top.addSpacer(5); txt(top, x.w, Font.mediumSystemFont(9.5), C.muted); }
  if (x.exam) { top.addSpacer(5); txt(top, "考试", Font.boldSystemFont(9.5), C.muted); }
  txt(mid, x.title, Font.semiboldSystemFont(big ? 13.5 : 13), C.ink);
  r.addSpacer();
  const rt = r.addStack(); rt.layoutVertically();
  const a = rt.addStack(); a.addSpacer(); txt(a, left(x, now), Font.boldSystemFont(13), hot(x, now) ? C.red : C.ink);
  const b = rt.addStack(); b.addSpacer(); txt(b, x.overdue ? "未提交" : dayText(x), Font.systemFont(9.5), C.muted);
}

function header(w, list, now, label) {
  const hd = w.addStack(); hd.layoutHorizontally(); hd.centerAlignContent();
  txt(hd, label, Font.boldSystemFont(11), C.muted);
  hd.addSpacer();
  const n = list.filter((x) => !x.overdue && x.when - now < 72 * 36e5).length;
  txt(hd, n ? `72 小时内 ${n} 项` : "72 小时内没有", Font.boldSystemFont(11), n ? C.red : C.muted);
}

function footer(w, d, offline, now) {
  const s = d.synced ? (now - new Date(d.synced)) / 36e5 : null;
  const t = s == null ? "" : s < 1 ? "同步不到 1 小时" : s < 48 ? `同步 ${Math.floor(s)} 小时前` : `同步 ${Math.floor(s / 24)} 天前`;
  txt(w, [t, offline ? "离线" : ""].filter(Boolean).join(" · "), Font.systemFont(9), s > 36 || offline ? C.red : C.muted);
}

// ---------- 各尺寸 ----------
function small(w, list, now) {
  const x = list[0];
  txt(w, "下一项", Font.boldSystemFont(11), C.muted);
  w.addSpacer(6);
  if (!x) { txt(w, "暂无待办 🎉", serif(18), C.ink); return; }
  txt(w, x.code, mono(11), courseColor(x.code));
  w.addSpacer(2);
  txt(w, x.title, Font.semiboldSystemFont(15), C.ink, 2);
  w.addSpacer();
  txt(w, left(x, now), serif(28), hot(x, now) ? C.red : C.ink);
  txt(w, x.overdue ? "逾期未提交" : dayText(x), Font.systemFont(10.5), C.muted);
  const more = list.filter((y) => y !== x && !y.overdue && y.when - now < 72 * 36e5).length;
  if (more) { w.addSpacer(4); txt(w, `72h 内还有 ${more} 项`, Font.boldSystemFont(10), C.red); }
}

function listed(w, list, now, n, big, d, offline) {
  header(w, list, now, big ? "课程 · 接下来" : "课程 DDL");
  w.addSpacer(big ? 10 : 8);
  if (!list.length) { txt(w, "暂无待办 🎉", serif(18), C.ink); w.addSpacer(); return; }
  list.slice(0, n).forEach((x, i) => { if (i) w.addSpacer(big ? 9 : 7); row(w, x, now, big); });
  w.addSpacer();
  if (big) { const more = list.length - n; if (more > 0) txt(w, `还有 ${more} 项 →`, Font.mediumSystemFont(10), C.muted); footer(w, d, offline, now); }
}

// ---------- 主程序 ----------
const now = new Date();
const { d, offline } = await load();
const fam = config.widgetFamily || (config.runsInWidget ? "medium" : (args.widgetParameter || "large"));
const w = new ListWidget();
w.url = SITE;
w.refreshAfterDate = new Date(Date.now() + 30 * 6e4);

if (!d) {
  txt(w, "连不上 moyunxiang.com", Font.boldSystemFont(13), C.red);
} else {
  const list = items(d, now);
  const x = list[0];
  if (fam === "accessoryInline") {
    w.addText(x ? `${x.code} ${x.title} · ${left(x, now)}` : "暂无待办");
  } else if (fam === "accessoryCircular") {
    const n = list.filter((y) => !y.overdue && y.when - now < 72 * 36e5).length;
    w.addAccessoryWidgetBackground = true;
    const t = w.addText(String(n)); t.font = Font.boldRoundedSystemFont(22); t.centerAlignText();
    const s = w.addText("72h"); s.font = Font.systemFont(9); s.centerAlignText();
  } else if (fam === "accessoryRectangular") {
    if (!x) w.addText("暂无待办");
    else {
      const a = w.addText(`${x.overdue ? "逾期" : "还剩 " + left(x, now)} · ${x.code}`); a.font = Font.boldSystemFont(12);
      const b = w.addText(x.title); b.font = Font.systemFont(13); b.lineLimit = 1;
      const c = w.addText(x.overdue ? "未提交" : dayText(x)); c.font = Font.systemFont(11); c.textOpacity = 0.7;
    }
  } else {
    w.backgroundColor = C.bg;
    w.setPadding(14, 15, 12, 15);
    if (fam === "small") small(w, list, now);
    else if (fam === "large" || fam === "extraLarge") listed(w, list, now, 8, true, d, offline);
    else listed(w, list, now, 3, false, d, offline);
  }
}

if (config.runsInWidget || config.runsInAccessoryWidget) Script.setWidget(w);
else if (fam === "small") await w.presentSmall();
else if (fam === "medium") await w.presentMedium();
else await w.presentLarge();
Script.complete();
