# WhatsApp Agent

Application locale d'agent WhatsApp : prospection, automatisations, réponses automatiques et console Green-API.

## Démarrage rapide

```bash
cd whatsapp-prospect-agent
npm run setup
npm run dev
```

Ouvrez **http://localhost:3000**

1. Cliquez sur la carte **WhatsApp** pour ouvrir le workspace
2. Configurez OpenAI et Green-API via **Connexions**

## Configuration (via l'interface)

1. Cliquez sur **Connexions**
2. Onglet **OpenAI** : collez votre clé `sk-...`
3. Onglet **Green-API** : Instance ID, Token, URL → **Connecter WhatsApp**
4. Onglet **Profil** : prénom, offre, tarif (pour les réponses auto)

Les identifiants sont stockés localement dans `data/agent.db`.

## Variables d'environnement (optionnelles)

```env
OPENAI_API_KEY=sk-...
GREEN_API_ID_INSTANCE=
GREEN_API_TOKEN=
GREEN_API_BASE_URL=https://api.green-api.com
PORT=3000
OPENAI_MODEL=gpt-4o
```

## Fonctionnalités WhatsApp

- **Agent IA** : instructions en langage naturel (prospection, groupes, contacts, programmation)
- **Automatisations** : campagnes de prospection groupe, vente sur mots-clés, suivi personnalisé
- **Console Green-API** : inbox, chats, groupes, statuts, envoi direct, 40+ méthodes API
- **Réponses automatiques** : conversation IA avec les prospects entrants
- **Bilan du jour** : statistiques SQLite en temps réel

## Exemples d'instructions

- « Liste mes groupes WhatsApp »
- « Envoie un message à +229XXXXXXXX : Bonjour… »
- « Prospecte tout le groupe X avec ce message… »
- « Bilan d'aujourd'hui »
- « Montre la conversation avec +229XXXXXXXX »
- « Poste le statut WhatsApp : … »
- « Programme un message à 6h30 »

## Base de données

**SQLite** — fichier local `data/agent.db`.

| Table | Contenu |
|---|---|
| `messages` | Conversations WhatsApp (entrant / sortant) |
| `contacts` | Pipeline prospection |
| `agent_conversation` | Instructions au chat agent |
| `automations` | Campagnes automatisées |
| `scheduled_messages` | Envois programmés |
| `settings` | Clés API + profil business |

API : `GET /api/reports/daily` · `GET /api/automations` · `GET /api/contacts/:phone/thread`

## Contacts & garde-fous

| Champ | Valeurs |
|---|---|
| status | `nouveau`, `en_conversation`, `interesse`, `stop` |
| auto_reply | 0/1 — réponse auto pour **ce** numéro |

### Réponse auto
1. Toggle **global** (panneau gauche)
2. **ET** `auto_reply = 1` sur le contact
3. **ET** statut ≠ `stop`

### Quota journalier
Maximum **30 messages sortants / jour**.

## Prérequis Green-API

- Instance sur [green-api.com](https://green-api.com)
- WhatsApp autorisé (QR scanné)
- État `authorized`
