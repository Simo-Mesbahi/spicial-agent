# Administration métier

Cette évolution complète les opérations existantes. La gestion des équipes et la
recette avec de vrais comptes administrateurs restent reportées à la demande du
propriétaire. Les contrôles automatisés utilisent exclusivement des données
synthétiques, sans appel à un fournisseur IA.

| Écran | Fonctions |
| --- | --- |
| `/admin/records` | Recherche paginée, création et correction des clients et produits ; gestion des magasins par le super-administrateur. |
| `/admin/operations` | Correction des fiches liées, réassociation client/produit, restauration des dossiers archivés, exports filtrés et actions groupées. |
| `/admin/reports` | Synthèse sur 7/30/90 jours, tableaux d’activité, export CSV et impression/PDF par le navigateur. |

## Droits et intégrité

- Chaque RPC vérifie l’organisation, l’appartenance active, le niveau MFA et les
  droits du service. Les analystes conservent les agrégats et n’accèdent pas aux
  fiches, messages ou exports de dossiers détaillés.
- Un responsable peut corriger une fiche client/produit seulement si elle n’est
  pas partagée avec un service qu’il ne gère pas. Le super-administrateur peut
  corriger les fiches partagées et gérer les magasins.
- Les écritures directes des tables de référentiels par `authenticated` sont
  révoquées. Les commandes passent par les RPC avec révision et journal d’audit.
- La correction d’un client/produit incrémente la version des dossiers actifs
  liés. Les notes en cours dans le dossier sont préservées lors du rafraîchissement.
- La réassociation d’un dossier à un autre client révoque les anciens codes et
  sessions d’accès dans la même transaction, y compris via l’API existante.
- La restauration conserve le statut et l’historique, exige un motif et ne
  réactive aucun ancien accès. Le magasin lié doit être actif.
- Les commandes sont idempotentes ; les formulaires conservent leur identifiant
  pour réessayer une même opération après une réponse perdue.

## Limites explicites

- Les actions groupées portent sur 25 dossiers maximum et sont atomiques. Elles
  ajoutent une note, modifient une échéance ou appliquent une transition autorisée.
- Un export respecte les filtres appliqués et les droits de service. Il contient
  au maximum 1 000 dossiers ; un volume supérieur ou une réponse dépassant la
  borne de taille est refusé avec une invitation à affiner les filtres. Aucun
  fichier partiel n’est présenté comme complet.
- Les CSV échappent les séparateurs, guillemets et préfixes de formules. Ils ne
  contiennent ni codes d’accès, ni sessions, ni métadonnées internes.
- L’historique des échanges lit uniquement les messages client/assistant
  enregistrés dans la source Supabase du dossier, par pages de 50. Les messages
  système/outils et leurs métadonnées sont exclus. Il ne remplace pas une console
  de chat en direct et ne copie pas les conversations de démonstration D1.
- « Préparer un email » ouvre la messagerie de l’administrateur. Aucun email ou
  SMS n’est envoyé automatiquement par cette évolution.
- Un magasin lié à des dossiers non archivés ne peut pas être désactivé. Les
  clients et produits sont conservés pour préserver les associations historiques.
- Le mode P1, les secrets et la politique de facturation restent gérés côté
  serveur. Aucun de ces paramètres n’est activé par cette livraison.

## Vérification

Les tests API vérifient l’authentification, les origines, les contrats de données,
les erreurs et les exports. Le rejeu de toutes les migrations sur PostgreSQL
embarqué exécute `supabase/tests/business.sql` : droits, conflits, idempotence,
transactions, révocation d’accès, recherche et pagination. Chaque fixture est
annulée par `ROLLBACK`.

`npm run test:admin-business-ui` exerce les vrais composants avec des API
synthétiques : correction et réassociation, note préservée, téléchargement CSV,
réponse réseau perdue, création des référentiels, droits de lecture, restauration,
rapports et affichage à 320/390/768 pixels. Les appels externes sont bloqués.
