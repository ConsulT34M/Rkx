USE rkx_consulting;

CREATE TABLE IF NOT EXISTS mk_chat_rooms (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  subject_ref CHAR(36) NOT NULL UNIQUE,
  intake_id CHAR(36) NOT NULL UNIQUE,
  case_id CHAR(36) NULL UNIQUE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
