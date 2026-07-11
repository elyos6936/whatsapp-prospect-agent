# Déploiement Klanvio — guide pas à pas

Architecture :

```
https://klanvio.netlify.app          →  frontend (Netlify)
https://klanvio-api.srv1820011.hstgr.cloud  →  API Node (Hostinger VPS)
Supabase omquaouhfifynvrpqilv        →  PostgreSQL
Evolution API (même VPS)             →  WhatsApp
```

---

## État actuel

| Étape | Statut |
|-------|--------|
| Schéma Supabase (`npx supabase db push`) | ✅ Fait |
| Code migré vers PostgreSQL (`src/pg.ts`) | ✅ Fait |
| Frontend Netlify `klanvio.netlify.app` | ✅ Déployé |
| Données SQLite → Supabase | ⏳ À faire (besoin `DATABASE_URL`) |
| Backend API sur Hostinger | ⏳ À faire (SSH requis) |
| HTTPS API + Nginx | ⏳ À faire sur le VPS |

---

## ÉTAPE 1 — Migrer vos données vers Supabase (sur votre PC)

### 1.1 Récupérer la connection string

1. Ouvrez https://supabase.com/dashboard/project/omquaouhfifynvrpqilv/settings/database
2. **Connection string** → **URI**
3. Mode **Transaction pooler** (port **6543**)
4. Copiez l’URL et remplacez `[YOUR-PASSWORD]` par le mot de passe DB du projet

### 1.2 Ajouter dans `.env` (racine du projet)

```env
DATABASE_URL=postgresql://postgres.omquaouhfifynvrpqilv:VOTRE_MOT_DE_PASSE@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
```

### 1.3 Lancer la migration

```powershell
cd C:\Projets\whatsapp-prospect-agent
npm run db:migrate
```

Vous devez voir `✅ Migration terminée` avec les comptes (contacts, messages, etc.).

### 1.4 Vérifier le schéma (optionnel)

```powershell
npx supabase db push
```

Réponse attendue : `Remote database is up to date.`

---

## ÉTAPE 2 — Déployer l’API sur Hostinger (VPS)

> **Prérequis** : accès SSH au VPS `srv1820011.hstgr.cloud`.  
> Sur Windows : installez **OpenSSH Client** (Paramètres → Applications → Fonctionnalités optionnelles → Client OpenSSH), ou utilisez le **terminal web Hostinger** (hPanel → VPS → Terminal).

### 2.1 Depuis votre PC (si SSH installé)

```powershell
cd C:\Projets\whatsapp-prospect-agent

# Clé SSH Hostinger (remplacez par votre user si différent de root)
$env:HOSTINGER_SSH = "root@srv1820011.hstgr.cloud"

# Avec Git Bash ou WSL :
bash deploy/hostinger/deploy.sh
```

### 2.2 Alternative : terminal web Hostinger

1. hPanel → VPS → **Terminal** (ou SSH depuis un autre PC)
2. Sur le VPS, une première fois :

```bash
mkdir -p /opt/klanvio
cd /opt/klanvio
# Uploadez le projet (zip, git clone, ou rsync depuis votre PC)
```

3. Créez `/opt/klanvio/.env` (copiez `deploy/hostinger/env.example` et remplissez) :

```env
PORT=3001
NODE_ENV=production
DATABASE_URL=postgresql://postgres.omquaouhfifynvrpqilv:[MOT_DE_PASSE]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://omquaouhfifynvrpqilv.supabase.co
OPENAI_API_KEY=sk-...
EVOLUTION_API_BASE_URL=https://evolution-api-kxse.srv1820011.hstgr.cloud
EVOLUTION_API_KEY=votre_cle
EVOLUTION_INSTANCE_NAME=votre_instance
CORS_ORIGINS=https://klanvio.netlify.app
PUBLIC_API_URL=https://klanvio-api.srv1820011.hstgr.cloud
```

4. Installez et démarrez :

```bash
cd /opt/klanvio
npm install --omit=dev
npm install -g pm2
pm2 start deploy/hostinger/ecosystem.config.cjs
pm2 save
pm2 startup   # suivez les instructions affichées
```

5. Test local sur le VPS :

```bash
curl http://127.0.0.1:3001/api/health
```

### 2.3 Nginx + HTTPS

```bash
sudo cp /opt/klanvio/deploy/hostinger/nginx-klanvio.conf /etc/nginx/sites-available/klanvio-api
sudo ln -sf /etc/nginx/sites-available/klanvio-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d klanvio-api.srv1820011.hstgr.cloud
```

### 2.4 Webhook Evolution API

Dans l’interface Klanvio (Connexions) ou Evolution :

```
https://klanvio-api.srv1820011.hstgr.cloud/api/evolution/webhook
```

---

## ÉTAPE 3 — Netlify (frontend)

Déjà en place : **https://klanvio.netlify.app**

### Variable d’environnement Netlify (pour les prochains builds)

```powershell
cd C:\Projets\whatsapp-prospect-agent
npx netlify env:set KLANVIO_API_URL "https://klanvio-api.srv1820011.hstgr.cloud" --context production
```

### Redéployer le frontend

```powershell
$env:KLANVIO_API_URL="https://klanvio-api.srv1820011.hstgr.cloud"
npm run deploy:netlify
```

---

## ÉTAPE 4 — Vérification finale

| Test | URL / commande |
|------|----------------|
| Frontend | https://klanvio.netlify.app |
| Config API | https://klanvio.netlify.app/config.js → doit contenir `klanvio-api.srv1820011.hstgr.cloud` |
| API health | https://klanvio-api.srv1820011.hstgr.cloud/api/health |
| Connexions | Ouvrir Klanvio → Connexions → OpenAI + Evolution → QR WhatsApp |

---

## Dépannage

### `npx supabase db query` → erreur 403

Normal sur certains comptes. Utilisez **`DATABASE_URL` + `npm run db:migrate`** (pas le mode linked CLI).

### API Hostinger : erreur SSL

Le backend ou certbot n’est pas encore configuré. Finissez l’étape 2.3.

### CORS depuis Netlify

Vérifiez `CORS_ORIGINS=https://klanvio.netlify.app` dans le `.env` du VPS.

### Pas de SSH sur Windows

- Installez OpenSSH Client, **ou**
- Utilisez le terminal web Hostinger, **ou**
- Déployez depuis WSL / Git Bash.

---

## Commandes utiles

```powershell
# Schéma Supabase
npx supabase link --project-ref omquaouhfifynvrpqilv
npx supabase db push

# Données
npm run db:migrate

# Frontend
npm run deploy:netlify

# Backend (Linux / Git Bash)
npm run deploy:hostinger
```
