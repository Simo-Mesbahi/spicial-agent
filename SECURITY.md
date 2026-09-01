# Sécurité et limites du périmètre

## Démonstration uniquement

N’utiliser que des données fictives. Le visiteur contrôle les rôles client et opérateur de son espace. Une référence et un code sur le même support ne constituent pas une authentification multifactorielle.

## Contrôles implémentés

- Cookie aléatoire 256 bits, HttpOnly, SameSite=Strict, Secure en HTTPS ; seule son empreinte est conservée dans la base.
- Espace valable 24 h ; grant par dossier valable 1 h ; chaque accès est contrôlé au serveur.
- Code fictif dérivé du jeton de session et de la référence ; seule une empreinte liée à l’espace est conservée par dossier. Le code n’est pas envoyé au modèle.
- Verrouillage après 5 échecs et quotas atomiques de création de sessions et de conversations.
- Vérification d’origine, jeton CSRF pour mutations, requêtes SQL paramétrées.
- Transitions métier explicites, confirmation des devis, version optimiste et identifiant d’opération contre les doublons.
- Devis sans montant valide non acceptables ; un montant absent n’est pas interprété comme zéro.
- Identifiant de message limité à la session, réservation atomique et réponse persistée pour les réessais. Les permissions sont recontrôlées avant restitution ; message, réponse et audit sont enregistrés dans une même transaction. Voir les limites de reprise après crash dans le [contrat HTTP](docs/API.md).
- Outils du LLM en lecture seule, nom vérifié côté serveur, nombre d’appels limité et timeout.
- Budget IA zéro par défaut : appels aux fournisseurs externes bloqués avant le réseau. Ollama limité à une boucle locale ; aucune clé transmise ; redirections HTTP refusées. Le lanceur démarre un processus isolé avec cloud désactivé. Cette politique ne neutralise pas un administrateur qui la modifierait ou installerait volontairement un proxy distant.
- Le mode `free` n’autorise que le connecteur Gemini et les modèles explicitement permis. Il ne vérifie pas le statut de facturation du compte Google et ne constitue pas une garantie de coût nul : conserver le compte fournisseur sans facturation pour cette démonstration et contrôler ses quotas.
- Masquage de certains codes, emails, clés OpenAI/Groq et clés Gemini avant transmission au modèle, avant réponse au navigateur et avant persistance. Ce filtrage est une protection partielle, pas une garantie de suppression de toutes les données personnelles.
- Réponses fournisseur limitées en taille et validées par schéma ; noms, arguments et identifiants d’outils sont contrôlés. Une réponse qui omet la consultation métier ou documentaire requise est écartée.
- En cas de quota, panne ou réponse non validée du modèle, continuité déterministe clairement signalée dans l’interface. Ce secours n’exécute aucune action et ne change jamais de fournisseur.
- Expiration des sessions, suppression des données associées à la réinitialisation et nettoyage lors de nouvelles créations. Aucun export de cookies ou codes dans l’audit.
- Le contact email est préparé localement vers une destination fixe. Les liens `mailto:`, Gmail et Outlook contiennent seulement le destinataire, l’objet et le message affichés au visiteur ; ces informations ne transitent pas par l’API et ne sont pas persistées par l’application. Le visiteur garde la confirmation finale dans la messagerie choisie. L’adresse de destination est publique dans l’interface et dans le code source ; ce n’est pas un secret.

## Avant des données réelles

Remplacer les rôles fictifs par un SSO/OIDC vérifié et des autorisations magasin/enseigne, revoir les codes d’accès et la récupération, mettre en place la gestion des clés, les politiques de rétention, les sauvegardes restaurables, la détection d’abus et un audit indépendant. Tester la sécurité de l’API indépendamment du prompt du modèle. Configurer un budget fournisseur ; un quota applicatif n’est pas un plafond financier garanti.

Pour signaler un défaut, ne publier aucun secret ni donnée client dans une issue. Utiliser un canal privé convenu avec le propriétaire du dépôt. Aucun canal privé de signalement automatique n’est configuré dans ce prototype.
