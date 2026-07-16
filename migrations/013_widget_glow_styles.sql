UPDATE app_settings
SET document = jsonb_set(
  jsonb_set(
    document,
    '{widgets}',
    '{"musicGlowStyle":"bottom","musicGlowTrigger":"connected","musicOutline":false}'::jsonb
      || COALESCE(document -> 'widgets', '{}'::jsonb),
    true
  ),
  '{search,appearance}',
  jsonb_build_object(
    'glowStyle',
    CASE
      WHEN COALESCE((document #>> '{search,appearance,outerGlow}')::boolean, false) THEN 'full'
      ELSE 'bottom'
    END,
    'glowTrigger',
    CASE
      WHEN COALESCE((document #>> '{search,appearance,glowOnFocus}')::boolean, true) THEN 'typing'
      ELSE 'always'
    END
  ) || COALESCE(document #> '{search,appearance}', '{}'::jsonb),
  true
),
version = version + 1,
updated_at = now()
WHERE id = 'default';
