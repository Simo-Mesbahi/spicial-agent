begin;

grant usage on schema app_private to authenticated, service_role;

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
  v_strict tsquery;
  v_relaxed tsquery;
  v_lexemes text[];
  v_relaxed_text text;
begin
  if (select auth.role()) <> 'service_role'
     and not app_private.is_admin(p_organization_id,null,true) then
    raise exception using errcode='42501', message='knowledge_search_denied';
  end if;

  if char_length(trim(coalesce(p_query,''))) < 2 then return; end if;

  v_strict := websearch_to_tsquery('french', left(trim(p_query),500));
  v_lexemes := tsvector_to_array(to_tsvector('french', left(trim(p_query),500)));

  if cardinality(v_lexemes) > 0 then
    select string_agg(quote_literal(lexeme), ' | ')
      into v_relaxed_text
    from unnest(v_lexemes) as lexeme;
    v_relaxed := to_tsquery('french', v_relaxed_text);
  end if;

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
        case when v_strict is not null and (d.search_vector @@ v_strict or c.search_vector @@ v_strict)
          then 3.0 else 0.0 end
        + 2.0 * coalesce(ts_rank_cd(d.search_vector, v_relaxed),0)
        + 1.0 * coalesce(ts_rank_cd(c.search_vector, v_relaxed),0)
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
      and (
        (v_strict is not null and (d.search_vector @@ v_strict or c.search_vector @@ v_strict))
        or
        (v_relaxed is not null and (d.search_vector @@ v_relaxed or c.search_vector @@ v_relaxed))
      )
  ),
  deduped as (
    select scored.*,
      row_number() over(
        partition by scored.document_id
        order by scored.rank desc, scored.chunk_ordinal
      ) as document_rank
    from scored
    where scored.rank > 0
  )
  select
    deduped.document_id,
    deduped.chunk_id,
    deduped.title,
    deduped.category,
    deduped.version,
    deduped.locale,
    deduped.market,
    deduped.effective_from,
    deduped.effective_until,
    deduped.chunk_ordinal,
    deduped.content,
    deduped.rank
  from deduped
  where deduped.document_rank=1
  order by deduped.rank desc, deduped.title, deduped.chunk_ordinal
  limit v_limit;
end;
$$;

commit;
