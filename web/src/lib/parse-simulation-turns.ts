/** Parse les tours de simulation affichés dans le chat agent (Toi → / Prospect →). */

export type PhoneBubble = {
  id: string;
  role: 'you' | 'prospect';
  text: string;
  name?: string;
};

const TURN_RE =
  /^(?:Toi|Moi|You)\s*→\s*[«"]\s*([\s\S]*?)\s*[»"]\s*$|^(?!Toi|Moi|You)(.+?)\s*→\s*[«"]\s*([\s\S]*?)\s*[»"]\s*$/gim;

/** Extrait les bulles depuis un message assistant (format simulation Klanvio). */
export function parseSimulationTurnsFromText(content: string): PhoneBubble[] {
  const text = String(content ?? '');
  if (!/→\s*[«"]/.test(text)) return [];

  const bubbles: PhoneBubble[] = [];
  const lines = text.split(/\n+/);
  let idx = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('---') || line.startsWith('*(') || line.startsWith('•')) continue;

    const you = /^(?:Toi|Moi|You)\s*→\s*[«"]([\s\S]*?)[»"]\s*$/i.exec(line);
    if (you) {
      const t = you[1].trim();
      if (t) {
        bubbles.push({ id: `sim-${idx++}`, role: 'you', text: t });
      }
      continue;
    }

    const prospect = /^(.+?)\s*→\s*[«"]([\s\S]*?)[»"]\s*$/.exec(line);
    if (prospect) {
      const name = prospect[1].trim();
      const t = prospect[2].trim();
      if (t && !/^(toi|moi|you)$/i.test(name)) {
        bubbles.push({
          id: `sim-${idx++}`,
          role: 'prospect',
          text: t,
          name: name || 'Prospect',
        });
      }
    }
  }

  return bubbles.length >= 1 ? bubbles : [];
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
