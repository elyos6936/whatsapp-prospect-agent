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

### 2.2 Recommandé : terminal web Hostinger + git clone

Le code est publié sur GitHub (`elyos6936/whatsapp-prospect-agent`, branche `master`).

1. hPanel → VPS → **Terminal (navigateur)**, connecté en `root`.
2. Cloner (ou mettre à jour) le projet :

```bash
cd /opt
git clone https://github.com/elyos6936/whatsapp-prospect-agent.git klanvio 2>/dev/null || (cd klanvio && git pull)
cd /opt/klanvio
```

3. Vérifier Node ≥ 20 (sinon l'installer) :

```bash
node -v || (curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs)
```

4. Créer `/opt/klanvio/.env` :

```bash
cat > /opt/klanvio/.env <<'EOF'
PORT=3001
NODE_ENV=production
DATABASE_URL=postgresql://postgres.omquaouhfifynvrpqilv:jxVrk6pk1trYgp5W@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://omquaouhfifynvrpqilv.supabase.co
EVOLUTION_API_BASE_URL=https://evolution-api-kxse.srv1820011.hstgr.cloud
EVOLUTION_API_KEY=RvYzeDK63Gl3fBKJ7bVovn5kJbp8AMpO
EVOLUTION_INSTANCE_NAME=automax-prospection
CORS_ORIGINS=https://klanvio.netlify.app
PUBLIC_API_URL=https://klanvio-api.srv1820011.hstgr.cloud
EOF
```

> La clé OpenAI est déjà stockée dans la base Supabase (migrée). Si l'agent ne répond pas, ajoutez `OPENAI_API_KEY=sk-...` dans ce `.env`.

5. Installer les dépendances et démarrer avec PM2 :

```bash
cd /opt/klanvio
npm install --omit=dev
npm install -g pm2
pm2 start deploy/hostinger/ecosystem.config.cjs
pm2 save
pm2 startup   # exécutez la commande affichée
```

6. Test local sur le VPS :

```bash
curl http://127.0.0.1:3001/api/health
```

Pour redéployer plus tard : `cd /opt/klanvio && git pull && npm install --omit=dev && pm2 reload klanvio-api`.

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
