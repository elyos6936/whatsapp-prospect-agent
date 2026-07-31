/** Parse les tours de simulation (fence klanvio-sim ou fil Toi → / Prospect →). */

export type PhoneBubble = {
  id: string;
  role: 'you' | 'prospect';
  text: string;
  name?: string;
};

const SIM_FENCE_RE = /```klanvio-sim\s*\n([\s\S]*?)```/gi;

/** Ligne de tour : flèche ou deux-points, guillemets optionnels. */
const YOU_LINE_RE =
  /^(?:Toi|Moi|You)\s*(?:→|->|:)\s*[«"“]?\s*(.+?)\s*[»"”]?\s*$/i;
const PROSPECT_LINE_RE =
  /^(.+?)\s*(?:→|->|:)\s*[«"“]?\s*(.+?)\s*[»"”]?\s*$/;

function parseTurnLines(block: string): PhoneBubble[] {
  const bubbles: PhoneBubble[] = [];
  const lines = block.split(/\n+/);
  let idx = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('---') || line.startsWith('*(') || line.startsWith('•')) {
      continue;
    }
    if (/^```/.test(line)) continue;

    const you = YOU_LINE_RE.exec(line);
    if (you) {
      const t = you[1].replace(/^[«"“]\s*/, '').replace(/\s*[»"”]$/, '').trim();
      if (t) bubbles.push({ id: `sim-${idx++}`, role: 'you', text: t });
      continue;
    }

    const prospect = PROSPECT_LINE_RE.exec(line);
    if (prospect) {
      const name = prospect[1].trim();
      if (/^(toi|moi|you)$/i.test(name)) continue;
      const t = prospect[2].replace(/^[«"“]\s*/, '').replace(/\s*[»"”]$/, '').trim();
      if (t) {
        bubbles.push({
          id: `sim-${idx++}`,
          role: 'prospect',
          text: t,
          name: name || 'Prospect',
        });
      }
    }
  }
  return bubbles;
}

/** Extrait les bulles depuis un message assistant (format simulation Klanvio). */
export function parseSimulationTurnsFromText(content: string): PhoneBubble[] {
  const text = String(content ?? '');
  if (!text.trim()) return [];

  const fenceBlocks: string[] = [];
  let m: RegExpExecArray | null;
  const fenceRe = new RegExp(SIM_FENCE_RE.source, 'gi');
  while ((m = fenceRe.exec(text)) !== null) {
    if (m[1]?.trim()) fenceBlocks.push(m[1]);
  }
  if (fenceBlocks.length > 0) {
    const bubbles = parseTurnLines(fenceBlocks[fenceBlocks.length - 1]!);
    if (bubbles.length >= 1) return bubbles;
  }

  if (!/(?:→|->|:)\s*[«"“]?/.test(text) && !/^(?:Toi|Moi|You|Prospect)\b/im.test(text)) {
    return [];
  }

  return parseTurnLines(text);
}

/**
 * Retire le payload simulation du texte affiché dans le chat
 * (le téléphone lit le contenu brut non strippé).
 */
export function stripSimulationPayloadForChat(content: string): string {
  let out = String(content ?? '');
  out = out.replace(/```klanvio-sim\s*\n[\s\S]*?```/gi, '').trim();

  const kept: string[] = [];
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line) {
      kept.push('');
      continue;
    }
    if (/^(?:Toi|Moi|You)\s*(?:→|->|:)\s*/i.test(line)) continue;
    if (/^Prospect(?:\s*\d+)?\s*(?:→|->|:)\s*/i.test(line)) continue;
    if (/^.+?\s*(?:→|->)\s*[«"“].+[»"”]\s*$/.test(line)) continue;
    if (/^\*\(Simulation/i.test(line)) continue;
    if (/^---+$/.test(line)) continue;
    kept.push(raw);
  }

  out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

/** Dernière simulation trouvée en parcourant les messages assistant du plus récent au plus ancien. */
export function extractLatestSimulationBubbles(
  messages: Array<{ kind: string; content: string }>,
): PhoneBubble[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind !== 'assistant') continue;
    const bubbles = parseSimulationTurnsFromText(m.content);
    if (bubbles.length >= 2) return bubbles;
  }
  return [];
}
