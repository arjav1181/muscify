// Final probe: geometry-anchored shell regions (not tag-name guesses),
// hover states, carousel affordances, and the responsive contract.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const URL = "https://open.spotify.com/";

const BODY = `
  const rect = (el) => { if(!el) return null; const r=el.getBoundingClientRect();
    return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const cs = (el) => el ? getComputedStyle(el) : null;
  const hex = (v) => { if(!v) return null; const m=v.match(/rgba?\\(([^)]+)\\)/); if(!m) return v;
    const p=m[1].split(",").map(Number); const h=n=>Math.round(n).toString(16).padStart(2,"0");
    return "#"+h(p[0])+h(p[1])+h(p[2])+(p.length>3&&p[3]<1?" / "+p[3]:""); };

  const shell = (el) => el ? { rect: rect(el), cls: String(el.className).slice(0,70),
    style: (s=>({ bg: hex(s.backgroundColor), bgImage: s.backgroundImage.slice(0,130),
      padding: s.padding, gap: s.gap, position: s.position, overflowY: s.overflowY, overflowX: s.overflowX,
      borderRight: s.borderRight, zIndex: s.zIndex, display: s.display,
      flexDirection: s.flexDirection, borderRadius: s.borderRadius }))(cs(el)) } : null;

  // sidebar: tall, narrow, near the left edge
  const cands = Array.from(document.querySelectorAll("div")).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height > innerHeight*0.6 && r.width > 200 && r.width < 420 && r.x < 40 && r.y < 220;
  }).sort((a,b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);

  // the shelf with real cards
  const shelves = Array.from(document.querySelectorAll('[role="grid"]'))
    .map((g) => ({ g, n: g.querySelectorAll('[role="gridcell"]').length, r: g.getBoundingClientRect() }))
    .filter((x) => x.n >= 4 && x.r.height > 120)
    .sort((a, b) => b.r.width - a.r.width);
  const shelf = shelves[0];

  let detail = null;
  if (shelf) {
    const row = shelf.g.querySelector('[role="row"]');
    const cells = row ? Array.from(row.querySelectorAll('[role="gridcell"]')) : [];
    const cr = cells.map(rect).filter(Boolean);
    const gaps = []; for (let i=1;i<cr.length;i++) gaps.push(cr[i].x - (cr[i-1].x + cr[i-1].w));
    const first = cells.find((c) => c.getBoundingClientRect().width > 40);
    const fs = first ? cs(first) : null;
    const img = first ? first.querySelector("img") : null;

    const header = shelf.g.parentElement;
    const hEl = header ? header.querySelector("h1,h2,h3") : null;
    let showAll = null;
    if (header) for (const a of Array.from(header.querySelectorAll("a,button"))) {
      if (/show all/i.test((a.textContent||"").trim())) { const s=cs(a);
        showAll = { text:(a.textContent||"").trim(), fontSize:s.fontSize, fontWeight:s.fontWeight,
                    color:hex(s.color) }; break; }
    }

    let scroller = shelf.g;
    while (scroller && scroller.parentElement && scroller.parentElement !== document.body) {
      const oy = cs(scroller).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      scroller = scroller.parentElement;
    }

    detail = {
      grid: shell(shelf.g), row: shell(row), scroller: shell(scroller),
      gridAria: shelf.g.getAttribute("aria-label"),
      cellCount: cells.length,
      cellWidths: [...new Set(cr.map(r=>r.w))].sort((a,b)=>b-a),
      gaps: [...new Set(gaps)].sort((a,b)=>a-b),
      cell: first ? { rect: rect(first),
        style: { padding: fs.padding, bg: hex(fs.backgroundColor), radius: fs.borderRadius,
                 transitionProperty: fs.transitionProperty, transitionDuration: fs.transitionDuration,
                 transitionTimingFunction: fs.transitionTimingFunction, cursor: fs.cursor } } : null,
      artwork: img ? { rect: rect(img), style: (s=>({ radius:s.borderRadius, objectFit:s.objectFit,
                 w:s.width, h:s.height }))(cs(img)) } : null,
      header: hEl ? { text: hEl.textContent.trim().slice(0,40), tag: hEl.tagName,
        style: (s=>({ fontSize:s.fontSize, fontWeight:s.fontWeight, color:hex(s.color),
                      margin:s.margin, lineHeight:s.lineHeight }))(cs(hEl)) } : null,
      showAll,
      cardControls: first ? Array.from(first.querySelectorAll("button,a")).slice(0,6).map((b)=>({
          tag: b.tagName.toLowerCase(), label:(b.getAttribute("aria-label")||b.textContent||"").trim().slice(0,40),
          rect: rect(b), radius: cs(b).borderRadius, bg: hex(cs(b).backgroundColor) })) : [],
    };
  }

  const arrows = Array.from(document.querySelectorAll("button")).filter((b) => {
    const t=(b.getAttribute("aria-label")||"").toLowerCase(); return /next|previous|scroll/.test(t);
  }).slice(0,6).map((b)=>({ label:(b.getAttribute("aria-label")||"").trim(), rect: rect(b), radius: cs(b).borderRadius }));

  const combo = document.querySelector('[role="combobox"]');
  const search = combo ? { rect: rect(combo), role: combo.getAttribute("role"),
    name: combo.getAttribute("aria-label"), placeholder: combo.getAttribute("placeholder"),
    style: (s=>({ fontSize:s.fontSize, padding:s.padding, bg:hex(s.backgroundColor),
                  radius:s.borderRadius, color:hex(s.color) }))(cs(combo)) } : null;

  const topbar = Array.from(document.querySelectorAll("header,div")).filter((el) => {
    const r=el.getBoundingClientRect();
    return r.y < 4 && r.height > 40 && r.height < 120 && r.width > innerWidth*0.9;
  }).sort((a,b)=>a.getBoundingClientRect().height-b.getBoundingClientRect().height)[0];

  const d = document.documentElement;
  return {
    viewport: { w: innerWidth, h: innerHeight },
    sidebar: shell(cands[0]), topbar: shell(topbar), search, arrows, detail,
    scrollbar: { clientWidth: d.clientWidth, offsetWidth: d.offsetWidth, gutter: d.offsetWidth - d.clientWidth },
  };
`;

const HOVER_BODY = `
  const c = document.querySelectorAll('[role="gridcell"]')[1];
  if (!c) return { missing: true };
  const s = getComputedStyle(c);
  const hex=(v)=>{const m=v.match(/rgba?\\(([^)]+)\\)/);if(!m)return v;const p=m[1].split(",").map(Number);
    const h=n=>Math.round(n).toString(16).padStart(2,"0");return "#"+h(p[0])+h(p[1])+h(p[2]);};
  let btn=null;
  for (const b of c.querySelectorAll("button")) {
    if (/play/i.test(b.getAttribute("aria-label")||"")) { btn=b; break; }
  }
  const im = c.querySelector("img");
  const bs = btn ? getComputedStyle(btn) : null;
  const ims = im ? getComputedStyle(im) : null;
  return {
    cellBg: hex(s.backgroundColor), cellShadow: s.boxShadow, cellTransform: s.transform,
    cellRadius: s.borderRadius, cellPadding: s.padding,
    artworkShadow: ims ? ims.boxShadow : null, artworkFilter: ims ? ims.filter : null,
    playButton: bs ? { label: btn.getAttribute("aria-label"), bg: hex(bs.backgroundColor),
      color: hex(bs.color), radius: bs.borderRadius, transitionProperty: bs.transitionProperty,
      transitionDuration: bs.transitionDuration, transitionTimingFunction: bs.transitionTimingFunction } : null,
  };
`;

const browser = await chromium.launch({
  executablePath: "/repl/tools/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
const page = await ctx.newPage();
const out = { url: URL, capturedAt: new Date().toISOString(), widths: {}, hover: null };

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[role="grid"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(7000);

  for (const w of [1920, 1600, 1440, 1280, 1100, 900, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(1600);
    out.widths[w] = await page.evaluate("(() => {" + BODY + "})()");
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1200);
  const cell = page.locator('[role="gridcell"]').nth(1);
  if (await cell.count()) {
    await cell.hover({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(700);
    out.hover = await page.evaluate("(() => {" + HOVER_BODY + "})()");
  }
} catch (e) {
  out.error = String(e && e.message ? e.message : e);
} finally {
  await browser.close();
}

writeFileSync("/tmp/opencode/spotify-layout2.json", JSON.stringify(out, null, 2));
console.log("wrote /tmp/opencode/spotify-layout2.json", out.error || "(ok)");
