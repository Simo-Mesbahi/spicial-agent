# Gemini gratuit dans AtlasCare

## Périmètre

Ce connecteur est prévu pour la démonstration publique avec des données fictives uniquement. Google indique que les données de l’offre gratuite peuvent être utilisées pour améliorer ses produits. Ne transmettre ni client réel, ni référence réelle, ni moyen de paiement, ni document interne.

Le serveur ne reconnaît que :

- `LLM_PROVIDER=gemini`
- `LLM_BUDGET_MODE=free`
- `LLM_MODEL=gemini-2.5-flash` ou `gemini-2.5-flash-lite`
- `GEMINI_API_KEY` comme secret serveur

L’endpoint est figé sur `https://generativelanguage.googleapis.com/v1beta/openai`. Aucun champ de l’interface ou de l’API AtlasCare ne peut modifier le fournisseur, le budget, le modèle ou la clé. OpenAI et les endpoints compatibles génériques restent bloqués en budget `zero`.

## Activation contrôlée

1. Créer une clé dans Google AI Studio sans activer de facturation.
2. Ajouter `GEMINI_API_KEY` comme secret de l’environnement de production : jamais dans Git, le navigateur, une capture ou la conversation.
3. Définir `LLM_PROVIDER=gemini`, `LLM_BUDGET_MODE=free`, `LLM_MODEL=gemini-2.5-flash` et un plafond `LLM_DAILY_LIMIT` conservateur.
4. Publier, puis vérifier le mode affiché, le premier appel et les erreurs de quota.

Le fournisseur impose ses propres limites. AtlasCare conserve ses quotas par espace, par réseau et son plafond global journalier. Une erreur de fournisseur ou de quota ne change pas de modèle et ne déclenche aucun repli payant.

## Garde-fous de réponse

L’API Gemini compatible OpenAI peut appeler seulement `get_case` et `search_knowledge`. L’assistant n’obtient jamais un autre dossier ; les actions de devis et de relais restent des confirmations serveur séparées. Les codes à six chiffres et emails sont masqués avant enregistrement et avant transmission au modèle. Les faits de dossier restent rendus en synthèses construites côté serveur.

## Validation requise

Lancer les huit scénarios, les demandes de devis, les réponses sans dossier, la demande d’un autre dossier, la sécurité produit et le dépassement de quota. Vérifier que toute réponse métier cite l’outil nécessaire, qu’aucun délai/montant n’est inventé et que le message d’information Gemini est visible. Cette validation est distincte des tests automatiques : elle nécessite une clé valide mais jamais partagée dans les sources.
