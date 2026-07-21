import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const previewRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(previewRoot, "../LEADAIcodebase");
const sourceOrigin = process.env.PREVIEW_SOURCE ?? "http://127.0.0.1:3102";
const repositoryName = "leadai-gpt-preview";
const basePath = `/${repositoryName}`;
const productionOrigin = "https://www.leadai.cc";

const commonPages = [
  "",
  "/about",
  "/advisory",
  "/advisory/ai-listening",
  "/advisory/ai-workshop",
  "/advisory/ai-dialogue",
  "/advisory/contact",
];

const extendedPages = [
  "/atlas",
  "/atlas/framework",
  "/academy",
  "/assessment",
  "/cases",
  "/insights",
];

const caseSlugs = [
  "multi-ai-strategic-research",
  "ai-customized-slides",
  "three-ai-team-workflow",
  "openclaw-ai-ceo",
];

const insightRoot = path.join(sourceRoot, "content/insights");
const insightSlugs = (await readdir(insightRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const locales = [
  { locale: "zh-TW", prefix: "", pages: [...commonPages, ...extendedPages] },
  { locale: "en", prefix: "/en", pages: [...commonPages, ...extendedPages] },
  { locale: "ja", prefix: "/ja", pages: commonPages },
];

const routes = [];
for (const locale of locales) {
  for (const suffix of locale.pages) {
    routes.push(makeRoute(locale, suffix));
  }

  if (locale.locale !== "ja") {
    for (const slug of caseSlugs) {
      routes.push(makeRoute(locale, `/cases/${slug}`));
    }
    for (const slug of insightSlugs) {
      routes.push(makeRoute(locale, `/insights/${slug}`));
    }
  }
}

const capturedPaths = new Set(routes.map((route) => normalizeRoutePath(route.requestPath)));

function makeRoute(locale, suffix) {
  return {
    locale: locale.locale,
    prefix: locale.prefix,
    suffix,
    requestPath: `${locale.prefix}${suffix}` || "/",
  };
}

function normalizeRoutePath(value) {
  const pathname = value.split(/[?#]/, 1)[0] || "/";
  return pathname === "/" ? "/" : pathname.replace(/\/$/, "");
}

function isAssetPath(pathname) {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/shots/") ||
    pathname.startsWith("/og/") ||
    /\.[a-z0-9]{2,6}$/i.test(pathname)
  );
}

function splitPathAndSuffix(value) {
  const match = value.match(/^([^?#]*)(.*)$/);
  return { pathname: match?.[1] || "/", suffix: match?.[2] || "" };
}

function previewRouteUrl(pathname, suffix = "") {
  if (pathname === "/") return `${basePath}/${suffix}`;
  return `${basePath}${pathname.replace(/\/$/, "")}/${suffix}`;
}

function rewriteAbsoluteAttribute(attribute, value) {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith(`${basePath}/`)) {
    return `${attribute}="${value}"`;
  }

  const { pathname, suffix } = splitPathAndSuffix(value);
  if (isAssetPath(pathname)) {
    return `${attribute}="${basePath}${pathname}${suffix}"`;
  }

  const normalized = normalizeRoutePath(pathname);
  if (capturedPaths.has(normalized)) {
    return `${attribute}="${previewRouteUrl(normalized, suffix)}"`;
  }

  if (attribute === "href") {
    return `${attribute}="${productionOrigin}${pathname}${suffix}"`;
  }

  if (attribute === "action") {
    return `${attribute}="#"`;
  }

  return `${attribute}="${basePath}${pathname}${suffix}"`;
}

function localizeMenu(locale, prefix) {
  const labels = {
    "zh-TW": ["首頁", "框架", "課程", "顧問服務", "案例", "洞察", "關於"],
    en: ["Home", "Atlas", "Academy", "Advisory", "Cases", "Insights", "About"],
    ja: ["ホーム", "フレームワーク", "Academy", "アドバイザリー", "事例", "Insights", "概要"],
  }[locale];
  const suffixes = ["", "/atlas", "/academy", "/advisory", "/cases", "/insights", "/about"];

  return suffixes
    .map((suffix, index) => {
      const requested = `${prefix}${suffix}` || "/";
      const normalized = normalizeRoutePath(requested);
      const href = capturedPaths.has(normalized)
        ? previewRouteUrl(normalized)
        : `${productionOrigin}${requested}`;
      return `<a href="${href}">${labels[index]}</a>`;
    })
    .join("");
}

function languageHref(locale, suffix) {
  const prefix = locale === "zh-TW" ? "" : `/${locale}`;
  const requested = `${prefix}${suffix}` || "/";
  const normalized = normalizeRoutePath(requested);
  return capturedPaths.has(normalized)
    ? previewRouteUrl(normalized)
    : `${productionOrigin}${requested}`;
}

function transformHtml(source, route) {
  let html = source;

  // A GitHub Pages snapshot should not hydrate the production application or call its APIs.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<link\b[^>]*\bas="script"[^>]*>/gi, "");
  html = html.replace(/<link\b[^>]*googletagmanager[^>]*>/gi, "");

  // Resolve Next's image optimizer URLs back to the checked-in source assets.
  html = html.replace(
    /\/_next\/image\?url=([^&"'\s]+)(?:&amp;|&)w=\d+(?:&amp;|&)q=\d+/gi,
    (_match, encodedUrl) => {
      const decodedUrl = decodeURIComponent(encodedUrl);
      return decodedUrl.startsWith("/") ? `${basePath}${decodedUrl}` : decodedUrl;
    },
  );

  html = html.replace(
    /\b(href|src|poster|action)="([^"]*)"/gi,
    (_match, attribute, value) => rewriteAbsoluteAttribute(attribute.toLowerCase(), value),
  );

  html = html.replace(/<title>([\s\S]*?)<\/title>/i, "<title>GPT Preview · $1</title>");
  html = html.replace(/type="submit"/gi, 'type="button" aria-disabled="true"');

  const zhHref = languageHref("zh-TW", route.suffix);
  const enHref = languageHref("en", route.suffix);
  const jaHref = languageHref("ja", route.suffix);
  const menuLinks = localizeMenu(route.locale, route.prefix);

  const previewStyles = `
    <meta name="robots" content="noindex,nofollow,noarchive" />
    <style>
      .gpt-preview-dock{position:fixed;right:18px;bottom:18px;z-index:9999;display:flex;align-items:center;gap:7px;padding:8px 9px 8px 13px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(10,22,35,.94);box-shadow:0 14px 40px rgba(3,12,20,.28);color:#f5f0e7;font:600 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;backdrop-filter:blur(14px)}
      .gpt-preview-dock>span{margin-right:4px;color:#d6af63}.gpt-preview-dock a{padding:6px 8px;border-radius:999px;color:#f5f0e7;text-decoration:none;transition:background .18s ease}.gpt-preview-dock a:hover,.gpt-preview-dock a[aria-current="true"]{background:rgba(255,255,255,.14)}
      .gpt-static-mobile-menu{position:fixed;inset:64px 0 auto 0;z-index:9998;display:grid;gap:1px;padding:12px;background:#f3efe7;border-bottom:1px solid rgba(18,31,43,.14);box-shadow:0 18px 34px rgba(8,19,29,.14)}
      .gpt-static-mobile-menu a{padding:14px 16px;border-radius:8px;color:#12202c;font:600 14px/1.2 system-ui,sans-serif;text-decoration:none}.gpt-static-mobile-menu a:hover{background:#fff}
      .gpt-preview-toast{position:fixed;left:50%;bottom:82px;z-index:10000;transform:translateX(-50%);padding:10px 14px;border-radius:8px;background:#12202c;color:#f5f0e7;font:500 12px/1.4 system-ui,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.22)}
      @media(max-width:640px){.gpt-preview-dock{right:10px;bottom:10px;left:10px;justify-content:center}.gpt-preview-dock>span{display:none}}
    </style>`;

  const previewDock = `
    <aside class="gpt-preview-dock" aria-label="GPT preview controls">
      <span>GPT STATIC PREVIEW</span>
      <a href="${zhHref}"${route.locale === "zh-TW" ? ' aria-current="true"' : ""}>繁中</a>
      <a href="${enHref}"${route.locale === "en" ? ' aria-current="true"' : ""}>EN</a>
      <a href="${jaHref}"${route.locale === "ja" ? ' aria-current="true"' : ""}>日本語</a>
      <a href="${productionOrigin}" rel="noreferrer">正式站 ↗</a>
    </aside>
    <template id="gpt-static-menu-template"><div class="gpt-static-mobile-menu">${menuLinks}</div></template>
    <script>
      (() => {
        const toggle = document.querySelector('button[aria-label="Toggle menu"]');
        let panel;
        toggle?.addEventListener('click', () => {
          if (panel) {
            panel.remove();
            panel = undefined;
            toggle.setAttribute('aria-expanded', 'false');
            return;
          }
          panel = document.querySelector('#gpt-static-menu-template').content.firstElementChild.cloneNode(true);
          document.body.append(panel);
          toggle.setAttribute('aria-expanded', 'true');
        });

        document.addEventListener('click', (event) => {
          const button = event.target.closest('button');
          if (!button || button === toggle || button.closest('.gpt-preview-dock')) return;
          const toast = document.createElement('div');
          toast.className = 'gpt-preview-toast';
          toast.textContent = '此為視覺比較版；互動、表單與登入功能已停用。';
          document.body.append(toast);
          window.setTimeout(() => toast.remove(), 2200);
        });
      })();
    </script>`;

  html = html.replace("</head>", `${previewStyles}</head>`);
  html = html.replace("</body>", `${previewDock}</body>`);
  return html;
}

function outputFileForRoute(requestPath) {
  const normalized = normalizeRoutePath(requestPath);
  if (normalized === "/") return path.join(previewRoot, "index.html");
  return path.join(previewRoot, normalized.slice(1), "index.html");
}

async function copyDirectoryContents(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      cp(path.join(source, entry.name), path.join(destination, entry.name), {
        recursive: true,
        force: true,
      }),
    ),
  );
}

async function renderRoute(route, index) {
  const response = await fetch(new URL(route.requestPath, sourceOrigin), {
    headers: { accept: "text/html" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`${route.requestPath} returned ${response.status}`);
  }

  const html = transformHtml(await response.text(), route);
  const outputFile = outputFileForRoute(route.requestPath);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, html, "utf8");
  console.log(`[${index + 1}/${routes.length}] ${route.requestPath} -> ${path.relative(previewRoot, outputFile)}`);
}

await copyDirectoryContents(path.join(sourceRoot, "public"), previewRoot);
await cp(path.join(sourceRoot, "app/favicon.ico"), path.join(previewRoot, "favicon.ico"));
await cp(path.join(sourceRoot, "app/icon.svg"), path.join(previewRoot, "icon.svg"));
await copyDirectoryContents(
  path.join(sourceRoot, ".next/static/css"),
  path.join(previewRoot, "_next/static/css"),
);
await copyDirectoryContents(
  path.join(sourceRoot, ".next/static/media"),
  path.join(previewRoot, "_next/static/media"),
);

const concurrency = 6;
let cursor = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (cursor < routes.length) {
      const index = cursor++;
      await renderRoute(routes[index], index);
    }
  }),
);

const notFoundTemplate = await readFile(path.join(previewRoot, "index.html"), "utf8");
const notFound = notFoundTemplate
  .replace(/<title>[\s\S]*?<\/title>/i, "<title>GPT Preview · Page not found</title>")
  .replace(
    /<main\b[\s\S]*?<\/main>/i,
    `<main style="min-height:100vh;display:grid;place-items:center;padding:7rem 1.5rem;background:#f3efe7;color:#12202c"><section style="max-width:42rem;text-align:center"><p style="font:600 11px ui-monospace,monospace;letter-spacing:.16em;color:#087f83">GPT STATIC PREVIEW · 404</p><h1 style="margin:1.2rem 0 .8rem;font:500 clamp(2.4rem,8vw,5rem)/.95 Georgia,serif">這個互動頁未收錄在靜態預覽。</h1><p style="margin:0 auto 2rem;max-width:34rem;line-height:1.75;color:rgba(18,32,44,.65)">回到 GPT 版本首頁繼續比較，或前往正式網站使用完整功能。</p><p><a href="${basePath}/" style="display:inline-block;margin:.3rem;padding:.8rem 1.1rem;border-radius:999px;background:#12202c;color:#fff;text-decoration:none">回到預覽首頁</a><a href="${productionOrigin}" style="display:inline-block;margin:.3rem;padding:.8rem 1.1rem;border:1px solid rgba(18,32,44,.2);border-radius:999px;color:#12202c;text-decoration:none">前往正式站</a></p></section></main>`,
  );
await writeFile(path.join(previewRoot, "404.html"), notFound, "utf8");
await writeFile(path.join(previewRoot, "robots.txt"), "User-agent: *\nDisallow: /\n", "utf8");

console.log(`Generated ${routes.length} pages for ${basePath}/`);
