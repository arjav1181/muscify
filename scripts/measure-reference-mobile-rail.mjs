// Mobile rail + tab bar probe.
//
// The mobile shelf is NOT role="grid" — anchoring on that found 0 shelves and
// nearly produced a wrong spec. Anchor on the card artwork instead.
import { chromium, devices } from "playwright";
import { writeFileSync } from "node:fs";

const URL = "https://open.spotify.com/";

const BODY = `
  const rect = (el) => { if(!el) return null; const r=el.getBoundingClientRect();
    return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
            right:Math.round(r.right), bottom:Math.round(r.bottom)}; };
  const cs = (el) => el ? getComputedStyle(el) : null;
  const hex = (v) => { if(!v) return null; const m=v.match(/rgba?\\(([^)]+)\\)/); if(!m) return v;
    const p=m[1].split(",").map(Number); const h=n=>Math.round(n).toString(16).padStart(2,"0");
    return "#"+h(p[0])+h(p[1])+h(p[2])+(p.length>3&&p[3]<1?" / "+p[3]:""); };

  // ---- the rail: walk up from a card artwork until we find the scroller
  const imgs = Array.from(document.querySelectorAll("img"))
    .filter((i) => { const r = i.getBoundingClientRect();
      return r.width > 60 && r.width < 400 && Math.abs(r.width - r.height) < 8; });
  const cardImg = imgs[0] || null;

  let rail = null, railInfo = null;
  if (cardImg) {
    rail = cardImg;
    while (rail.parentElement) {
      const s = getComputedStyle(rail);
      if (s.overflowX === "auto" || s.overflowX === "scroll" || s.display === "flex" && s.flexDirection === "row") break;
      rail = rail.parentElement;
    }
    const s = getComputedStyle(rail);
    // sibling cards = same-size images sharing the rail's row
    const kids = Array.from(rail.children).map(rect).filter(Boolean);
    railInfo = {
      display: s.display, flexDirection: s.flexDirection,
      overflowX: s.overflowX, gap: s.gap, columnGap: s.columnGap,
      padding: s.padding, paddingLeft: s.paddingLeft, scrollSnapType: s.scrollSnapType,
      rect: rect(rail),
      childCount: kids.length,
      childWidths: [...new Set(kids.map(k=>k.w))].sort((a,b)=>b-a),
      childGaps: (() => { const g=[]; for(let i=1;i<kids.length;i++) g.push(kids[i].x-(kids[i-1].x+kids[i-1].w));
                          return [...new Set(g)].sort((a,b)=>a-b); })(),
      scrollWidth: rail.scrollWidth, clientWidth: rail.clientWidth,
      overflows: rail.scrollWidth > rail.clientWidth,
    };
  }

  // ---- card anatomy
  let card = null;
  if (cardImg) {
    let n = cardImg;
    for (let i=0;i<5 && n.parentElement;i++) {
      n = n.parentElement;
      const s = getComputedStyle(n);
      if (n.querySelector("a,button")) { }
      if (s.display === "flex" || s.display === "block") { }
      card = n;
    }
    const s = cs(card);
    const lines = Array.from(card.querySelectorAll("div,span,a"))
      .filter((n2) => n2.children.length === 0 && n2.textContent.trim())
      .slice(0,3)
      .map((n2) => { const l = getComputedStyle(n2);
        return { text: n2.textContent.trim().slice(0,32), fontSize:l.fontSize, fontWeight:l.fontWeight,
                 color:hex(l.color), margin:l.margin }; });
    const cs2 = cs(card);
    card = { rect: rect(card), padding: cs2.padding, display: cs2.display,
             flexDirection: cs2.flexDirection, gap: cs2.gap, lines,
             artwork: { rect: rect(cardImg), radius: cs(cardImg).borderRadius } };
  }

  // ---- shelf heading
  let heading = null;
  for (const h of document.querySelectorAll("h1,h2,h3")) {
    const r = h.getBoundingClientRect();
    if (r.width > 60 && r.top > 40 && r.top < innerHeight) {
      const s = getComputedStyle(h);
      heading = { text: h.textContent.trim().slice(0,40), tag: h.tagName,
                  fontSize: s.fontSize, fontWeight: s.fontWeight, color: hex(s.color),
                  margin: s.margin, rect: rect(h) };
      break;
    }
  }

  // ---- bottom tab bar: full-width fixed element containing nav links
  let tabbar = null;
  for (const el of document.querySelectorAll("nav,div,footer")) {
    const s = getComputedStyle(el);
    if (s.position !== "fixed" && s.position !== "sticky") continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < innerHeight - 4 || r.height < 40 || r.width < innerWidth * 0.9) continue;
    const links = el.querySelectorAll("a");
    if (links.length < 2) continue;
    tabbar = { el, s, r, links };
    break;
  }

  let tabs = null;
  if (tabbar) {
    tabs = {
      rect: rect(tabbar.el),
      style: { bg: hex(tabbar.s.backgroundColor), bgImage: tabbar.s.backgroundImage.slice(0,80),
               borderTop: tabbar.s.borderTop, padding: tabbar.s.padding, position: tabbar.s.position,
               zIndex: tabbar.s.zIndex, backdropFilter: tabbar.s.backdropFilter },
      items: Array.from(tabbar.links).map((a) => {
        const s = getComputedStyle(a);
        const r = rect(a);
        const svg = a.querySelector("svg");
        const sr = svg ? rect(svg) : null;
        const label = Array.from(a.querySelectorAll("*"))
          .filter((n) => n.children.length === 0 && n.textContent.trim())
          .map((n) => { const ls = getComputedStyle(n);
            return { t: n.textContent.trim().slice(0,18), fontSize: ls.fontSize,
                     fontWeight: ls.fontWeight, color: hex(ls.color), marginTop: ls.marginTop }; })[0];
        return { href: (a.getAttribute("href")||"").slice(0,20),
                 current: a.getAttribute("aria-current"),
                 rect: r, padding: s.padding,
                 icon: sr ? { w: sr.w, h: sr.h, color: hex(getComputedStyle(svg).fill === "none" ? getComputedStyle(svg).color : getComputedStyle(svg).color) } : null,
                 label: label || null };
      }),
    };
  }

  // ---- top bar
  let topbar = null;
  for (const el of document.querySelectorAll("header,div")) {
    const r = el.getBoundingClientRect();
    if (r.y < 3 && r.height > 40 && r.height < 120 && r.width > innerWidth * 0.9) { topbar = el; break; }
  }
  const top = topbar ? { rect: rect(topbar), bg: hex(cs(topbar).backgroundColor),
    padding: cs(topbar).padding,
    children: Array.from(topbar.querySelectorAll("a,button")).slice(0,8).map((n) => ({
      tag: n.tagName.toLowerCase(), label: (n.getAttribute("aria-label")||n.textContent||"").trim().slice(0,20),
      rect: rect(n), radius: cs(n).borderRadius, bg: hex(cs(n).backgroundColor) })) } : null;

  return { viewport:{w:innerWidth,h:innerHeight}, rail: railInfo, card, heading, tabs, top, hasSearchField: !!document.querySelector('[role="combobox"]') };
`;

const browser = await chromium.launch({
  executablePath: "/repl/tools/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const out = { url: URL, capturedAt: new Date().toISOString(), devices: {} };

for (const key of ["iPhone SE", "iPhone 13", "Pixel 5", "iPad Mini"]) {
  const ctx = await browser.newContext({ ...devices[key], colorScheme: "dark" });
  await ctx.addCookies([
    { name: "OptanonAlertBoxClosed", value: new Date().toISOString(), domain: ".spotify.com", path: "/" },
    { name: "OptanonConsent", value: "isGpcEnabled=0&groups=C0001:1,C0002:1,C0003:1", domain: ".spotify.com", path: "/" },
  ]);
  const page = await ctx.newPage();
  const rec = {};
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(9000);
    // close the Premium upsell so it does not cover the content we measure
    await page.locator('[aria-label="Close"], button[aria-label*="lose"]').first()
      .click({ timeout: 6000, force: true }).catch(() => {});
    await page.waitForTimeout(2500);
    Object.assign(rec, await page.evaluate("(() => {" + BODY + "})()"));
    await page.screenshot({ path: "/tmp/opencode/mobile-" + key.replace(/\s+/g, "-").toLowerCase() + ".png" });
  } catch (e) {
    rec.error = String(e && e.message ? e.message : e);
  } finally {
    await ctx.close();
  }
  out.devices[key] = rec;
  console.log(key, "->", rec.error || `rail:${!!rec.rail} tabs:${!!rec.tabs}`);
}
await browser.close();
writeFileSync("/tmp/opencode/spotify-mobile2.json", JSON.stringify(out, null, 2));
console.log("wrote /tmp/opencode/spotify-mobile2.json");
