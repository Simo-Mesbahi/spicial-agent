# Préparation d’un pilote entreprise

Cette version est une démonstration technique ; elle ne constitue pas une livraison de production ni une garantie de couverture exhaustive.

| Sujet        | Version de démonstration                          | À réaliser avec l’entreprise                                                                |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Identité     | Session anonyme et code fictif                    | Socle Supabase Auth/MFA prêt à valider ; SSO salariés et récupération à intégrer             |
| Métier       | Huit familles de scénarios                        | Inventaire des demandes, décisions autorisées, contrats de données, règles validées         |
| Données      | Base synthétique D1 ; schéma Supabase versionné   | Appliquer en préproduction, puis API SAV/CRM/commandes, synchronisation et réconciliation    |
| RAG          | Corpus versionné dans le code, recherche lexicale | Documents validés, ingestion, filtrage des droits, benchmark hybride/vectoriel              |
| Modèles      | Connecteurs configurables, tests simulés          | Accès fournisseur, licence, benchmark français/outils/coûts, politiques de données          |
| Réclamations | Demandes enregistrées sans envoi                  | Routage vers une vraie file de conseillers et engagements de traitement                     |
| Activité     | Progression à la consultation                     | Ordonnanceur ou événements du SI, reprise, déduplication et files d’erreur                  |
| Sécurité     | Sessions dossier, RLS et MFA codés en préproduction | Tests bout en bout, revue indépendante, tests d’intrusion et secrets managés                |
| Exploitation | Quotas, historique, état de service               | Alertes, budget fournisseur, sauvegardes testées, objectifs de service et runbooks          |
| Qualité      | Tests fonctionnels synthétiques                   | Jeu de validation indépendant validé par le métier, revue humaine et critères d’acceptation |

## Sélection du modèle

Comparer à contexte identique les réponses, les appels d’outils, les erreurs de faits, l’abstention, la latence et le coût total. Aucun modèle n’est déclaré « meilleur » avant ces mesures. Inclure le coût du matériel et de l’exploitation pour l’auto-hébergement. Ne pas transférer automatiquement une conversation à un autre fournisseur sans politique explicite.

## Matrice de couverture

Consultation opérationnelle : réparation, devis, échange, livraison, retour, remboursement, réclamation. Explication documentaire : garantie, compte/fidélité/facture, sécurité produit, disponibilités et contact. Les stocks, modifications de compte, paiements, annulations de commandes et remboursements réels ne sont pas exécutés dans cette version.

Le plan d’activation détaillé, les responsabilités et les critères de sortie sont dans [SUPABASE-PRODUCTION.md](SUPABASE-PRODUCTION.md).


## Reverse proxy et origine publique

Les mutations HTTP vérifient l’origine du navigateur avant tout traitement métier. Une terminaison TLS classique qui conserve exactement le même hôte public est prise en charge lorsque le navigateur utilise HTTPS et que le runtime interne observe HTTP.

Si un reverse proxy réécrit également l’hôte, configurer `APP_PUBLIC_ORIGIN` côté serveur avec l’origine publique canonique exacte, par exemple `https://support.example.com`. Les chemins, jokers, identifiants intégrés à l’URL et origines HTTP hors environnement `LOCAL` sont refusés. L’application ne fait pas confiance à `X-Forwarded-Host` pour décider qu’une mutation est de même origine.

Cette exception de proxy ne remplace ni `Sec-Fetch-Site`, ni les jetons CSRF des sessions concernées, ni les cookies `SameSite`.
