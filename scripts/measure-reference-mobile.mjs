// Mobile capture: proper device emulation (touch + mobile UA + DPR).
//
// The earlier desktop-context run at 480px was INVALID — without touch/mobile
// emulation the page served the desktop layout squeezed into a narrow window,
// which is why "sidebar 320px, content 416px" appeared. Real mobile needs the
// device descriptor, not just a small viewport.

import { chromium, devices } from "playwright";
import { writeFileSync } from "node:fs";

const URL = "https://open.spotify.com/";

const PROFILES = [
  { key: "iphone-se", device: "iPhone SE" },
  { key: "iphone-13", device: "iPhone 13" },
  { key: "pixel-5", device: "Pixel 5" },
  { key: "ipad-mini", device: "iPad Mini" },
];

const BODY = `
  const rect = (el) => { if(!el) return null; const r=el.getBoundingClientRect();
    return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
            bottom:Math.round(r.bottom)}; };
  const cs = (el) => el ? getComputedStyle(el) : null;
  const hex = (v) => { if(!v) return null; const m=v.match(/rgba?\\(([^)]+)\\)/); if(!m) return v;
    const p=m[1].split(",").map(Number); const h=n=>Math.round(n).toString(16).padStart(2,"0");
    return "#"+h(p[0])+h(p[1])+h(p[2])+(p.length>3&&p[3]<1?" / "+p[3]:""); };

  // Anything pinned to the bottom edge: tab bar, mini player, CTA strip.
  const bottomPinned = Array.from(document.querySelectorAll("div,nav,footer,section"))
    .filter((el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      return (s.position === "fixed" || s.position === "sticky") &&
             r.bottom >= innerHeight - 6 && r.height > 20 && r.width > innerWidth * 0.6; })
    .map((el) => ({ el, s: getComputedStyle(el), r: el.getBoundingClientRect() }))
    .sort((a, b) => a.r.y - b.r.y);

  const layers = bottomPinned.map(({ el, s, r }) => ({
    rect: rect(el),
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role"),
    aria: el.getAttribute("aria-label"),
    bg: hex(s.backgroundColor),
    borderTop: s.borderTop,
    padding: s.padding,
    position: s.position,
    zIndex: s.zIndex,
    // is it a tab bar? does it contain nav links?
    links: Array.from(el.querySelectorAll("a")).slice(0, 8).map((a) => ({
      label: (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 22),
      href: (a.getAttribute("href") || "").slice(0, 26),
      iconOnly: !(a.textContent || "").trim(),
      current: a.getAttribute("aria-current"),
    })),
  }));

  // main content region
  const grid = Array.from(document.querySelectorAll('[role="grid"]'))
    .map((g) => ({ g, n: g.querySelectorAll('[role="gridcell"]').length, r: g.getBoundingClientRect() }))
    .filter((x) => x.n >= 2 && x.r.height > 60)
    .sort((a, b) => b.r.height - a.r.height)[0];

  let shelf = null;
  if (grid) {
    const g = grid.g, s = cs(g);
    const row = g.querySelector('[role="row"]');
    const cells = row ? Array.from(row.querySelectorAll('[role="gridcell"]')) : [];
    const cr = cells.map(rect).filter(Boolean);
    const gaps = []; for (let i = 1; i < cr.length; i++) gaps.push(cr[i].x - (cr[i-1].x + cr[i-1].w));
    const img = cells.map(c => c.querySelector("img")).find(Boolean);
    shelf = {
      aria: g.getAttribute("aria-label"),
      rect: rect(g),
      display: s.display, autoFlow: s.gridAutoFlow,
      gridTemplateColumns: s.gridTemplateColumns.slice(0, 240),
      overflowX: s.overflowX,
      padding: s.padding,
      cellCount: cells.length,
      cellWidths: [...new Set(cr.map(r => r.w))].sort((a,b) => b-a),
      gaps: [...new Set(gaps)].sort((a,b) => a-b),
      artwork: img ? { rect: rect(img), radius: cs(img).borderRadius, objectFit: cs(img).objectFit } : null,
    };
  }

  // top bar + search
  const combo = document.querySelector('[role="combobox"], input[type="search"], input[placeholder]');
  const search = combo ? { rect: rect(combo), role: combo.getAttribute("role"),
    name: combo.getAttribute("aria-label"), placeholder: combo.getAttribute("placeholder"),
    style: (s=>({ fontSize:s.fontSize, padding:s.padding, bg:hex(s.backgroundColor),
                   radius:s.borderRadius }))(cs(combo)) } : null;

  const topbar = Array.from(document.querySelectorAll("header,div")).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.y < 4 && r.height > 30 && r.height < 130 && r.width > innerWidth * 0.9;
  }).sort((a,b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];

  // type scale actually rendered at this width
  const types = new Map();
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") continue;
    const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const key = [st.fontSize, st.fontWeight].join("|");
    if (!types.has(key)) types.set(key, { fontSize: st.fontSize, fontWeight: st.fontWeight, n: 0, e: [] });
    const r = types.get(key); r.n++;
    const t = (el.textContent||"").trim().slice(0,28);
    if (t && r.e.length < 3) r.e.push(t);
  }

  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    touch: { maxTouchPoints: navigator.maxTouchPoints, coarse: matchMedia("(pointer: coarse)").matches },
    bottomLayers: layers,
    shelf,
    search,
    topbar: topbar ? { rect: rect(topbar), bg: hex(cs(topbar).backgroundColor), padding: cs(topbar).padding } : null,
    types: Array.from(types.values()).sort((a,b) => b.n - a.n).slice(0, 10),
  };
`;

const browser = await chromium.launch({
  executablePath: "/repl/tools/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const out = { url: URL, capturedAt: new Date().toISOString(), devices: {} };

for (const p of PROFILES) {
  const ctx = await browser.newContext({ ...devices[p.device], colorScheme: "dark" });
  const page = await ctx.newPage();
  const rec = {};
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[role="grid"]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(8000);
    Object.assign(rec, await page.evaluate("(() => {" + BODY + "})()"));
    rec.screenshot = "device-" + p.key + ".png";
    await page.screenshot({ path: "/tmp/opencode/" + rec.screenshot });
  } catch (e) {
    rec.error = String(e && e.message ? e.message : e);
  } finally {
    await ctx.close();
  }
  out.devices[p.key] = rec;
  console.log(p.key, "->", rec.error || `${rec.viewport?.w}x${rec.viewport?.h} touch:${rec.touch?.coarse} layers:${rec.bottomLayers?.length}`);
}

await browser.close();
writeFileSync("/tmp/opencode/spotify-mobile.json", JSON.stringify(out, null, 2));
console.log("wrote /tmp/opencode/spotify-mobile.json");
