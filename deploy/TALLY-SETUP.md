# Checklist — Configurer Tally pour Klanvio

Tally n’utilise **pas** d’OAuth serveur. Chaque utilisateur colle sa **clé API** dans Réglages → Intégrations.

## Pour l’utilisateur final (dans Tally)

1. Va sur [https://tally.so/settings/api-keys](https://tally.so/settings/api-keys)  
   (Settings → **API keys**)  
   Doc : [API keys](https://developers.tally.so/api-reference/api-keys)
2. Clique **Create API key**
3. Copie la clé (`tly-…`) — elle n’est plus visible ensuite
4. Dans Klanvio : **Réglages → Intégrations → Tally** → colle la clé → **Connecter**

Doc API : [Introduction](https://developers.tally.so/api-reference/introduction)  
Base URL : `https://api.tally.so` — header `Authorization: Bearer <token>`

## Côté serveur Klanvio

Aucun `TALLY_CLIENT_*` : il faut seulement :

```env
TOKENS_ENCRYPTION_KEY=...   # chiffrement de la clé API au repos
PUBLIC_URL=...
```

Pas de redirect URI à enregistrer chez Tally.
