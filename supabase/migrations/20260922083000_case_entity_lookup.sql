-- SAV SC Assistant AI — bounded customer/product lookup for case management.
-- Prevents duplicate business entities while keeping search tenant-scoped,
-- role-scoped and index-backed for large catalogues.

begin;

create index if not exists customers_case_lookup_trgm_idx
  on public.customers
  using gin (
    (
      lower(
        coalesce(external_id,'') || ' ' ||
        coalesce(first_name,'') || ' ' ||
        coalesce(last_name,'') || ' ' ||
        coalesce(email,'') || ' ' ||
        coalesce(phone,'')
      )
    ) extensions.gin_trgm_ops
  );

create index if not exists products_case_lookup_trgm_idx
  on public.products
  using gin (
    (
      lower(
        coalesce(external_id,'') || ' ' ||
        coalesce(sku,'') || ' ' ||
        coalesce(name,'') || ' ' ||
        coalesce(category,'') || ' ' ||
        coalesce(serial_number,'')
      )
    ) extensions.gin_trgm_ops
  );

create or replace function public.admin_case_entity_search(
  p_organization_id uuid,
  p_entity_type text,
  p_query text,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_query text := left(trim(coalesce(p_query,'')),80);
  v_normalized text := lower(left(trim(coalesce(p_query,'')),80));
  v_limit integer := least(greatest(coalesce(p_limit,12),1),20);
begin
  if not app_private.is_admin(
    p_organization_id,
    array['super_admin','sav_manager','sc_manager'],
    true
  ) then
    raise exception using errcode='42501',message='admin_access_denied';
  end if;

  if p_entity_type not in ('customer','product') then
    raise exception using errcode='22023',message='invalid_entity_type';
  end if;

  -- Three characters is deliberate: no empty/broad customer-directory dumps.
  if char_length(v_query)<3 then
    return jsonb_build_object(
      'entity_type',p_entity_type,
      'query',v_query,
      'items','[]'::jsonb
    );
  end if;

  if p_entity_type='customer' then
    return jsonb_build_object(
      'entity_type','customer',
      'query',v_query,
      'items',coalesce((
        select jsonb_agg(to_jsonb(r) order by r.rank desc,r.display_name,r.id)
        from (
          select
            c.id,
            c.external_id,
            c.first_name,
            c.last_name,
            c.email,
            c.phone,
            trim(concat_ws(' ',c.first_name,c.last_name)) as display_name,
            (
              case
                when lower(coalesce(c.external_id,''))=v_normalized then 100
                when lower(coalesce(c.email,''))=v_normalized then 95
                when lower(coalesce(c.phone,''))=v_normalized then 90
                when lower(coalesce(c.external_id,'')) like v_normalized||'%' then 75
                when lower(coalesce(c.email,'')) like v_normalized||'%' then 70
                when lower(trim(concat_ws(' ',c.first_name,c.last_name))) like v_normalized||'%' then 65
                else 0
              end
              + 20*greatest(
                extensions.similarity(
                  lower(coalesce(c.external_id,'')),
                  v_normalized
                ),
                extensions.similarity(
                  lower(trim(concat_ws(' ',c.first_name,c.last_name))),
                  v_normalized
                ),
                extensions.similarity(
                  lower(coalesce(c.email,'')),
                  v_normalized
                ),
                extensions.similarity(
                  lower(coalesce(c.phone,'')),
                  v_normalized
                )
              )
            )::real as rank
          from public.customers c
          where c.organization_id=p_organization_id
            and (
              lower(
                coalesce(c.external_id,'') || ' ' ||
                coalesce(c.first_name,'') || ' ' ||
                coalesce(c.last_name,'') || ' ' ||
                coalesce(c.email,'') || ' ' ||
                coalesce(c.phone,'')
              ) like '%'||v_normalized||'%'
              or greatest(
                extensions.similarity(
                  lower(coalesce(c.external_id,'')),
                  v_normalized
                ),
                extensions.similarity(
                  lower(trim(concat_ws(' ',c.first_name,c.last_name))),
                  v_normalized
                ),
                extensions.similarity(
                  lower(coalesce(c.email,'')),
                  v_normalized
                ),
                extensions.similarity(
                  lower(coalesce(c.phone,'')),
                  v_normalized
                )
              )>=0.22
            )
          order by rank desc,display_name,c.id
          limit v_limit
        ) r
      ),'[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'entity_type','product',
    'query',v_query,
    'items',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.rank desc,r.name,r.id)
      from (
        select
          p.id,
          p.external_id,
          p.sku,
          p.name,
          p.category,
          p.serial_number,
          (
            case
              when lower(coalesce(p.external_id,''))=v_normalized then 100
              when lower(coalesce(p.serial_number,''))=v_normalized then 98
              when lower(coalesce(p.sku,''))=v_normalized then 95
              when lower(coalesce(p.external_id,'')) like v_normalized||'%' then 75
              when lower(coalesce(p.serial_number,'')) like v_normalized||'%' then 72
              when lower(coalesce(p.sku,'')) like v_normalized||'%' then 70
              when lower(p.name) like v_normalized||'%' then 65
              else 0
            end
            + 20*greatest(
              extensions.similarity(
                lower(coalesce(p.external_id,'')),
                v_normalized
              ),
              extensions.similarity(
                lower(coalesce(p.sku,'')),
                v_normalized
              ),
              extensions.similarity(
                lower(p.name),
                v_normalized
              ),
              extensions.similarity(
                lower(coalesce(p.serial_number,'')),
                v_normalized
              )
            )
          )::real as rank
        from public.products p
        where p.organization_id=p_organization_id
          and (
            lower(
              coalesce(p.external_id,'') || ' ' ||
              coalesce(p.sku,'') || ' ' ||
              coalesce(p.name,'') || ' ' ||
              coalesce(p.category,'') || ' ' ||
              coalesce(p.serial_number,'')
            ) like '%'||v_normalized||'%'
            or greatest(
              extensions.similarity(
                lower(coalesce(p.external_id,'')),
                v_normalized
              ),
              extensions.similarity(
                lower(coalesce(p.sku,'')),
                v_normalized
              ),
              extensions.similarity(
                lower(p.name),
                v_normalized
              ),
              extensions.similarity(
                lower(coalesce(p.serial_number,'')),
                v_normalized
              )
            )>=0.22
          )
        order by rank desc,p.name,p.id
        limit v_limit
      ) r
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_case_entity_search(
  uuid,text,text,integer
) from public,anon;
grant execute on function public.admin_case_entity_search(
  uuid,text,text,integer
) to authenticated;

comment on function public.admin_case_entity_search(uuid,text,text,integer) is
  'MFA/admin-only bounded customer/product lookup for case creation. Minimum query length prevents directory enumeration.';

commit;
