begin;

alter table public.knowledge_documents
  add column if not exists search_vector tsvector;

create or replace function app_private.refresh_knowledge_document_search_vector()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('french', coalesce(new.title,'')), 'A')
    || setweight(to_tsvector('french', coalesce(new.category,'')), 'A')
    || setweight(to_tsvector('french', coalesce(new.summary,'')), 'B')
    || setweight(to_tsvector('french', array_to_string(coalesce(new.tags,'{}'::text[]),' ')), 'A');
  return new;
end;
$$;

update public.knowledge_documents
set search_vector =
  setweight(to_tsvector('french', coalesce(title,'')), 'A')
  || setweight(to_tsvector('french', coalesce(category,'')), 'A')
  || setweight(to_tsvector('french', coalesce(summary,'')), 'B')
  || setweight(to_tsvector('french', array_to_string(coalesce(tags,'{}'::text[]),' ')), 'A')
where search_vector is null;

drop trigger if exists knowledge_documents_search_vector_refresh on public.knowledge_documents;
create trigger knowledge_documents_search_vector_refresh
before insert or update of title,category,summary,tags
on public.knowledge_documents
for each row execute function app_private.refresh_knowledge_document_search_vector();

create index if not exists knowledge_documents_search_vector_idx
  on public.knowledge_documents using gin(search_vector);

create or replace function app_private.knowledge_search(
  p_organization_id uuid,
  p_query text,
  p_limit integer default 3,
  p_locale text default null,
  p_market text default null
)
returns table(
  document_id uuid,
  chunk_id uuid,
  title text,
  category text,
  version text,
  locale text,
  market text,
  effective_from date,
  effective_until date,
  chunk_ordinal integer,
  content text,
  rank real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit,3),1),8);
  v_query tsquery;
begin
  if (select auth.role()) <> 'service_role'
     and not app_private.is_admin(p_organization_id,null,true) then
    raise exception using errcode='42501', message='knowledge_search_denied';
  end if;
  if char_length(trim(coalesce(p_query,''))) < 2 then return; end if;
  v_query := websearch_to_tsquery('french', left(trim(p_query),500));

  return query
  with scored as (
    select
      d.id as document_id,
      c.id as chunk_id,
      d.title,
      d.category,
      d.version,
      d.locale,
      d.market,
      d.effective_from,
      d.effective_until,
      c.ordinal as chunk_ordinal,
      c.content,
      (
        2.0 * ts_rank_cd(d.search_vector, v_query)
        + ts_rank_cd(c.search_vector, v_query)
      )::real as rank
    from public.knowledge_chunks c
    join public.knowledge_documents d
      on d.organization_id=c.organization_id and d.id=c.document_id
    where d.organization_id=p_organization_id
      and d.status='published'
      and (d.effective_from is null or d.effective_from<=current_date)
      and (d.effective_until is null or d.effective_until>=current_date)
      and (p_locale is null or d.locale=p_locale)
      and (p_market is null or d.market in ('GLOBAL',p_market))
      and (d.search_vector @@ v_query or c.search_vector @@ v_query)
  ),
  deduped as (
    select scored.*,
      row_number() over(
        partition by scored.document_id
        order by scored.rank desc, scored.chunk_ordinal
      ) as document_rank
    from scored
  )
  select
    deduped.document_id,deduped.chunk_id,deduped.title,deduped.category,deduped.version,
    deduped.locale,deduped.market,deduped.effective_from,deduped.effective_until,
    deduped.chunk_ordinal,deduped.content,deduped.rank
  from deduped
  where deduped.document_rank=1
  order by deduped.rank desc, deduped.title, deduped.chunk_ordinal
  limit v_limit;
end;
$$;

with source(legacy_id,title,category,version,effective_from,tags_text,content) as (
  values
    ('sav-suivi','Comprendre le suivi de réparation','SAV','1.0','2026-08-01'::date,'reparation panne sav technicien diagnostic piece atelier suivi','Le suivi distingue le dépôt, la réception à l’atelier, le diagnostic, l’attente de pièce, la réparation, le contrôle et le retour. Une réparation terminée ne signifie pas que le produit est disponible au magasin. Les dates de retour sont estimatives tant que la réception n’est pas confirmée.'),
    ('sav-garantie','Garantie et prise en charge','SAV','1.0','2026-08-01'::date,'garantie gratuit payer couverture prise charge','Dans cette enseigne fictive, la décision de prise en charge est enregistrée dans le dossier après contrôle des justificatifs et du diagnostic. L’assistant explique cette décision, mais ne détermine pas les droits légaux et ne promet pas une gratuité. En cas de désaccord, un conseiller doit examiner le dossier.'),
    ('sav-devis','Accepter ou refuser un devis','SAV','1.0','2026-08-01'::date,'devis accepter refuser prix cout montant reparation','Un devis en attente nécessite une confirmation explicite du client. Le montant présenté est celui du dossier actuel. L’intervention ne commence pas avant acceptation. En cas de refus, un conseiller organise la restitution ; aucun paiement réel n’est déclenché dans cette démonstration.'),
    ('sav-retrait','Récupérer un produit réparé','SAV','1.0','2026-08-01'::date,'retrait recuperer chercher magasin repare disponible','Le retrait est possible lorsque le dossier indique « Disponible au retrait ». Préparez la référence du dossier et le justificatif de dépôt. Un produit encore en transport n’est pas disponible. Pour un changement de magasin ou une livraison à domicile, un conseiller vérifie la faisabilité.'),
    ('sc-livraison','Retard ou incident de livraison','Service client','1.0','2026-08-01'::date,'livraison retard colis transporteur date commande arriver','Le statut et l’estimation proviennent du suivi enregistré. Une estimation ne constitue pas une date garantie. Si la date n’est pas communiquée ou si le colis est signalé perdu, une demande de contact peut être créée pour le service client. La simulation métier ne déclenche aucun SMS ni email automatique.'),
    ('sc-incomplet','Colis incomplet ou endommagé','Service client','1.0','2026-08-01'::date,'manquant incomplet casse abime endommage article colis','Précisez la référence de commande et les articles concernés. Conservez l’emballage et les justificatifs disponibles. Le conseiller vérifie s’il existe un envoi séparé ou ouvre une réclamation. Aucun remboursement ni échange n’est promis avant examen du dossier.'),
    ('sc-retour','Demander un retour ou un échange','Service client','1.0','2026-08-01'::date,'retour retourner echange changer produit delai','Les possibilités de retour dépendent du produit, du mode d’achat et de la politique applicable. Dans la démonstration, les retours autorisés sont identifiés dans le dossier. Un retour réceptionné doit être contrôlé avant la validation du remboursement. Les situations non documentées sont transmises à un conseiller.'),
    ('sc-remboursement','Suivre un remboursement','Service client','1.0','2026-08-01'::date,'remboursement rembourse argent paiement banque montant','Le dossier distingue remboursement en traitement et remboursement effectué. L’assistant communique le montant et l’état enregistrés sans inventer de délai bancaire. Un montant contesté nécessite l’examen du service client. Aucun mouvement financier réel n’a lieu sur cette plateforme.'),
    ('sc-compte','Compte, fidélité et facture','Service client','1.0','2026-08-01'::date,'compte fidelite points facture ticket paiement mot passe','Un conseiller peut examiner une demande liée au compte, aux points de fidélité ou à une facture. La plateforme de démonstration ne dispose pas de connecteur de paiement ou de programme de fidélité réel. Ne communiquez jamais de mot de passe, code bancaire ou numéro de carte dans la conversation.'),
    ('produit-securite','Un appareil présente un danger','Sécurité','1.0','2026-08-01'::date,'danger fumee brule electrique etincelle odeur fuite securite feu','En cas de fumée, odeur de brûlé ou étincelles, cessez d’utiliser l’appareil et éloignez-vous du danger. Ne démontez pas l’appareil. Contactez un professionnel ; en cas de danger immédiat, contactez les secours locaux. L’assistant ne propose pas de réparation électrique à réaliser soi-même.'),
    ('produit-conseil','Conseil et disponibilité produit','Produits','1.0','2026-08-01'::date,'produit stock disponibilite compatible conseil caracteristique acheter','Le catalogue de démonstration présente des produits fictifs. Le stock et la compatibilité technique ne sont pas reliés à un inventaire réel. Pour une caractéristique absente de la notice, l’assistant doit préciser qu’il ne peut pas la vérifier et proposer un conseiller.'),
    ('magasin-contact','Contacter un conseiller','Service client','1.0','2026-08-01'::date,'conseiller humain contact reclamation magasin horaires telephone adresse','Une demande de contact rassemble la référence du dossier, le statut et le résumé du problème. Elle apparaît dans l’espace de gestion. Le relais conseiller est simulé : aucun appel, email ou SMS automatique n’est déclenché. La page de contact séparée permet au visiteur de préparer puis de confirmer lui-même un email. Les horaires des magasins ne sont pas disponibles dans cette version.')
),
prepared as (
  select source.*,
    encode(
      extensions.digest(
        convert_to(trim(title)||E'\n'||trim(category)||E'\n'||trim(version)||E'\n'||trim(content)||E'\n'||'fr-FR'||E'\n'||'GLOBAL','UTF8'),
        'sha256'
      ),
      'hex'
    ) as checksum
  from source
),
expanded as (
  select o.id as organization_id, extensions.gen_random_uuid() as id, p.*
  from prepared p
  join public.organizations o on o.slug='maison-atlas-staging' and o.active
)
insert into public.knowledge_documents(
  id,organization_id,series_id,revision,lock_version,title,category,version,summary,
  content,locale,market,tags,source_url,effective_from,effective_until,status,checksum,
  created_by,approved_by,published_at
)
select
  e.id,e.organization_id,e.id,1,1,e.title,e.category,e.version,left(e.content,1000),
  e.content,'fr-FR','GLOBAL',
  array_append(regexp_split_to_array(trim(e.tags_text),'\s+'),'legacy:'||e.legacy_id),
  null,e.effective_from,null,'published',e.checksum,null,null,now()
from expanded e
on conflict (organization_id,checksum) do nothing;

with source(legacy_id,title,category,version,effective_from,tags_text,content) as (
  values
    ('sav-suivi','Comprendre le suivi de réparation','SAV','1.0','2026-08-01'::date,'reparation panne sav technicien diagnostic piece atelier suivi','Le suivi distingue le dépôt, la réception à l’atelier, le diagnostic, l’attente de pièce, la réparation, le contrôle et le retour. Une réparation terminée ne signifie pas que le produit est disponible au magasin. Les dates de retour sont estimatives tant que la réception n’est pas confirmée.'),
    ('sav-garantie','Garantie et prise en charge','SAV','1.0','2026-08-01'::date,'garantie gratuit payer couverture prise charge','Dans cette enseigne fictive, la décision de prise en charge est enregistrée dans le dossier après contrôle des justificatifs et du diagnostic. L’assistant explique cette décision, mais ne détermine pas les droits légaux et ne promet pas une gratuité. En cas de désaccord, un conseiller doit examiner le dossier.'),
    ('sav-devis','Accepter ou refuser un devis','SAV','1.0','2026-08-01'::date,'devis accepter refuser prix cout montant reparation','Un devis en attente nécessite une confirmation explicite du client. Le montant présenté est celui du dossier actuel. L’intervention ne commence pas avant acceptation. En cas de refus, un conseiller organise la restitution ; aucun paiement réel n’est déclenché dans cette démonstration.'),
    ('sav-retrait','Récupérer un produit réparé','SAV','1.0','2026-08-01'::date,'retrait recuperer chercher magasin repare disponible','Le retrait est possible lorsque le dossier indique « Disponible au retrait ». Préparez la référence du dossier et le justificatif de dépôt. Un produit encore en transport n’est pas disponible. Pour un changement de magasin ou une livraison à domicile, un conseiller vérifie la faisabilité.'),
    ('sc-livraison','Retard ou incident de livraison','Service client','1.0','2026-08-01'::date,'livraison retard colis transporteur date commande arriver','Le statut et l’estimation proviennent du suivi enregistré. Une estimation ne constitue pas une date garantie. Si la date n’est pas communiquée ou si le colis est signalé perdu, une demande de contact peut être créée pour le service client. La simulation métier ne déclenche aucun SMS ni email automatique.'),
    ('sc-incomplet','Colis incomplet ou endommagé','Service client','1.0','2026-08-01'::date,'manquant incomplet casse abime endommage article colis','Précisez la référence de commande et les articles concernés. Conservez l’emballage et les justificatifs disponibles. Le conseiller vérifie s’il existe un envoi séparé ou ouvre une réclamation. Aucun remboursement ni échange n’est promis avant examen du dossier.'),
    ('sc-retour','Demander un retour ou un échange','Service client','1.0','2026-08-01'::date,'retour retourner echange changer produit delai','Les possibilités de retour dépendent du produit, du mode d’achat et de la politique applicable. Dans la démonstration, les retours autorisés sont identifiés dans le dossier. Un retour réceptionné doit être contrôlé avant la validation du remboursement. Les situations non documentées sont transmises à un conseiller.'),
    ('sc-remboursement','Suivre un remboursement','Service client','1.0','2026-08-01'::date,'remboursement rembourse argent paiement banque montant','Le dossier distingue remboursement en traitement et remboursement effectué. L’assistant communique le montant et l’état enregistrés sans inventer de délai bancaire. Un montant contesté nécessite l’examen du service client. Aucun mouvement financier réel n’a lieu sur cette plateforme.'),
    ('sc-compte','Compte, fidélité et facture','Service client','1.0','2026-08-01'::date,'compte fidelite points facture ticket paiement mot passe','Un conseiller peut examiner une demande liée au compte, aux points de fidélité ou à une facture. La plateforme de démonstration ne dispose pas de connecteur de paiement ou de programme de fidélité réel. Ne communiquez jamais de mot de passe, code bancaire ou numéro de carte dans la conversation.'),
    ('produit-securite','Un appareil présente un danger','Sécurité','1.0','2026-08-01'::date,'danger fumee brule electrique etincelle odeur fuite securite feu','En cas de fumée, odeur de brûlé ou étincelles, cessez d’utiliser l’appareil et éloignez-vous du danger. Ne démontez pas l’appareil. Contactez un professionnel ; en cas de danger immédiat, contactez les secours locaux. L’assistant ne propose pas de réparation électrique à réaliser soi-même.'),
    ('produit-conseil','Conseil et disponibilité produit','Produits','1.0','2026-08-01'::date,'produit stock disponibilite compatible conseil caracteristique acheter','Le catalogue de démonstration présente des produits fictifs. Le stock et la compatibilité technique ne sont pas reliés à un inventaire réel. Pour une caractéristique absente de la notice, l’assistant doit préciser qu’il ne peut pas la vérifier et proposer un conseiller.'),
    ('magasin-contact','Contacter un conseiller','Service client','1.0','2026-08-01'::date,'conseiller humain contact reclamation magasin horaires telephone adresse','Une demande de contact rassemble la référence du dossier, le statut et le résumé du problème. Elle apparaît dans l’espace de gestion. Le relais conseiller est simulé : aucun appel, email ou SMS automatique n’est déclenché. La page de contact séparée permet au visiteur de préparer puis de confirmer lui-même un email. Les horaires des magasins ne sont pas disponibles dans cette version.')
),
prepared as (
  select source.*,
    encode(
      extensions.digest(
        convert_to(trim(title)||E'\n'||trim(category)||E'\n'||trim(version)||E'\n'||trim(content)||E'\n'||'fr-FR'||E'\n'||'GLOBAL','UTF8'),
        'sha256'
      ),
      'hex'
    ) as checksum
  from source
)
insert into public.knowledge_chunks(id,organization_id,document_id,ordinal,content,metadata)
select
  extensions.gen_random_uuid(),d.organization_id,d.id,0,p.content,
  jsonb_build_object('bootstrap',true,'legacy_id',p.legacy_id,'source','legacy-12')
from prepared p
join public.organizations o on o.slug='maison-atlas-staging' and o.active
join public.knowledge_documents d on d.organization_id=o.id and d.checksum=p.checksum
where not exists (
  select 1 from public.knowledge_chunks c
  where c.organization_id=d.organization_id and c.document_id=d.id
);

insert into public.audit_events(organization_id,actor_user_id,action,entity_type,entity_id,outcome,metadata)
select o.id,null,'knowledge.bootstrap_imported','knowledge_collection',null,'success',
  jsonb_build_object('documents',12,'source','legacy-typescript','retrieval','fts-v2')
from public.organizations o
where o.slug='maison-atlas-staging' and o.active
  and not exists (
    select 1 from public.audit_events a
    where a.organization_id=o.id and a.action='knowledge.bootstrap_imported'
  );

commit;
