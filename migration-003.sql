-- Apply once to an RKX database created before direct account registration.
USE rkx_consulting;

ALTER TABLE users
  ADD COLUMN consent_version VARCHAR(40) NULL AFTER identity_status,
  ADD COLUMN terms_consented_at DATETIME NULL AFTER consent_version,
  ADD COLUMN privacy_consented_at DATETIME NULL AFTER terms_consented_at,
  ADD COLUMN outsourcing_consented_at DATETIME NULL AFTER privacy_consented_at;

ALTER TABLE tickets
  ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT 'other' AFTER type,
  ADD COLUMN client_request_id CHAR(36) NULL AFTER category,
  ADD UNIQUE KEY uq_tickets_client_request_id (client_request_id);
