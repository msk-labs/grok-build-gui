const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const DIR = __dirname;
const vids = JSON.parse(fs.readFileSync(path.join(DIR, "videos.json"), "utf8"));

// ---- palette (B 站主题：墨黑 + 哔哩粉 + 哔哩蓝) ----
const INK = "1B1D24";
const INK_SOFT = "2A2E38";
const PINK = "FB7299";
const BLUE = "00AEEC";
const WHITE = "FFFFFF";
const PAPER = "F7F8FA";
const MUTED = "8A8F99";
const TEXT = "23262E";
const F = "Arial";

// ---- 人工归类（与 videos.json 顺序一一对应）----
const CATS = [
  "娱乐鬼畜","科技数码","游戏","美食生活","知识科普","美食生活","游戏","科技数码","社会时政","影视解说",
  "动画二次元","音乐","影视解说","娱乐鬼畜","知识科普","影视解说","音乐","知识科普","娱乐鬼畜","知识科普",
  "社会时政","美食生活","娱乐鬼畜","美食生活","体育","汽车","音乐","体育","娱乐鬼畜","动画二次元",
  "游戏","社会时政","科技数码","社会时政","美食生活","游戏","美食生活","娱乐鬼畜","音乐","美食生活",
  "音乐","美食生活","动画二次元","影视解说","知识科普","美食生活","影视解说","娱乐鬼畜","汽车","娱乐鬼畜",
  "娱乐鬼畜","汽车","动画二次元","美食生活","动画二次元","社会时政","音乐","动画二次元","知识科普","社会时政",
];
vids.forEach((v, i) => (v.cat = CATS[i]));

// ---- helpers ----
const wan = (n) =>
  n >= 100000000
    ? (n / 100000000).toFixed(2) + " 亿"
    : n >= 10000
    ? (n / 10000).toFixed(1) + " 万"
    : String(n);
const mmss = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (v) => String(v).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
};
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const total = vids.reduce((a, v) => a + v.view, 0);
const totalLike = vids.reduce((a, v) => a + v.like, 0);
const ups = new Set(vids.map((v) => v.up)).size;
const sortedDur = vids.map((v) => v.dur).sort((a, b) => a - b);
const medDur = Math.round((sortedDur[29] + sortedDur[30]) / 2);

const byView = [...vids].sort((a, b) => b.view - a.view);
const byLike = [...vids].sort((a, b) => b.like - a.like);

const catCount = {};
vids.forEach((v) => (catCount[v.cat] = (catCount[v.cat] || 0) + 1));
const catRank = Object.entries(catCount).sort((a, b) => b[1] - a[1]);

// 时长分桶
const buckets = [
  ["≤1 分钟", (d) => d <= 60],
  ["1–5 分钟", (d) => d > 60 && d <= 300],
  ["5–10 分钟", (d) => d > 300 && d <= 600],
  ["10–20 分钟", (d) => d > 600 && d <= 1200],
  ["20 分钟以上", (d) => d > 1200],
];
const durData = buckets.map(([label, f]) => [label, vids.filter((v) => f(v.dur)).length]);

// ---- deck ----
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "B 站首页速览";
pres.title = "B 站首页视频标题整理";

const W = 13.3, H = 7.5, M = 0.7;

// 统一的页眉（浅色页）
function head(slide, kicker, title) {
  slide.background = { color: WHITE };
  slide.addShape(pres.ShapeType.ellipse, { x: M, y: 0.52, w: 0.17, h: 0.17, fill: { color: PINK } });
  slide.addText(kicker, {
    x: M + 0.3, y: 0.44, w: 6, h: 0.34, fontFace: F, fontSize: 11.5, bold: true,
    color: PINK, charSpacing: 2, margin: 0, valign: "middle",
  });
  slide.addText(title, {
    x: M, y: 0.85, w: W - M * 2, h: 0.72, fontFace: F, fontSize: 34, bold: true,
    color: TEXT, margin: 0, valign: "middle",
  });
}
function foot(slide, n) {
  slide.addText("bilibili 首页推荐 · 2026-08-04 采集", {
    x: M, y: H - 0.55, w: 7, h: 0.3, fontFace: F, fontSize: 9, color: MUTED, margin: 0,
  });
  slide.addText(String(n), {
    x: W - M - 0.6, y: H - 0.55, w: 0.6, h: 0.3, fontFace: F, fontSize: 9,
    color: MUTED, align: "right", margin: 0,
  });
}
const card = (slide, x, y, w, h, fill) =>
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.08, fill: { color: fill || PAPER },
    line: { color: "E7E9EE", width: 0.75 },
  });
// 视觉母题：粉色圆形序号
function badge(slide, x, y, d, label, fill, txtColor) {
  slide.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: fill || PINK } });
  slide.addText(label, {
    x, y, w: d, h: d, fontFace: F, fontSize: d > 0.5 ? 13 : 10.5, bold: true,
    color: txtColor || WHITE, align: "center", valign: "middle", margin: 0,
  });
}

// ===== 1. 封面 =====
{
  const s = pres.addSlide();
  s.background = { color: INK };
  s.addShape(pres.ShapeType.ellipse, { x: 9.6, y: -1.5, w: 5.6, h: 5.6, fill: { color: PINK, transparency: 82 } });
  s.addShape(pres.ShapeType.ellipse, { x: 11.1, y: 3.6, w: 3.4, h: 3.4, fill: { color: BLUE, transparency: 85 } });
  s.addShape(pres.ShapeType.ellipse, { x: M, y: 1.5, w: 0.22, h: 0.22, fill: { color: PINK } });
  s.addText("BILIBILI · HOMEPAGE FEED", {
    x: M + 0.38, y: 1.42, w: 7, h: 0.36, fontFace: F, fontSize: 12, bold: true,
    color: PINK, charSpacing: 3, margin: 0, valign: "middle",
  });
  s.addText("B 站首页视频标题整理", {
    x: M, y: 2.05, w: 9.2, h: 1.15, fontFace: F, fontSize: 52, bold: true, color: WHITE, margin: 0,
  });
  s.addText("60 条首页推荐视频 · 标题 / UP 主 / 播放 / 时长 全量归档", {
    x: M, y: 3.25, w: 9, h: 0.45, fontFace: F, fontSize: 16, color: "C9CDD6", margin: 0,
  });
  const facts = [
    ["60", "条视频"],
    [wan(total), "总播放"],
    [String(ups), "位 UP 主"],
    [String(catRank.length), "个内容方向"],
  ];
  facts.forEach(([big, small], i) => {
    const x = M + i * 2.45;
    s.addText(big, { x, y: 4.35, w: 2.2, h: 0.62, fontFace: F, fontSize: 30, bold: true, color: PINK, margin: 0 });
    s.addText(small, { x, y: 4.98, w: 2.2, h: 0.3, fontFace: F, fontSize: 11.5, color: "9AA0AC", margin: 0 });
  });
  s.addText("采集时间 2026-08-04 · 数据来自 bilibili 首页推荐流", {
    x: M, y: 6.55, w: 9, h: 0.32, fontFace: F, fontSize: 10.5, color: "7A808C", margin: 0,
  });
  s.addNotes("本页为封面。数据于 2026-08-04 从 bilibili 首页推荐流采集，共 60 条视频。");
}

// ===== 2. 数据概览 =====
{
  const s = pres.addSlide();
  head(s, "OVERVIEW", "首页这 60 条视频，长什么样");
  const tiles = [
    [wan(total), "总播放量", PINK],
    [wan(Math.round(total / 60)), "单条平均播放", BLUE],
    [wan(totalLike), "总点赞数", PINK],
    [mmss(medDur), "时长中位数", BLUE],
  ];
  tiles.forEach(([big, small, c], i) => {
    const x = M + i * 3.06, y = 1.85, w = 2.82;
    card(s, x, y, w, 1.5);
    s.addText(big, { x: x + 0.25, y: y + 0.2, w: w - 0.5, h: 0.62, fontFace: F, fontSize: 30, bold: true, color: c, margin: 0, valign: "middle" });
    s.addText(small, { x: x + 0.25, y: y + 0.85, w: w - 0.5, h: 0.35, fontFace: F, fontSize: 12, color: MUTED, margin: 0 });
  });

  s.addText("时长分布", { x: M, y: 3.7, w: 5, h: 0.4, fontFace: F, fontSize: 20, bold: true, color: TEXT, margin: 0 });
  s.addChart(
    pres.ChartType.bar,
    [{ name: "视频数", labels: durData.map((d) => d[0]), values: durData.map((d) => d[1]) }],
    {
      x: M - 0.1, y: 4.15, w: 6.6, h: 2.6,
      barDir: "bar", barGapWidthPct: 55, chartColors: [PINK],
      showValue: true, dataLabelPosition: "outEnd", dataLabelColor: TEXT,
      dataLabelFontFace: F, dataLabelFontSize: 11,
      catAxisLabelColor: TEXT, catAxisLabelFontFace: F, catAxisLabelFontSize: 11,
      valAxisLabelColor: MUTED, valAxisLabelFontFace: F, valAxisLabelFontSize: 9,
      valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" },
      showLegend: false,
    }
  );

  const notes = [
    ["短视频占了小半壁", `${durData[0][1] + durData[1][1]} 条在 5 分钟以内，首页推荐明显偏爱能一口气看完的内容。`],
    ["中视频仍是主力", `5–20 分钟共 ${durData[2][1] + durData[3][1]} 条，是解说、测评、Vlog 的主要长度区间。`],
    ["长视频靠内容硬撑", `${durData[4][1]} 条超过 20 分钟，多为影视解说与深度科普。`],
  ];
  card(s, 7.55, 3.7, W - M - 7.55, 3.05, PAPER);
  notes.forEach(([t, d], i) => {
    const y = 3.95 + i * 0.95;
    badge(s, 7.85, y + 0.05, 0.34, String(i + 1), i % 2 ? BLUE : PINK);
    s.addText(t, { x: 8.35, y, w: 4.1, h: 0.32, fontFace: F, fontSize: 13, bold: true, color: TEXT, margin: 0, valign: "middle" });
    s.addText(d, { x: 8.35, y: y + 0.32, w: 4.15, h: 0.55, fontFace: F, fontSize: 10.5, color: MUTED, margin: 0 });
  });
  foot(s, 2);
  s.addNotes("总播放、平均播放、点赞与平均时长四项汇总，右侧为时长分布的解读。");
}

// ===== 3. 播放量 TOP 10 =====
{
  const s = pres.addSlide();
  head(s, "TOP 10 BY VIEWS", "播放量最高的 10 条");
  const top = byView.slice(0, 10);
  s.addChart(
    pres.ChartType.bar,
    [{ name: "播放量（万）", labels: top.map((v) => cut(v.title, 13)), values: top.map((v) => +(v.view / 10000).toFixed(1)) }],
    {
      x: M - 0.15, y: 1.8, w: 7.9, h: 4.9,
      barDir: "bar", barGapWidthPct: 45, chartColors: [PINK],
      showValue: true, dataLabelPosition: "outEnd", dataLabelColor: TEXT,
      dataLabelFontFace: F, dataLabelFontSize: 10,
      catAxisLabelColor: TEXT, catAxisLabelFontFace: F, catAxisLabelFontSize: 10,
      valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" },
      showLegend: false,
    }
  );
  const champ = top[0];
  card(s, 8.7, 1.8, W - M - 8.7, 2.5, INK);
  s.addText("播放冠军", { x: 9.0, y: 2.0, w: 3.4, h: 0.3, fontFace: F, fontSize: 11, bold: true, color: PINK, charSpacing: 2, margin: 0 });
  s.addText(champ.title, { x: 9.0, y: 2.35, w: 3.35, h: 1.1, fontFace: F, fontSize: 14, bold: true, color: WHITE, margin: 0, valign: "top" });
  s.addText(`${champ.up}   ·   ${wan(champ.view)} 播放   ·   ${mmss(champ.dur)}`, {
    x: 9.0, y: 3.55, w: 3.35, h: 0.4, fontFace: F, fontSize: 10.5, color: "9AA0AC", margin: 0,
  });

  card(s, 8.7, 4.5, W - M - 8.7, 2.2, PAPER);
  s.addText("读数", { x: 9.0, y: 4.68, w: 3.3, h: 0.32, fontFace: F, fontSize: 13, bold: true, color: TEXT, margin: 0 });
  s.addText(
    [
      { text: `前 10 条合计 ${wan(top.reduce((a, v) => a + v.view, 0))} 播放，占全部的 ${Math.round((top.reduce((a, v) => a + v.view, 0) / total) * 100)}%。`, options: { bullet: true, breakLine: true } },
      { text: "头部集中度很高，长尾内容播放量差着一个数量级。", options: { bullet: true, breakLine: true } },
      { text: "上榜的多是赶海、生存、鬼畜这类强钩子选题。", options: { bullet: true } },
    ],
    { x: 9.0, y: 5.05, w: 3.35, h: 1.5, fontFace: F, fontSize: 10.5, color: "555B66", paraSpaceAfter: 6, margin: 0 }
  );
  foot(s, 3);
  s.addNotes("按播放量排序的前 10 条，标题在图表中做了截断，完整标题见后面的清单页。");
}

// ===== 4. 内容类型分布 =====
{
  const s = pres.addSlide();
  head(s, "CATEGORIES", "内容方向分布");
  const colors = [PINK, BLUE, "FFB03A", "6C5CE7", "00C48C", "FF7A45", "5B8FF9", "F759AB", "9254DE", "36CFC9", "FF9C6E"];
  s.addChart(
    pres.ChartType.doughnut,
    [{ name: "内容方向", labels: catRank.map((c) => c[0]), values: catRank.map((c) => c[1]) }],
    {
      x: 0.55, y: 1.72, w: 6.3, h: 4.95, holeSize: 56, chartColors: colors,
      showLegend: false,
      showValue: false, showPercent: true, dataLabelColor: WHITE, dataLabelFontFace: F,
      dataLabelFontSize: 9, dataLabelPosition: "ctr",
    }
  );
  s.addText("按数量排序", { x: 7.3, y: 1.75, w: 5, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: MUTED, margin: 0 });
  catRank.forEach((c, i) => {
    const col = i < 6 ? 0 : 1;
    const row = i % 6;
    const x = 7.3 + col * 2.75;
    const y = 2.2 + row * 0.72;
    s.addShape(pres.ShapeType.ellipse, { x, y: y + 0.08, w: 0.2, h: 0.2, fill: { color: colors[i % colors.length] } });
    s.addText(c[0], { x: x + 0.32, y, w: 1.55, h: 0.36, fontFace: F, fontSize: 12.5, bold: true, color: TEXT, margin: 0, valign: "middle" });
    s.addText(`${c[1]} 条`, { x: x + 0.32, y: y + 0.32, w: 1.6, h: 0.28, fontFace: F, fontSize: 9.5, color: MUTED, margin: 0 });
  });
  foot(s, 4);
  s.addNotes("按人工归类统计的内容方向分布，共 " + catRank.length + " 类。");
}

// ===== 5. 高热标题精选 =====
{
  const s = pres.addSlide();
  head(s, "MOST LIKED", "点赞最高的 6 条标题");
  const top = byLike.slice(0, 6);
  top.forEach((v, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * 6.15, y = 1.8 + row * 1.68, w = 5.85;
    card(s, x, y, w, 1.45);
    badge(s, x + 0.28, y + 0.3, 0.52, String(i + 1), i % 2 ? BLUE : PINK);
    s.addText(v.title, {
      x: x + 0.98, y: y + 0.22, w: w - 1.28, h: 0.66, fontFace: F, fontSize: 13.5,
      bold: true, color: TEXT, margin: 0, valign: "top",
    });
    s.addText(`${v.up}  ·  ${wan(v.like)} 赞  ·  ${wan(v.view)} 播放  ·  ${mmss(v.dur)}  ·  ${v.cat}`, {
      x: x + 0.98, y: y + 0.94, w: w - 1.28, h: 0.32, fontFace: F, fontSize: 10, color: MUTED, margin: 0,
    });
  });
  foot(s, 5);
  s.addNotes("以点赞量排序的前 6 条，代表首页中口碑最强的内容。");
}

// ===== 6–10. 完整标题清单 =====
const PER = 12;
const pages = Math.ceil(vids.length / PER);
const listOrder = byView; // 按播放量排序展示
for (let p = 0; p < pages; p++) {
  const s = pres.addSlide();
  head(s, `TITLE LIST ${p + 1} / ${pages}`, `完整标题清单 · 第 ${p + 1} 组`);
  const items = listOrder.slice(p * PER, (p + 1) * PER);
  items.forEach((v, i) => {
    const idx = p * PER + i + 1;
    const col = Math.floor(i / 6), row = i % 6;
    const x = M + col * 6.15, y = 1.72 + row * 0.87;
    badge(s, x, y + 0.06, 0.36, String(idx), row % 2 ? BLUE : PINK);
    s.addText(v.title, {
      x: x + 0.5, y, w: 5.35, h: 0.5, fontFace: F, fontSize: 11,
      bold: true, color: TEXT, margin: 0, valign: "top",
    });
    s.addText(`${v.up}  ·  ${wan(v.view)} 播放  ·  ${mmss(v.dur)}  ·  ${v.cat}`, {
      x: x + 0.5, y: y + 0.5, w: 5.35, h: 0.28, fontFace: F, fontSize: 9, color: MUTED, margin: 0,
    });
  });
  foot(s, 6 + p);
  s.addNotes(`标题清单第 ${p + 1} 组，按播放量降序，序号 ${p * PER + 1}–${Math.min((p + 1) * PER, vids.length)}。`);
}

// ===== 11. 观察小结 =====
{
  const s = pres.addSlide();
  head(s, "TAKEAWAYS", "从这批标题里看到的四件事");
  const items = [
    ["标题几乎都在设问或制造反差", "“到底有多离谱？”“究竟是谁？”——疑问句和夸张对比是首页标题最通用的开场方式。"],
    ["数字是最硬的钩子", "10000 个入侵物种、365 天马拉松、132 个彩蛋，具体数字比形容词更容易让人点进去。"],
    [`${catRank[0][0]}与${catRank[1][0]}撑起了推荐流`, `两类合计 ${catRank[0][1] + catRank[1][1]} 条，接近总量的三分之一，是首页最稳的基本盘。`],
    ["长内容并不吃亏", "超过 20 分钟的解说与科普照样进首页，前提是选题足够具体、足够垂直。"],
  ];
  items.forEach(([t, d], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * 6.15, y = 1.85 + row * 2.35, w = 5.85;
    card(s, x, y, w, 2.05);
    badge(s, x + 0.35, y + 0.35, 0.56, String(i + 1), i % 2 ? BLUE : PINK);
    s.addText(t, { x: x + 1.08, y: y + 0.3, w: w - 1.45, h: 0.62, fontFace: F, fontSize: 15, bold: true, color: TEXT, margin: 0, valign: "middle" });
    s.addText(d, { x: x + 1.08, y: y + 0.98, w: w - 1.45, h: 0.9, fontFace: F, fontSize: 11.5, color: "555B66", margin: 0, valign: "top" });
  });
  foot(s, 6 + pages);
  s.addNotes("四条基于标题文本与数据的观察结论。");
}

// ===== 12. 结尾 =====
{
  const s = pres.addSlide();
  s.background = { color: INK };
  s.addShape(pres.ShapeType.ellipse, { x: -1.8, y: 3.6, w: 5.2, h: 5.2, fill: { color: BLUE, transparency: 86 } });
  s.addShape(pres.ShapeType.ellipse, { x: 10.4, y: -1.2, w: 4.6, h: 4.6, fill: { color: PINK, transparency: 82 } });
  s.addText("以上就是这一屏首页", {
    x: M, y: 2.5, w: 9, h: 1.0, fontFace: F, fontSize: 44, bold: true, color: WHITE, margin: 0,
  });
  s.addText("60 条标题、" + ups + " 位 UP 主、" + wan(total) + " 次播放", {
    x: M, y: 3.55, w: 9, h: 0.45, fontFace: F, fontSize: 16, color: "C9CDD6", margin: 0,
  });
  s.addShape(pres.ShapeType.ellipse, { x: M, y: 4.35, w: 0.18, h: 0.18, fill: { color: PINK } });
  s.addText("数据采集自 bilibili 首页推荐流 · 2026-08-04", {
    x: M + 0.34, y: 4.26, w: 9, h: 0.36, fontFace: F, fontSize: 11.5, color: "7A808C", margin: 0, valign: "middle",
  });
  s.addNotes("结尾页。");
}

pres.writeFile({ fileName: path.join(DIR, "bilibili_首页视频标题整理.pptx") }).then((f) => {
  console.log("written:", f);
  console.log("slides:", 5 + pages + 2);
});
