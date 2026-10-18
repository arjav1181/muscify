// Measure the COMPUTED design values of a live page: colours, type scale,
// spacing rhythm, radii, layout geometry, hover states.
//
// REA's accessibility tree gives roles/names but not resolved values, so this
// fills the token layer. Read-only; anonymous session; nothing is written back.
//
// Usage: node measure-ui.mjs <url> [outfile] [width] [height]

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.argv[2] || "https://open.spotify.com/";
const outFile = process.argv[3] || "/tmp/opencode/measured.json";
const W = Number(process.argv[4] || 1440);
const H = Number(process.argv[5] || 900);

// Runs inside the page. Defined once so every evaluate() can use it.
const HELPERS = `
  const clean = (o) => Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, String(v).trim() || null])
  );
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const px = (v) => (v && /^[-\\d.]+px$/.test(v) ? Math.round(parseFloat(v) * 100) / 100 : v);
  const rectOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  // Classify a colour string into a name-ish bucket for grouping.
  const asRgb = (v) => {
    if (!v) return null;
    const m = v.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return v;
    const p = m[1].split(",").map((n) => parseFloat(n));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const hex = (v) => {
    const c = asRgb(v);
    if (!c || typeof c === "string") return v;
    const h = (n) => Math.round(n).toString(16).padStart(2, "0");
    return "#" + h(c.r) + h(c.g) + h(c.b) + (c.a < 1 ? " / " + c.a : "");
  };
`;

const BODY = (HELPERS) + `
  // ---- every element, once, with the values that matter
  const all = Array.from(document.querySelectorAll("*"));
  const textNodes = [];
  const seenType = new Map();
  const seenColour = new Map();
  const seenRadius = new Map();
  const seenShadow = new Map();

  for (const el of all) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") continue;

    // type scale, keyed by the full typographic triple
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own) {
      const t = (el.textContent || "").trim().slice(0, 40);
      if (t) {
        const key = [s.fontSize, s.fontWeight, s.lineHeight, s.letterSpacing].join("|");
        if (!seenType.has(key)) {
          seenType.set(key, {
            fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight,
            letterSpacing: s.letterSpacing, fontFamily: s.fontFamily.slice(0, 60),
            color: hex(s.color), count: 0, samples: [], tags: [],
          });
        }
        const rec = seenType.get(key);
        rec.count++;
        if (rec.samples.length < 5) rec.samples.push(t);
        if (rec.tags.length < 5 && !rec.tags.includes(el.tagName.toLowerCase())) rec.tags.push(el.tagName.toLowerCase());
      }
    }

    // background colours in use, excluding fully transparent
    const bg = s.backgroundColor;
    if (bg && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) {
      const k = hex(bg);
      if (!seenColour.has(k)) seenColour.set(k, { hex: k, count: 0, samples: [], alpha: asRgb(bg).a });
      const r = seenColour.get(k);
      r.count++;
      if (r.samples.length < 4) r.samples.push((el.className || el.tagName).toString().slice(0, 50));
    }

    const br = s.borderRadius;
    if (br && br !== "0px" && !seenRadius.has(br)) seenRadius.set(br, { radius: br, count: 0, samples: [] });
    if (br && br !== "0px") {
      const r = seenRadius.get(br);
      r.count++;
      if (r.samples.length < 4) r.samples.push((el.className || el.tagName).toString().slice(0, 50));
    }

    if (s.boxShadow && s.boxShadow !== "none" && !seenShadow.has(s.boxShadow)) {
      seenShadow.set(s.boxShadow, { shadow: s.boxShadow, count: 0, samples: [] });
      const r = seenShadow.get(s.boxShadow);
      r.count++;
      if (r.samples.length < 3) r.samples.push((el.className || el.tagName).toString().slice(0, 50));
    }
  }

  // ---- layout geometry of the named regions
  const geo = (sel, label) => {
    const el = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (!el) return { label, missing: true };
    const s = getComputedStyle(el);
    return {
      label,
      selector: typeof sel === "string" ? sel : el.tagName.toLowerCase(),
      rect: rectOf(el),
      style: clean({
        width: px(s.width), height: px(s.height),
        padding: s.padding, margin: s.margin, gap: s.gap,
        backgroundColor: hex(s.backgroundColor),
        backgroundImage: s.backgroundImage.slice(0, 160),
        borderRadius: s.borderRadius,
        position: s.position, overflow: s.overflow,
        flexDirection: s.flexDirection,
        gridTemplateColumns: s.gridTemplateColumns,
        boxShadow: s.boxShadow.slice(0, 120),
        zIndex: s.zIndex,
      }),
      aria: el.getAttribute("aria-label") || null,
      role: el.getAttribute("role") || null,
    };
  };

  // ---- one representative card in detail
  const cell = document.querySelector('[role="gridcell"]');
  const cardDetail = cell ? (() => {
    const s = getComputedStyle(cell);
    const img = cell.querySelector("img");
    const is = img ? getComputedStyle(img) : null;
    const lines = Array.from(cell.querySelectorAll("div,span"))
      .filter((n) => n.children.length === 0 && n.textContent.trim())
      .slice(0, 4)
      .map((n) => {
        const cs2 = getComputedStyle(n);
        return {
          text: n.textContent.trim().slice(0, 36),
          fontSize: cs2.fontSize, fontWeight: cs2.fontWeight,
          lineHeight: cs2.lineHeight, color: hex(cs2.color),
          display: cs2.display,
          webkitLineClamp: cs2.webkitLineClamp || cs2.getPropertyValue("-webkit-line-clamp"),
          overflow: cs2.overflow, textOverflow: cs2.textOverflow,
          whiteSpace: cs2.whiteSpace,
        };
      });
    return {
      rect: rectOf(cell),
      cellStyle: clean({ padding: s.padding, borderRadius: s.borderRadius, backgroundColor: hex(s.backgroundColor), transition: s.transition.slice(0, 140) }),
      artwork: is ? clean({ width: px(is.width), height: px(is.height), borderRadius: is.borderRadius, objectFit: is.objectFit, boxShadow: is.boxShadow.slice(0,100) }) : null,
      lines,
    };
  })() : null;

  // ---- hover behaviour on a card (computed transition + hovered shadow/bg)
  const hover = cell ? (() => {
    const s = getComputedStyle(cell);
    return {
      transitionProperty: s.transitionProperty,
      transitionDuration: s.transitionDuration,
      transitionTimingFunction: s.transitionTimingFunction,
      willChange: s.willChange,
      cursor: s.cursor,
    };
  })() : null;

  // ---- buttons inventory
  const buttons = [];
  const bseen = new Set();
  for (const b of Array.from(document.querySelectorAll("button")).slice(0, 500)) {
    const s = getComputedStyle(b);
    const r = rectOf(b);
    const rec = {
      label: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 44),
      bg: hex(s.backgroundColor), color: hex(s.color),
      radius: s.borderRadius, padding: s.padding,
      fontSize: s.fontSize, fontWeight: s.fontWeight,
      transition: s.transitionProperty + " " + s.transitionDuration + " " + s.transitionTimingFunction,
      hit: r ? { w: r.w, h: r.h } : null,
    };
    const k = [rec.bg, rec.color, rec.radius, rec.padding].join("|");
    if (!bseen.has(k)) { bseen.add(k); buttons.push(rec); }
  }

  // ---- inputs
  const inputs = Array.from(document.querySelectorAll("input")).slice(0, 8).map((i) => {
    const s = getComputedStyle(i);
    const p = i.parentElement ? getComputedStyle(i.parentElement) : null;
    return {
      placeholder: i.getAttribute("placeholder"),
      ariaLabel: i.getAttribute("aria-label"),
      role: i.getAttribute("role"),
      fontSize: s.fontSize, height: px(s.height), padding: s.padding,
      color: hex(s.color), background: hex(s.backgroundColor),
      wrapperBg: p ? hex(p.backgroundColor) : null,
      wrapperRadius: p ? p.borderRadius : null,
      wrapperPadding: p ? p.padding : null,
      wrapperHeight: p ? px(p.height) : null,
      border: s.border,
    };
  });

  return {
    url: location.href,
    title: document.title,
    viewport: { w: innerWidth, h: innerHeight },
    rootStyle: (() => { const s = getComputedStyle(document.documentElement); const b = getComputedStyle(document.body);
      return { htmlBg: hex(s.backgroundColor), bodyBg: hex(b.backgroundColor), bodyColor: hex(b.color),
               bodyFont: b.fontFamily.slice(0,80), bodyFontSize: b.fontSize, bodyLineHeight: b.lineHeight,
               bodyLetterSpacing: b.letterSpacing }; })(),
    shell: [
      geo("nav", "nav/sidebar"),
      geo("header", "top bar"),
      geo("main", "main content"),
      geo("footer", "player bar"),
      geo('[role="grid"]', "shelf grid"),
      geo('[role="row"]', "shelf row"),
      geo('[role="gridcell"]', "shelf cell"),
    ],
    cardDetail,
    hover,
    typeScale: Array.from(seenType.values()).sort((a, b) => b.count - a.count).slice(0, 30),
    colours: Array.from(seenColour.values()).sort((a, b) => b.count - a.count).slice(0, 30),
    radii: Array.from(seenRadius.values()).sort((a, b) => b.count - a.count).slice(0, 15),
    shadows: Array.from(seenShadow.values()).sort((a, b) => b.count - a.count).slice(0, 10),
    buttons: buttons.slice(0, 30),
    inputs,
  };
`;

// page.evaluate runs a string as a statement list; a top-level `return` is a
// syntax error there, so the whole collector is wrapped in an IIFE.
const COLLECT = "(() => {" + BODY + "})()";

const browser = await chromium.launch({
  executablePath: "/repl/tools/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "dark" });
const page = await ctx.newPage();

const out = { url, viewport: { width: W, height: H }, capturedAt: new Date().toISOString() };
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[role="grid"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(7000);
  Object.assign(out, await page.evaluate(COLLECT));
} catch (e) {
  out.error = String(e && e.message ? e.message : e);
} finally {
  await browser.close();
}

writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log("wrote", outFile, out.error ? "ERROR: " + out.error : "(ok)");
