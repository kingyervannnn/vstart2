UPDATE app_settings
SET document = jsonb_set(
      jsonb_set(
        jsonb_set(
          document,
          '{speedDial,wheelResistance}',
          to_jsonb(CASE
            WHEN COALESCE((document #>> '{speedDial,wheelResistance}')::numeric, 1) <= 5 THEN 20
            ELSE LEAST(100, GREATEST(0, (document #>> '{speedDial,wheelResistance}')::numeric))
          END),
          true
        ),
        '{search,appearance}',
        jsonb_build_object('outerGlow', false, 'glowOnFocus', true, 'outline', false, 'blur', 19)
          || COALESCE(document #> '{search,appearance}', '{}'::jsonb),
        true
      ),
      '{search,workspaceOffset}',
      jsonb_build_object('wide', 0, 'compact', 0)
        || COALESCE(document #> '{search,workspaceOffset}', '{}'::jsonb),
      true
    ),
    version = version + 1,
    updated_at = now()
WHERE id = 'default';
