# AI evaluation baseline — P0

Cette baseline fige le comportement conversationnel avant le remplacement progressif du moteur de règles par l’orchestrateur LLM structuré.

## Ce que la CI mesure maintenant

- routage conversationnel : small talk, changement de dossier, question métier, conversation ouverte ;
- détection de langue : français, anglais, allemand, espagnol, arabe ;
- normalisation multilingue vers le corpus métier ;
- conservation d’un sujet métier sur un follow-up contextuel ;
- contrats provider, tool-calling, grounding et fallback déjà couverts par les tests API.

Le fichier `tests/atlas-ai-eval-baseline.test.mjs` est volontairement petit : il sert de point zéro reproductible, pas de benchmark final.

## Étape suivante

Avant le refactor P1, enrichir cette baseline avec des conversations multi-tours annotées et des métriques distinctes :

- intent accuracy ;
- case selection accuracy ;
- tool selection accuracy ;
- retrieval recall/precision ;
- groundedness ;
- abstention quality ;
- context retention/switch ;
- language consistency ;
- escalation accuracy ;
- safety ;
- latence et tokens.

La règle de migration est : une nouvelle architecture ne remplace pas l’ancienne parce qu’elle paraît plus naturelle ; elle doit égaler ou dépasser la baseline sur les métriques critiques, sans régression de sécurité.
