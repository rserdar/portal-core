-- Migration 008: audits tablosundan Calendar/redundant sütunları kaldır
-- Artık denetimlerle Google Calendar entegrasyonu yapılmıyor.

ALTER TABLE audits DROP COLUMN a1_kapsam;
ALTER TABLE audits DROP COLUMN a1_event_id;
ALTER TABLE audits DROP COLUMN a1_auditor;
ALTER TABLE audits DROP COLUMN a1_lead;
ALTER TABLE audits DROP COLUMN a2_kapsam;
ALTER TABLE audits DROP COLUMN a2_event_id;
ALTER TABLE audits DROP COLUMN a2_auditor;
ALTER TABLE audits DROP COLUMN a2_lead;
ALTER TABLE audits DROP COLUMN qms;
ALTER TABLE audits DROP COLUMN mdd;
ALTER TABLE audits DROP COLUMN ems;
ALTER TABLE audits DROP COLUMN ohs;
ALTER TABLE audits DROP COLUMN fsms;
ALTER TABLE audits DROP COLUMN isms;
ALTER TABLE audits DROP COLUMN engy;
ALTER TABLE audits DROP COLUMN gmp;
