-- Medicert Portal — D1 Migration 005: audits tablosuna eksik sütunlar
-- 003 relational schema'da bırakılan audit alanları ekleniyor.
-- a1/a2 kapsam ve event_id olmadan edit formu bu değerleri kaybediyor.

ALTER TABLE audits ADD COLUMN a1_kapsam   TEXT;
ALTER TABLE audits ADD COLUMN a1_event_id TEXT;
ALTER TABLE audits ADD COLUMN a1_auditor  TEXT;
ALTER TABLE audits ADD COLUMN a1_lead     TEXT;
ALTER TABLE audits ADD COLUMN a2_kapsam   TEXT;
ALTER TABLE audits ADD COLUMN a2_event_id TEXT;
ALTER TABLE audits ADD COLUMN a2_auditor  TEXT;
ALTER TABLE audits ADD COLUMN a2_lead     TEXT;
ALTER TABLE audits ADD COLUMN qms         TEXT;
ALTER TABLE audits ADD COLUMN mdd         TEXT;
ALTER TABLE audits ADD COLUMN ems         TEXT;
ALTER TABLE audits ADD COLUMN ohs         TEXT;
ALTER TABLE audits ADD COLUMN fsms        TEXT;
ALTER TABLE audits ADD COLUMN isms        TEXT;
ALTER TABLE audits ADD COLUMN engy        TEXT;
ALTER TABLE audits ADD COLUMN gmp         TEXT;
