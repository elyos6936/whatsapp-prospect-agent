/**
 * Prerender SEO — génère un index.html par route marketing dans dist/.
 * Usage : npm run build (appelé automatiquement après vite build)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPrerenderPages } from '../src/lib/seo-prerender-pages.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');
const SITE = 'https://www.klanvio.com';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function upsertMeta(html: string, attr: 'name' | 'property', key: string, content: string): string {
  const escaped = escapeHtml(content);
  const re = new RegExp(`<meta ${attr}="${key}"[^>]*>`, 'i');
  const tag = `<meta ${attr}="${key}" content="${escaped}" />`;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace('</head>', `    ${tag}\n  </head>`);
}

function upsertLink(html: string, rel: string, href: string): string {
  const re = new RegExp(`<link rel="${rel}"[^>]*>`, 'i');
  const tag = `<link rel="${rel}" href="${href}" />`;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace('</head>', `    ${tag}\n  </head>`);
}

function patchHtml(
  baseHtml: string,
  page: { path: string; title: string; description: string; robots?: string; bodyHtml: string },
): string {
  const url = `${SITE}${page.path === '/' ? '/' : page.path}`;
  let html = baseHtml;

  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(page.title)}</title>`);
  html = upsertMeta(html, 'name', 'description', page.description);
  html = upsertMeta(html, 'name', 'robots', page.robots ?? 'index,follow,max-image-preview:large');
  html = upsertLink(html, 'canonical', url);
  html = upsertMeta(html, 'property', 'og:url', url);
  html = upsertMeta(html, 'property', 'og:title', page.title);
  html = upsertMeta(html, 'property', 'og:description', page.description);
  html = upsertMeta(html, 'name', 'twitter:title', page.title);
  html = upsertMeta(html, 'name', 'twitter:description', page.description);

  const rootInner = `
      <main id="seo-prerender" style="max-width:48rem;margin:0 auto;padding:1.5rem;font-family:system-ui,sans-serif;line-height:1.6;color:#0a0f1a">
        ${page.bodyHtml.trim()}
        <hr style="margin:2rem 0;border:none;border-top:1px solid #e2e8f0" />
        <p style="font-size:0.875rem;color:#64748b"><a href="/">Klanvio</a> — Agent WhatsApp IA</p>
      </main>`;

  html = html.replace(
    /<div id="root">[\s\S]*?<\/div>/i,
    `<div id="root">${rootInner}\n    </div>`,
  );

  return html;
}

function routeToFilePath(routePath: string): string {
  if (routePath === '/') return path.join(DIST, 'index.html');
  const segments = routePath.replace(/^\//, '').split('/');
  return path.join(DIST, ...segments, 'index.html');
}

function main(): void {
  const basePath = path.join(DIST, 'index.html');
  if (!fs.existsSync(basePath)) {
    console.error('❌ dist/index.html introuvable — lancez vite build d’abord.');
    process.exitCode = 1;
    return;
  }

  const baseHtml = fs.readFileSync(basePath, 'utf8');
  const pages = getPrerenderPages();

  for (const page of pages) {
    const outPath = routeToFilePath(page.path);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, patchHtml(baseHtml, page), 'utf8');
    console.log(`  ✓ ${page.path} → ${path.relative(DIST, outPath)}`);
  }

  console.log(`\n✅ Prerender SEO : ${pages.length} page(s) marketing`);
}

main();
