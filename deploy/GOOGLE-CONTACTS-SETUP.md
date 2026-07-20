# Checklist — Configurer Google Contacts (People API) pour Klanvio

Complète la config Sheets (`deploy/GOOGLE-SHEETS-SETUP.md`). Même client OAuth **Intégrations** (`GOOGLE_INTEGRATIONS_*`), scopes **incrémentaux**.

## Prérequis

- Google Sheets déjà opérationnel (même projet Cloud, même OAuth Client Intégrations)
- Backend Hostinger joignable (`PUBLIC_URL`)
- `TOKENS_ENCRYPTION_KEY` en place

## 1. Activer l’API People

1. [Google Cloud Console](https://console.cloud.google.com) → projet Klanvio
2. **APIs & Services → Library**
3. Active **People API** (`people.googleapis.com`)

Ne réactive pas l’ancienne « Contacts API » (dépréciée depuis 2021).

## 2. OAuth consent screen — scope

1. **APIs & Services → OAuth consent screen → Scopes → Add or remove**
2. Ajoute :

```
https://www.googleapis.com/auth/contacts
```

(écriture People / My Contacts — `contacts.readonly` **ne suffit pas**)

3. Garde les scopes Sheets existants (`drive.file`, `spreadsheets`, openid/email/profile)
4. Si l’app est en **Testing** : les test users peuvent consentir immédiatement
5. Scope Contacts est souvent **sensible** → en production, validation Google peut être requise

## 3. Variables d’environnement

**Aucune nouvelle variable** si Sheets est déjà configuré :

```env
GOOGLE_INTEGRATIONS_CLIENT_ID=...
GOOGLE_INTEGRATIONS_CLIENT_SECRET=...
# GOOGLE_INTEGRATIONS_REDIRECT_URI=...   # optionnel
APP_URL=https://www.klanvio.com
PUBLIC_URL=https://klanvio-api.srv1820011.hstgr.cloud
TOKENS_ENCRYPTION_KEY=...
```

Puis rebuild / redéploy du container API.

## 4. Migration DB

Appliquer `supabase/migrations/20260720120000_google_contacts.sql` :

- `users.google_contacts_prompt_done`
- table `google_contacts_ensured` (idempotence)
- `oauth_pending_states.purpose`

Le backend fait aussi un `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` au besoin.

## 5. Comportement produit

| Action | Effet |
|--------|--------|
| Gate post-WhatsApp → Connecter | OAuth `for=contacts` (scope seul si Google déjà lié, `include_granted_scopes=true`) |
| Gate → Passer | Flag `google_contacts_prompt_done` ; campagne sans écriture Contacts |
| Réglages → Intégrations → Google Contacts | Même OAuth incrémental |
| Campagne (avant `enqueueSend`) | Si scope présent : search → create si absent ; sinon no-op |

## 6. Test

1. Compte avec WhatsApp connecté → gate Google Contacts
2. **Passer** → accès app ; plus de gate ; message d’avertissement vu
3. Réglages → Intégrations → **Connecter / Autoriser Contacts**
4. Consentement Google (scope Contacts) → retour « Google Contacts connecté »
5. Lancer une petite campagne test → vérifier dans contacts.google.com que la fiche (nom + numéro) apparaît
6. Relancer / même numéro → pas de doublon (cache `google_contacts_ensured` + search People)

### Compte Google = téléphone WhatsApp

L’utilisateur doit lier le **compte Google synchronisé avec le téléphone** où WhatsApp est installé. Un autre compte Google crée des contacts inutiles pour l’anti-blocage WhatsApp.

### Refresh / scopes

- Tokens Sheets existants sont **conservés** (`include_granted_scopes` + merge des scopes en base)
- Si Google ne renvoie pas le nouveau scope : révoquer Klanvio sur [myaccount.google.com/permissions](https://myaccount.google.com/permissions) puis reconnecter Contacts
