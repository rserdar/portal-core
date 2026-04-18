-- Medicert Portal — D1 Migration 002: data_json columns
-- Her tabloya tam canonical objeyi saklayan data_json sütunu eklenir.
-- Bu sayede indexed sütunlar SQL sorguları için, data_json detay okuma için kullanılır.

ALTER TABLE companies     ADD COLUMN data_json TEXT;
ALTER TABLE certificates  ADD COLUMN data_json TEXT;
ALTER TABLE audits        ADD COLUMN data_json TEXT;
ALTER TABLE tests         ADD COLUMN data_json TEXT;
ALTER TABLE proformas     ADD COLUMN data_json TEXT;
