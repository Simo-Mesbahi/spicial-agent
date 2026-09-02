# SAV SC Assistant AI — critères d’expérience

## Intention

Donner envie d’essayer en montrant une situation compréhensible, puis permettre de vérifier que le dossier fait foi. La satisfaction ne peut pas être garantie : elle doit être observée avec des utilisateurs.

## Parcours livré

- Accueil utilisable avant la création d’une session : trois aperçus fictifs et interactifs, sans appel à un modèle.
- Démarrage sur le scénario choisi, code fictif disponible, contrôle serveur et première consultation après validation explicite.
- Guide en contexte : vérification, consultation, puis orientation vers les autres dossiers ou une décision client autorisée. Aucune commande opérateur n’est proposée dans l’édition publique.
- Devis : aucune progression automatique sans confirmation ; aucune opération financière réelle.
- Conversation : suggestions liées au dossier, réponses courtes aux salutations, sources consultables et erreurs explicites.
- Suivi « Le dossier en clair » : état consulté, explication, prochaine étape prévue, action du client et montant pertinent. L’estimation reste explicitement non garantie ; son absence n’est pas remplacée par une date inventée. Les réponses de statut déterministes privilégient cette synthèse et conservent le texte intégral dépliable.
- Historique fiable : synthèse figée à la version consultée, alerte lorsque le dossier évolue et nouvelle consultation en un clic. Un ancien devis n’expose plus son bouton d’examen. Les anciennes conversations sans synthèse restent lisibles.
- Changement de dossier directement dans la conversation avec contrôle d’accès inchangé. Suggestions spécifiques aux réclamations, échanges et retraits ; le suivi d’une réclamation ne déclenche plus à tort une proposition de relais.
- Résolution avant transfert : à la première demande de contact, l’assistant propose son aide et trois prochaines étapes pertinentes. Si le client confirme son choix, le relais apparaît immédiatement. Une modification de commande, de compte ou de paiement, une contestation, un devis sans montant ou une situation de sécurité déclenche directement l’orientation humaine. Le transfert métier reste simulé.
- Mobile : conversation prioritaire, panneau du dossier repliable, saisie en 16 px. Thèmes clair, sombre et système ; navigation clavier et préférence de réduction des animations prises en compte dans le code.
- Contact : page dédiée accessible depuis l’accueil, la navigation et les réponses de relais. Depuis le chat, le dossier et le dernier besoin sont préremplis pour éviter la répétition. Le destinataire et l’aperçu sont visibles, le visiteur choisit sa messagerie et son compte d’envoi, et aucun message ne part avant confirmation. En secours, destinataire, objet et corps se copient séparément dans les bons champs.

## Essai utilisateur à organiser

Commencer avec cinq personnes qui ne connaissent pas le projet. Ce petit groupe sert à trouver des incompréhensions, pas à prouver une satisfaction universelle. Ne collecter aucune information client réelle et ne pas enregistrer une personne sans son accord.

1. Montrer l’accueil sans explication : « Que pensez-vous pouvoir faire ici ? »
2. Demander de suivre la réparation d’un lave-linge et de trouver la prochaine étape.
3. Demander de simuler une évolution et de vérifier que la réponse a changé.
4. Proposer le devis : vérifier que le testeur comprend ce qui nécessite son accord.
5. Demander si une livraison retardée possède une date confirmée.
6. Refaire un parcours sur téléphone et au clavier.
7. Masquer le guide, changer de dossier depuis la conversation, puis retrouver son premier suivi. Vérifier que le code est encore demandé pour un dossier non vérifié.
8. Faire évoluer le dossier après une réponse : demander au testeur de distinguer l’ancien état consulté du nouvel état et de retrouver la nouvelle réponse.
9. Demander « Je souhaite un conseiller » : vérifier que l’assistant propose d’abord une aide utile, puis que « Continuer avec un conseiller » ouvre le relais sans recommencer le triage.
10. Demander de modifier une adresse de livraison : vérifier que l’assistant explique pourquoi un humain est requis et préremplit le contact avec le bon dossier.

Relever pour chaque tâche : réussite sans aide, temps observé, endroit du blocage, erreur affichée, compréhension du caractère fictif et commentaire libre. Demander ensuite une note de facilité sur cinq et la principale amélioration souhaitée. Aucun suivi analytique externe n’est installé par cette livraison.

## Critères avant une présentation commerciale

- Chaque parcours essentiel réalisable sans intervention du présentateur.
- Aucun devis accepté involontairement, aucune date inventée, aucune confusion entre simulation et opération réelle.
- Aucun blocage de navigation, champ masqué ou débordement sur les tailles d’écran testées.
- Les erreurs de connexion ou de code offrent une explication et une reprise possible.
- Les réponses du LLM réel, lorsqu’il sera activé, sont évaluées séparément sur un jeu de questions métier validé.

Les tests automatiques vérifient le code et les contrats métier. Ils ne remplacent ni cette observation utilisateur ni un audit d’accessibilité.
