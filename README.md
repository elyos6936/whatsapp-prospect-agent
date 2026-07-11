# WhatsApp Agent

Application locale d'agent WhatsApp : prospection, automatisations, réponses automatiques via **Evolution API**.

## Démarrage rapide

```bash
cd whatsapp-prospect-agent
npm run setup
npm run dev
```

Ouvrez **http://localhost:3000**

1. Cliquez sur la carte **WhatsApp**
2. **Connexions** → OpenAI + Evolution API
3. **Connecter WhatsApp (QR)** → scannez le QR code

## Configuration Evolution API

Dans **Connexions → Evolution API** :

- URL du serveur (ex. Hostinger)
- Clé API (`apikey`)
- Nom de l'instance
- Bouton **Connecter WhatsApp (QR)** pour lier votre compte

Variables `.env` optionnelles :

```env
OPENAI_API_KEY=sk-...
EVOLUTION_API_BASE_URL=https://votre-serveur.com
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE_NAME=mon-instance
PORT=3000
```

## Fonctionnalités

- **Agent IA** : instructions en langage naturel
- **Console WhatsApp** : inbox, chats, groupes, statuts, envoi test, QR
- **Automatisations** : campagnes groupe, séquences, ROI

## Prérequis

- Node.js 20+
- Serveur [Evolution API](https://doc.evolution-api.com) (VPS / Hostinger)
- Clé OpenAI
