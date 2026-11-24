-- Apply once to a database created with the first RKX schema.
USE rkx_consulting;

ALTER TABLE users
  ADD COLUMN customer_key VARCHAR(32) NULL AFTER id,
  MODIFY COLUMN role ENUM('customer','admin','partner') NOT NULL DEFAULT 'customer',
  ADD COLUMN failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN locked_until DATETIME NULL,
  ADD UNIQUE KEY uq_users_customer_key (customer_key);
UPDATE users SET customer_key=CONCAT('RKXLEGACY',LPAD(HEX(id),16,'0')) WHERE role='customer' AND customer_key IS NULL;

ALTER TABLE tickets
  ADD COLUMN receipt_number VARCHAR(32) NULL AFTER id,
  ADD COLUMN assignment_kind ENUM('ai','counselor') NULL AFTER status,
  ADD COLUMN partner_reference VARCHAR(190) NULL AFTER partner_status;
UPDATE tickets SET receipt_number=CONCAT('RKX-LEGACY-',LPAD(id,10,'0')) WHERE receipt_number IS NULL;
ALTER TABLE tickets MODIFY COLUMN receipt_number VARCHAR(32) NOT NULL, ADD UNIQUE KEY uq_tickets_receipt_number (receipt_number);

ALTER TABLE chat_messages MODIFY COLUMN sender ENUM('customer','admin','partner') NOT NULL;
UPDATE chat_messages SET sender='partner' WHERE sender='admin';
ALTER TABLE chat_messages
  MODIFY COLUMN sender ENUM('customer','partner') NOT NULL,
  ADD COLUMN partner_status ENUM('not_configured','sent','failed') NOT NULL DEFAULT 'not_configured';

CREATE TABLE IF NOT EXISTS signup_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  consent_version VARCHAR(40) NOT NULL,
  provider_reference VARCHAR(190) UNIQUE,
  status ENUM('pending','verified','rejected','expired') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  INDEX (email, status), INDEX (created_at)
);

CREATE TABLE IF NOT EXISTS recordings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(80) NOT NULL,
  mime_type VARCHAR(60) NOT NULL,
  retention_until DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  INDEX (retention_until, deleted_at)
);
CREATE TABLE IF NOT EXISTS recording_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recording_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action ENUM('registered','played','deleted') NOT NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE,
  INDEX (recording_id, occurred_at)
);
CREATE TABLE IF NOT EXISTS access_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(50) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id VARCHAR(80) NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (actor_user_id, created_at)
);
