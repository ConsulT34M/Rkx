CREATE DATABASE IF NOT EXISTS rkx_consulting CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE rkx_consulting;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_key VARCHAR(32) UNIQUE,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  phone VARCHAR(30) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('customer','admin','partner') NOT NULL DEFAULT 'customer',
  identity_status ENUM('not_started','pending','verified','rejected') NOT NULL DEFAULT 'not_started',
  consent_version VARCHAR(40) NULL,
  terms_consented_at DATETIME NULL,
  privacy_consented_at DATETIME NULL,
  outsourcing_consented_at DATETIME NULL,
  failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  INDEX (email, status),
  INDEX (created_at)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (expires_at)
);

CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_number VARCHAR(32) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  type ENUM('consultation','reentry','phone') NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'other',
  client_request_id CHAR(36) NULL UNIQUE,
  subject VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  preferred_time VARCHAR(100),
  recording_consent BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('received','in_progress','completed') NOT NULL DEFAULT 'received',
  assignment_kind ENUM('ai','counselor') NULL,
  partner_status ENUM('not_configured','sent','failed') NOT NULL DEFAULT 'not_configured',
  partner_reference VARCHAR(190),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (user_id, created_at),
  INDEX (status, created_at)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  sender ENUM('customer','partner') NOT NULL,
  body TEXT NOT NULL,
  partner_status ENUM('not_configured','sent','failed') NOT NULL DEFAULT 'not_configured',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (user_id, id)
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
