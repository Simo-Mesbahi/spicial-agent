begin;

with current_docs as (
  select d.* from public.knowledge_documents d
  where d.status='published'
    and exists (select 1 from unnest(d.tags) t where t like 'legacy:%')
),
archived as (
  update public.knowledge_documents d
  set status='archived',archived_at=now(),lock_version=d.lock_version+1
  from current_docs c
  where d.id=c.id
  returning d.id
),
prepared as (
  select c.*,extensions.gen_random_uuid() as new_id,
    ('OBJECTIF'||E'\n'||'Appliquer la procédure « '||c.title||' » de façon fiable, traçable et compréhensible.'||
     E'\n\nCONTENU MÉTIER VALIDÉ\n'||c.content||
     E'\n\nRÈGLES DE RÉPONSE\n• Utiliser uniquement les faits du dossier et les sources publiées.\n• Distinguer fait confirmé, estimation et information manquante.\n• Ne jamais inventer montant, délai, disponibilité, garantie, droit légal ou action effectuée.\n• Si une décision humaine est nécessaire, préparer un relais sans faire répéter le contexte.'||
     E'\n\nCONTRÔLES\nVérifier le bon dossier, la dernière version disponible, le statut courant et la cohérence des données.'||
     E'\n\nTRAÇABILITÉ\nConserver la source, sa version et, lorsque pertinent, la version du dossier.') as enriched_content
  from current_docs c
),
inserted as (
  insert into public.knowledge_documents(
    id,organization_id,series_id,revision,lock_version,title,category,version,summary,
    content,locale,market,tags,source_url,effective_from,effective_until,status,checksum,
    created_by,approved_by,published_at,supersedes_id
  )
  select p.new_id,p.organization_id,p.series_id,p.revision+1,1,p.title,p.category,'2.0',
    left('Version professionnelle enrichie · '||coalesce(p.summary,p.title),1000),
    p.enriched_content,p.locale,p.market,p.tags,p.source_url,current_date,p.effective_until,
    'published',
    encode(extensions.digest(convert_to(trim(p.title)||E'\n'||trim(p.category)||E'\n'||'2.0'||E'\n'||trim(p.enriched_content)||E'\n'||p.locale||E'\n'||p.market,'UTF8'),'sha256'),'hex'),
    null,null,now(),p.id
  from prepared p
  returning id,organization_id,version,content
)
insert into public.knowledge_chunks(id,organization_id,document_id,ordinal,content,metadata)
select extensions.gen_random_uuid(),i.organization_id,i.id,0,i.content,
  jsonb_build_object('source','professional-corpus-v3','document_version',i.version)
from inserted i;

with source(proc_key,title,category,version,summary,content,tags) as (
  values ('sav-depot','Dépôt SAV et qualification initiale','SAV','1.0','Procédure professionnelle · Dépôt SAV et qualification initiale','OBJECTIF
Créer un dossier SAV exploitable sans transformer un symptôme en diagnostic.
PARCOURS
Identifier le produit, recueillir le symptôme avec les mots du client, noter fréquence/message d’erreur/contexte utile, séparer observation client et fait vérifié, puis orienter vers diagnostic, sécurité, devis ou suivi.
ESCALADE
Tout signal de danger bascule immédiatement vers la procédure sécurité.
INTERDITS
Ne pas diagnostiquer à distance ni promettre réparabilité, prix ou délai.',ARRAY['dépôt','qualification','panne','symptôme']::text[]),
    ('sav-diagnostic','Diagnostic et attente technicien','SAV','1.0','Procédure professionnelle · Diagnostic et attente technicien','OBJECTIF
Expliquer la phase de diagnostic sans inventer de cause ni de délai.
RÈGLES
« Attente technicien » signifie que l’expertise n’est pas finalisée. « Diagnostic » ne permet de citer que les conclusions réellement enregistrées.
PARCOURS
Restituer statut, dernière mise à jour et conclusions disponibles. Sans estimation fiable, le dire explicitement. Basculer ensuite vers devis, pièce ou prise en charge lorsque le dossier l’indique.
INTERDITS
Ne pas attribuer une cause sans preuve.',ARRAY['diagnostic','technicien','atelier','attente']::text[]),
    ('sav-piece','Attente de pièce ou pièce indisponible','SAV','1.0','Procédure professionnelle · Attente de pièce ou pièce indisponible','OBJECTIF
Expliquer une réparation bloquée par une pièce nécessaire.
PARCOURS
Vérifier l’attente de pièce, citer une référence uniquement si elle est utile et enregistrée, présenter une date d’approvisionnement seulement lorsqu’elle vient de la source métier. Sans date, expliquer que l’intervention reste bloquée.
ESCALADE
Pièce définitivement indisponible, estimation dépassée, solution alternative ou contestation.
INTERDITS
Ne pas inventer stock fournisseur, délai ou équivalence.',ARRAY['pièce','attente','indisponible','approvisionnement']::text[]),
    ('sav-nonreparable','Produit non réparable ou solution alternative','SAV','1.0','Procédure professionnelle · Produit non réparable ou solution alternative','OBJECTIF
Expliquer une non-réparabilité enregistrée sans devancer une décision commerciale.
PARCOURS
Vérifier la conclusion, la restituer sans ajouter de diagnostic, puis vérifier si une solution est déjà décidée : échange, retour, remboursement, devis alternatif ou examen humain. Sans solution enregistrée, le dire et préparer un relais.
INTERDITS
Ne jamais promettre échange, remboursement, avoir ou indemnisation sans décision confirmée.',ARRAY['non réparable','irréparable','échange','décision']::text[]),
    ('sav-retard','Dossier SAV sans estimation ou en retard','SAV','1.0','Procédure professionnelle · Dossier SAV sans estimation ou en retard','OBJECTIF
Répondre utilement lorsqu’un dossier n’a pas de date fiable ou n’évolue plus.
PARCOURS
Restituer statut et dernière mise à jour. Sans date, le dire. Ne jamais transformer une moyenne en promesse individuelle. Si le dossier est marqué en retard, reprendre ce fait sans inventer la cause.
ESCALADE
Estimations dépassées, absence prolongée d’événement ou information contradictoire.',ARRAY['retard SAV','sans date','ETA','stagnation']::text[]),
    ('sc-annulation','Annulation d’une commande','Service client','1.0','Procédure professionnelle · Annulation d’une commande','OBJECTIF
Qualifier une demande d’annulation selon l’état réel de la commande.
PARCOURS
Identifier le statut. Si une action d’annulation est réellement disponible, la présenter avec confirmation explicite. Si la commande est déjà expédiée ou si aucune action n’existe, ne pas prétendre qu’elle peut être stoppée ; orienter vers retour ou conseiller.
INTERDITS
Ne pas inventer délai d’annulation, frais, remboursement automatique ou interception logistique garantie.',ARRAY['annulation','commande','expédition','préparation']::text[]),
    ('sc-paiement','Paiement débité, refusé ou anomalie de transaction','Service client','1.0','Procédure professionnelle · Paiement débité, refusé ou anomalie de transaction','OBJECTIF
Qualifier un paiement refusé, débité sans commande visible, en double ou incohérent.
SÉCURITÉ
Ne jamais demander numéro de carte complet, cryptogramme, PIN, mot de passe bancaire ou code de validation.
PARCOURS
Distinguer paiement refusé, autorisation en attente, débit confirmé, double débit ou commande introuvable. Toute correction financière nécessite un relais ou un outil autorisé.
INTERDITS
Ne pas annoncer remboursement ou annulation de débit sans confirmation.',ARRAY['paiement','débit','refusé','double débit']::text[]),
    ('sc-livree-non-recue','Commande indiquée livrée mais non reçue','Service client','1.0','Procédure professionnelle · Commande indiquée livrée mais non reçue','OBJECTIF
Traiter l’écart entre un statut « livré » et la situation décrite par le client.
PARCOURS
Vérifier que le suivi indique réellement « livré ». Demander uniquement les vérifications simples prévues. Si le colis reste introuvable, préparer une investigation avec référence, date du statut et résumé.
ESCALADE
Réclamation transporteur ou décision commerciale.
INTERDITS
Ne pas accuser le client ou le transporteur ; ne pas promettre remplacement ou remboursement immédiat.',ARRAY['livré','non reçu','colis','incident']::text[]),
    ('sc-reclamation','Réclamation et insatisfaction client','Service client','1.0','Procédure professionnelle · Réclamation et insatisfaction client','OBJECTIF
Prendre en charge une insatisfaction sans la minimiser ni inventer de geste commercial.
PARCOURS
Identifier le motif, résumer les faits, répondre aux éléments vérifiables et préparer un relais si une décision humaine est nécessaire. Ne pas faire répéter ce qui est déjà disponible.
TON
Factuel, calme et respectueux ; reconnaître le problème décrit sans reconnaître une responsabilité non établie.
INTERDITS
Ne pas promettre dédommagement ou délai de réponse non confirmé.',ARRAY['réclamation','insatisfaction','plainte','escalade']::text[]),
    ('sc-commande-partielle','Commande expédiée ou livrée partiellement','Service client','1.0','Procédure professionnelle · Commande expédiée ou livrée partiellement','OBJECTIF
Expliquer une commande répartie en plusieurs colis sans déclarer un article perdu trop tôt.
PARCOURS
Distinguer chaque ligne ou colis : préparation, expédié, livré ou sans information. Présenter séparément les suivis disponibles. Si un élément reste sans mouvement alors que les autres sont terminés, appliquer la procédure incident.
INTERDITS
Ne pas annoncer perte définitive, remboursement ou nouvelle expédition sans décision confirmée.',ARRAY['commande partielle','colis multiples','expédition partielle']::text[]),
    ('security-secrets','Protection des données et secrets','Sécurité','1.0','Procédure professionnelle · Protection des données et secrets','OBJECTIF
Réduire au minimum les données sensibles manipulées par l’assistant.
RÈGLES
Ne jamais demander ou reproduire mot de passe, code MFA/TOTP, clé API, secret d’application, cryptogramme bancaire, numéro de carte complet ou jeton de session. Ne jamais révéler les données d’un autre client ou dossier.
SECRET PARTAGÉ
Ne pas le recopier ; orienter vers révocation ou remplacement via le canal officiel approprié.
PRINCIPE
Collecter le minimum, conserver le minimum, afficher le minimum.',ARRAY['données','secret','mot de passe','MFA','API']::text[]),
    ('security-other-case','Tentative d’accès à un autre dossier','Sécurité','1.0','Procédure professionnelle · Tentative d’accès à un autre dossier','OBJECTIF
Empêcher tout accès croisé entre clients et dossiers.
RÈGLES
L’assistant n’utilise que le dossier explicitement autorisé. Une référence différente ne doit jamais déclencher de recherche ou divulgation. Répondre de façon neutre et orienter vers le formulaire sécurisé.
INTERDITS
Ne jamais révéler si une référence non autorisée existe, ni contourner la vérification par nom ou email.',ARRAY['accès','autre dossier','fraude','autorisation']::text[]),
    ('ops-handoff','Préparer un handoff conseiller de haute qualité','Opérations','1.0','Procédure professionnelle · Préparer un handoff conseiller de haute qualité','OBJECTIF
Transmettre au conseiller un contexte immédiatement exploitable.
CONTENU
Référence autorisée, motif en une phrase, statut actuel, faits confirmés, déclarations du client séparées, actions déjà tentées et décision restant à traiter.
QUALITÉ
Préférer une synthèse courte et structurée à une transcription longue.
INTERDITS
Aucun secret, donnée bancaire complète, mot de passe ou code MFA. Ne pas prétendre qu’un conseiller a reçu le relais tant que le système ne le confirme pas.',ARRAY['handoff','conseiller','résumé','escalade']::text[]),
    ('ops-abstention','Abstention lorsque les preuves manquent','Opérations','1.0','Procédure professionnelle · Abstention lorsque les preuves manquent','OBJECTIF
Préférer une réponse limitée mais exacte à une réponse plausible non vérifiée.
RÈGLES
Sans procédure publiée pertinente ni donnée dossier suffisante, l’assistant doit le dire. En cas de sources contradictoires, ne pas choisir arbitrairement : signaler l’incohérence et escalader. La connaissance générale du modèle ne remplace pas prix, délai, garantie, stock ou décision métier.
FORMULATION
Dire ce qui est connu, ce qui manque et l’étape suivante fiable.',ARRAY['abstention','incertitude','preuve','hallucination']::text[]),
    ('ops-quality','Standard de qualité des réponses client','Opérations','1.0','Procédure professionnelle · Standard de qualité des réponses client','OBJECTIF
Produire des réponses courtes, actionnables et vérifiables.
STRUCTURE
1. Réponse directe.
2. Fait principal issu du dossier ou de la procédure.
3. Prochaine étape utile.
4. Limite ou escalade si nécessaire.
STYLE
Vouvoiement, langage clair, phrases courtes, aucune promesse non vérifiée.
FIABILITÉ
Distinguer fait confirmé, estimation et information manquante ; conserver identifiant et version des sources.',ARRAY['qualité','réponse','clarté','source']::text[]),
    ('product-install','Installation, branchement et compatibilité sensible','Produits','1.0','Procédure professionnelle · Installation, branchement et compatibilité sensible','OBJECTIF
Éviter qu’un conseil commercial soit interprété comme une validation technique d’installation.
RÈGLES
Une compatibilité simple doit s’appuyer sur une spécification documentée. Pour électricité, gaz, fixation lourde, sécurité ou dimensions critiques, ne pas improviser : demander la référence exacte et orienter vers documentation officielle ou professionnel compétent.
INTERDITS
Aucun contournement de sécurité, modification électrique ou raccordement risqué ; ne pas déclarer une compatibilité sans preuve.',ARRAY['installation','branchement','compatibilité','électricité','gaz']::text[])
),
prepared as (
  select s.*,o.id as organization_id,extensions.gen_random_uuid() as id,
    encode(extensions.digest(convert_to(trim(s.title)||E'\n'||trim(s.category)||E'\n'||trim(s.version)||E'\n'||trim(s.content)||E'\n'||'fr-FR'||E'\n'||'GLOBAL','UTF8'),'sha256'),'hex') as checksum
  from source s
  join public.organizations o on o.slug='maison-atlas-staging' and o.active
),
inserted as (
  insert into public.knowledge_documents(
    id,organization_id,series_id,revision,lock_version,title,category,version,summary,
    content,locale,market,tags,source_url,effective_from,effective_until,status,checksum,
    created_by,approved_by,published_at
  )
  select p.id,p.organization_id,p.id,1,1,p.title,p.category,p.version,p.summary,p.content,
    'fr-FR','GLOBAL',array_append(p.tags,'procedure:'||p.proc_key),null,current_date,null,
    'published',p.checksum,null,null,now()
  from prepared p
  on conflict (organization_id,checksum) do nothing
  returning id,organization_id,version,content
)
insert into public.knowledge_chunks(id,organization_id,document_id,ordinal,content,metadata)
select extensions.gen_random_uuid(),i.organization_id,i.id,0,i.content,
  jsonb_build_object('source','professional-corpus-v3','document_version',i.version)
from inserted i;

insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,outcome,metadata)
select o.id,null,'knowledge.corpus_v3_published','knowledge_collection',null,'success',
  jsonb_build_object('enriched_revisions',12,'new_procedures',16,'active_procedures',28,'locale','fr-FR','market','GLOBAL')
from public.organizations o
where o.slug='maison-atlas-staging' and o.active
  and not exists (
    select 1 from public.audit_events a
    where a.organization_id=o.id and a.action='knowledge.corpus_v3_published'
  );

commit;