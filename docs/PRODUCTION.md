# Préparation d’un pilote entreprise

Le projet dispose désormais d’un socle de préproduction nettement plus avancé qu’une simple démonstration, mais cela ne constitue pas encore une autorisation de généralisation client. La vitrine publique, la démonstration fictive, le socle Supabase et la release P1 ont des gates distincts.

| Sujet | État actuel | Avant généralisation entreprise |
| --- | --- | --- |
| Vitrine | `/` statique, preuves desktop/mobile/clavier et absence d’appel IA/API à la première vue | Publier via Sites puis vérifier la version réellement servie |
| Démonstration | `/demo`, scénarios et données fictifs | Ne jamais y injecter de dossier client réel |
| Accès client | Référence + code, sessions bornées, contrat serveur | Valider hosted sur l’environnement production exact, anti-abus et restauration |
| Identité admin | Supabase Auth, rôles, MFA/AAL2 | SSO/récupération selon l’entreprise, moindre privilège et revue des comptes |
| Données | D1 historique pour démo/tests + schéma Supabase production-aligned | Projet production séparé, migrations gelées, API SAV/CRM et réconciliation |
| RAG | Lexical + hybride borné disponible, provenance et filtres gouvernés | Qualification corpus exact, plans SQL/ANN, seuils, p50/p95/p99 et charge |
| Embeddings | Fournisseur séparé, baseline `gemini-embedding-2` 768 dimensions | Quotas, réindexation contrôlée et validation de l’espace exact de release |
| Génération | Gemini/Groq/OpenAI routables selon politique, validation factuelle et abstention | Qualification live provider/modèle exact, revue humaine, canary |
| Failover | Optionnel, un seul secours, exclusions fail-closed | N’activer que pour les fournisseurs/données explicitement approuvés |
| Réclamations/handoff | Orientation humaine déterministe, aucune promesse d’action inexistante | Connecter une vraie file et définir SLA/responsabilités |
| Sécurité | RLS/MFA/sessions/origine/CSRF et tests automatisés | Pentest/revue indépendante, secrets managés, alertes, rotation et restauration |
| Exploitation | CI, quotas, diagnostics, preuves de release | SLO, alertes, runbooks, capacité, coûts et plan de retour arrière |
| Gouvernance GitHub | CI complète et preuves vitrine | Protéger `main` / ruleset ; suivi dans l’issue #109 |

## Release P1

`P1_RELEASE_MODE` ne doit être activé pour de vrais clients qu’après qualification de la configuration exacte. Une CI verte ou un diagnostic ciblé ne suffit pas.

La séquence de release est :

`P1.7A Live Qualification → P1.7B Documentary freshness/revalidation → P1.7C Customer Release Gate → P1.7D Canary rollout`

Les preuves doivent rester liées au fournisseur, modèle, corpus, environnement et espace d’embedding qualifiés. Une modification de ces éléments peut invalider une attestation précédente.

Voir [P1-CONTROLLED-RELEASE.md](P1-CONTROLLED-RELEASE.md).

## Sélection et qualification des modèles

Comparer à contexte identique : exactitude factuelle, abstention, sorties structurées, respect des outils, multilingue, latence, quotas et coût total. Aucun modèle n’est déclaré « meilleur » uniquement parce que son transport répond ou qu’un smoke test passe.

Le routage administratif distingue Gemini, Groq et OpenAI et peut configurer un secours borné. Le secours ne doit pas transformer une erreur de quota, d’authentification, de requête, un refus ou une sortie invalide en réussite artificielle. Pendant les modes P1 qui lient l’attestation à un fournisseur/modèle exact, le failover automatique reste désactivé.

## RAG et corpus

Le mode hybride existe déjà mais son existence dans le code ne prouve pas son aptitude à la charge production. Avant activation généralisée :

1. vérifier la complétude de l’index dans l’espace d’embedding exact ;
2. valider les filtres organisation/statut/révision/date/locale/marché ;
3. mesurer précision/recall avec labels relus ;
4. inspecter les plans PostgreSQL représentatifs ;
5. mesurer p50/p95/p99 sous volumes réalistes et concurrence ;
6. valider le comportement de dégradation lorsque l’embedding ou Supabase est indisponible ;
7. rejouer grounding, validation factuelle et abstention sur les langues supportées.

Voir [P1-HYBRID-RETRIEVAL.md](P1-HYBRID-RETRIEVAL.md).

## Matrice métier

La plateforme peut présenter et encadrer des consultations de réparation, devis, échange, livraison, retour, remboursement et réclamation selon les données/règles autorisées. Les stocks, paiements, annulations de commandes, remboursements réels ou modifications de compte ne doivent jamais être exécutés simplement parce qu’un modèle les propose.

Chaque intégration entreprise doit définir :

- source de vérité ;
- opérations en lecture/écriture ;
- rôles autorisés ;
- idempotence et versionnement ;
- erreurs et reprises ;
- délais/SLA ;
- journal d’audit ;
- politique de rétention ;
- responsable humain en cas d’escalade.

## Reverse proxy et origine publique

Les mutations HTTP vérifient l’origine du navigateur avant tout traitement métier. Une terminaison TLS qui conserve le même hôte public est prise en charge lorsque le navigateur utilise HTTPS et que le runtime interne observe HTTP.

Si un reverse proxy réécrit l’hôte, configurer `APP_PUBLIC_ORIGIN` côté serveur avec l’origine publique canonique exacte, par exemple `https://support.example.com`. Les chemins, jokers, identifiants intégrés à l’URL et origines HTTP hors environnement `LOCAL` sont refusés. L’application ne fait pas confiance à `X-Forwarded-Host` pour décider qu’une mutation est de même origine.

Cette exception ne remplace ni `Sec-Fetch-Site`, ni les protections CSRF des sessions concernées, ni les cookies `SameSite`.

## Passage préproduction → production

1. figer les migrations et paramètres qualifiés ;
2. créer des environnements production séparés, avec secrets et comptes distincts ;
3. appliquer les migrations sans données fictives ;
4. connecter les SI autorisés avec moindre privilège ;
5. valider Auth/MFA/RLS et contrats métier en hosted ;
6. qualifier corpus, embeddings et génération sur la configuration exacte ;
7. exécuter charge, sécurité, sauvegarde/restauration et observabilité ;
8. obtenir revue métier et sécurité ;
9. utiliser canary + rollback plutôt qu’une ouverture générale directe.

Le guide Supabase détaillé est dans [SUPABASE-PRODUCTION.md](SUPABASE-PRODUCTION.md).

## Limites de preuve

Les tests de repository, le build, les dry-runs, les navigateurs CI et les diagnostics fournisseurs constituent des preuves importantes de non-régression. Ils ne remplacent ni une charge à l’échelle réelle, ni un audit externe, ni un pentest, ni une recette sur appareils physiques, ni la validation opérationnelle d’une entreprise cliente.
