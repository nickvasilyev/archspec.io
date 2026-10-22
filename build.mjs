// Build archspec.io: a static site made from an archspec checkout.
//   /             the landing page, with diagrams and findings rendered by the real engine
//   /docs/        the user guide (archspec/docs/instructions.md), examples rendered at build time
//   /playground/  the web app, the single HTML file archspec builds
// Usage: node build.mjs [path to archspec]   (default: $ARCHSPEC_DIR or ../archspec) → dist/
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Marked } from "marked";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(process.argv[2] || process.env.ARCHSPEC_DIR || join(HERE, "..", "archspec"));
const OUT = join(HERE, "dist");
const SITE = "https://archspec.io";
const SOURCE_URL = process.env.ARCHSPEC_SOURCE_URL || "";   // link to the code; left out while the repo is private

if (!existsSync(join(APP, "core", "core.js"))) {
  console.error(`archspec not found at ${APP}: pass its path, or set ARCHSPEC_DIR`);
  process.exit(1);
}
const read = (...p) => readFileSync(join(APP, ...p), "utf8");
const src = (...p) => readFileSync(join(HERE, "src", ...p), "utf8");
const A = { ...(await import(pathToFileURL(join(APP, "core", "core.js")))), ...(await import(pathToFileURL(join(APP, "core", "diagrams.js")))) };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const opts = {
  schema: JSON.parse(read("schema", "archspec.schema.json")),
  policies: read("platform", "policies.yaml"),
  resolveImport: (p) => { try { return read("platform", p.split("/").pop()); } catch { return null; } },
};
const load = (text, name = "example") => A.load(A.exampleSpecText(text).replace(/^spec: example$/m, `spec: ${name}`), `${name}.spec.yaml`, opts);
// open findings: not suppressed by an exception, not marked done in the spec's reviews
const active = (spec) => A.check(spec).filter((f) => !f.suppressed && !(f.review && f.review.status === "done"));

// Every diagram in both themes; CSS shows the one that matches the page. The engine names its
// arrowhead markers the same in every SVG, so each copy gets its own ids: otherwise a page with
// several diagrams draws every arrow with the first diagram's (possibly hidden) markers.
let svgCount = 0;
const uniqIds = (svg) => {
  const p = `d${++svgCount}-`;
  return svg.replace(/\sid="([^"]+)"/g, ` id="${p}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/href="#([^"]+)"/g, `href="#${p}$1"`);
};
const themed = (draw) => `<div class="svg only-light">${uniqIds(draw("light"))}</div><div class="svg only-dark">${uniqIds(draw("dark"))}</div>`;
const architecture = (spec, focus) => themed((theme) => A.architectureSvg(spec, { theme, focus }));
const sequence = (spec, focus) => themed((theme) => A.sequenceSvg(spec, { theme, focus }));
const SEV = { error: "✗", warning: "!", info: "i" };
const findingsHtml = (fs) => fs.length
  ? `<ul class="findings">${fs.map((f) => `<li class="${f.severity}"><span class="sev">${SEV[f.severity] || "·"}</span><code>${esc(f.rule)}</code><span>${esc(f.message)}</span></li>`).join("")}</ul>`
  : `<p class="allclear">No findings.</p>`;
function connectionsHtml(spec) {
  const rows = A.techIds(spec).map((cid) => `<tr>${A.securityRow(spec, cid).cells.map((c, i) => `<td>${i === 0 ? `<code>${esc(c)}</code>` : esc(c).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</td>`).join("")}</tr>`).join("");
  return `<div class="tablewrap"><table><thead><tr>${A.SECURITY_HEADER.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ── the playground: build it with archspec's own build ──
execFileSync(process.execPath, [join(APP, "web", "build.mjs")], { stdio: "inherit" });
const ruleCount = (read("platform", "policies.yaml").match(/^ {2}[A-Z]+\d+:/gm) || []).length;

// ── the user guide ──
const slug = A.slug;
const toc = [];
let exampleCount = 0;
const marked = new Marked({
  renderer: {
    heading(text, level, raw) {
      const id = slug(raw);
      if (level === 2) toc.push({ id, text: raw });
      return `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${level}>\n`;
    },
    code(code, info) {
      const [lang, tag, view] = String(info || "").split(/\s+/);
      if (tag !== "archspec") return `<pre class="code"><code>${esc(code)}</code></pre>\n`;
      exampleCount++;
      const spec = load(code);
      const out = view === "findings" ? findingsHtml(active(spec))
        : view === "sequence" ? sequence(spec)
        : view === "connections" ? connectionsHtml(spec)
        : architecture(spec);
      return `<figure class="example"><pre class="code"><code>${esc(code)}</code></pre><div class="render render-${esc(view || "architecture")}">${out}</div></figure>\n`;
    },
    table(header, body) { return `<div class="tablewrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>\n`; },
  },
});
// The guide's own contents list and "Open in editor" note are for the in-app Help tab;
// the site has a sidebar and renders the examples ahead of time.
const guide = read("docs", "instructions.md")
  .replace(/^- \[[^\]]+\]\(#[^)]+\)\n/gm, "")
  .replace(/^Every example on this page is live[^\n]*\n[^\n]*\n/m,
    "Every example on this page was drawn by the archspec engine from the spec next to it. Paste one into the [playground](/playground/) to change it.\n");
const [, title, intro, rest] = guide.match(/^# (.+)\n([\s\S]*?)(?=^## )([\s\S]*)$/m);
const docBody = marked.parse(intro) + marked.parse(rest);

// ── the landing page ──
const businessSnippet = `components:
  customer:  { kind: person,   title: Customer }
  website:   { kind: system,   title: eCommerce Website }
  orders:    { kind: system,   title: Order Processing Engine }
  warehouse: { kind: external, title: Warehouse Partner }
connections:
  customer_to_website: { from: customer, to: website, label: places orders }
  website_to_orders:   { from: website, to: orders, label: submits orders }
  orders_to_warehouse: { from: orders, to: warehouse, label: sends picking lists }`;
const checkSnippet = `components:
  web:  { kind: external, title: Web App, zone: internet }
  api:  { kind: service, title: API, zone: dmz }
  data: { kind: database, title: Data, zone: private }
connections:
  web_to_api: { from: web, to: api, type: https-rest, timeout: 3s, retryPolicy: none }
  api_to_data: { from: api, to: data, type: postgres, auth: password, statementTimeout: 1s }`;
const shop = A.load(read("examples", "online-shop.spec.yaml"), "online-shop.spec.yaml", {
  ...opts, resolveImport: (p) => { try { return readFileSync(resolve(APP, "examples", p), "utf8"); } catch { return null; } },
});

// One flow step as written in the example, for the comparison with a prose spec.
function stepYaml(id) {
  const start = shopLines.indexOf(`  - id: ${id}`);
  if (start < 0) throw new Error(`online-shop example has no step ${id}: update build.mjs`);
  let end = start + 1;
  while (end < shopLines.length && shopLines[end].trim() && !/^  - id: /.test(shopLines[end])) end++;
  return shopLines.slice(start, end).map((l) => l.slice(2)).join("\n");
}

// Scene: a shortcut typed into the spec, and what the checker says about it.
const shopText = read("examples", "online-shop.spec.yaml");
const shopOpts = { ...opts, resolveImport: (p) => { try { return readFileSync(resolve(APP, "examples", p), "utf8"); } catch { return null; } } };
const SHORTCUT = ["  fulfillment-worker_to_orders_db:", "    from: fulfillment-worker", "    to: orders_db", "    type: postgres", "    auth: password", ""];
const shopLines = shopText.split("\n");
const at = shopLines.indexOf("  fulfillment-worker_to_fulfillment_db:");
if (at < 0) throw new Error("online-shop example changed: update the typing scene in build.mjs");
const withShortcut = A.load([...shopLines.slice(0, at), ...SHORTCUT, ...shopLines.slice(at)].join("\n"), "online-shop.spec.yaml", shopOpts);
const severityPill = (fs) => {
  const n = (sev) => fs.filter((f) => f.severity === sev).length;
  return n("error") ? `<span class="pill pill-err">${n("error")} errors</span>` : `<span class="pill pill-ok">No errors</span>` +
    (n("info") ? ` <span class="pill pill-info">${n("info")} info</span>` : "");
};
const line = (no, text, cls = "") => `<span class="ln${cls}"><span class="no">${no}</span>${esc(text)}</span>`;
const editorLines = (() => {
  const from = at - 10, to = at + 4, out = [];
  for (let i = from; i < at; i++) out.push(line(i + 1, shopLines[i]));
  SHORTCUT.forEach((t, k) => out.push(`<span class="ln ins" data-text="${esc(t)}"><span class="no">${at + k + 1}</span><span class="txt"></span></span>`));
  for (let i = at; i < to; i++) out.push(`<span class="ln" data-shift="${SHORTCUT.length}"><span class="no" data-a="${i + 1}" data-b="${i + 1 + SHORTCUT.length}">${i + 1}</span>${esc(shopLines[i])}</span>`);
  return out.join("");
})();

// Scene: the views one spec produces.
const mdView = new Marked({ renderer: {
  code(code) { return `<pre class="code"><code>${esc(code)}</code></pre>`; },
  table(header, body) { return `<div class="tablewrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`; },
} });
const API = await import(pathToFileURL(join(APP, "core", "api.js")));
const views = [
  ["Architecture", `<div class="diagram">${architecture(shop, "order-processing-engine")}</div>`],
  ["Sequence", `<div class="diagram">${sequence(shop, "order-processing-engine")}</div>`],
  ["Security", connectionsHtml(shop)],
  ["API reference", `<div class="md">${mdView.parse(API.apiReference(shop, ["storefront"]))}</div>`],
  ["Agent brief", `<pre class="code"><code>${esc(A.brief(shop, ["S6"], "online-shop.spec.yaml"))}</code></pre>`],
  ["Postgres DDL", `<pre class="code"><code>${esc(A.ddl(shop))}</code></pre>`],
];

const cli = (() => {
  try {
    execFileSync(process.execPath, [join(APP, "cli", "archspec.mjs"), "check", "examples/order-placed-broken.spec.yaml"], { cwd: APP, encoding: "utf8" });
    return "";
  } catch (e) { return String(e.stdout || ""); }   // exit code 1: the broken example has errors, as intended
})();
const cliLines = cli.split("\n").filter((l) => /^[✗!i] /.test(l));
const cliShown = [0, 3, 4, 7].map((i) => cliLines[i]).filter(Boolean)
  .map((l) => l.replace("examples/order-placed-broken.spec.yaml", "orders.spec.yaml"));
const cliTotal = cliLines.length;
const terminal = [`<span class="ln"><span class="prompt">$</span> archspec check orders.spec.yaml</span>`,
  ...cliShown.map((l) => { const [sev, rule, ...rest] = l.split(/\s+/); const at = rest.shift(); const msg = rest.join(" ");
    return `<span class="ln"><span class="t-${sev === "✗" ? "err" : sev === "!" ? "warn" : "info"}">${esc(sev)} ${esc(rule.padEnd(7))}</span> <span class="t-at">${esc(at)}</span> ${esc(msg)}</span>`; }),
  `<span class="ln t-muted">… ${cliTotal - cliShown.length} more · exit code 1</span>`].join("");

const page = (file, vars) => Object.entries(vars).reduce((html, [k, v]) => html.split(`{{${k}}}`).join(v), src(file));
const shell = (vars) => page("layout.html", {
  source: SOURCE_URL ? `<a href="${esc(SOURCE_URL)}">Source</a>` : "",
  ...vars,
});
const index = shell({
  title: "archspec · design specs for people and coding agents",
  description: "One compact YAML spec instead of the design doc and the architecture diagram. archspec checks the design like a static analyzer, draws the diagrams and gives each coding agent a precise brief, in your browser.",
  path: "/", nav_home: ' aria-current="page"', nav_docs: "",
  body: page("index.html", {
    business_snippet: esc(businessSnippet),
    business_diagram: architecture(load(businessSnippet, "shop")),
    check_snippet: esc(checkSnippet),
    check_findings: findingsHtml(active(load(checkSnippet, "api"))),
    drill1: architecture(shop),
    drill2: architecture(shop, "order-processing-engine"),
    drill3: architecture(shop, "order-processing-api"),
    editor_lines: editorLines,
    findings_before: severityPill(active(shop)) + findingsHtml(active(shop)),
    findings_after: severityPill(active(withShortcut)) + findingsHtml(active(withShortcut).filter((f) => f.severity !== "info")),
    view_tabs: views.map(([t], i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-i="${i}"><span class="bar"></span>${esc(t)}</button>`).join(""),
    view_panels: views.map(([t, html], i) => `<div class="view${i === 0 ? " on" : ""}" role="tabpanel" aria-label="${esc(t)}" data-i="${i}">${html}</div>`).join(""),
    rule_count: String(ruleCount),
    agent_step: esc(stepYaml("S6")),
    terminal,
  }),
});
const docs = shell({
  title: `${title.replace(/^archspec /, "")} · archspec docs`.replace(/^instructions/, "User guide"),
  description: "How to write archspec specs and use the app: components, connections, data, flows, findings, diagrams, security review, exports and the command line.",
  path: "/docs/", nav_home: "", nav_docs: ' aria-current="page"',
  body: page("docs.html", {
    toc: toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join(""),
    content: docBody,
  }),
});
const notFound = shell({
  title: "Page not found · archspec", description: "This page does not exist.", path: "/404.html", nav_home: "", nav_docs: "",
  body: src("404.html"),
});

// The playground makes no requests after it loads; say so in a policy the browser enforces.
// (frame-ancestors only works as a header, so it is left out here.)
const CSP_APP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
// archspec's build writes a bare document (no doctype or head), so the site gives it one
// with the charset; without it, hosts that send no charset show "â€¦" for "…".
const HEAD = `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  `<meta http-equiv="Content-Security-Policy" content="${CSP_APP}">\n<link rel="canonical" href="${SITE}/playground/">\n` +
  `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(src("favicon.svg"))}">\n`;   // img-src allows data: only
let playground = read("web", "dist", "archspec-playground.html").replace(/<title>[^<]*<\/title>/i, "<title>archspec playground</title>");
playground = /<head(\s[^>]*)?>/i.test(playground)
  ? playground.replace(/<head(\s[^>]*)?>/i, (h) => `${h}\n${HEAD}`)
  : `<!doctype html>\n<html lang="en">\n<head>\n${HEAD}</head>\n${playground}\n</html>\n`;
if (!playground.includes(CSP_APP)) throw new Error("could not add the Content-Security-Policy to the playground");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "docs"), { recursive: true });
mkdirSync(join(OUT, "playground"), { recursive: true });
writeFileSync(join(OUT, "index.html"), index);
writeFileSync(join(OUT, "docs", "index.html"), docs);
writeFileSync(join(OUT, "404.html"), notFound);
writeFileSync(join(OUT, "playground", "index.html"), playground);
for (const f of ["style.css", "site.js", "favicon.svg"]) copyFileSync(join(HERE, "src", f), join(OUT, f));
writeFileSync(join(OUT, "CNAME"), "archspec.io\n");
writeFileSync(join(OUT, ".nojekyll"), "");
writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  ["/", "/docs/", "/playground/"].map((p) => `  <url><loc>${SITE}${p}</loc></url>\n`).join("") + `</urlset>\n`);
// Every internal link must land on a page and, for #fragments, on an id in it.
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const pages = { "/": index, "/docs/": docs, "/404.html": notFound };
const broken = [];
for (const [from, html] of Object.entries(pages)) {
  for (const [, href] of html.matchAll(/\shref="([^"]+)"/g)) {
    if (/^(https?:|mailto:|data:)/.test(href)) continue;
    const [path, frag] = href.split("#");
    const target = path === "" ? from : path;
    if (!existsSync(join(OUT, target.endsWith("/") ? target + "index.html" : target))) broken.push(`${from} → ${href}`);
    else if (frag && pages[target] && !ids(pages[target]).has(frag)) broken.push(`${from} → ${href}`);
  }
}
if (broken.length) { console.error(`broken links:\n  ${broken.join("\n  ")}`); process.exit(1); }
console.log(`wrote ${OUT}: landing, docs (${toc.length} sections, ${exampleCount} examples), playground; ${ruleCount} rules`);
