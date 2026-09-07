-- STAGING ONLY. These synthetic records make the production flow testable.
-- Never apply this file to the live customer database.

begin;

insert into public.organizations (id, slug, name, support_email)
values ('00000000-0000-4000-8000-000000000001', 'maison-atlas-staging', 'Maison Atlas · Préproduction', 'support@entreprise.example')
on conflict (id) do update set name = excluded.name, support_email = excluded.support_email;

insert into public.stores (id, organization_id, code, name, city)
values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'PAR-001', 'Maison Atlas Paris République', 'Paris'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'LIL-001', 'Maison Atlas Lille Centre', 'Lille')
on conflict (id) do update set name = excluded.name, city = excluded.city;

insert into public.customers (id, organization_id, external_id, first_name, last_name)
values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', 'STAGING-C-001', 'Camille', 'Martin'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', 'STAGING-C-002', 'Yanis', 'Benali')
on conflict (id) do update set first_name = excluded.first_name, last_name = excluded.last_name;

insert into public.products (id, organization_id, external_id, sku, name, category)
values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', 'STAGING-P-001', 'TV-OLED-55', 'Téléviseur OLED 55 pouces', 'Image & son'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', 'STAGING-P-002', 'ROB-CUIS-01', 'Robot de cuisine', 'Petit électroménager')
on conflict (id) do update set name = excluded.name, category = excluded.category;

insert into public.service_cases (
  id, organization_id, customer_id, product_id, store_id, reference, kind,
  title, description, status, warranty_status, warranty_label, delivery_mode,
  estimated_at, source_system, source_updated_at
) values
  (
    '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000101', 'SAV-2026-1042', 'repair',
    'Écran noir intermittent', 'Le diagnostic est terminé et la pièce nécessaire est commandée.',
    'waiting_part', 'covered', 'Prise en charge sous garantie', 'Retrait en magasin',
    now() + interval '5 days', 'staging_seed', now()
  ),
  (
    '00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000302',
    '00000000-0000-4000-8000-000000000102', 'SC-2026-2048', 'complaint',
    'Accessoire manquant', 'La demande est prise en charge par le service client.',
    'complaint_review', 'unknown', 'Analyse en cours', 'Réponse par email',
    now() + interval '2 days', 'staging_seed', now()
  )
on conflict (id) do update set
  status = excluded.status,
  description = excluded.description,
  estimated_at = excluded.estimated_at,
  source_updated_at = excluded.source_updated_at;

insert into public.case_events (
  id, organization_id, case_id, status, label, details, customer_visible, source, occurred_at
) values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000401', 'received', 'Produit reçu par le SAV', '{}', true, 'staging_seed', now() - interval '4 days'),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000401', 'diagnosis', 'Diagnostic terminé', '{}', true, 'staging_seed', now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000401', 'waiting_part', 'Pièce commandée', '{"detail":"Livraison fournisseur attendue"}', true, 'staging_seed', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000402', 'opened', 'Demande enregistrée', '{}', true, 'staging_seed', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000402', 'complaint_review', 'Analyse par le service client', '{}', true, 'staging_seed', now() - interval '3 hours')
on conflict (id) do update set label = excluded.label, occurred_at = excluded.occurred_at;

select public.set_case_access_code(
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000401',
  '482731',
  now() + interval '90 days'
);
select public.set_case_access_code(
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000402',
  '639204',
  now() + interval '90 days'
);

commit;
