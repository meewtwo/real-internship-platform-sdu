-- "Publish after approval": a company waiting for admin approval cannot publish, so the employer can ask for a draft to be published as soon as
-- the company is approved. Set by POST /api/vacancies/:id/publish-request, cleared when the vacancy is published (or the request withdrawn).
ALTER TABLE vacancies ADD COLUMN publish_requested_at TEXT;
CREATE INDEX vacancies_publish_requested_idx ON vacancies (employer_id) WHERE publish_requested_at IS NOT NULL;

-- One-time fix for drafts created while the company was still pending: publishing was blocked then, and approval left them as drafts, so
-- students never saw them. They are marked as requested; the approval / cron sweep (publishRequestedDrafts) publishes them properly
-- (validation, matching, notifications). Drafts written after the approval are the employer's own choice and stay drafts.
UPDATE vacancies SET publish_requested_at = created_at
WHERE status = 'draft' AND EXISTS (
  SELECT 1 FROM employer_profiles ep WHERE ep.user_id = vacancies.employer_id
    AND (ep.review_status = 'pending' OR (ep.review_status = 'approved' AND ep.reviewed_at IS NOT NULL AND ep.reviewed_at > vacancies.created_at)));
