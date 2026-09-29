# Pilotage Gemini, Groq et OpenAI

## Configuration et activation

Les réglages se trouvent dans **Administration → Performance → Réglages de
l’assistant**. Le super-administrateur authentifié avec AAL2 sélectionne le
modèle principal, un fournisseur de secours et active ou désactive le
basculement. Un changement de principal/secours décoche la bascule, à confirmer
explicitement avant l’enregistrement. La version, l’auteur et l’environnement
sont conservés dans l’historique existant; une écriture concurrente est refusée.

Configurer les secrets dans l’environnement d’hébergement, jamais dans le
navigateur ou dans Git. Les secrets GitHub Actions seuls ne configurent pas le
serveur de l’application.

| Fournisseur | Secret serveur   | Modèle                                        | Politique serveur     |
| ----------- | ---------------- | --------------------------------------------- | --------------------- |
| Gemini      | `GEMINI_API_KEY` | `GEMINI_MODEL`, liste autorisée existante     | `free` ou `approved`  |
| Groq        | `GROQ_API_KEY`   | `openai/gpt-oss-120b` ou `openai/gpt-oss-20b` | `free` ou `approved`  |
| OpenAI      | `OPENAI_API_KEY` | `OPENAI_MODEL`, autorisé par l’opérateur      | `approved` uniquement |

Ajouter les fournisseurs autorisés à `LLM_ENABLED_PROVIDERS`. Leur simple présence
dans la liste n’autorise pas les appels : clé, modèle et budget doivent être
valides. `LLM_BUDGET_MODE=zero` conserve le blocage des API hébergées.
`free` exprime une politique d’utilisation de comptes gratuits; l’application ne
peut ni lire ni modifier le plan de facturation Gemini/Groq. Vérifier le niveau
gratuit auprès du fournisseur avant de renseigner une clé. OpenAI reste bloqué
en mode `free`, même si sa clé existe.

Groq utilise son endpoint fixe `https://api.groq.com/openai/v1`, sa propre clé,
un effort de raisonnement `low` et les sorties JSON Schema. Les identifiants
`openai/gpt-oss-*` sont des modèles hébergés par Groq, pas des appels facturés par
l’API OpenAI. Sources de compatibilité :
[API Groq](https://console.groq.com/docs/api-reference),
[sorties structurées Groq](https://console.groq.com/docs/structured-outputs).

## Politique de basculement

- Désactivée par défaut (`LLM_AUTO_FAILOVER=false`). Les anciennes versions de
  réglages restent compatibles et chargent cette valeur par défaut.
- Un principal et **un seul secours différent**, parmi Gemini/Groq/OpenAI.
  Le secours utilise le modèle défini côté serveur pour ce fournisseur.
- Une tentative de secours maximum par message HTTP. Les étapes suivantes du
  même message gardent ce fournisseur; le message suivant réessaie le principal.
- Déclencheurs : erreur réseau, délai de la tentative principale dépassé,
  réponse HTTP 5xx. La première tentative reçoit au maximum la moitié du délai
  configuré; les deux tentatives partagent le délai total original du demandeur.
- Aucune bascule après annulation du demandeur, HTTP 429 (y compris les quotas
  journaliers), erreur de clé/droits, HTTP 4xx/3xx, refus, sortie invalide ou
  rejet sémantique. Les validations locales, autorisations et sources restent
  obligatoires, quel que soit le fournisseur.
- Aucun outil métier n’est réexécuté par le transport : seule la requête modèle
  qui a échoué est envoyée au secours. Si le secours échoue, le repli documentaire
  existant s’applique; il n’y a pas de troisième fournisseur ni boucle de retry.
- Le quota global existant est réservé avant le routage. `dailyLimit=0` suspend
  les appels du chat. Une bascule ajoute au maximum un appel et conserve le
  plafond de sortie de la requête; une tentative échouée peut aussi consommer des
  tokens. Ce quota de conversations n’est pas un plafond monétaire.
- La révocation du secours suspend seulement la bascule et affiche sa raison
  dans l’admin. La révocation du principal conserve le repli documentaire.

## Qualification, recherche et exploitation

`P1_RELEASE_MODE` reste indépendant. Le basculement est désactivé dès qu’un mode
P1 autre que `off` est actif : l’attestation existante qualifie un fournisseur et
un modèle précis. La génération naturelle et la validation factuelle restent
des appels au fournisseur principal, sans secours implicite. Il faudra qualifier
chaque combinaison avant d’étendre cette politique à la libération naturelle P1.

Les embeddings restent indépendants. Changer le fournisseur de chat ne change
ni le modèle d’embedding ni l’index; une panne de recherche documentaire n’est
pas réparée par un changement de LLM de génération.

Les indicateurs de disponibilité admin signifient **configuré**, pas « testé en
direct ». Les sondes synthétiques existantes contrôlent uniquement le principal
et ne peuvent masquer sa panne derrière un secours. Aucun appel périodique ou
test payant n’est ajouté. Une bascule transmet au secours le contexte autorisé
du message; n’activer que les fournisseurs approuvés pour ces données.

Les métadonnées de routage distinguent `configuredProvider`, `provider`, `model`
et `providerFailover` (`from`, `to`, `recovered`). La trace conserve chaque
tentative, sa latence, son statut et les tokens mesurés. Une consommation
inconnue reste marquée incomplète; aucune estimation de coût inventée. Aucun
secret ni texte de conversation n’est ajouté aux traces.

## Validation avant activation réelle

Tests déterministes : six directions entre les trois fournisseurs, adaptation
des paramètres/schémas, transport Groq structuré, erreurs exclues, double panne,
délai/annulation, concurrence, isolation des requêtes, budget, révocation, anciens
réglages, MFA/rôle/origine, sondes sans secours et régressions générales.

Ces tests n’appellent aucune API LLM réelle. Après configuration des clés, une
petite qualification réelle avec données synthétiques reste nécessaire pour
vérifier l’accès du compte, ses quotas, la qualité métier et la latence. Cette
implémentation ne constitue pas une attestation P1 ou une validation de charge
en production.
