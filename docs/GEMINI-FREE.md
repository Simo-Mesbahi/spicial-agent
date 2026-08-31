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
2. Dans les réglages du site, ouvrir **Settings > Environment variables > Add variable**. Nom : `GEMINI_API_KEY`. Valeur : la clé copiée depuis Google AI Studio. Activer **Secret** si cette option est proposée, valider la variable puis toucher **Save changes** en haut de la page. Ne jamais placer la clé dans Git, le code du navigateur, une capture ou la conversation.
3. Vérifier que la variable est bien enregistrée dans l’hébergement. La création de la clé chez Google seule ne suffit pas. Conserver `LLM_PROVIDER=demo` et `LLM_BUDGET_MODE=zero` tant que cette étape n’est pas confirmée.
4. Une fois le secret enregistré, appliquer les paramètres ci-dessous, puis enregistrer les changements.
5. Publier la nouvelle configuration, puis vérifier le mode affiché, le premier appel et les erreurs de quota. Un badge de configuration valide ne prouve pas qu’une génération a réussi.

| Variable          | Valeur pour l’essai |
| ----------------- | ------------------- |
| `LLM_PROVIDER`    | `gemini`            |
| `LLM_BUDGET_MODE` | `free`              |
| `LLM_MODEL`       | `gemini-2.5-flash`  |
| `LLM_DAILY_LIMIT` | `100`               |

La clé reste exclusivement côté serveur. Les noms de variables ne doivent recevoir aucun préfixe de publication au navigateur.

## Budget et confidentialité

`free` est une politique d’activation AtlasCare, pas une preuve de gratuité du compte Google. Ne pas activer la facturation pour cet essai à budget nul. La disponibilité de l’offre gratuite dépend du modèle, de la région et des limites du fournisseur ; le quota applicatif ne garantit pas un plafond financier.

Documentation officielle vérifiée le 31 août 2026 : [tarifs et utilisation des données](https://ai.google.dev/gemini-api/docs/pricing), [niveaux de facturation](https://ai.google.dev/gemini-api/docs/billing), [API compatible OpenAI](https://ai.google.dev/gemini-api/docs/openai), [cycle de vie des modèles](https://ai.google.dev/gemini-api/docs/deprecations). Les modèles autorisés doivent être revérifiés avant une activation ultérieure.

Le fournisseur impose ses propres limites. AtlasCare conserve ses quotas par espace, par réseau et son plafond global journalier. Une erreur de fournisseur, de quota ou de validation ne change pas de modèle et ne déclenche aucun repli payant : AtlasCare affiche explicitement une réponse de secours déterministe, fondée sur les règles et les données fictives disponibles.

## Garde-fous de réponse

L’API Gemini compatible OpenAI peut appeler seulement `get_case` et `search_knowledge`. L’assistant n’obtient jamais un autre dossier ; les actions de devis et de relais restent des confirmations serveur séparées. Les codes à six chiffres, emails et formats de clés Gemini/OpenAI/Groq sont masqués avant transmission, avant réponse au navigateur et avant enregistrement. Les faits de dossier restent rendus en synthèses construites côté serveur. Les urgences produit et tentatives de contournement restent traitées localement, sans appel Gemini.

## Validation requise

Lancer les huit scénarios, les demandes de devis, les réponses sans dossier, la demande d’un autre dossier, la sécurité produit et le dépassement de quota. Vérifier que toute réponse métier cite l’outil nécessaire, qu’aucun délai/montant n’est inventé et que le message d’information Gemini est visible. Cette validation est distincte des tests automatiques : elle nécessite une clé valide mais jamais partagée dans les sources.
