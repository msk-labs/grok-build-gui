const fs = require("fs");
const path = require("path");
const {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, LevelFormat, Packer,
  PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} = require("docx");

const DIR = __dirname;
const vids = JSON.parse(fs.readFileSync(path.join(DIR, "videos.json"), "utf8"));

const CATS = [
  "娱乐鬼畜","科技数码","游戏","美食生活","知识科普","美食生活","游戏","科技数码","社会时政","影视解说",
  "动画二次元","音乐","影视解说","娱乐鬼畜","知识科普","影视解说","音乐","知识科普","娱乐鬼畜","知识科普",
  "社会时政","美食生活","娱乐鬼畜","美食生活","体育","汽车","音乐","体育","娱乐鬼畜","动画二次元",
  "游戏","社会时政","科技数码","社会时政","美食生活","游戏","美食生活","娱乐鬼畜","音乐","美食生活",
  "音乐","美食生活","动画二次元","影视解说","知识科普","美食生活","影视解说","娱乐鬼畜","汽车","娱乐鬼畜",
  "娱乐鬼畜","汽车","动画二次元","美食生活","动画二次元","社会时政","音乐","动画二次元","知识科普","社会时政",
];
vids.forEach((v, i) => (v.cat = CATS[i]));
vids.sort((a, b) => b.view - a.view);

// ---- helpers ----
const wan = (n) =>
  n >= 1e8 ? (n / 1e8).toFixed(2) + " 亿" : n >= 1e4 ? (n / 1e4).toFixed(1) + " 万" : String(n);
const mmss = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (v) => String(v).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
};
const pct = (a, b) => ((a / b) * 100).toFixed(1) + "%";

const views = vids.map((v) => v.view);
const total = views.reduce((a, b) => a + b, 0);
const totalLike = vids.reduce((a, v) => a + v.like, 0);
const totalDm = vids.reduce((a, v) => a + v.danmaku, 0);
const ups = new Set(vids.map((v) => v.up)).size;
const sortedDur = vids.map((v) => v.dur).sort((a, b) => a - b);
const medDur = (sortedDur[29] + sortedDur[30]) / 2;
const sortedView = [...views].sort((a, b) => a - b);
const medView = (sortedView[29] + sortedView[30]) / 2;

const catCount = {};
vids.forEach((v) => (catCount[v.cat] = (catCount[v.cat] || 0) + 1));
const catRank = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
const catStat = catRank.map(([c, n]) => {
  const g = vids.filter((v) => v.cat === c);
  const gv = g.reduce((a, v) => a + v.view, 0);
  const gl = g.reduce((a, v) => a + v.like, 0);
  return { c, n, gv, avg: Math.round(gv / n), rate: (gl / gv) * 100 };
});

const INK = "1B1D24";
const PINK = "FB7299";
const GREY = "6B7280";
const HEAD_BG = "1B1D24";
const ZEBRA = "F5F6F8";
const CONTENT_W = 9638;

// ---- text builders ----
const run = (text, o = {}) => new TextRun({ text, font: "Arial", ...o });
const p = (text, o = {}) =>
  new Paragraph({
    spacing: { after: o.after === undefined ? 120 : o.after, line: 300 },
    alignment: o.alignment,
    children: [run(text, { size: o.size || 21, color: o.color || INK, bold: o.bold, italics: o.italics })],
  });
const h1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [run(text, { size: 30, bold: true, color: INK })],
  });
const h2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 130 },
    children: [run(text, { size: 24, bold: true, color: INK })],
  });

const cell = (text, w, o = {}) =>
  new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    verticalAlign: "center",
    children: [
      new Paragraph({
        alignment: o.align,
        spacing: { after: 0, line: 260 },
        children: [run(text, { size: o.size || 18, bold: o.bold, color: o.color || INK })],
      }),
    ],
  });

const headRow = (labels, widths, aligns) =>
  new TableRow({
    tableHeader: true,
    children: labels.map((l, i) =>
      cell(l, widths[i], { fill: HEAD_BG, bold: true, color: "FFFFFF", size: 18, align: aligns && aligns[i] })
    ),
  });

const table = (widths, rows) =>
  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: "D8DBE2" },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: "D8DBE2" },
      left: { style: BorderStyle.SINGLE, size: 2, color: "D8DBE2" },
      right: { style: BorderStyle.SINGLE, size: 2, color: "D8DBE2" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "E7E9EE" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "E7E9EE" },
    },
    rows,
  });

const bullets = (items) =>
  items.map((t) =>
    new Paragraph({
      numbering: { reference: "dot", level: 0 },
      spacing: { after: 90, line: 300 },
      children: [run(t, { size: 21, color: INK })],
    })
  );

// ---- document body ----
const body = [];

body.push(
  new Paragraph({
    spacing: { after: 60 },
    children: [run("BILIBILI · 首页推荐流", { size: 18, bold: true, color: PINK, characterSpacing: 40 })],
  }),
  new Paragraph({
    spacing: { after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: INK, space: 8 } },
    children: [run("B 站首页视频标题整理报告", { size: 44, bold: true, color: INK })],
  }),
  p("采集时间 2026-08-04（北京时间）　·　样本 60 条　·　数据来源：bilibili 首页推荐流", {
    size: 19, color: GREY, after: 260,
  })
);

body.push(h1("一、摘要"));
body.push(
  p(
    `本次从 B 站首页推荐流采集到 60 条去重视频，来自 ${ups} 位 UP 主，合计 ${wan(total)}次播放、${wan(totalLike)}点赞、${wan(totalDm)}条弹幕。` +
      `单条播放量中位数 ${wan(medView)}，与均值 ${wan(Math.round(total / 60))}相差近一倍，说明推荐流里少数爆款拉走了大部分流量。` +
      `按标题人工归类后共 ${catRank.length} 个内容方向，其中${catRank[0][0]}（${catRank[0][1]} 条）与${catRank[1][0]}（${catRank[1][1]} 条）合计占到 ${pct(catRank[0][1] + catRank[1][1], 60)}，是这一屏首页最主要的两类内容。`
  )
);

body.push(h1("二、采集方法与口径"));
body.push(
  ...bullets([
    "采集方式：打开 B 站首页后，页面本身只渲染了 10 条卡片，其余为懒加载骨架屏，反复滚动仍未填充，因此改为直接读取首页自身使用的推荐接口返回结果。",
    "样本范围：连续取两批推荐结果并按 BV 号去重，最终得到 60 条视频。",
    "字段口径：播放量、点赞数、弹幕数、时长均为接口返回的采集时刻快照值，会随时间变化。",
    "内容方向：按视频标题人工归类，共 11 类，非 B 站官方分区，仅用于本报告的结构化分析。",
    "重要限制：首页推荐结果因人因时而异，本报告只代表 2026-08-04 这一次采集的结果，不能推广为 B 站整体内容分布。",
  ])
);

body.push(h1("三、数据概览"));
{
  const w = [2600, 2200, 4838];
  const rows = [headRow(["指标", "数值", "说明"], w, [undefined, "right", undefined])];
  const items = [
    ["视频总数", "60 条", "去重后的推荐视频数量"],
    ["UP 主数量", `${ups} 位`, "有 UP 主在同一屏内出现了两条视频"],
    ["内容方向", `${catRank.length} 类`, "按标题人工归类"],
    ["总播放量", wan(total), "60 条视频的播放量之和"],
    ["单条平均播放量", wan(Math.round(total / 60)), "受头部爆款影响明显偏高"],
    ["播放量中位数", wan(medView), "更能代表一条“普通”推荐视频的水平"],
    ["最高 / 最低播放量", `${wan(Math.max(...views))} / ${wan(Math.min(...views))}`, "头尾相差约 130 倍"],
    ["总点赞数", wan(totalLike), `整体点赞率 ${((totalLike / total) * 100).toFixed(2)}%`],
    ["总弹幕数", wan(totalDm), "弹幕高度集中在演唱会直拍等少数视频"],
    ["时长中位数", mmss(medDur), "样本含一条 17 小时的解说，故不用平均值"],
    ["5 分钟以内", `${vids.filter((v) => v.dur <= 300).length} 条`, `占 ${pct(vids.filter((v) => v.dur <= 300).length, 60)}`],
    ["20 分钟以上", `${vids.filter((v) => v.dur > 1200).length} 条`, `占 ${pct(vids.filter((v) => v.dur > 1200).length, 60)}`],
  ];
  items.forEach(([a, b, c], i) =>
    rows.push(
      new TableRow({
        children: [
          cell(a, w[0], { fill: i % 2 ? ZEBRA : undefined, bold: true }),
          cell(b, w[1], { fill: i % 2 ? ZEBRA : undefined, align: AlignmentType.RIGHT }),
          cell(c, w[2], { fill: i % 2 ? ZEBRA : undefined, color: GREY }),
        ],
      })
    )
  );
  body.push(table(w, rows));
}

body.push(h1("四、内容方向分布"));
body.push(p("按标题人工归类后的 11 个方向，按视频数降序排列。", { color: GREY, size: 19 }));
{
  const w = [1700, 1000, 1000, 1938, 2000, 2000];
  const aligns = [undefined, "right", "right", "right", "right", "right"];
  const rows = [headRow(["内容方向", "视频数", "占比", "总播放量", "平均播放量", "点赞率"], w, aligns)];
  catStat.forEach((s, i) =>
    rows.push(
      new TableRow({
        children: [
          cell(s.c, w[0], { fill: i % 2 ? ZEBRA : undefined, bold: true }),
          cell(String(s.n), w[1], { fill: i % 2 ? ZEBRA : undefined, align: AlignmentType.RIGHT }),
          cell(pct(s.n, 60), w[2], { fill: i % 2 ? ZEBRA : undefined, align: AlignmentType.RIGHT }),
          cell(wan(s.gv), w[3], { fill: i % 2 ? ZEBRA : undefined, align: AlignmentType.RIGHT }),
          cell(wan(s.avg), w[4], { fill: i % 2 ? ZEBRA : undefined, align: AlignmentType.RIGHT }),
          cell(s.rate.toFixed(2) + "%", w[5], { fill: i % 2 ? ZEBRA : undefined, align: AlignmentType.RIGHT }),
        ],
      })
    )
  );
  rows.push(
    new TableRow({
      children: [
        cell("合计", w[0], { fill: "EDEFF3", bold: true }),
        cell("60", w[1], { fill: "EDEFF3", bold: true, align: AlignmentType.RIGHT }),
        cell("100.0%", w[2], { fill: "EDEFF3", bold: true, align: AlignmentType.RIGHT }),
        cell(wan(total), w[3], { fill: "EDEFF3", bold: true, align: AlignmentType.RIGHT }),
        cell(wan(Math.round(total / 60)), w[4], { fill: "EDEFF3", bold: true, align: AlignmentType.RIGHT }),
        cell(((totalLike / total) * 100).toFixed(2) + "%", w[5], { fill: "EDEFF3", bold: true, align: AlignmentType.RIGHT }),
      ],
    })
  );
  body.push(table(w, rows));
  body.push(
    p(
      `视频数最多的是${catStat[0].c}，但平均播放量最高的是${[...catStat].sort((a, b) => b.avg - a.avg)[0].c}（${wan([...catStat].sort((a, b) => b.avg - a.avg)[0].avg)}）——数量多不等于单条更能跑。`,
      { size: 19, color: GREY }
    )
  );
}

body.push(h1("五、播放量 TOP 10"));
{
  const w = [700, 4238, 1900, 1300, 1500];
  const rows = [headRow(["排名", "标题", "UP 主", "播放量", "时长 / 方向"], w, ["center", undefined, undefined, "right", "right"])];
  vids.slice(0, 10).forEach((v, i) =>
    rows.push(
      new TableRow({
        children: [
          cell(String(i + 1), w[0], { fill: i % 2 ? ZEBRA : undefined, bold: true, align: AlignmentType.CENTER, color: PINK }),
          cell(v.title, w[1], { fill: i % 2 ? ZEBRA : undefined }),
          cell(v.up, w[2], { fill: i % 2 ? ZEBRA : undefined, color: GREY }),
          cell(wan(v.view), w[3], { fill: i % 2 ? ZEBRA : undefined, align: AlignmentType.RIGHT, bold: true }),
          cell(`${mmss(v.dur)} · ${v.cat}`, w[4], { fill: i % 2 ? ZEBRA : undefined, align: AlignmentType.RIGHT, color: GREY }),
        ],
      })
    )
  );
  body.push(table(w, rows));
  const t10 = vids.slice(0, 10).reduce((a, v) => a + v.view, 0);
  body.push(p(`前 10 条合计 ${wan(t10)}播放，占全部 60 条的 ${pct(t10, total)}。`, { size: 19, color: GREY }));
}

body.push(h1("六、完整标题清单（60 条）"));
body.push(p("按播放量降序排列。", { color: GREY, size: 19 }));
{
  const w = [700, 3938, 1700, 1200, 900, 1200];
  const rows = [headRow(["序号", "标题", "UP 主", "播放量", "时长", "内容方向"], w, ["center", undefined, undefined, "right", "right", undefined])];
  vids.forEach((v, i) =>
    rows.push(
      new TableRow({
        children: [
          cell(String(i + 1), w[0], { fill: i % 2 ? ZEBRA : undefined, align: AlignmentType.CENTER, color: GREY }),
          cell(v.title, w[1], { fill: i % 2 ? ZEBRA : undefined }),
          cell(v.up, w[2], { fill: i % 2 ? ZEBRA : undefined, color: GREY }),
          cell(wan(v.view), w[3], { fill: i % 2 ? ZEBRA : undefined, align: AlignmentType.RIGHT }),
          cell(mmss(v.dur), w[4], { fill: i % 2 ? ZEBRA : undefined, align: AlignmentType.RIGHT, color: GREY }),
          cell(v.cat, w[5], { fill: i % 2 ? ZEBRA : undefined, color: GREY }),
        ],
      })
    )
  );
  body.push(table(w, rows));
}

body.push(h1("七、标题写法观察"));
body.push(h2("1. 疑问句与反差是最通用的开场"));
body.push(
  p(
    "“到底有多离谱？”“究竟是谁？”“真的还是莲花吗？”——60 条里有相当一部分标题以问句结尾，把结论留在视频里。另一类是制造反差：“华强买瓜，但摄影师是新手”“请不要乱剪动物世界之河狸”，用一个“但”字或反常搭配制造预期落差。"
  )
);
body.push(h2("2. 具体数字比形容词更有效"));
body.push(
  p(
    "10000 个入侵物种、365 天连续马拉松、132 个彩蛋、全球 17 款可乐、30 支枪 + 1 万发弹药——数字给出了可量化的信息密度，比“超好看”“太震撼”这类形容词更能让人预期到内容体量。"
  )
);
body.push(h2("3. 长内容并不吃亏"));
body.push(
  p(
    `样本里有 ${vids.filter((v) => v.dur > 1200).length} 条超过 20 分钟，最长的一条是 17 小时的《汉尼拔》全三季解说，依然进了首页推荐。前提是选题足够具体、足够垂直——泛泛的长视频很难拿到这个位置。`
  )
);
body.push(h2("4. 头部集中度很高"));
body.push(
  p(
    `播放量最高与最低之间相差约 ${Math.round(Math.max(...views) / Math.min(...views))} 倍，前 10 条就占了总播放的 ${pct(vids.slice(0, 10).reduce((a, v) => a + v.view, 0), total)}。首页推荐并不是均匀分发，而是把大部分曝光压在少数几条上。`
  )
);

body.push(h1("八、附录：字段说明"));
{
  const w = [2200, 7438];
  const rows = [headRow(["字段", "含义"], w)];
  [
    ["标题", "视频标题原文，未做改写；个别标题中的表情符号已去除以保证排版一致"],
    ["UP 主", "视频作者昵称"],
    ["播放量 / 点赞数 / 弹幕数", "接口返回的采集时刻累计值"],
    ["时长", "视频总时长，格式为 分:秒 或 时:分:秒"],
    ["内容方向", "按标题人工归类，共 11 类，非 B 站官方分区"],
    ["BV 号 / 链接", "视频唯一标识与网页地址，见配套 Excel 文件"],
  ].forEach(([a, b], i) =>
    rows.push(
      new TableRow({
        children: [
          cell(a, w[0], { fill: i % 2 ? ZEBRA : undefined, bold: true }),
          cell(b, w[1], { fill: i % 2 ? ZEBRA : undefined, color: GREY }),
        ],
      })
    )
  );
  body.push(table(w, rows));
}
body.push(
  p("配套文件：bilibili_首页视频清单.xlsx（含 60 条全字段明细与分类统计）、bilibili_首页视频标题整理.pptx（12 页汇报版）。", {
    size: 19, color: GREY,
  })
);

// ---- assemble ----
const doc = new Document({
  creator: "B 站首页视频整理",
  title: "B 站首页视频标题整理报告",
  styles: {
    default: {
      document: { run: { font: "Arial", size: 21, color: INK } },
    },
  },
  numbering: {
    config: [
      {
        reference: "dot",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 420, hanging: 260 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: { margin: { top: 1440, bottom: 1440, left: 1134, right: 1134 } },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                run("bilibili 首页推荐 · 2026-08-04 采集　|　", { size: 16, color: GREY }),
                new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: GREY }),
                run(" / ", { size: 16, color: GREY }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Arial", size: 16, color: GREY }),
              ],
            }),
          ],
        }),
      },
      children: body,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(DIR, "bilibili_首页视频整理报告.docx");
  fs.writeFileSync(out, buf);
  console.log("written:", out, (buf.length / 1024).toFixed(0) + " KB");
});
