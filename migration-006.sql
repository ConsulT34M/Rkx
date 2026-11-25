USE rkx_consulting;

ALTER TABLE signup_requests MODIFY phone VARCHAR(30) NULL;
ALTER TABLE signup_requests ADD COLUMN token_hash CHAR(64) NULL UNIQUE AFTER consent_version;
ALTER TABLE signup_requests ADD COLUMN client_user_ref VARCHAR(100) NULL UNIQUE AFTER token_hash;
ALTER TABLE signup_requests ADD COLUMN mode ENUM('demo','ijinfo') NULL AFTER status;
ALTER TABLE signup_requests ADD COLUMN stage ENUM('intro','phone','phone_code','id_card','face','completed','failed') NOT NULL DEFAULT 'intro' AFTER mode;
ALTER TABLE signup_requests ADD COLUMN code_hash CHAR(129) NULL AFTER stage;
ALTER TABLE signup_requests ADD COLUMN code_expires_at DATETIME NULL AFTER code_hash;
