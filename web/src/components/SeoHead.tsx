import { useEffect } from 'react';

const SITE = 'https://www.klanvio.com';

export type SeoHeadProps = {
  title: string;
  description: string;
  path: string;
  /** Default: index,follow,max-image-preview:large */
  robots?: string;
  /** Si false, ne touche pas au link canonical (ex. pages 404). */
  updateCanonical?: boolean;
};

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

/** Met à jour title / description / canonical / OG pour les routes SPA secondaires. */
export function SeoHead({
  title,
  description,
  path,
  /** Préserver max-image-preview (Google Images / vignettes SERP). */
  robots = 'index,follow,max-image-preview:large',
  updateCanonical = true,
}: SeoHeadProps) {
  useEffect(() => {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const url = `${SITE}${normalized === '/' ? '/' : normalized}`;
    document.title = title;
    upsertMeta('name', 'description', description);
    upsertMeta('name', 'robots', robots);
    if (updateCanonical) {
      upsertLink('canonical', url);
      upsertMeta('property', 'og:url', url);
    }
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);
  }, [title, description, path, robots, updateCanonical]);

  return null;
}
