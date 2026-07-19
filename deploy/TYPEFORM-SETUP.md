# Checklist — Configurer Typeform OAuth pour Klanvio

## Prérequis

- Backend Hostinger joignable (`PUBLIC_URL`)
- Front Netlify : `https://www.klanvio.com`
- Variables ajoutées au `.env` Hostinger puis rebuild Docker

## 1. Créer l’application Typeform

1. Va sur [https://admin.typeform.com](https://admin.typeform.com) et connecte-toi.
2. Ouvre le menu compte / **Account** → **Developer apps** (ou [https://admin.typeform.com/account#/section/apps](https://admin.typeform.com/account#/section/apps)).
3. Clique **Register a new app** / **Create application**.
4. Renseigne :
   - **App name** : `Klanvio`
   - **App website** : `https://www.klanvio.com`
   - Description courte (optionnel)
5. Dans **Redirect URI(s)**, ajoute **exactement** (copier-coller) :

```
https://klanvio-api.srv1820011.hstgr.cloud/api/integrations/typeform/callback
```

6. Enregistre. Copie **Client ID** et **Client Secret**.

## 2. Variables d’environnement (Hostinger)

Dans le `.env` du dossier Docker Klanvio :

```env
APP_URL=https://www.klanvio.com
TYPEFORM_CLIENT_ID=...   # depuis Typeform
TYPEFORM_CLIENT_SECRET=...
TOKENS_ENCRYPTION_KEY=... # fournie une seule fois — ne jamais changer ensuite
PUBLIC_URL=https://klanvio-api.srv1820011.hstgr.cloud
```

Puis :

```bash
cd /docker/klanvio
git pull
docker compose build --no-cache
docker compose up -d
```

## 3. Migration Supabase

Appliquer la migration `supabase/migrations/20260719120000_user_integrations.sql`
(via `npx supabase db push` ou SQL Editor).

## 4. Test manuel

1. Réglages → **Intégrations** → **Connecter** Typeform
2. Autoriser l’accès → retour app « Connecté » + liste des forms
3. **Actualiser** recharge la liste
4. **Déconnecter** puis reconnecter

### Si erreur « HTTP 400 » après acceptation

1. Dans Typeform → Developer Apps → ton app Klanvio, le Redirect URI doit être **exactement** :
   `https://klanvio-api.srv1820011.hstgr.cloud/api/integrations/typeform/callback`
2. Vérifie `TYPEFORM_CLIENT_ID` / `TYPEFORM_CLIENT_SECRET` dans le `.env` Hostinger (secret sans espace / guillemets).
3. Rebuild Docker après toute modif `.env`, puis réessaie **Connecter**.

## Scopes demandés

`forms:read` · `responses:read` · `accounts:read`

**Pas de `offline`** : Typeform renvoie souvent
`Forbidden: this kind of access tokens cannot have refresh tokens`.
L’access token dure ~7 jours ; au-delà, reconnecter Typeform dans Réglages.

Si Typeform était déjà connecté avec d’anciens scopes : **Déconnecter** puis **Connecter** à nouveau.

(Pas de webhooks pour cette itération — lecture à la demande via l’agent.)
