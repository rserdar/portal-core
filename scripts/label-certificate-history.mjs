/**
 * label-certificate-history.mjs — v2
 *
 * Kural tabanlı EA/NACE etiketleyici.
 * Tüm regex pattern'ler normalise edilmiş metne (ğ→g, ş→s, ç→c, ı→i, ü→u, ö→o) karşı çalışır.
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function readJson(p) {
  return JSON.parse(readFileSync(join(root, p), "utf-8").replace(/^﻿/, ""));
}

const history = readJson("src/data/certificate-history.json");
const naceCodesData = readJson("src/content/reference/nace-codes.json");

const naceToEa = {};
naceCodesData.items.forEach((i) => { if (i.code) naceToEa[i.code] = i.ea || ""; });

// ---------------------------------------------------------------------------
// Metin normalleştirme (classification-reference.ts ile birebir)
// ---------------------------------------------------------------------------
function norm(text) {
  return String(text || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\n/g, " ")
    .trim();
}

// Kombinlenmiş normalise metin üzerinde test eder
function has(tr, en, pattern) {
  return pattern.test(tr + " " + en);
}

// ---------------------------------------------------------------------------
// KURALLAR — normalise forma (ASCII) göre yazılmıştır
// Öncelik sıralıdır: ilk eşleşen kazanır.
// ---------------------------------------------------------------------------
const RULES = [

  // ════════════════════════════════════════════════════════════════════════
  // ELEKTROMED — ventilatör, monitör, görüntüleme, EEG, TENS
  // ════════════════════════════════════════════════════════════════════════
  { nace: "26.60", note: "Elektromed: anestezi, ventilatör, hasta monitörü, görüntüleme imalatı",
    match: (tr, en) =>
      has(tr, en, /anestezi.*(cihaz|makine|imalat)|ventilator|yoğun.?bakim.?(ventilator|cihaz)|anesthesia.?device|intensive.?care.*ventilat/i) ||
      has(tr, en, /elektro.?medikal|elektro.?terapik|pet.?tarayici|mri.*(imalat|uretim)|tibbi.?ultrason|defibrilat|hasta.*monitor.*(uretim|imalat)|electromedical|electrotherapy/i) ||
      has(tr, en, /tens.?cihaz.*(uretim|tasarim|imalat)|ecct.*cancer.?therapy|electrotherapy.*electrode/i),
  },
  { nace: "26.60", note: "Elektromed: nebülizatör, akıl sağlığı, elektroterapi aksesuarı",
    match: (tr, en) =>
      has(tr, en, /nebulizat[oe]r|oksijen.?terapi.*debimetre|medikal.?flowmetre|sinir.?stimulator.*(uretim|imalat)|k.?wire.*(uretim|imalat)|mobil.?yurume.?robotu/i) ||
      has(tr, en, /ecct.?mvs|ecct.?c1|erectostimulation|eye.*massager/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // TIBBİ CİHAZ / DENTAL / ORTOPEDİ / CERRAHİ (32.50)
  // ════════════════════════════════════════════════════════════════════════
  { nace: "32.50", note: "Dental ürün imalatı",
    match: (tr, en) =>
      has(tr, en, /dental|dis.?hekim|dishekimligi|zirkonY|zirkonyum|dental.?alasim|dental.?alci|zirkon.?blok|kronlar.*(dental|dis)/i),
  },
  { nace: "32.50", note: "İmplant, protez, ortopedik imalat",
    match: (tr, en) =>
      has(tr, en, /implant|protez.*(uretim|imalat|tasarim)|ortopedik.*(urun|cihaz|alet|imalat)|omurga.?implant|pedicle.?screw|kemik.*celik.?vida|spinal.*implant/i),
  },
  { nace: "32.50", note: "Bacak, ayak protezi, ortez imalatı",
    match: (tr, en) =>
      has(tr, en, /bacak.*(protez|ortez)|ayak.*(protez|ortez)|ortopedik.*urun.*(uretim|imalat|tasarim)/i),
  },
  { nace: "32.50", note: "Tek kullanımlık cerrahi örtü, önlük, nonwoven medikal tekstil",
    match: (tr, en) =>
      has(tr, en, /cerrahi.?(ortu|onluk|havlu|set)|surgical.?(drape|gown|towel)|tek.?kullanimlik.*(ortu|onluk)/i),
  },
  { nace: "32.50", note: "Şırınga, iğne, kateter, infüzyon seti imalatı",
    match: (tr, en) =>
      has(tr, en, /siringa|hipoderMik.?igne|sterİl.?igne|sterile.?needle|kateter|infuzyon.?set|steril.?siringa|sterile.?syringe|sterile.?catheter/i),
  },
  { nace: "32.50", note: "Cerrahi eldiven, lateks/nitril eldiven imalatı",
    match: (tr, en) =>
      has(tr, en, /cerrahi.?eldiven|lateks.*(muayene|eldiven)|nitril.?eldiven|surgical.?glove|latex.*glove|nitrile.*glove/i),
  },
  { nace: "32.50", note: "Kompres, gazlı bez, cerrahi maske, nonwoven medikal imalatı",
    match: (tr, en) =>
      has(tr, en, /gazli.?bez|kompres|cerrahi.?maske|absorban.*pad|lap.?sponge|surgical.?mask|nonwoven.*absorb|tibbi.*nonwoven|steril.*nonwoven/i),
  },
  { nace: "32.50", note: "Tıbbi cihaz genel imalatı (sterile/non-sterile medical devices)",
    match: (tr, en) =>
      has(tr, en, /tibbi.?(cihaz|alet|malzeme|urun).*(imalat|uretim|manufactur|product|satis|ithalat|ihracat)|manufacturing.*(medical|medikal).?device|medical.?device.*(manufactur|product|sale)|sterile.*medical.*(manufactur|product)/i) ||
      (tr === "tibbi cihaz" || tr === "medical device") ||
      (has(tr, en, /steril|non.?steril/i) && has(tr, en, /urun.*(uretim|satis|imalat)/i)),
  },
  { nace: "32.50", note: "Tanısal ve terapötik cihazlar — Ar-Ge, üretim, ithalat/ihracat, satış ve distribütörlük",
    match: (tr, en) =>
      has(
        tr,
        en,
        /diagnostic.and.therapeutic.devices|in.?vitro.and.in.?vivo.diagnostic|diagnostic.devices|therapeutic.devices|tani.?ve.?tedavi.?cihaz|tanisal.?ve.?terapotik.?cihaz/i,
      ),
  },
  { nace: "32.50", note: "Hastane yatağı, tekerlekli sandalye, medikal mobilya imalatı",
    match: (tr, en) =>
      has(tr, en, /hastane.?yatagi.*(uretim|imalat)|tekerlekli.?sandalye.*(uretim|imalat)|medikal.?mobilya|tibbi.?mobilya|hospital.?bed.*(manufactur|product)|wheelchair.*(manufactur|product)/i),
  },
  { nace: "32.50", note: "Medikal sektör için talaşlı / metal parça imalatı",
    match: (tr, en) =>
      has(tr, en, /medikal.?sektor.*(icin|için)|tibbi.?sektor.*(icin|için)|medical.?industry.*manufactur|manufactur.*medical.?industry/i),
  },
  { nace: "32.50", note: "Medikal gaz sistemi, oksijen ekipmanı, akım regülatörü imalatı",
    match: (tr, en) =>
      has(tr, en, /medikal.?gaz.?(sistem|urun|ekipman)|oksijen.?terapi|oksijen.?gaz.?sistemi|medical.?gas.?(system|product)|oxygen.?therapy/i),
  },
  { nace: "32.50", note: "Sterilizasyon göstergesi (biyolojik indikatör, otoklav bandı) imalatı",
    match: (tr, en) =>
      has(tr, en, /biyolojik.?indikat|otoklav.?(bandi|test)|etilen.?oksit.?sterilizasyon|buhar.?indikat|formaldehit.?(bandi|indikat)|bowie.{0,4}dick|hydrogen.?peroxide.*indicator|biological.?indicator|autoclave.?(tape|band|test)/i),
  },
  { nace: "32.50", note: "PCR tanı kiti, scarex jel, yara bakım, diyabetik bariyer solüsyon",
    match: (tr, en) =>
      has(tr, en, /pcr.*(tani|kit)|tani.?kiti.*(uretim|imalat)|scarex.?jel|yara.?(bakim|bariyer|cozucu|spreyi).*(uretim|imalat|cozelti|jel)|yanIk.?bariyer|yanIk.*jel.*(uretim|imalat)|diyabet.*bariyer|sclero.?foam|felix.?filler|pentaderm|cloud.?clean|central.?bariyer/i),
  },
  { nace: "32.50", note: "Laparoskopi, gastroskopi, kolonoskopi aletleri imalatı",
    match: (tr, en) =>
      has(tr, en, /laparoskopi.*(alet|cihaz|uretim|imalat)|gastroskopi|kolonoskopi|end[eo]skop.*(uretim|imalat|satis|urun)/i),
  },
  { nace: "32.50", note: "Tibbi atik kovasi, dezenfektan standi, sterilizasyon urun",
    match: (tr, en) =>
      has(tr, en, /tibbi.?atik.?(kova|kap|konteyner)|enfekte.*atik.*kova|medikal.*cam.*atik/i),
  },
  { nace: "32.50", note: "Deri stapler, cildi kapatan, disposable medikal aksesuar",
    match: (tr, en) =>
      has(tr, en, /cilt.?stapler|skin.?stapler|tek.?kullanimlik.*(medikal|tibbi|cerrahi).*(plastik|adaptör|tipa|conta|baglanti)|disposable.?(medical|surgical).*(adapter|tip|connector)/i),
  },
  { nace: "32.50", note: "İdrar/kemo torbası, oksijen maskesi, nazal kanül, medikal tek kullanımlık",
    match: (tr, en) =>
      has(tr, en, /idrar.?torbasi|kemoterapi.?torbasi|eva.?torba.*(steril|medikal|tibbi)|oksijen.?maskesi|nazal.?oksijen.?kanul|oxygen.?mask|urinary.?bag|chemotherapy.?bag/i),
  },
  { nace: "32.50", note: "İdrar numune kabı, smear fırçası, HME filtresi (medikal)",
    match: (tr, en) =>
      has(tr, en, /idrar.?numune.?kabi|smear.?fircasi|hme.?(filtre|filter)|urine.?sample|smear.?brush/i),
  },
  { nace: "32.50", note: "Soda-lime (anestezi ekipmanı malzemesi) imalatı",
    match: (tr, en) =>
      has(tr, en, /soda.?lime|sorbo.?lime/i),
  },
  { nace: "32.50", note: "Etilen oksit sterilizasyon validasyonu ve test hizmeti",
    match: (tr, en) =>
      has(tr, en, /etilen.?oksit.?sterilizasyon.?validasyonu|paketleme.?validasyonu|gama.?doz.?tayini/i),
  },
  { nace: "32.50", note: "Odyolojik sessiz kabin (medikal tanı amaçlı)",
    match: (tr, en) =>
      has(tr, en, /odyolojik.*(kabin|test)|audiological.*(cabin|booth)|isitme.?cihaz/i),
  },
  { nace: "32.50", note: "Farmasötik şişe, flakon (cam veya plastik) imalatı",
    match: (tr, en) =>
      has(tr, en, /farmasotik.*(sise|flakon|uretim)|pharmaceutical.*(bottle|vial|flask).*(manufactur|product)/i),
  },
  { nace: "32.50", note: "Cerrahi/tıbbi ortopedik alet ve hizmetler, diyaliz, fizik tedavi (karma)",
    match: (tr, en) =>
      has(tr, en, /cerrahi.*tibbi.*ortopedik.*(alet|cihaz).*(uretim|imalat)|diyaliz.?(servis|hizmet)|fizik.?tedavi.?(servis|hizmet)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // İLAÇ / ECZACILIK
  // ════════════════════════════════════════════════════════════════════════
  { nace: "21.20", note: "İlaç formülasyon imalatı (tablet, kapsül, ampul, şurup, solüsyon)",
    match: (tr, en) =>
      has(tr, en, /tablet|kapsul|ampul|surup|oral.?(sivi|cozelti|damla|sprey)|supozituar|agri.?kesici.?imalat|beseri.?ilac.*(imalat|uretim)/i) &&
      has(tr, en, /imalat|uretim|manufactur|production/i),
  },
  { nace: "21.10", note: "Gıda takviyesi / vitamin / probiyotik imalatı",
    match: (tr, en) =>
      has(tr, en, /gida.?takviyesi|besin.?destegi|food.?supplement|probiyotik|probiotic/i) &&
      has(tr, en, /imalat|uretim|manufactur|production/i),
  },
  { nace: "46.46", note: "Tıbbi/ilaç ürünlerin depolanması, toptan satışı, GDP",
    match: (tr, en) =>
      has(tr, en, /beseri.?ilac.*(depolama|satis|toptan)|tibbi.?(cihaz|urun).*(depolama|satis|toptan)(?!.*imalat|.*uretim)|medical.?(device|product).*(storage|wholesale)(?!.*manufactur)|iyi.dagitim.uygulamalari|good.distribution.practice/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // KOZMETİK / KİŞİSEL BAKIM / SABUN / DETERJAN
  // ════════════════════════════════════════════════════════════════════════
  { nace: "20.42", note: "Kozmetik, parfüm, kişisel bakım imalatı",
    match: (tr, en) =>
      has(tr, en, /kozmetik|parfum|kolonya|roll.?on|kisisel.?bakim|personal.?care|sac.?bakim|cilt.?bakim|sampuan|losyon|balsam|deodorant|tiras/i) &&
      has(tr, en, /imalat|uretim|manufactur|production/i),
  },
  { nace: "20.41", note: "Deterjan, sabun, temizlik kimyasalı imalatı",
    match: (tr, en) =>
      has(tr, en, /deterjan|temizlik.*(urun|malzeme|kimyas).*(imalat|uretim|manufactur)|kisisel.*temizlik.*(uretim|imalat)|genel.*temizlik.*(uretim|imalat)|leke.?cikarici|irec.?sokuc|cleaning.*(product|material).*(manufactur|product)/i),
  },
  { nace: "20.41", note: "Sabun imalatı",
    match: (tr, en) =>
      has(tr, en, /sabun.*(imalat|uretim)|soap.*(manufactur|product)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // DEZENFEKTİF / PESTİSİT / HAYVAN SAĞLIĞI
  // ════════════════════════════════════════════════════════════════════════
  { nace: "20.20", note: "Dezenfektan, biyosidal, hayvan sağlığı ürünleri imalatı",
    match: (tr, en) =>
      has(tr, en, /dezenfektan.*(imalat|uretim)|disinfectant.*(manufactur|product)|biyosidal.*(imalat|uretim)|biocidal.*(manufactur|product)|hayvan.?saglik.*(urun|imalat)|animal.?health.*(product|manufactur)/i),
  },
  { nace: "81.29", note: "Haşere mücadelesi hizmetleri",
    match: (tr, en) =>
      has(tr, en, /hasere.*(mucadele|ilacla|kontrol)|kemiRgen.*(mucadele|kontrol)|pest.?control|disinfection.?service|ilacla.*hizmet.*temizlik/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // GIDA / İÇECEK
  // ════════════════════════════════════════════════════════════════════════
  { nace: "11.07", note: "Meşrubat, içecek imalatı",
    match: (tr, en) =>
      has(tr, en, /mesrubat|icecek.*(imalat|uretim)|soft.?drink|beverage.*(manufactur|product)/i),
  },
  { nace: "10.51", note: "Süt ve süt ürünleri imalatı",
    match: (tr, en) =>
      has(tr, en, /sut.*(urun|isleme|imalat|manufactur)|peynir|yogurt|kaymak|kefir/i),
  },
  { nace: "10.11", note: "Et işleme imalatı",
    match: (tr, en) =>
      has(tr, en, /(kirmizi|kirmizi).?et|kasap|karkas|sigir|dana.?et|koyun.?et|et.?(isleme|imalat)|meat.?processing/i),
  },
  { nace: "10.12", note: "Kanatlı et işleme",
    match: (tr, en) =>
      has(tr, en, /kanatli.?et|tavuk.?et|hindi.?et|pilic.?(isleme|uretim)|poultry.?processing/i),
  },
  { nace: "10.39", note: "Meyve/sebze işleme, konserve, salça",
    match: (tr, en) =>
      has(tr, en, /meyve.*(isleme|kurutma|konserve)|sebze.*(isleme|konserve)|tursu|salca|domates.*(isleme|salca)|konserve.*(meyve|sebze)|jam|marmalade|tomato.*paste/i),
  },
  { nace: "10.41", note: "Bitkisel yağ imalatı",
    match: (tr, en) =>
      has(tr, en, /zeytinyagi|zeytin.?yagi|bitkisel.?yag|aycicek.?yagi|kanola.?yag|rafine.?yag|vegetable.?oil|olive.?oil/i),
  },
  { nace: "10.61", note: "Tahıl işleme, un, nişasta, kepek imalatı",
    match: (tr, en) =>
      has(tr, en, /un.?(imalat|uretim|manufactur)|bugday.?isleme|nistasta|pirinc.?(isleme|unu)|grain.?milling|kepek.?(uretim|imalat)|un.?ve.?kepek/i),
  },
  { nace: "10.61", note: "Bakliyat, kuru meyve, kuruyemiş işleme",
    match: (tr, en) =>
      has(tr, en, /bakliyat|kuru.?meyve|kuruyemis|findik.*(isleme|ic)|fistik.*(isleme|ic)|ceviz|badem.*(isleme)|nohut|mercimek|bulgur|kuru.?fasulye/i),
  },
  { nace: "10.71", note: "Ekmek, pastane, unlu mamul imalatı",
    match: (tr, en) =>
      has(tr, en, /ekmek|pasta|borek|simit|unlu.?mamul|bread|bakery/i),
  },
  { nace: "10.82", note: "Şekerleme, çikolata imalatı",
    match: (tr, en) =>
      has(tr, en, /cikolata|sekerleme|lokum|seker.?(urun|imalat)|candy|chocolate|confection/i),
  },
  { nace: "10.20", note: "Balık ve su ürünleri işleme",
    match: (tr, en) =>
      has(tr, en, /balik.*(isleme|urun)|su.?urunleri.*(isleme)|seafood.?processing|fish.*processing/i),
  },
  { nace: "10.84", note: "Baharat, sos, ketçap, çeşni imalatı",
    match: (tr, en) =>
      has(tr, en, /baharat|sos.*(imalat|uretim)|ketcap|mayonez|hardal|ketchup|sauce.*(manufactur)|spice.*(imalat|blend)|condiment/i),
  },
  { nace: "10.91", note: "Hayvan yemi imalatı",
    match: (tr, en) =>
      has(tr, en, /(?=.*(hayvan|ciftlik|kanatli))(?=.*(yem|mama)).*(imalat|uretim|hazir|satis)/i) ||
      has(tr, en, /animal.?feed.*(manufactur|product)/i),
  },
  { nace: "17.22", note: "Kağıt ambalaj, pizza kutusu imalatı",
    match: (tr, en) =>
      has(tr, en, /pizza.?kutu|paket.?servis.?gida.*ambalaj|gida.*temas.*kagit.*ambalaj|kagit.*ambalaj.*(uretim|imalat)|paper.*packaging.*(manufactur|product)/i),
  },
  { nace: "56.10", note: "Restoran, kafeterya, yemek hizmetleri, toplu yemek",
    match: (tr, en) =>
      has(tr, en, /restoran.?hizmet|toplu.?yemek.*(imalat|isletme|temin)|kafeterya.?(hizmet|isletme)|kendi.?yerinde.?yemek.?uretim|restaurant.?service|catering.?service/i),
  },
  { nace: "52.10", note: "Antrepo, serbest depolama, genel depolama ve lojistik dağıtım",
    match: (tr, en) =>
      has(tr, en, /genel.?antrepo|serbest.?depolama|yurtici.?lojistik.?dagitim|gida.*(urunler|malzemelerin).*(depolanmasi|depolama|ihracat|ithalat|serbest.?depo)|food.*(storage|warehouse).*(import|export)/i),
  },
  { nace: "79.12", note: "Tur operatörlüğü, hac/umre organizasyonu",
    match: (tr, en) =>
      has(tr, en, /tur.?organizasyon|hac.*(umre|organizasyon)|umre.*(hac|organizasyon|seyahat)|dini.?gezi.?organizasyon|tour.?operator/i),
  },
  { nace: "25.62", note: "Talaşlı imalat — çoklu sektöre (savunma, otomotiv, gıda, medikal) hizmet",
    match: (tr, en) =>
      has(tr, en, /talasli.?imalat|cnc.*(isleme|imalat)|precision.?machining/i) &&
      has(tr, en, /(savunma|havacilik|otomotiv|beyaz.?esya).*(sektore|sektori|sektor)/i),
  },
  { nace: "10.89", note: "Diğer gıda imalatı",
    match: (tr, en) =>
      has(tr, en, /gida.*(imalat|uretim|manufactur|product)|food.*(manufactur|product|process)|helal.?gida.*(imalat|uretim)/i) &&
      !has(tr, en, /gida.sektore|gida.sektori|gida.sektorleri|food.sector/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // KİMYASAL ÜRÜNLER
  // ════════════════════════════════════════════════════════════════════════
  { nace: "20.30", note: "Boya, vernik, kaplama imalatı",
    match: (tr, en) =>
      has(tr, en, /boya.*(imalat|uretim|manufactur)|vernik.*(imalat|uretim)|paint.*(manufactur|product)|coating.*(manufactur|product)/i),
  },
  { nace: "20.59", note: "Yapıştırıcı, reçine, solvent, diğer kimyasal imalatı",
    match: (tr, en) =>
      has(tr, en, /yapistirici|tutkal|adhesive|recine.*(imalat|uretim|manufactur)|alkid.?recine|polyester.?recine|epoksi.?recine|poliaset|polikarbonat|solvent|cozucu/i) &&
      has(tr, en, /imalat|uretim|manufactur|birincil.?formda/i),
  },
  { nace: "20.11", note: "Sanayi gazı imalatı",
    match: (tr, en) =>
      has(tr, en, /sanayi.?gaz.*(imalat|uretim)|oksijen.*(uretim|imalat)(?!.*terapi|.*medikal)|azot.*(uretim|imalat)|argon|industrial.?gas.*(manufactur|product)/i),
  },
  { nace: "20.15", note: "Gübre imalatı",
    match: (tr, en) =>
      has(tr, en, /gubre.*(imalat|uretim|manufactur)|fertilizer.*(manufactur|product)/i),
  },
  { nace: "20.16", note: "Plastik hammadde, PVC granül imalatı",
    match: (tr, en) =>
      has(tr, en, /pvc.?(granul|hammadde|uretim)|polimer.*(imalat|uretim)|plastik.?hammadde|polymer.*(manufactur|product)/i),
  },
  { nace: "20.13", note: "Kimyasal — diğer temel organik/inorganik",
    match: (tr, en) =>
      has(tr, en, /kimyasal.*(imalat|uretim|manufactur)(?!.*boya|.*deterjan)|kimyevi.*(madde|malzeme).*imalat/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // PLASTİK / KAUÇUK
  // ════════════════════════════════════════════════════════════════════════
  { nace: "22.21", note: "Plastik profil, boru, conta imalatı",
    match: (tr, en) =>
      has(tr, en, /plastik.*(profil|boru|conta|hortum).*(imalat|uretim|manufactur)|plastic.*(profile|pipe|tube|gasket).*(manufactur|product)/i),
  },
  { nace: "22.22", note: "Plastik ambalaj, kap, şişe imalatı",
    match: (tr, en) =>
      has(tr, en, /plastik.*(ambalaj|kap|sise|kutu|torba).*(imalat|uretim)|plastic.*(packaging|container|bottle).*(manufactur|product)/i),
  },
  { nace: "22.29", note: "Diğer plastik ürün (küşkonmaz diken, solid surface, banyo kabini)",
    match: (tr, en) =>
      has(tr, en, /plastik.?(kuskonmaz|kusu|diken)|bird.?spike|solid.?surface.*(tasarim|uretim)|akrilik.*(kabin|kuvet).*(tasarim|uretim)|whirlpool.bath|shower.*whirlpool|plastic.?(bird|spike|solid.?surface)/i),
  },
  { nace: "22.11", note: "Kauçuk, lastik imalatı",
    match: (tr, en) =>
      has(tr, en, /kaucuk.*(imalat|uretim|manufactur)|lastik.*(imalat|uretim)|rubber.*(manufactur|product)|tyre.*(manufactur|product)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // TEKSTİL / HAZIR GİYİM
  // ════════════════════════════════════════════════════════════════════════
  { nace: "14.19", note: "Dış giyim, konfeksiyon, dikiş imalatı",
    match: (tr, en) =>
      has(tr, en, /konfeksiyon|hazir.?giyim|dis.?giyim.*(tasarim|imalat|uretim|satis)|etek|bluz|tayt|t.shirt|sweatshirt|gomlek|elbise.*(tasarim|imalat|uretim)|clothing.*(manufactur|product)|apparel.*(manufactur|product)/i),
  },
  { nace: "14.31", note: "Çorap, ribana, manşet, örme konfeksiyon",
    match: (tr, en) =>
      has(tr, en, /corap|ribana|manset|kol.?manceti|sleeve.?cuff|knitted.?cuff/i),
  },
  { nace: "13.10", note: "İplik, pamuklu elyaf bükme, iplik üretimi",
    match: (tr, en) =>
      has(tr, en, /pamuklu.?elyaf.*(bukme|iplik)|iplik.*(imalat|uretim)(?!.*tekstil.?makine)|yarn.*(manufactur|product)/i),
  },
  { nace: "13.20", note: "Dokuma kumaş imalatı",
    match: (tr, en) =>
      has(tr, en, /dokuma.*(kusas|imalat)|kumaş.*(imalat|uretim)|textile.*(fabric|weaving).*(manufactur|product)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // DERİ / AYAKKABI
  // ════════════════════════════════════════════════════════════════════════
  { nace: "15.20", note: "Ayakkabı, deri ürün imalatı",
    match: (tr, en) =>
      has(tr, en, /ayakkabi.*(imalat|uretim)|deri.*(urun|esya).*(imalat|uretim)|shoe.*manufactur|leather.*goods.*manufactur/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // AHŞAP / AMBALAJ
  // ════════════════════════════════════════════════════════════════════════
  { nace: "16.24", note: "Palet, sandık, kablo makarası, ahşap ambalaj imalatı",
    match: (tr, en) =>
      has(tr, en, /palet.*(uretim|imalat)|sandik.*(ahsap|uretim|imalat)|kablo.?makarasi.*(uretim|imalat)|ahsap.*(urun|paket|ambalaj).*(uretim|imalat)|wooden.*(pallet|crate|drum).*(manufactur|product)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // CAM / SERAMİK / MİNERAL
  // ════════════════════════════════════════════════════════════════════════
  { nace: "23.13", note: "İçi boş cam (şişe, flakon) imalatı",
    match: (tr, en) =>
      has(tr, en, /cam.*(sise|flakon|kap).*(imalat|uretim)|hollow.?glass.*(manufactur|product)|glass.*(bottle|vial|flask).*(manufactur|product)/i),
  },
  { nace: "23.11", note: "Düz/oto camı imalatı",
    match: (tr, en) =>
      has(tr, en, /cam.*(imalat|uretim|manufactur)(?!.*dental|.*dis|.*zirkonyum)|glass.*(manufactur|product)(?!.*dental)/i),
  },
  { nace: "23.41", note: "Seramik ev eşyası imalatı (non-dental)",
    match: (tr, en) =>
      has(tr, en, /seramik.*(imalat|uretim|manufactur)(?!.*dental|.*dis|.*zirkonyum)|ceramics.*(manufactur|product)(?!.*dental)/i),
  },
  { nace: "23.20", note: "Refrakter, ateşe dayanıklı ürün imalatı",
    match: (tr, en) =>
      has(tr, en, /refrakter|ateşe.?dayanikli.*(urun|malzeme|imalat)|refractory.*(product|manufactur)/i),
  },
  { nace: "23.32", note: "Tuğla, kiremit imalatı",
    match: (tr, en) =>
      has(tr, en, /tugla.*(imalat|uretim|ihracat)|kiremit.*(imalat|uretim)|brick.*(manufactur|product)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // ÇİMENTO / BETON
  // ════════════════════════════════════════════════════════════════════════
  { nace: "23.51", note: "Çimento imalatı",
    match: (tr, en) =>
      has(tr, en, /cimento.*(imalat|uretim|manufactur)|cement.*(manufactur|product)/i),
  },
  { nace: "23.61", note: "Beton ürünleri imalatı",
    match: (tr, en) =>
      has(tr, en, /beton.*(urun|eleman|parca|boru|blok).*(imalat|uretim)|concrete.*(product|element).*(manufactur|product)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // TEMEL METAL
  // ════════════════════════════════════════════════════════════════════════
  { nace: "24.42", note: "Alüminyum profil, levha, extrusion imalatı",
    match: (tr, en) =>
      has(tr, en, /aluminyum.*(profil|levha|boru|dokum|imalat|uretim|manufactur)|aluminium.*(profile|sheet|extrusion|manufactur)/i),
  },
  { nace: "24.20", note: "Çelik boru imalatı",
    match: (tr, en) =>
      has(tr, en, /celik.?boru.*(imalat|uretim|manufactur)|steel.?pipe.*(manufactur|product)/i),
  },
  { nace: "24.10", note: "Demir/çelik temel metal imalatı",
    match: (tr, en) =>
      has(tr, en, /celik.*(hadde|haddeleme|kulce|imalat|uretim)(?!.*boru|.*profil)|demir.?celik.*(imalat|uretim|manufactur)|steel.?(manufactur|production)(?!.*pipe|.*tube)/i),
  },
  { nace: "24.34", note: "Çelik tel, çelik kablo imalatı",
    match: (tr, en) =>
      has(tr, en, /celik.?tel.*(imalat|uretim)|metal.?tel.*(imalat|uretim)|wire.*(manufactur|draw)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // FABRİKASYON METAL ÜRÜNLER
  // ════════════════════════════════════════════════════════════════════════
  { nace: "25.94", note: "Metal bağlantı elemanı (cıvata, somun, vida) imalatı",
    match: (tr, en) =>
      has(tr, en, /baglanti.?eleman.*(imalat|uretim|manufactur)|civata|somun|vida.*(imalat|uretim)|fastener.*(manufactur)|bolt.*(manufactur)|nut.*(manufactur)|screw.*(manufactur)/i),
  },
  { nace: "25.91", note: "Metal kap, kavanoz kapağı, bidon imalatı",
    match: (tr, en) =>
      has(tr, en, /kavanoz.?kapagi.*(imalat|uretim)|(metal|teneke|aluminyum).?(kap|bidon|kapak).*(imalat|uretim)|metal.?(can|drum|container).*(manufactur|product)/i),
  },
  { nace: "25.61", note: "Metal yüzey işleme, kaplama, galvaniz, ısıl işlem",
    match: (tr, en) =>
      has(tr, en, /yuzey.?isleme|galvaniz|elektrokaplama|metal.?sertlestirme|metal.?isil.?islem|hardening|surface.?treatment|galvanizing|electroplating|kompozit.*yuzey.?hazirlama|boya.?isleri.*metal/i),
  },
  { nace: "25.62", note: "Talaşlı imalat, CNC işleme, tornalama",
    match: (tr, en) =>
      has(tr, en, /talasli.?imalat|cnc.*(isleme|imalat)|torna.*(imalat|hizmet)|freze.*(imalat)|machining|metal.?cutting|hassas.?islenmis.*celik|precision.*machining/i),
  },
  { nace: "25.50", note: "Metal dövme, presleme, damgalama",
    match: (tr, en) =>
      has(tr, en, /dovme.*(metal|imalat)|metal.?(presleme|damgalama)|metal.*forging|metal.*stamping/i),
  },
  { nace: "25.11", note: "Çelik konstrüksiyon, metal yapısal eleman imalatı",
    match: (tr, en) =>
      has(tr, en, /celik.?konstruksiyon.*(imalat|uretim)|metal.?(cerceve|iskelet|tasiyici).*(imalat|uretim)|structural.?steel.*(manufactur|fabricat)|celik.?merdiVen.*(imalat|uretim)|en.1090|iso.3834/i),
  },
  { nace: "25.21", note: "Kazan, radyatör, panel radyatör, boyler imalatı",
    match: (tr, en) =>
      has(tr, en, /panel.?radyator|kalorifer.?kazani|boyler.*(tasarim|uretim|imalat)|kazan.*(imalat|uretim)(?!.*pres)|radyator.*(imalat|uretim)|boiler.*(manufactur|product)/i),
  },
  { nace: "25.29", note: "Basınçlı kap, kriyo tank, LNG tank, depolama tankı imalatı",
    match: (tr, en) =>
      has(tr, en, /basinçli.?kap|kriYojenik.?tank|lng.?tank|depolama.?tank.*(imalat|uretim)|pressure.?vessel|storage.?tank.*(manufactur|product)|hyperbarik|kriyojenik|evaporator.*(imalat|uretim)/i),
  },
  { nace: "25.30", note: "Buhar jeneratörü, ısı eşanjörü imalatı",
    match: (tr, en) =>
      has(tr, en, /buhar.?jenerator|isi.?esansor|heat.?exchanger.*(manufactur|product)|steam.?generator/i),
  },
  { nace: "25.40", note: "Silah, mühimmat imalatı",
    match: (tr, en) =>
      has(tr, en, /silah.*(imalat|uretim)|muhimmat.*(imalat|uretim)|weapon.*(manufactur|product)|ammunition.*(manufactur|product)/i),
  },
  { nace: "25.73", note: "Kesici alet, endüstriyel döner bıçak imalatı",
    match: (tr, en) =>
      has(tr, en, /endustriyel.?(doNer|doner).*bica/i) ||
      has(tr, en, /kesici.?alet.*(imalat|uretim)|cutting.?tool.*(manufactur|product)/i),
  },
  { nace: "25.99", note: "Diğer fabrikasyon metal ürünleri (denge kabı, seperatör, vb.)",
    match: (tr, en) =>
      has(tr, en, /denge.?kabi|tortu.?tutucu|hava.?ayirici|seperator.*(imalat|uretim)|metal.?(urun|esya|parca).*(imalat|uretim)(?!.*boru|.*kap|.*civata|.*celik)|fabricated.?metal.*(manufactur|product)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // MAKİNE / EKİPMAN
  // ════════════════════════════════════════════════════════════════════════
  { nace: "28.30", note: "Tarım/hayvancılık makineleri; kümes ekipmanı, fındık toplama",
    match: (tr, en) =>
      has(tr, en, /tarim.?(makine|alet|ekipman)|zirai.?(alet|ekipman|makine)|kumes.?ekipman|hayvan.?kafes|kanatli.?kafes|civciv.?kafes|broiler.?kafes|quail.?cage|poultry.?cage|broiler.?cage|chick.?cage|gubre.?sistem|yemleme.?sistem|yumurta.?toplama|findik.?toplama.?makine/i),
  },
  { nace: "28.13", note: "Pompa ve kompresör imalatı",
    match: (tr, en) =>
      has(tr, en, /pompa.*(imalat|uretim)|kompressor.*(imalat|uretim)|compressor.*(manufactur|product)|pump.*(manufactur|product)/i),
  },
  { nace: "28.14", note: "Vana ve supap imalatı",
    match: (tr, en) =>
      has(tr, en, /vana.*(imalat|uretim)|supap.*(imalat|uretim)|valve.*(manufactur|product)/i),
  },
  { nace: "28.15", note: "Rulman, dişli, zincir, fren elemanı imalatı",
    match: (tr, en) =>
      has(tr, en, /rulman.*(imalat|uretim)|disli.*(imalat|uretim)|zincir.*(imalat|uretim)|bearing.*(manufactur|product)|bearing/i),
  },
  { nace: "28.22", note: "Kaldırma, taşıma ekipmanı; konveyör, viyol/yumurta toplama konveyörü",
    match: (tr, en) =>
      has(tr, en, /vinc|konveyor|forklift|kaldirma.*(ekipman|makine)|tasima.*(ekipman|makine)|lifting.*equipment|conveyor.*(manufactur|product)|hoist|viyol.?(toplama|konveyor)/i),
  },
  { nace: "28.25", note: "Havalandırma, klima, soğutma ekipmanı imalatı",
    match: (tr, en) =>
      has(tr, en, /havalandirma.?(fan|ekipman|sistem).*(imalat|uretim)|klima.*(imalat|uretim|ekipman)|iklimlendirme.?(pano|sistem|ekipman).*(imalat|uretim)|sogutma.?(ekipman|makine).*(imalat|uretim)|ventilating.?fan|hvac.*(manufactur|product|system)/i),
  },
  { nace: "28.21", note: "Endüstriyel fırın ve ocak imalatı",
    match: (tr, en) =>
      has(tr, en, /endustriyel.?firin|sanayi.?firin|industrial.?furnace|firin.*(imalat|uretim)(?!.*ekmek|.*pastane)|yaş.?ve.?toz.?boya.?kurleme.?firin/i),
  },
  { nace: "28.91", note: "Metalurji makine imalatı (haddehane, çelikhane ekipmanı)",
    match: (tr, en) =>
      has(tr, en, /haddehane|celikhane|metalurji.?(makine|ekipman)|rolling.?mill|meltshop|metallurgical.?(equipment|machinery)|roll.?form.?makine/i),
  },
  { nace: "28.92", note: "Maden/inşaat/sondaj makinesi imalatı",
    match: (tr, en) =>
      has(tr, en, /sondaj.?(makin|rings|m.?akin)|maden.?makin.*(uretim|imalat)|is.?makin.*(kova|tasarim|imalat)|drilling.?(machine|rings).*(manufactur|product)|mining.?machine.*(manufactur|product)/i),
  },
  { nace: "28.93", note: "Gıda ve içecek makineleri imalatı",
    match: (tr, en) =>
      has(tr, en, /gida.?(makine|ekipman|tesisi).*(imalat|uretim)|food.?(machine|equipment|processing).*(manufactur|product)|beton.?santral.*(uretim|imalat|kurulum)|tambur.?elek/i),
  },
  { nace: "28.94", note: "Tekstil, dikiş, örgü makineleri imalatı",
    match: (tr, en) =>
      has(tr, en, /tekstil.?makine|disis.?makine|sewing.?machine|knitting.?machine|textile.?machine.*(manufactur|product)/i),
  },
  { nace: "28.41", note: "Metal işleme tezgahı, roll-form makinesi imalatı",
    match: (tr, en) =>
      has(tr, en, /metal.?isleme.?(tezgah|ve.?roll.?form.?makine)|torna.?tezgah|freze.?tezgah|machine.?tool.*(manufactur|product)|metal.?isleme.*roll.?form/i),
  },
  { nace: "28.29", note: "Genel amaçlı makine imalatı (otomat, endüstriyel mutfak, genel)",
    match: (tr, en) =>
      has(tr, en, /otomat.?cihaz.*(uretim|imalat)|endustriyel.?mutfak.*(ekipman|uretim|imalat)|buzdolabi.*(endustriyel|uretim|imalat)|sanayi.?robot.*(imalat|uretim|satis)|makine.*(imalat|uretim)(?!.*gida|.*tekstil|.*tarim|.*metalur|.*sondaj)|equipment.*(manufactur|product)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // ELEKTRİK EKİPMANI
  // ════════════════════════════════════════════════════════════════════════
  { nace: "27.11", note: "Elektrik motoru, jeneratör, ısıtıcı, rezistans imalatı",
    match: (tr, en) =>
      has(tr, en, /(?=.*(jenerator|motor|elektrik.enerjisi))(?=.*(satis|servis|imalat|uretim|bakim))/i) ||
      has(tr, en, /her.?turlu.?isitma.?cihaz.*(imalat|uretim)|rezistans.*(uretim|imalat|bakim)|isitici.*(uretim|imalat)|electric.?(motor|generator).*(manufactur|product|sale|service)/i),
  },
  { nace: "27.12", note: "Elektrik pano, trafo, güç dağıtım imalatı",
    match: (tr, en) =>
      has(tr, en, /elektrik.?pano|trafo.*(imalat|uretim)|guc.?dagitim.*(imalat|uretim)|switchgear|transformer.*(manufactur|product)|electrical.?panel.*(manufactur|product)/i),
  },
  { nace: "27.20", note: "Pil ve akümülatör imalatı",
    match: (tr, en) =>
      has(tr, en, /pil.*(imalat|uretim)|aku|akumulator.*(imalat|uretim)|battery.*(manufactur|product)/i),
  },
  { nace: "27.32", note: "Elektrik kablo imalatı",
    match: (tr, en) =>
      has(tr, en, /elektrik.?kablo.*(imalat|uretim)|kablo.*(imalat|uretim)(?!.*metal.?tel)|electric.?cable.*(manufactur|product)/i),
  },
  { nace: "27.40", note: "Aydınlatma ekipmanı, LED armatür imalatı",
    match: (tr, en) =>
      has(tr, en, /aydinlatma.*(imalat|uretim|ekipman)|led.?(armatür|lamba).*(imalat|uretim)|lighting.*(manufactur|product)|asansor.?boy.?fotoseli/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // ELEKTRONİK / IT
  // ════════════════════════════════════════════════════════════════════════
  { nace: "26.11", note: "Elektronik kart, PCB, baskılı devre tasarım/imalatı",
    match: (tr, en) =>
      has(tr, en, /elektronik.?kart|baskili.?devre|pcb|devre.?kart|electronic.?(board|card|pcb|component)|(elektronik|electronic).*(tasarim|design|manufactur)/i),
  },
  { nace: "26.20", note: "Bilgisayar, fotokopi, yazıcı, tarayıcı imalatı/satışı",
    match: (tr, en) =>
      has(tr, en, /fotokopi.?makine|yazici.?makine|faks.?makine|tarama.*goruntuleme.*kopyalama|computer.*(manufactur|product)|laptop.*(imalat|uretim)/i),
  },
  { nace: "26.30", note: "İletişim cihazları, radyo haberleşme ekipmanı",
    match: (tr, en) =>
      has(tr, en, /radyo.?haberlEsme|radyo.?iletisim|iletisim.?cihaz|telekomunikasyon.?(cihaz|ekipman)|communication.?equipment|radio.?communication/i),
  },
  { nace: "26.51", note: "Ölçüm, test, navigasyon cihazları imalatı",
    match: (tr, en) =>
      has(tr, en, /olcum.?(cihaz|ekipman|alet).*(imalat|uretim|tasarim)|measurement.?(device|instrument).*(manufactur|product)|navigasyon.?(cihaz|imalat)/i),
  },
  { nace: "62.01", note: "Yazılım geliştirme",
    match: (tr, en) =>
      has(tr, en, /yazilim.?(gelistirme|tasarim|hizmet)|software.?(development|design|service|product)|programlama|mobil.?uygulama/i),
  },
  { nace: "62.02", note: "IT danışmanlık, sistem entegrasyon",
    match: (tr, en) =>
      has(tr, en, /bilisim.?danismanlik|it.?danismanlik|sistem.?entegrasyon|it.?consulting|information.?technology.?consulting/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // OTOMOTİV
  // ════════════════════════════════════════════════════════════════════════
  { nace: "45.20", note: "Otomobil yetkili servis hizmetleri",
    match: (tr, en) =>
      has(tr, en, /otomobil.?yetkili.?servis|vehicle.?authorized.?service|car.?dealership.?service/i),
  },
  { nace: "29.32", note: "Araç parçaları, filtre, jant, egzoz imalatı",
    match: (tr, en) =>
      has(tr, en, /hava.?filtresi.*yag.?filtresi|yakit.?filtresi.*hava.?filtresi|araç.?parça|otomotiv.?parça|jant.*(tarim|is.?makina|uretim|imalat)|egzoz.*(imalat|uretim)|automotive.?(component|part|filter).*(manufactur|product)/i),
  },
  { nace: "29.31", note: "Araç elektrik/elektronik teçhizat imalatı",
    match: (tr, en) =>
      has(tr, en, /otomotiv.?(elektrik|elektronik).*(imalat|uretim)|arac.?(elektrik|elektronik).?sis|automotive.?electronic.*(manufactur|product)/i),
  },
  { nace: "29.10", note: "Motorlu araç imalatı",
    match: (tr, en) =>
      has(tr, en, /motorlu.?(arac|tasit).*(imalat|uretim)|otomobil.*(imalat|uretim)|kasa.*platform.*tasiyici|kurtarici.*monteli.*arac|motor.?vehicle.*(manufactur|product)|automobile.*(manufactur|product)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // GEMİ / HAVACILIK / SAVUNMA
  // ════════════════════════════════════════════════════════════════════════
  { nace: "30.11", note: "Gemi imalatı, gemi onarım",
    match: (tr, en) =>
      has(tr, en, /gemi.*(imalat|insa|onarim)|tekne.*(imalat|insa)|shipbuilding|ship.?repair/i),
  },
  { nace: "30.30", note: "Havacılık, drone, uzay araçları imalatı",
    match: (tr, en) =>
      has(tr, en, /ucak.*(imalat|uretim)|havacilik.*(imalat|uretim|savunma)|uzay.?araci.*(imalat)|aerospace.*(manufactur|product)|aircraft.*(manufactur|product)|drone.?(sertifika|manufactur)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // ENERJİ
  // ════════════════════════════════════════════════════════════════════════
  { nace: "35.11", note: "Elektrik üretimi (güneş, rüzgar, hidroelektrik)",
    match: (tr, en) =>
      has(tr, en, /elektrik.?uretim|(gunes|solar|ruzgar|wind|hidroelektrik|hydro).*(enerji|power.?generation)|yenilenebilir.?enerji.?uretim/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // İNŞAAT
  // ════════════════════════════════════════════════════════════════════════
  { nace: "42.22", note: "Elektrik ve enerji nakil hatları inşaatı, tesis",
    match: (tr, en) =>
      has(tr, en, /enerji.?nakil.?hatlari|ag.?og.?(sehir|sebekeleri)|trafo.?merkez.*(muhendislik|insaat|montaj)|elektrik.?(hat|altyapi).*(insaat|montaj|proje)|power.?line.?construction/i),
  },
  { nace: "43.29", note: "Asansör montaj, bakım, revizyon hizmetleri",
    match: (tr, en) =>
      has(tr, en, /asansor.*(montaj|bakim|revizyon|servis)|elevator.*(installation|maintenance|service)/i),
  },
  { nace: "43.99", note: "Uzmanlaşmış inşaat: kurşun kaplama, radyasyon odası, Faraday kafesi",
    match: (tr, en) =>
      has(tr, en, /kursun.?(panel|kaplama|zirh|cam)|radyasyon.?(kapi|oda|panel|koruma)|faraday.?kafes|lead.?(panel|shielding|glass)/i),
  },
  { nace: "41.20", note: "Bina inşaatı, hastane inşaatı, yapı taahhüt",
    match: (tr, en) =>
      has(tr, en, /bina.?(insaat|insaati)|yapi.?(insaat|taahut)|altyapi.?(insaat|uStyapi)|taahut.*(insaat|yapi)|building.?construction|construction.?contracting|hastane.?insaat|genel.?insaat.?isleri|proje.*kapsaminda.*taahhut/i),
  },
  { nace: "42.99", note: "Mühendislik yapıları (köprü, tünel, baraj) inşaatı",
    match: (tr, en) =>
      has(tr, en, /muhendislik.?yapilari.*(projelendirme|insaat)|kopru.?(insaat|proje)|tunel.?(insaat|proje)|dam.?construction|bridge.?construction/i),
  },
  { nace: "43.21", note: "Elektrik tesisat ve inşaat montaj hizmetleri",
    match: (tr, en) =>
      has(tr, en, /elektrik.?(tesisat|ket.?isleri|insaat.?proje).*(hizmet|montaj|kurulum)|electrical.?installation.*(service|work)/i),
  },
  { nace: "43.22", note: "Sıhhi tesisat, ısıtma, iklimlendirme tesisat",
    match: (tr, en) =>
      has(tr, en, /sihhi.?tesisat|isitma.?tesisat|iklimlendirme.?tesisat|plumbing|heating.?installation|hvac.?installation/i),
  },
  { nace: "71.11", note: "Mimari tasarım, restorasyon proje hizmetleri",
    match: (tr, en) =>
      has(tr, en, /mimari.?tasarim|tarihi.?restorasyon|architecture.*(design|service)|restoration.?(project|service)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // TOPTAN / PERAKENDE TİCARET
  // ════════════════════════════════════════════════════════════════════════
  { nace: "46.46", note: "Tıbbi/eczacılık ürünleri toptan ticareti (depolama, ithalat dahil)",
    match: (tr, en) =>
      has(tr, en, /(tibbi|medikal|eczaci|saglik).*(urun|malzeme|cihaz).*(toptan|ticaret|ithalat|ihracat|satis|depolama)(?!.*imalat|.*uretim)/i) &&
      !has(tr, en, /imalat|uretim|manufacturing|production/i),
  },
  { nace: "46.44", note: "Ev eşyaları, temizlik malzemesi toptan ticareti",
    match: (tr, en) =>
      has(tr, en, /temizlik.?malzeme.*(toptan|ticaret)|deterjan.*(toptan|ticaret)|cleaning.?(material|product).*(wholesale|trade)/i) &&
      !has(tr, en, /imalat|uretim|manufacturing|production/i),
  },
  { nace: "46.90", note: "Genel toptan ticaret, ithalat-ihracat",
    match: (tr, en) =>
      has(tr, en, /toptan.?(ticaret|satis|alim.?satim)|genel.?ticaret|ithalat.*(ve|ve)?ihracat|dis.?ticaret|wholesale.?trade|import.?(and|&)?export/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // GAYRİMENKUL
  // ════════════════════════════════════════════════════════════════════════
  { nace: "68.10", note: "Gayrimenkul alım, satım, kiralama",
    match: (tr, en) =>
      has(tr, en, /gayrimenkul.*(alim|satim|kiralama|devir)|real.?estate.*(buy|sell|lease|transfer)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // MÜHENDİSLİK / TEST / DANIŞMANLIK
  // ════════════════════════════════════════════════════════════════════════
  { nace: "33.20", note: "Endüstriyel ekipman kalibrasyon, bakım, onarım",
    match: (tr, en) =>
      has(tr, en, /kalibrasyon.*(bakim|onarim)|tibbi.*endustriyel.*cihaz.*(kalibrasyon|bakim|onarim)|calibration.*(service|maintenance)|industrial.*calibration/i),
  },
  { nace: "71.20", note: "Teknik test, muayene, analiz; gemi muayene; sterilizasyon testi",
    match: (tr, en) =>
      has(tr, en, /test.?ve.?muayene|teknik.?muayene|teknik.?test|analiz.?hizmet|testing.?and.?inspection|technical.?(testing|inspection|analysis)|gemi.?(kontrol|muayene|sertifikalandirma)|yikama.?dezenfeksiyon.*test|yuzey.?kaliNtiK|protein.?kalinti/i),
  },
  { nace: "71.12", note: "Mühendislik faaliyetleri, teknik danışmanlık, elektrik mühendisliği",
    match: (tr, en) =>
      has(tr, en, /muhendislik.?(faaliyetleri|hizmet|danismanlik|yapilari)|teknik.?danismanlik|engineering.?(service|consulting|activity|structures)|teknik.?destek.*(analiz|tasarim|proje)|elektrik.?muhendisligi.*(olcum|hizmet)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // LOJİSTİK / ULAŞIM / TEMİZLİK HİZMETİ
  // ════════════════════════════════════════════════════════════════════════
  { nace: "49.39", note: "Personel ve öğrenci taşıma hizmetleri",
    match: (tr, en) =>
      has(tr, en, /personel.*(tasima|tasimaciligi)|ogrenci.*tasima|personnel.*transport|student.*transport/i),
  },
  { nace: "52.29", note: "Lojistik, nakliyat, taşıma acenteliği",
    match: (tr, en) =>
      has(tr, en, /lojistik.?(hizmet|yonetim)|nakliyat|freight.?forwarding|tasima.?acenteligi/i),
  },
  { nace: "96.01", note: "Endüstriyel çamaşır yıkama ve ütüleme hizmetleri",
    match: (tr, en) =>
      has(tr, en, /endustriyel.?camasir.?(yikama|kurutma|utuleme)|industrial.?laundry/i),
  },
  { nace: "81.10", note: "Bütünleşik tesisi yönetim (temizlik, güvenlik, kafeterya)",
    match: (tr, en) =>
      has(tr, en, /temizlik.?hizmet.*guvenlik.?hizmet|guvenlik.?hizmet.*kafeterya|personel.*temini.*kafeterya|ilaclamaL?hizmet.*temizlik.?hizmet/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // ATIK YÖNETİMİ / ÇEVRE
  // ════════════════════════════════════════════════════════════════════════
  { nace: "38.12", note: "Tehlikeli ve tehlikesiz atık toplama, bertaraf",
    match: (tr, en) =>
      has(tr, en, /islenmis.?metal.*atik.*(bertaraf|toplanma|ayristirilma)|tehlikeli.?(atik|bertaraf)|tehlikesiz.?atik.*(geri.kazanim|toplama|ayirma)|hazardous.?waste/i),
  },
  { nace: "38.32", note: "Geri dönüşüm ve ikincil hammadde kazanımı",
    match: (tr, en) =>
      has(tr, en, /tehlikesiz.?atik.*(geri.kazanim|yeniden.kullanim)|recycling.*(non.?hazardous)|secondary.?raw.?material/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // SAĞLIK HİZMETLERİ / KLİNİK
  // ════════════════════════════════════════════════════════════════════════
  { nace: "86.21", note: "Klinik/tıp merkezi sağlık hizmetleri",
    match: (tr, en) =>
      has(tr, en, /saglik.?hizmetleri(?!.*urun|.*malzeme|.*imalat)|klinik.?hizmet|tip.?merkezi|kalp.?damar.*tani.?tedavi|diyabetik.?ayak.?tedavi|medical.?(service|care)(?!.*device|.*product)/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // MADENCİLİK
  // ════════════════════════════════════════════════════════════════════════
  { nace: "07.10", note: "Demir cevheri madenciliği",
    match: (tr, en) =>
      has(tr, en, /demir.?cevheri.?madenciligi|iron.?ore.?mining/i),
  },
  { nace: "08.11", note: "Taş, kum ocağı, maden",
    match: (tr, en) =>
      has(tr, en, /tas.?ocagi|kum.?ocagi|kil.?madenciligi|quarry|stone.?mining/i),
  },

  // ════════════════════════════════════════════════════════════════════════
  // EĞİTİM
  // ════════════════════════════════════════════════════════════════════════
  { nace: "85.59", note: "Eğitim hizmetleri",
    match: (tr, en) =>
      has(tr, en, /egitim.?(hizmet|faaliyeti)|training.?(service|activity)(?!.*medikal|.*tibbi)|kurs.?(hizmet|merkez)|stem.deneyleri/i),
  },
  // ════════════════════════════════════════════════════════════════════════
  // EK KURALLAR — önceki çalışmada inceleme listesine düşen kapsamlar
  // ════════════════════════════════════════════════════════════════════════
  { nace: "26.60", note: "ECCT elektro kanser terapisi cihazı; ErectoStimulation",
    match: (tr, en) =>
      has(tr, en, /ecct[-\s]?(mvs|c1|cancer|therapy)|erecto.?stimul/i),
  },
  { nace: "32.50", note: "Endoskopik/endeskopik ürünler (CE)",
    match: (tr, en) =>
      has(tr, en, /end[eo]skopik.?urun|endoskopik|endeskopik/i),
  },
  { nace: "32.50", note: "Göz, kafa masajı; whirlpool banyo sistemi (medikal/wellness cihaz)",
    match: (tr, en) =>
      has(tr, en, /eye.*(massager|massage)|head.?massager|whirlpool.?(bath|shower|system)|shower.*whirlpool/i),
  },
  { nace: "32.50", note: "MLP / GRN / EFD — spesifik CE ürün kodu (bağlam: 13485/CE)",
    match: (tr, en) =>
      has(tr, en, /\bmlp-25ct\b|\bmlp-33ct\b|\bgrn\b|\befd\b/i),
  },
  { nace: "25.61", note: "Robocoating — robotik yüzey kaplama sistemi",
    match: (tr, en) =>
      has(tr, en, /robocoating/i),
  },
  { nace: "28.15", note: "Rulman (bearing) imalatı veya satışı",
    match: (tr, en) =>
      has(tr, en, /^bearing$|rulman.*(imalat|satis|uretim)|bearing.*(manufactur|sale)/i),
  },
  { nace: "28.92", note: "Sondaj ekipmanı; drilling rings (CE)",
    match: (tr, en) =>
      has(tr, en, /sondaj.?makin|drilling.?(ring|machine|equipment)/i),
  },
  { nace: "28.29", note: "Sanayi robotu imalatı",
    match: (tr, en) =>
      has(tr, en, /sanayi.?robot.*(imalat|uretim|satis)|industrial.?robot.*(manufactur|product)/i),
  },
  { nace: "29.10", note: "Özel amaçlı araç: hidrolik kurtarıcı, kaza kırım araçları",
    match: (tr, en) =>
      has(tr, en, /kurtarici.*(monteli|arac|arac)|kayar.?kasa.*(platform|arac)|rescue.?(vehicle|truck)/i),
  },
  { nace: "33.12", note: "Jeneratör, elektrik enerjisi cihazları satış ve servis",
    match: (tr, en) =>
      has(tr, en, /jenerator.*(satis|servis|satisi)|elektrik.?enerjisi.*(cihaz|ekipman).*(satis|servis)/i),
  },
  { nace: "46.46", note: "İyi Dağıtım Uygulamaları (GDP) — ilaç dağıtım sistemi",
    match: (tr, en) =>
      has(tr, en, /iyi.?dagitim.?uygulamalari|good.?distribution.?practice|gdp.*(yonetim|sistem)/i),
  },
  { nace: "25.11", note: "EN 1090 çelik yapı imalatı; kaynakla endüstriyel platform/ekipman imalatı",
    match: (tr, en) =>
      has(tr, en, /en.?1090|iso.?3834|iso.?5817/i) ||
      has(tr, en, /kaynakli.?imalat.*(endustriyel|platform|ekipman)|endustriyel.*(platform|ekipman).*(kaynakli|imalat)/i),
  },
  { nace: "43.99", note: "Temiz oda, kontrollü ortam, havalandırma sistemi tesis/kurulum",
    match: (tr, en) =>
      has(tr, en, /temiz.?oda.*(kontrol|havalandir|sistem|kurulum|tesis)|cleanroom.*(system|installation)|clean.?room.*(hvac|system)/i),
  },
  { nace: "32.50", note: "Hazneli maske, nebulizer set, oksijen maskesi, nazal kanül (medikal kit)",
    match: (tr, en) =>
      has(tr, en, /hazneli.?maske|nebulizer.?set|nazal.?oksijen|nasal.?cannula|oxygen.?mask.*(medikal|set)/i),
  },
];

// ---------------------------------------------------------------------------
// Sınıflandırma fonksiyonu
// ---------------------------------------------------------------------------
function classify(kapsam, scope) {
  const tr = norm(kapsam);
  const en = norm(scope || "");
  for (const rule of RULES) {
    if (rule.match(tr, en)) {
      return { nace: rule.nace, ea: rule.ea || naceToEa[rule.nace] || "", note: rule.note };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Benzersiz kapsamları etiketle ve uygula
// ---------------------------------------------------------------------------
const uniqueMap = new Map();

history.items.forEach((item) => {
  const key = item.kapsam.trim();
  if (uniqueMap.has(key)) return;
uniqueMap.set(key, classify(item.kapsam, item.scope || ""));
});

// ---------------------------------------------------------------------------
// Gemini ile etiketleme (Gelecek planı — Opsiyonel)
// ---------------------------------------------------------------------------
async function classifyWithGemini(items) {
  // TODO: Gemini API entegrasyonu buraya gelecek.
  // console.log(`Gemini ile ${items.length} item analiz ediliyor...`);
  return items;
}

let labeled = 0, review = 0, skipped = 0;

history.items.forEach((item) => {
  if (item.ea || item.nace) { skipped++; return; }
  delete item._needs_review;
  const key = item.kapsam.trim();
  const result = uniqueMap.get(key);
  if (result) {
    item.ea = result.ea;
    item.nace = result.nace;
    labeled++;
  } else {
    item._needs_review = true;
    review++;
  }
});

history.stats.ea_filled = history.items.filter((i) => i.ea).length;
history.stats.nace_filled = history.items.filter((i) => i.nace).length;
history.stats.rule_labeled = labeled;
history.stats.needs_review = review;

writeFileSync(join(root, "src/data/certificate-history.json"), JSON.stringify(history, null, 2));

console.log("\n=== Kural Tabanlı Etiketleme Raporu (v2) ===");
console.log(`Toplam item         : ${history.items.length}`);
console.log(`Önceden dolu (koru) : ${skipped}`);
console.log(`Kural ile etiket    : ${labeled}`);
console.log(`İnceleme gerekli    : ${review}`);
console.log(`ea_filled           : ${history.stats.ea_filled}`);
console.log(`nace_filled         : ${history.stats.nace_filled}`);

const reviewItems = history.items.filter((i) => i._needs_review);
if (reviewItems.length) {
  console.log("\n--- İnceleme Gerekli (benzersiz) ---");
  const shown = new Set();
  reviewItems.forEach((item) => {
    const k = item.kapsam.trim();
    if (shown.has(k)) return;
    shown.add(k);
    if (shown.size > 100) return;
    console.log(`  [${item.standard}] ${k.slice(0, 90)}`);
  });
}
