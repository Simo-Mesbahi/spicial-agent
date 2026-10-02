# SAV SC Assistant AI — périmètre et décisions actuels

SAV SC Assistant AI est une plateforme SAV et service client qui sépare volontairement quatre usages : présentation commerciale, démonstration fictive, accès client à un dossier et administration interne. Les données de démonstration restent synthétiques ; aucune intégration fictive ne doit être présentée comme une connexion réelle à un SI client.

## Surfaces

- `/` : vitrine commerciale statique, indépendante des fournisseurs IA et de Supabase au premier affichage ;
- `/demo` : expérience interactive sur scénarios fictifs ;
- `/trial` : demande d’essai accompagné vers le contact commercial confirmé ;
- `/file` : entrée client par référence + code, avec contrôles serveur et session bornée ;
- `/admin` : administration protégée, rôles et MFA.

La publication de la vitrine n’autorise pas à elle seule les capacités P1 auprès de vrais clients.

## Données et autorisations

Le dépôt conserve un socle D1/SQLite historique pour la démonstration, les fixtures et certains tests. Le plan de données production-aligned est Supabase PostgreSQL : organisations, dossiers, sessions client, corpus documentaire, Auth administrative, rôles, RLS, RPC serveur et audit technique.

Les décisions métier et mutations restent côté serveur. Le LLM ne devient jamais la source d’autorité pour l’identité du dossier, les droits, les montants, les dates, les garanties, la publication documentaire ou les actions métier.

Voir [SUPABASE-PRODUCTION.md](SUPABASE-PRODUCTION.md).

## Assistant et RAG

L’orchestration sépare compréhension structurée, autorisation/dossier, faits métier, recherche documentaire, génération naturelle, validation factuelle et orientation humaine.

Le moteur documentaire conserve un mode lexical et dispose d’un mode hybride explicite pour le corpus Supabase configuré. Le chemin hybride est borné : un embedding de requête maximum, filtrage gouverné, canaux lexical/vectoriel, RRF, provenance, seuil de pertinence et abstention/dégradation contrôlée.

Les embeddings sont indépendants du fournisseur de chat. Le baseline P1 documenté utilise `gemini-embedding-2` en 768 dimensions et impose une réindexation contrôlée lorsqu’un espace vectoriel change.

Voir [P1-HYBRID-RETRIEVAL.md](P1-HYBRID-RETRIEVAL.md).

## Fournisseurs et budget

Le routage administrable prend en charge Gemini, Groq et OpenAI selon clés, allowlists, modèles et politique de budget. `LLM_BUDGET_MODE=zero` bloque les API hébergées ; `free` et `approved` ouvrent uniquement les combinaisons autorisées par la politique serveur.

Le failover éventuel est désactivé par défaut et borné à un seul secours. Il ne doit pas masquer un 429/quota, une erreur de clé/droit, une requête invalide, un refus ou une sortie invalide. Pendant une qualification P1 liée à un provider/modèle exact, le secours automatique reste désactivé.

Voir [admin-llm-routing.md](admin-llm-routing.md).

## P1 et release

P1 est une frontière de release, pas une simple fonctionnalité d’interface. Une CI verte, un dry-run ou un diagnostic ciblé fournisseur ne vaut pas qualification client.

La chaîne reste :

`P1.7A Live Qualification → P1.7B Documentary freshness/revalidation → P1.7C Customer Release Gate → P1.7D Canary rollout`

Tant que cette chaîne n’est pas terminée sur la configuration exacte de release, la vitrine doit présenter les capacités avancées comme soumises à qualification.

Voir [P1-CONTROLLED-RELEASE.md](P1-CONTROLLED-RELEASE.md).

## Principes non négociables

- pas de données client réelles dans la démonstration publique ;
- pas de secret côté navigateur ou dans Git ;
- aucune action métier autorisée uniquement parce qu’un modèle l’a proposée ;
- provenance documentaire et abstention plutôt qu’invention ;
- séparation des environnements et des flags de release ;
- aucune baisse de seuil, suppression de test ou désactivation de protection pour obtenir un état vert ;
- publication GitHub/Sites et qualification P1 traitées comme des étapes distinctes.

## Limites à rendre visibles

Les tests synthétiques et la CI ne remplacent pas une validation hosted complète, un benchmark de charge, une recette appareil physique, un test d’intrusion ou une revue de sécurité indépendante. Les intégrations SAV/CRM, engagements humains et notifications réelles dépendent du SI et des responsabilités définies avec chaque entreprise.
