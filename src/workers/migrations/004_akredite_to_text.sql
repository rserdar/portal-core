-- Migration 004: akredite kolonunu INTEGER'dan TEXT'e çevir
-- Sheets'te "TGS", "TCL" gibi metin değerleri tutulduğu için TEXT olmalı

ALTER TABLE certificates ADD COLUMN akredite_text TEXT;
UPDATE certificates SET akredite_text = NULL;
ALTER TABLE certificates DROP COLUMN akredite;
ALTER TABLE certificates RENAME COLUMN akredite_text TO akredite;
