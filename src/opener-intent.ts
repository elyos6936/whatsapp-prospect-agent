/**
 * Accroche dictée par l'utilisateur + 5 variantes (chemin symbolique).
 * MiniMax ne doit ni réécrire l'angle a/b/c, ni demander de recoller 1–5.
 */

const QUOTE_RE = /[«"']([^»"']{2,200})[»"']/;

export function extractUserDictatedOpener(msg: string): string | null {
  const t = String(msg ?? "").trim();
  if (!t || t.length > 320) return null;

  const labeled = t.match(
    /\b(?:juste\s+(?:un|une|le|la)|premier\s+message|message\s+(?:d['’]ouverture|d['’]accroche)|accroche)\s*[:\-–]?\s*[«"']([^»"']{2,200})[»"']/i
  );
  if (labeled?.[1]?.trim()) return tidyOpener(labeled[1]);

  if (
    /\b(juste\s+un|c['’]est\s+ce\s+que\s+je\s+veux|comme\s+premier\s+message|comme\s+accroche)\b/i.test(
      t
    )
  ) {
    const q = t.match(QUOTE_RE);
    if (q?.[1]?.trim()) return tidyOpener(q[1]);
  }
  return null;
}

export function extractUserDictatedOpenerFromHistory(
  history: Array<{ role: string; content: string }>,
  userMessage?: string
): string | null {
  if (userMessage) {
    const current = extractUserDictatedOpener(userMessage);
    if (current) return current;
  }
  for (let i = history.length - 1; i >= 0 && i >= history.length - 16; i--) {
    const m = history[i];
    if (m?.role !== "user") continue;
    const hit = extractUserDictatedOpener(m.content);
    if (hit) return hit;
  }
  return null;
}

function tidyOpener(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/^[«"'\s]+|[»"'\s]+$/g, "").trim();
}

const GREETING_VARIANTS = [
  "Bonjour, comment ça va ?",
  "Salut, tu vas bien ?",
  "Hello, comment tu vas ?",
  "Coucou, ça va ?",
  "Hey, tu vas bien ?",
];

/** Exactement 5 textes : v1 = phrase validée, le reste = mêmes intention, autre formulation. */
export function generateOpenerVariants(base: string): string[] {
  const t = tidyOpener(base);
  if (!t) return [];
  const out: string[] = [t];
  const seen = new Set([t.toLowerCase()]);
  const push = (s: string) => {
    const x = tidyOpener(s);
    if (!x || seen.has(x.toLowerCase()) || out.length >= 5) return;
    seen.add(x.toLowerCase());
    out.push(x);
  };

  if (/bonjour|salut|hello|coucou|hey|comment\s+[çc]a\s+va|tu\s+vas\s+bien/i.test(t)) {
    for (const g of GREETING_VARIANTS) push(g);
  } else {
    push(t.replace(/^bonjour\b/i, "Salut"));
    push(t.replace(/^salut\b/i, "Bonjour"));
    push(t.endsWith("?") ? t : `${t.replace(/[.!]+$/, "")} ?`);
    push(t.replace(/\s*[—–-]\s*/g, ", "));
    const lower = t.charAt(0).toLowerCase() + t.slice(1);
    push(`Dis-moi, ${lower}`);
  }

  let i = 0;
  while (out.length < 5 && i < GREETING_VARIANTS.length) {
    push(GREETING_VARIANTS[i]!);
    i++;
  }
  return out.slice(0, 5);
}

export function formatOpenerVariantsReply(base: string): string | null {
  const variants = generateOpenerVariants(base);
  if (variants.length < 5) return null;
  const lines = variants.map((v, i) => `${i + 1}. ${v}`);
  return (
    "Voici les **5 variantes** qui seront utilisées (le 1er message = l'une d'elles, en rotation) :\n\n" +
    `${lines.join("\n")}\n\n` +
    "Dis **« je valide »** si l'ensemble te va, ou corrige une ligne."
  );
}
