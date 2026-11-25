USE rkx_consulting;

ALTER TABLE users MODIFY phone VARCHAR(30) NULL;
ALTER TABLE identity_verifications ADD COLUMN pending_phone VARCHAR(30) NULL AFTER sample_person_no;
