SELECT
  status,
  COUNT(*) AS job_count,
  MIN(created_at) AS oldest_job,
  MAX(created_at) AS newest_job
FROM enrichment_jobs
WHERE org_id = 'default'
GROUP BY status
ORDER BY status;
