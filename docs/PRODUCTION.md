# Préparation d’un pilote entreprise

Cette version est une démonstration technique ; elle ne constitue pas une livraison de production ni une garantie de couverture exhaustive.

| Sujet        | Version de démonstration                          | À réaliser avec l’entreprise                                                                |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Identité     | Session anonyme et code fictif                    | SSO salariés, identité client, récupération et autorisations par enseigne/magasin           |
| Métier       | Huit familles de scénarios                        | Inventaire des demandes, décisions autorisées, contrats de données, règles validées         |
| Données      | Base synthétique                                  | API SAV/CRM/commandes, environnement de test, synchronisation et réconciliation             |
| RAG          | Corpus versionné dans le code, recherche lexicale | Documents validés, ingestion, filtrage des droits, benchmark hybride/vectoriel              |
| Modèles      | Connecteurs configurables, tests simulés          | Accès fournisseur, licence, benchmark français/outils/coûts, politiques de données          |
| Réclamations | Demandes enregistrées sans envoi                  | Routage vers une vraie file de conseillers et engagements de traitement                     |
| Activité     | Progression à la consultation                     | Ordonnanceur ou événements du SI, reprise, déduplication et files d’erreur                  |
| Sécurité     | Contrôles applicatifs et tests locaux             | Revue indépendante, tests d’intrusion, secrets managés, menace et abus                      |
| Exploitation | Quotas, historique, état de service               | Alertes, budget fournisseur, sauvegardes testées, objectifs de service et runbooks          |
| Qualité      | Tests fonctionnels synthétiques                   | Jeu de validation indépendant validé par le métier, revue humaine et critères d’acceptation |

## Sélection du modèle

Comparer à contexte identique les réponses, les appels d’outils, les erreurs de faits, l’abstention, la latence et le coût total. Aucun modèle n’est déclaré « meilleur » avant ces mesures. Inclure le coût du matériel et de l’exploitation pour l’auto-hébergement. Ne pas transférer automatiquement une conversation à un autre fournisseur sans politique explicite.

## Matrice de couverture

Consultation opérationnelle : réparation, devis, échange, livraison, retour, remboursement, réclamation. Explication documentaire : garantie, compte/fidélité/facture, sécurité produit, disponibilités et contact. Les stocks, modifications de compte, paiements, annulations de commandes et remboursements réels ne sont pas exécutés dans cette version.
