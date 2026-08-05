"""Render word/document.xml to an HTML approximation for visual QA + a plain text dump."""
import html
import sys
import zipfile

from defusedxml import minidom

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
DXA = 1440.0  # per inch
PX = 96.0


def kids(node, name):
    return [n for n in node.childNodes if n.nodeType == 1 and n.localName == name and n.namespaceURI == W]


def kid(node, name):
    k = kids(node, name)
    return k[0] if k else None


def val(node, name, attr="val"):
    n = kid(node, name)
    return n.getAttribute("w:" + attr) or n.getAttribute(attr) if n is not None else None


def run_html(r):
    r_pr = kid(r, "rPr")
    css = []
    text = "".join(t.firstChild.nodeValue for t in kids(r, "t") if t.firstChild)
    if kids(r, "br"):
        text += ""
    if r_pr is not None:
        if kid(r_pr, "b") is not None:
            css.append("font-weight:700")
        if kid(r_pr, "i") is not None:
            css.append("font-style:italic")
        sz = val(r_pr, "sz")
        if sz:
            css.append("font-size:%.1fpt" % (int(sz) / 2.0))
        col = val(r_pr, "color")
        if col and col != "auto":
            css.append("color:#%s" % col)
        spc = val(r_pr, "spacing")
        if spc:
            css.append("letter-spacing:%.2fpt" % (int(spc) / 20.0))
    if not text:
        return ""
    return '<span style="%s">%s</span>' % (";".join(css), html.escape(text))


def para_html(p, in_cell=False):
    p_pr = kid(p, "pPr")
    css = ["margin:0"]
    if p_pr is not None:
        jc = val(p_pr, "jc")
        if jc:
            css.append("text-align:%s" % {"center": "center", "right": "right", "both": "justify"}.get(jc, "left"))
        sp = kid(p_pr, "spacing")
        if sp is not None:
            for a, prop in (("after", "margin-bottom"), ("before", "margin-top")):
                v = sp.getAttribute("w:" + a)
                if v:
                    css.append("%s:%.1fpx" % (prop, int(v) / 20.0 * (PX / 72.0)))
            line = sp.getAttribute("w:line")
            if line:
                css.append("line-height:%.2f" % (int(line) / 240.0))
        bdr = kid(p_pr, "pBdr")
        if bdr is not None and kid(bdr, "bottom") is not None:
            b = kid(bdr, "bottom")
            css.append("border-bottom:%.1fpx solid #%s;padding-bottom:6px"
                       % (max(int(b.getAttribute("w:sz") or 4) / 8.0, 1), b.getAttribute("w:color") or "000"))
        if kid(p_pr, "numPr") is not None:
            css.append("margin-left:28px;list-style:disc;display:list-item")
        ind = kid(p_pr, "ind")
        if ind is not None and ind.getAttribute("w:left"):
            css.append("padding-left:%.1fpx" % (int(ind.getAttribute("w:left")) / DXA * PX))
    inner = "".join(run_html(r) for r in kids(p, "r"))
    if not inner:
        inner = "&nbsp;" if not in_cell else ""
    return '<p style="%s">%s</p>' % (";".join(css), inner)


def tbl_html(tbl, rows=None):
    grid = kid(tbl, "tblGrid")
    widths = [int(g.getAttribute("w:w")) for g in kids(grid, "gridCol")] if grid is not None else []
    total = sum(widths)
    out = ['<table style="width:%.1fpx;border-collapse:collapse;margin:8px 0 14px 0">' % (total / DXA * PX)]
    for tr in (rows if rows is not None else kids(tbl, "tr")):
        out.append("<tr>")
        for i, tc in enumerate(kids(tr, "tc")):
            tc_pr = kid(tc, "tcPr")
            css = ["border:0.6px solid #E7E9EE", "padding:3px 5px", "vertical-align:middle"]
            if i < len(widths):
                css.append("width:%.1fpx" % (widths[i] / DXA * PX))
            if tc_pr is not None:
                sh = kid(tc_pr, "shd")
                if sh is not None:
                    f = sh.getAttribute("w:fill")
                    if f and f != "auto":
                        css.append("background:#%s" % f)
            out.append('<td style="%s">%s</td>' % (";".join(css), "".join(para_html(p, True) for p in kids(tc, "p"))))
        out.append("</tr>")
    out.append("</table>")
    return "".join(out), total


def main(path):
    z = zipfile.ZipFile(path)
    doc = minidom.parseString(z.read("word/document.xml"))
    body = doc.getElementsByTagNameNS(W, "body")[0]
    parts, texts, tbl_widths = [], [], []
    for n in body.childNodes:
        if n.nodeType != 1:
            continue
        if n.localName == "p":
            parts.append(para_html(n))
            t = "".join(
                tt.firstChild.nodeValue
                for r in kids(n, "r") for tt in kids(r, "t") if tt.firstChild
            )
            if t.strip():
                texts.append(t)
        elif n.localName == "tbl":
            h, tw = tbl_html(n)
            parts.append(h)
            tbl_widths.append(tw)
            for tr in kids(n, "tr"):
                cells = []
                for tc in kids(tr, "tc"):
                    cells.append("".join(
                        tt.firstChild.nodeValue
                        for p in kids(tc, "p") for r in kids(p, "r") for tt in kids(r, "t") if tt.firstChild
                    ))
                texts.append(" | ".join(cells))

    CONTENT = 9638
    print("=== 表格宽度检查（正文可用宽度 %d dxa）===" % CONTENT)
    for i, w in enumerate(tbl_widths, 1):
        print("  表 %d: %d dxa  %s" % (i, w, "OK" if w <= CONTENT else "!!! 超出正文宽度"))

    CSS = (
        "<style>body{margin:0;background:#5a5d65;font-family:Arial,'PingFang SC',sans-serif;}"
        ".page{background:#fff;width:%.0fpx;padding:%.0fpx %.0fpx;margin:10px auto;"
        "box-shadow:0 3px 14px rgba(0,0,0,.35);}</style>"
        % (11906 / DXA * PX, 1440 / DXA * PX, 1134 / DXA * PX)
    )
    with open("docx-preview.html", "w", encoding="utf-8") as f:
        f.write(CSS + "<div class='page'>%s</div>" % "".join(parts))

    # chunked previews: split long tables so each file fits one screenshot
    chunks, cur, budget = [], [], 0
    for n in body.childNodes:
        if n.nodeType != 1:
            continue
        if n.localName == "p":
            cur.append(para_html(n))
            budget += 1
        elif n.localName == "tbl":
            rows = kids(n, "tr")
            header = rows[0:1]
            for i in range(0, len(rows), 18):
                part = rows[i : i + 18] if i == 0 else header + rows[i : i + 18]
                if budget > 20:
                    chunks.append(cur)
                    cur, budget = [], 0
                cur.append(tbl_html(n, part)[0])
                budget += len(part)
        if budget > 22:
            chunks.append(cur)
            cur, budget = [], 0
    if cur:
        chunks.append(cur)
    for i, c in enumerate(chunks, 1):
        with open("docx-preview-%02d.html" % i, "w", encoding="utf-8") as f:
            f.write(CSS + "<div class='page'>%s</div>" % "".join(c))
    print("chunked previews: %d files" % len(chunks))
    with open("docx-text.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(texts))
    print("\nwrote docx-preview.html, docx-text.txt (%d blocks)" % len(texts))


if __name__ == "__main__":
    main(sys.argv[1])
