# Aperçu RAG dans l'administration

## Avant / après

L'aperçu des réglages appelait le corpus statique `retrieve()` même lorsque le
chat utilisait les documents publiés dans Supabase. Il ne permettait donc pas de
vérifier les sources effectivement retenues pour le déploiement.

L'aperçu appelle désormais `searchKnowledge()`, le même point d'entrée que le chat,
avec les valeurs RAG du formulaire. Il respecte le mode, les filtres documentaires,
les seuils serveur et l'organisation de ce déploiement. Il ne publie aucun réglage,
ne crée aucune réponse LLM et n'arme pas P1.

## Ce que voit le super-administrateur

- Source effective : corpus de démonstration, base publiée lexicale, ou hybride.
- Langue documentaire et marché configurés côté serveur.
- Nombre de documents retenus, version, contenu du passage, dates de validité,
  langue, marché et score du moteur ; canaux lexical/vectoriel lorsqu'ils existent.
- Temps de l'aperçu et nombre d'appels d'embedding observés.
- Mode dégradé signalé explicitement. Une absence de résultat est distincte d'une
  indisponibilité : cette dernière retourne HTTP 503, jamais un succès de démo.

Le score est une valeur de classement du moteur, pas une probabilité de vérité.
Une bonne prévisualisation ne constitue pas une qualification des réponses finales.

`ragMinAnchors` agit uniquement sur le corpus de démonstration. Son contrôle reste
visible mais désactivé lorsque la base publiée est utilisée, avec une explication.
Les seuils du RAG hybride et le modèle d'embedding restent gouvernés côté serveur.
Les sources affichées correspondent à l'instant de l'aperçu ; le chat conserve sa
revalidation documentaire existante avant une libération de réponse P1.

## Quota et accès

- Rôle super_admin, MFA AAL2, organisation de déploiement et contrôle d'origine
  obligatoires. Aucun identifiant d'organisation ou de modèle injectable dans le
  corps de l'aperçu ; contrat strict.
- En hybride, confirmation explicite par test : au plus un appel d'embedding,
  réservé sur le quota partagé existant. Le navigateur seul ne suffit pas :
  l'API refuse le test sans `allowEmbedding: true` avant toute recherche.
- Le budget fournisseur serveur reste la limite. Le test n'accorde aucun budget
  supplémentaire et ne contourne pas une réserve épuisée.
- Pas de bascule automatique de fournisseur d'embedding et aucun appel de chat.
- Question bornée à 500 caractères, 1 à 3 sources ; aucune sauvegarde automatique
  ni test périodique. L'autorisation du test se réinitialise après son exécution.

## Validation et déploiement

Tests HTTP simulés : document publié et provenance, paramètres du formulaire,
absence de mutation de configuration, recherche vide, indisponibilité, refus
sans confirmation, quota partagé sur deux tentatives, une requête d'embedding au
maximum, locale/marché, rôle/MFA/origine/organisation et payloads invalides.
Les tests hybrides existants continuent de vérifier dates, organisations,
versions concurrentes, hashes, instructions documentaires et abstention.

Aucun appel fournisseur réel n'est réalisé pendant ces tests. La recette visuelle
et un test de préproduction sur des documents synthétiques restent nécessaires.
Aucune migration : déployer l'API et l'interface ensemble. L'interface désactive
le test si les métadonnées RAG de la nouvelle API sont absentes pendant une mise
à jour partielle. Retour arrière possible au commit applicatif précédent ; aucune
configuration persistée n'a changé de schéma.
