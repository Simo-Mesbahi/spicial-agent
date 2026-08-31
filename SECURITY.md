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
- Outils du LLM en lecture seule, nom vérifié côté serveur, nombre d’appels limité et timeout.
- Budget IA zéro par défaut : appels aux fournisseurs externes bloqués avant le réseau. Ollama limité à une boucle locale ; aucune clé transmise ; redirections HTTP refusées. Le lanceur démarre un processus isolé avec cloud désactivé. Cette politique ne neutralise pas un administrateur qui la modifierait ou installerait volontairement un proxy distant.
- Masquage de certains codes, emails et secrets avant persistance de la conversation. Ce filtrage est une protection partielle, pas une garantie de suppression de toutes les données personnelles.
- Expiration des sessions, suppression des données associées à la réinitialisation et nettoyage lors de nouvelles créations. Aucun export de cookies ou codes dans l’audit.

## Avant des données réelles

Remplacer les rôles fictifs par un SSO/OIDC vérifié et des autorisations magasin/enseigne, revoir les codes d’accès et la récupération, mettre en place la gestion des clés, les politiques de rétention, les sauvegardes restaurables, la détection d’abus et un audit indépendant. Tester la sécurité de l’API indépendamment du prompt du modèle. Configurer un budget fournisseur ; un quota applicatif n’est pas un plafond financier garanti.

Pour signaler un défaut, ne publier aucun secret ni donnée client dans une issue. Utiliser un canal privé convenu avec le propriétaire du dépôt. Aucun canal privé de signalement automatique n’est configuré dans ce prototype.
