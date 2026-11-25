USE rkx_consulting;

ALTER TABLE users MODIFY identity_status ENUM('not_started','pending','demo_verified','verified','rejected') NOT NULL DEFAULT 'not_started';

CREATE TABLE IF NOT EXISTS identity_verifications (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  client_user_ref VARCHAR(100) NOT NULL UNIQUE,
  provider_reference VARCHAR(100) NULL UNIQUE,
  mode ENUM('demo','ijinfo') NOT NULL,
  stage ENUM('phone','phone_code','id_card','face','completed','failed') NOT NULL DEFAULT 'phone',
  sample_person_no TINYINT UNSIGNED NOT NULL DEFAULT 1,
  code_hash CHAR(129) NULL,
  code_expires_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX (stage, expires_at)
);
