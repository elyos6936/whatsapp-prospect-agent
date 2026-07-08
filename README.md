# WhatsApp Agent / Agent Team

Application locale multi-agents. **WhatsApp** est le premier membre validé de l'équipe.

## Démarrage rapide

```bash
cd whatsapp-prospect-agent
npm install
npm run dev
```

Ouvrez **http://localhost:3000**

1. L'écran **Équipe** affiche WhatsApp (validé) + des emplacements libres
2. Cliquez sur la carte **WhatsApp** pour ouvrir le workspace chat
3. Configurez OpenAI + Green-API via **Connexions**

## Configuration (via l'interface)

1. Cliquez sur **Connexions**
2. Onglet **OpenAI** : collez votre clé `sk-...`
3. Onglet **Green-API** : renseignez Instance ID, Token et URL → **Connecter WhatsApp**

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

## Exemples d'instructions

- « Liste mes groupes WhatsApp »
- « Envoie un message à +229XXXXXXXX : Bonjour… »
- « Bilan d'aujourd'hui »
- « Montre la conversation avec +229XXXXXXXX »
- « Mon prénom est Awa, mon offre est … , tarif 25 000 FCFA »
- « Montre-moi les messages reçus aujourd'hui »
- « Liste mes contacts »
- « Enregistre +229… , boutique mode Cotonou, statut intéressé »
- « Arrête toute réponse automatique avec +229… »
- « Bloque +229… » / « Passe ce numéro en STOP »

## Base de données & rapports

**SQLite** — fichier local `data/agent.db` (déjà utilisé par l'app).

| Table | Contenu |
|---|---|
| `messages` | Conversations WhatsApp (entrant / sortant) |
| `contacts` | Pipeline prospection |
| `agent_conversation` | Instructions au chat agent uniquement |
| `scheduled_messages` | Envois programmés |
| `settings` | Clés API + profil business |

### Accès aux données
- Fichier : `whatsapp-prospect-agent/data/agent.db` (DB Browser for SQLite, DBeaver, etc.)
- API : `GET /api/reports/daily` · `GET /api/contacts/:phone/thread`
- Chat agent : « Bilan d'aujourd'hui » / « Conversation avec +229… »

Les échanges prospects **ne polluent plus** le chat agent : ils vivent en base pour bilans et rapports.

### Profil business
Connexions → onglet **Profil** (prénom, offre, tarif FCFA) — utilisé pour les réponses auto.

## Contacts & garde-fous (Étape 4)

### Contacts (table SQLite)
| Champ | Valeurs |
|---|---|
| status | `nouveau`, `en_conversation`, `interesse`, `stop` |
| auto_reply | 0/1 — réponse auto pour **ce** numéro |

Le panneau gauche liste les contacts connus. Un message entrant crée/met à jour automatiquement le contact.

### Réponse auto
1. Toggle **global** (panneau gauche)
2. **ET** `auto_reply = 1` sur le contact
3. **ET** statut ≠ `stop`

Sinon le message est enregistré en base sans réponse automatique.

### STOP
- Phrase prospect type « Je ne veux plus recevoir… » / « stop » → confirmation + statut `stop`
- « Arrête de répondre à +229… » → `set_auto_reply(false)`
- « Bloque +229… » → statut `stop` (aucun envoi possible, même demandé manuellement)

### Brouillon & anti-spam
- Message **rédigé par l'agent** : brouillon dans le chat, puis « ok » / « envoie »
- Texte **dicté mot pour mot** : envoi direct
- Espacement **45–120 s** entre deux envois sortants

### Quota journalier
Maximum **30 messages sortants / jour**. Au-delà : refus clair dans le chat.

## Réception des messages (Étape 3)

Polling Green-API (`receiveNotification` / `deleteNotification`) toutes les 3 s — pas besoin de webhook/ngrok en local.

- **Affichage temps réel** dans le chat WhatsApp :
  - **WhatsApp · Contact** = message entrant
  - **WhatsApp · Envoyé** = message sortant
- Outils agent : `get_chat_history`, `list_incoming_messages`

### Test rapide
1. Ouvrez le workspace **WhatsApp** (pas seulement l’écran Équipe)
2. Envoyez un SMS à votre compte depuis un second numéro
3. Le message doit apparaître sous ~3 s
4. Demandez : « Montre l'historique avec +229… » ou « Messages reçus aujourd'hui »

## Prérequis Green-API

- Instance sur [green-api.com](https://green-api.com)
- WhatsApp autorisé (QR scanné)
- État `authorized`
- URL de base selon l'instance (ex. `https://7107.api.greenapi.com`)
