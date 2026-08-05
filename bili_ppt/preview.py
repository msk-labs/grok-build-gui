"""Render the generated .pptx to an HTML approximation for visual QA.

Parses ppt/slides/slideN.xml directly, so what you see is what is actually in the
file (charts are drawn as labelled placeholders — pptxgenjs writes those as
separate chart parts).
"""
import html
import re
import sys
import zipfile

from defusedxml import minidom

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
EMU = 914400.0
PX = 96.0  # css px per inch
SCALE = EMU / PX


def child(node, ns, name):
    for n in node.childNodes:
        if n.nodeType == 1 and n.localName == name and n.namespaceURI == ns:
            return n
    return None


def descend(node, ns, *names):
    cur = node
    for n in names:
        if cur is None:
            return None
        cur = child(cur, ns, n)
    return cur


def solid_fill(node):
    """Return (hex, alpha) for a <a:solidFill> parent, or None."""
    sf = child(node, A, "solidFill") if node is not None else None
    if sf is None:
        return None
    clr = child(sf, A, "srgbClr")
    if clr is None:
        return None
    val = clr.getAttribute("val")
    alpha = child(clr, A, "alpha")
    a = int(alpha.getAttribute("val")) / 100000.0 if alpha is not None else 1.0
    return val, a


def xfrm_box(sp_pr):
    if sp_pr is None:
        return None
    # shapes carry <a:xfrm> inside spPr; graphicFrames carry <p:xfrm> directly
    xf = child(sp_pr, A, "xfrm") or child(sp_pr, P, "xfrm")
    if xf is None:
        return None
    off, ext = child(xf, A, "off"), child(xf, A, "ext")
    if off is None or ext is None:
        return None
    return (
        int(off.getAttribute("x")) / SCALE,
        int(off.getAttribute("y")) / SCALE,
        int(ext.getAttribute("cx")) / SCALE,
        int(ext.getAttribute("cy")) / SCALE,
    )


ALIGN = {"l": "left", "ctr": "center", "r": "right", "just": "justify"}
ANCHOR = {"t": "flex-start", "ctr": "center", "b": "flex-end"}


def render_txbody(tx):
    body_pr = child(tx, A, "bodyPr")
    anchor = ANCHOR.get(body_pr.getAttribute("anchor") if body_pr is not None else "", "flex-start")
    ins = {}
    if body_pr is not None:
        for attr, key in (("lIns", "left"), ("rIns", "right"), ("tIns", "top"), ("bIns", "bottom")):
            if body_pr.hasAttribute(attr):
                ins[key] = int(body_pr.getAttribute(attr)) / SCALE
    pad = "padding:%dpx %dpx %dpx %dpx;" % (
        ins.get("top", 4), ins.get("right", 8), ins.get("bottom", 4), ins.get("left", 8)
    )
    paras = []
    for p in tx.childNodes:
        if p.nodeType != 1 or p.localName != "p":
            continue
        p_pr = child(p, A, "pPr")
        algn = ALIGN.get(p_pr.getAttribute("algn") if p_pr is not None else "", "left")
        bullet = p_pr is not None and child(p_pr, A, "buChar") is not None
        space_after = 0
        if p_pr is not None:
            sa = child(p_pr, A, "spcAft")
            pts = descend(sa, A, "spcPts") if sa is not None else None
            if pts is not None:
                space_after = int(pts.getAttribute("val")) / 100.0
        runs = []
        for r in p.childNodes:
            if r.nodeType != 1 or r.localName != "r":
                continue
            r_pr = child(r, A, "rPr")
            t = child(r, A, "t")
            text = t.firstChild.nodeValue if (t is not None and t.firstChild) else ""
            css = []
            if r_pr is not None:
                if r_pr.hasAttribute("sz"):
                    css.append("font-size:%.2fpt" % (int(r_pr.getAttribute("sz")) / 100.0))
                if r_pr.getAttribute("b") == "1":
                    css.append("font-weight:700")
                if r_pr.getAttribute("i") == "1":
                    css.append("font-style:italic")
                if r_pr.hasAttribute("spc"):
                    css.append("letter-spacing:%.2fpt" % (int(r_pr.getAttribute("spc")) / 100.0))
                f = solid_fill(r_pr)
                if f:
                    css.append("color:#%s" % f[0])
                lat = child(r_pr, A, "latin")
                if lat is not None and lat.getAttribute("typeface"):
                    css.append('font-family:"%s","PingFang SC",sans-serif' % lat.getAttribute("typeface"))
            runs.append('<span style="%s">%s</span>' % (";".join(css), html.escape(text)))
        if not runs:
            continue
        paras.append(
            '<p style="text-align:%s;margin:0 0 %.1fpt 0;%s">%s</p>'
            % (algn, space_after, "list-style:disc;margin-left:14px;display:list-item;" if bullet else "", "".join(runs))
        )
    if not paras:
        return None
    return (
        '<div class="tx" style="%s justify-content:%s;">%s</div>' % (pad, anchor, "".join(paras)),
        anchor,
    )


def render_slide(xml_bytes, idx):
    doc = minidom.parseString(xml_bytes)
    sld = doc.documentElement
    bg_color = "FFFFFF"
    bg = descend(sld, P, "cSld", "bg")
    if bg is not None:
        bgpr = child(bg, P, "bgPr")
        f = solid_fill(bgpr) if bgpr is not None else None
        if f:
            bg_color = f[0]
    tree = descend(sld, P, "cSld", "spTree")
    parts = []
    boxes = []
    for sp in tree.childNodes:
        if sp.nodeType != 1:
            continue
        if sp.localName == "graphicFrame":
            box = xfrm_box(sp)
            if box:
                x, y, w, h = box
                parts.append(
                    '<div class="chart" style="left:%.1fpx;top:%.1fpx;width:%.1fpx;height:%.1fpx">CHART</div>'
                    % (x, y, w, h)
                )
                boxes.append(("chart", x, y, w, h, "CHART"))
            continue
        if sp.localName not in ("sp", "pic"):
            continue
        sp_pr = child(sp, P, "spPr")
        box = xfrm_box(sp_pr)
        if not box:
            continue
        x, y, w, h = box
        style = ["left:%.1fpx" % x, "top:%.1fpx" % y, "width:%.1fpx" % w, "height:%.1fpx" % h]
        geom = child(sp_pr, A, "prstGeom")
        prst = geom.getAttribute("prst") if geom is not None else "rect"
        if prst == "ellipse":
            style.append("border-radius:50%")
        elif prst == "roundRect":
            style.append("border-radius:%.1fpx" % min(w, h, 0.08 * 2 * PX))
        f = solid_fill(sp_pr)
        if f:
            style.append("background:#%s" % f[0])
            if f[1] < 1:
                style.append("opacity:%.3f" % f[1])
        ln = child(sp_pr, A, "ln")
        if ln is not None:
            lf = solid_fill(ln)
            wpt = int(ln.getAttribute("w")) / 12700.0 if ln.hasAttribute("w") else 1
            if lf:
                style.append("border:%.2fpx solid #%s" % (max(wpt, 0.5), lf[0]))
        inner = ""
        label = ""
        tx = child(sp, P, "txBody")
        if tx is not None:
            r = render_txbody(tx)
            if r:
                inner = r[0]
                label = re.sub("<[^>]+>", "", inner)[:40]
        parts.append('<div class="sh" style="%s">%s</div>' % (";".join(style), inner))
        if label.strip():
            boxes.append(("text", x, y, w, h, label.strip()))
    return (
        '<div class="slide" style="background:#%s"><div class="num">%d</div>%s</div>'
        % (bg_color, idx, "".join(parts)),
        boxes,
    )


def main(pptx):
    z = zipfile.ZipFile(pptx)
    names = sorted(
        (n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
        key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)),
    )
    slides, all_boxes = [], []
    for i, n in enumerate(names, 1):
        h, boxes = render_slide(z.read(n), i)
        slides.append(h)
        all_boxes.append(boxes)

    W, H = 13.3 * PX, 7.5 * PX
    # geometry checks
    problems = []
    for i, boxes in enumerate(all_boxes, 1):
        for kind, x, y, w, h, label in boxes:
            if x < -1 or y < -1 or x + w > W + 1 or y + h > H + 1:
                if kind == "text":
                    problems.append(f"slide {i}: 越界 {label!r} -> x={x/PX:.2f} y={y/PX:.2f} r={(x+w)/PX:.2f} b={(y+h)/PX:.2f}")
    print("\n".join(problems) if problems else "geometry: no out-of-bounds text boxes")

    css = """
    body{margin:0;background:#4a4d55;font-family:Arial,"PingFang SC",sans-serif;}
    .slide{position:relative;width:%.0fpx;height:%.0fpx;margin:18px auto;overflow:hidden;
           box-shadow:0 4px 18px rgba(0,0,0,.4);}
    .sh{position:absolute;box-sizing:border-box;}
    .tx{position:absolute;inset:0;display:flex;flex-direction:column;box-sizing:border-box;
        font-size:18pt;line-height:1.25;color:#000;overflow:visible;}
    .tx p{white-space:pre-wrap;word-break:break-word;}
    .chart{position:absolute;box-sizing:border-box;border:1.5px dashed #FB7299;color:#FB7299;
           font-size:12px;display:flex;align-items:center;justify-content:center;letter-spacing:3px;}
    .num{position:absolute;left:-14px;top:-14px;background:#111;color:#fff;font-size:11px;
         padding:2px 6px;border-radius:3px;z-index:99;}
    """ % (W, H)
    with open("preview.html", "w", encoding="utf-8") as f:
        f.write("<style>%s</style>%s" % (css, "".join(slides)))
    for i, s in enumerate(slides, 1):
        with open("preview-%02d.html" % i, "w", encoding="utf-8") as f:
            f.write("<style>%s.slide{margin:6px auto;}</style>%s" % (css, s))
    print("wrote preview.html + %d per-slide files" % len(slides))


if __name__ == "__main__":
    main(sys.argv[1])
