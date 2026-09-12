# Chat et recherche documentaire — recette du 12 septembre 2026

La réponse publiée est composée côté serveur à partir du dossier autorisé ou du texte documentaire retenu. Le modèle sélectionne des outils ; sa prose libre n'est ni publiée ni enregistrée comme réponse client. Une exécution d'outil ne suffit plus à rendre une affirmation fiable. Les sources citées correspondent au texte effectivement affiché et incluent leur date d'application.

La recherche lexicale indexe les mots des titres, tags et contenus, pondère les correspondances et reconnaît des variantes françaises. Elle ne confond plus une sous-chaîne avec un mot, élimine les doublons, limite les résultats et exclut les documents futurs. Aucun appel supplémentaire à un modèle de vérification ni changement du budget n'est introduit.

## Vérifications

- 130 tests applicatifs réussis, dont régressions contre les dates/statuts/garanties fabriqués après appel d'outil, contrôle de l'historique enregistré, requêtes hors périmètre et recherche documentaire.
- 10 tests de rendu et composants réussis.
- TypeScript, lint applicatif, compilation et contrôle du diff réussis.
- Navigateur : accueil → assistant de démonstration → fermeture du formulaire d'accès → question générale sur la garantie → réponse documentaire → ouverture de sa source/version/date → question sur Jupiter → aucune réponse astronomique inventée.
- Le parcours de questions générales ne nécessite pas de saisir le code du dossier. Les informations personnelles restent derrière la vérification existante.

## Périmètre réel

Le chat testé utilise les dossiers fictifs D1 et les 12 documents de démonstration. La recherche demeure lexicale, sans embeddings. Le suivi Supabase de production constitue un parcours distinct ; ce changement ne le connecte pas au chat. Les appels fournisseurs sont simulés dans les tests, avec des régressions sous workerd. Aucun test Gemini réel, compte administrateur réel, téléphone physique ou test de charge n'est revendiqué ici.

La composition contrôlée réduit les inventions du modèle ; elle ne prouve pas que les documents métier sont exacts, complets ou pertinents pour chaque question. Une validation métier et une recette de l'environnement final restent nécessaires avant de qualifier le chat pour des clients réels.
