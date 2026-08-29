# Checklist — Configurer Calendly OAuth pour Klanvio

## 1. Créer l’app OAuth Calendly

1. Ouvre [https://developer.calendly.com/](https://developer.calendly.com/)
2. **Sign Up / Log in** (compte **développeur** Calendly — distinct du compte Calendly utilisateur courant).
3. Va dans **My Apps** → **Create new app**  
   Doc : [Creating an OAuth App](https://developer.calendly.com/creating-an-oauth-app)
4. Remplis :
   - **Name** : `Klanvio`
   - **Kind of app** : **Web**
   - **Environment** : **Sandbox** d’abord, puis une 2ᵉ app **Production**
   - **Redirect URI** (exact, sans slash final) :

```
https://klanvio-api.srv1937804.hstgr.cloud/api/integrations/calendly/callback
```

   - Sandbox local OK : `http://localhost:3000/api/integrations/calendly/callback`
   - Production : **HTTPS obligatoire**

5. Copie **Client ID** et **Client Secret** tout de suite (le secret n’est plus réaffichable).

Scopes demandés par Klanvio : `users:read` · `event_types:read` · `scheduled_events:read` · `contacts:read`  
(réf. [Scopes](https://developer.calendly.com/scopes))

**Important** : après ajout de scopes, l’utilisateur doit **Déconnecter puis Connecter** Calendly dans Réglages pour re-consentir.

## 2. Variables Hostinger (Docker)

Dans le panel **Environment** Hostinger **et** dans `docker-compose.yml` → `environment:` (sinon le conteneur ignore les vars) :

```env
CALENDLY_CLIENT_ID=...
CALENDLY_CLIENT_SECRET=...
PUBLIC_URL=https://klanvio-api.srv1937804.hstgr.cloud
APP_URL=https://www.klanvio.com
TOKENS_ENCRYPTION_KEY=...   # déjà présent pour Typeform
```

Puis rebuild le conteneur :

```bash
docker compose up -d --build klanvio-api
# Vérifier (sans afficher le secret) :
docker exec klanvio-api printenv CALENDLY_CLIENT_ID
```

## 3. Test

Réglages → Intégrations → **Connecter** Calendly → autoriser → liste des types d’événements et contacts.
