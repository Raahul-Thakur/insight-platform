SELECT
  COUNT(*) AS total_startups,
  COUNT(*) FILTER (WHERE last_enriched_at IS NOT NULL) AS enriched_startups,
  COUNT(*) FILTER (
    WHERE domain IS NULL
       OR funding_stage IS NULL
       OR hq_location IS NULL
  ) AS missing_data_startups
FROM startups
WHERE org_id = 'default';
