# Dette structure (vague 6 — backlog)

Items planifiés, non bloquants pour la stabilisation v2.1 :

- Découper `src/db.ts` et `src/tools.ts` par domaine
- Retirer l'UI legacy `public/` à la racine API en production
- Unifier `VITE_API_URL` → `https://api.klanvio.com` (Netlify + Vercel)
- npm workspaces pour `web/`, `admin/`, `support/`
- OpenTelemetry optionnel si le volume le justifie

Voir le plan de stabilisation (vagues 0–5) pour le périmètre livré.
