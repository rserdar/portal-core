-- Medicert Portal — D1 Migration 006: normalize certificates.akredite as TEXT
--
-- 004 migration'i certificates.akredite kolonunu TEXT'e cevirmisti ancak
-- mevcut degerleri tasimadan kolonu yeniden olusturdugu icin veri kaybi riski
-- yaratti. Migration disiplini geregi 004 degistirilmiyor; bunun yerine bu
-- corrective migration mevcut kolonun semantigini normalize ediyor.
--
-- Not: 004 daha once uygulanip akredite degerleri NULL'a dusurulduyse, bu
-- migration kaybolan veriyi geri getiremez. Ancak elde kalan / sonradan gelen
-- degerleri tek tip TEXT formata getirir.

UPDATE certificates
SET akredite = CASE
  WHEN akredite IS NULL THEN NULL
  WHEN TRIM(CAST(akredite AS TEXT)) = '' THEN NULL
  WHEN LOWER(TRIM(CAST(akredite AS TEXT))) IN ('1', 'true', 'yes', 'evet') THEN 'TRUE'
  WHEN LOWER(TRIM(CAST(akredite AS TEXT))) IN ('0', 'false', 'no', 'hayir', 'hayır') THEN 'FALSE'
  ELSE TRIM(CAST(akredite AS TEXT))
END;
