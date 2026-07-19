# Checklist — Configurer Google Sheets (Intégrations) pour Klanvio

Client OAuth **séparé** du login Google (`GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID`).
Même projet Google Cloud, **deux** OAuth Clients Web.

## Prérequis

- Backend Hostinger joignable (`PUBLIC_URL`)
- Front Netlify : `https://www.klanvio.com`
- `TOKENS_ENCRYPTION_KEY` déjà en place (Typeform)

## 1. Projet & APIs

1. Va sur [Google Cloud Console](https://console.cloud.google.com).
2. Sélectionne le projet Klanvio (ou crée-en un).
3. **APIs & Services → Library** — active :
   - **Google Sheets API**
   - **Google Drive API**
   - **Google Picker API**

## 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type : **External** → Create
3. App name : `Klanvio`, support email, developer contact
4. **Publishing status : Testing**
5. **Test users** : ajoute ton compte Google (+ collaborateurs)
6. **Scopes → Add or remove** :
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/spreadsheets`
7. **Ne pas** ajouter `drive` ni `drive.readonly` (restricted / audit CASA).

## 3. OAuth Client « Intégrations » (pas le client Login)

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**
2. Application type : **Web application**
3. Name : `Klanvio Integrations` (ou similaire)
4. **Authorized JavaScript origins** :
   - `https://www.klanvio.com`
   - `http://localhost:5173` (dev Vite)
5. **Authorized redirect URIs** — exact :

```
https://klanvio-api.srv1820011.hstgr.cloud/api/integrations/google/callback
```

(dev éventuel : `http://localhost:3001/api/integrations/google/callback`)

6. Create → copie **Client ID** et **Client secret**.

Le client Login existant (`GOOGLE_CLIENT_ID`) reste inchangé.

## 4. API Key pour le Picker

1. **Credentials → Create credentials → API key**
2. Restrict key :
   - **Application restrictions** → HTTP referrers : `https://www.klanvio.com/*`, `http://localhost:5173/*`
   - **API restrictions** → Google Picker API (et Drive/Sheets si demandé)
3. Copie la clé → `VITE_GOOGLE_PICKER_API_KEY`

## 5. Project number (Picker `setAppId`)

1. Menu hamburger → **IAM & Admin → Settings** (ou page d’accueil du projet)
2. Copie **Project number** (chiffres uniquement) — **pas** le Project ID
3. → `VITE_GOOGLE_CLOUD_PROJECT_NUMBER`

## 6. Variables Hostinger (API)

```env
GOOGLE_INTEGRATIONS_CLIENT_ID=...
GOOGLE_INTEGRATIONS_CLIENT_SECRET=...
# Optionnel :
# GOOGLE_INTEGRATIONS_REDIRECT_URI=https://klanvio-api.srv1820011.hstgr.cloud/api/integrations/google/callback
APP_URL=https://www.klanvio.com
PUBLIC_URL=https://klanvio-api.srv1820011.hstgr.cloud
TOKENS_ENCRYPTION_KEY=...   # déjà présent
```

Puis rebuild / redéploy du container API.

## 7. Variables Netlify (front)

```env
VITE_GOOGLE_PICKER_API_KEY=...
VITE_GOOGLE_CLOUD_PROJECT_NUMBER=...
# VITE_GOOGLE_CLIENT_ID reste celui du LOGIN (inchangé)
```

Rebuild du site.

## 8. Test

1. Réglages → Intégrations → **Connecter** Google Sheets
2. Consentement Google → retour « Connecté »
3. **Ajouter des feuilles** → Picker → sélection → liste persistée
4. Retirer un Sheet unitairement
5. Déconnecter → liste vidée

### Refresh token manquant

Si après Connecter tu vois une erreur « n’a pas renvoyé de refresh token » :

1. https://myaccount.google.com/permissions → révoquer Klanvio
2. Reconnecter depuis Intégrations (`prompt=consent` renverra un nouveau refresh)

## Limite

50 Sheets max par utilisateur.
