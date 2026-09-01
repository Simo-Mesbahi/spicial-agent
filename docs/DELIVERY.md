# Bilan de livraison — 1er septembre 2026

La révision décrite ici est validée localement. Une mise à jour du dépôt ne prouve pas sa publication : celle-ci et l’activation de Gemini sont contrôlées séparément. Le [rapport de recette du 1er septembre](QA-2026-09-01.md) détaille les résultats et les limites de cette passe ; le [rapport du 31 août](QA-2026-08-31.md) reste disponible pour l’historique.

## Livré

- Plateforme existante : [SAV SC Assistant AI](https://atlas-sav-sc-ai.mohammed-elmesbahi.chatgpt.site).
- Interface client, dossiers, espace conseiller fictif, laboratoire, documents et présentation du projet.
- Accueil éditorial avec trois aperçus interactifs, vérification guidée, comparaison avant/après d’un dossier, suggestions contextuelles et panneau de suivi repliable sur mobile.
- Base relationnelle, 8 scénarios initiaux et 12 documents fictifs versionnés.
- Connecteurs LLM OpenAI et compatibles, avec outils de consultation contrôlés.
- Mode actif par défaut : démonstration déterministe sans appel à un LLM.
- Budget IA 0 € appliqué par défaut au serveur : fournisseurs externes bloqués, connecteur Ollama local sans clé, lanceur isolé avec cloud désactivé et diagnostic séparant installation et génération réelle.
- Suivi conversationnel « Le dossier en clair » : synthèse factuelle construite côté serveur, version historique conservée, alerte de changement et nouvelle consultation. Changement de dossier dans le chat, réponses de réclamation mieux orientées et parcours « aide d’abord, humain lorsque nécessaire ou confirmé » piloté par une politique déterministe indépendante du LLM.
- Fiabilité des échanges : identifiants de messages, reprise sans doublon après erreur réseau, enregistrement atomique, historique sélectionné par dossier et absence de validation d’un devis sans montant.
- Fluidité : affichage immédiat de la réponse enregistrée, attente bornée, information hors ligne et d’actualisation interrompue, meilleur dimensionnement des contrôles sur mobile. Aperçu de partage propre au projet.
- Identité produit renommée **SAV SC Assistant AI** dans l’interface, les métadonnées, le partage social, les messages du moteur local et la documentation.
- Contact email dédié depuis l’accueil, la navigation et le relais conversationnel : aucun formulaire, dossier et dernier besoin préremplis, choix entre l’application du téléphone, Gmail et Outlook, versions web mobiles de secours, destinataire fixe visible, copie complète, aucune persistance applicative et confirmation finale dans la messagerie du visiteur.

## Vérifications exécutées

- 48 tests API et réponses : sessions, accès aux dossiers, isolation entre visiteurs, codes erronés, quotas, devis, transitions, rejeu, historique, simulation, relais conseiller, entrées invalides, expiration, versions des réponses, relances contextuelles, blocage des fournisseurs payants, masquage des secrets, continuité sans IA et contrats stricts d’appel d’outils simulés. Les nouveaux cas vérifient aussi l’aide avant transfert, la confirmation humaine et l’escalade immédiate d’une opération indisponible.
- 4 tests de lecture JSON bornée : UTF-8 fragmenté, limite exacte, annulation d’un flux trop volumineux ou bloqué et formats invalides.
- 12 tests d’expérience : cohérence des aperçus, étapes du guide, versions historiques, suggestions, recherche sans accents, champs autorisés des synthèses, fraîcheur, montants manquants et états terminaux.
- 10 tests de politique de budget, adresses locales, configuration conservée/sauvegardée et diagnostic Ollama simulé.
- 6 tests client : identifiants compatibles avec la prévisualisation HTTP, erreurs de session, lecture bloquée, réponses invalides, absence de rejeu automatique et fusion sans doublons.
- 5 tests de rendu serveur des synthèses : données courantes, alerte de changement, accès vérifié, historique compact et absence d’action de devis périmé.
- 5 tests du contact email : destinataire fixe, Unicode, cohérence des brouillons `mailto:`, Gmail et Outlook, liens d’applications mobiles, neutralisation des retours de ligne et bornes de validation.
- 5 tests de routage support : aide initiale, confirmation sans boucle, opérations humaines, absence de faux positif et devis sans montant.
- 6 tests du rendu serveur et des composants du socle, dont le sélecteur contextualisé sans formulaire.
- Vérification TypeScript, ESLint applicatif et compilation de production : réussies.
- Audit npm complet après mise à jour contrôlée du runtime et des outils de développement : aucune vulnérabilité connue signalée.
- Les trois migrations ont été appliquées avec succès sur l’émulateur D1 local. La nouvelle migration ajoute le registre `chat_requests` ; la base applicative comprend 12 tables.
- Parcours HTTP local de bout en bout : création de session, vérification d’un dossier, première demande de conseiller, réponse d’aide avec choix rapides, confirmation du relais et contrôle de l’entrée Contact dans le rendu serveur. La recette visuelle précédente reste documentée ; les nouveaux contrôles visuels seront rejoués après publication.

Total : **95 tests applicatifs et 6 tests du socle réussis**. La recette couvre le routage progressif, le contact sans formulaire, les brouillons cohérents pour trois familles de messageries, la copie de secours et le retour vers l’assistant. Un parcours utilisateur local a contrôlé l’ouverture de la page, l’aperçu, la copie complète et la poursuite dans l’assistant. Elle reste ciblée, pas exhaustive : Safari/iPhone physique, charge, appel à un modèle réel et audit indépendant restent à valider. Le workflow GitHub Actions est fourni ; le résultat de chaque exécution est consultable dans [Actions](https://github.com/Simo-Mesbahi/spicial-agent/actions). Les validations locales, les validations GitHub et la publication restent distinctes.
La satisfaction utilisateur n’est pas encore mesurée : le [protocole d’essai](EXPERIENCE.md) prépare cette évaluation, sans publier de résultat inventé.

## Blocages et limites

L’écriture vers `Simo-Mesbahi/spicial-agent` avait initialement été refusée avec `403 Resource not accessible by integration`. Une nouvelle vérification après réautorisation a confirmé que la création de contenu fonctionne désormais. L’autorisation de l’utilisateur dans la conversation ne remplace pas les droits de l’application GitHub. Les sources complètes et leur historique sont à consulter dans [le dépôt du projet](https://github.com/Simo-Mesbahi/spicial-agent) ; l’archive initiale reste une copie de la première livraison.

Aucun serveur Ollama n’est disponible dans l’environnement de livraison. Le diagnostic local a confirmé son absence ; les tests du connecteur simulent le fournisseur. Aucune qualité de génération ni latence réelle de modèle n’a été mesurée. Aucune clé payante n’est demandée pour le parcours local. La recherche documentaire est lexicale. La simulation automatique progresse à la consultation, sans processus permanent en arrière-plan.

Au contrôle de l’hébergement pendant cette recette, `GEMINI_API_KEY` n’était pas enregistrée et les paramètres conservés étaient `LLM_PROVIDER=demo` et `LLM_BUDGET_MODE=zero`. La création de la clé chez Google n’active pas l’application. Suivre le [guide Gemini](GEMINI-FREE.md) sans transmettre de secret dans le dépôt ou la conversation.

## Trois prochaines priorités

1. Maintenir une publication reproductible : contrôler le workflow CI de chaque modification et la cohérence entre les sources et la plateforme.
2. Enregistrer la clé Gemini côté serveur sans activer la facturation Google, puis évaluer réellement les réponses françaises, les sources, les appels d’outils, les quotas et la latence. Ollama reste l’alternative locale.
3. Faire une recette sur iPhone, puis préparer un pilote avec l’entreprise : documents validés, contrats d’API SAV/CRM, authentification réelle, contrôle d’accès et revue de sécurité.
