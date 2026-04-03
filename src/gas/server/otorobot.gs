function convertGoogleDocToPDF() {
  var docId = "1L2TWhzEXumJVq5FMsANU1xsWGlz_VIaSU4WNFoRn15I"; // Google Docs'un ID'si
  var docFile = DriveApp.getFileById(docId);
  var pdfBlob = docFile.getAs('application/pdf');

  var pdfFile = DriveApp.createFile(pdfBlob);
  Logger.log("PDF oluşturuldu: " + pdfFile.getUrl());

  return pdfFile.getId();
}

function convertPDFtoPNG(pdfFileId) {
  var apiKey = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiYjVkMzY4ZmRlNGM4ZGJmM2JkMzQzNDQyMDk5MzgyNWUyZWVjZTczYWIxNTdmZjNiZTgxMzBjZWNmNjc0ZDdiOTdiNDNkMWJkNGM5YjkxYzQiLCJpYXQiOjE3NDA1NjI4NjMuNzU4OTA0LCJuYmYiOjE3NDA1NjI4NjMuNzU4OTA2LCJleHAiOjQ4OTYyMzY0NjMuNzUyNzk5LCJzdWIiOiI3MTE3MTMyOSIsInNjb3BlcyI6WyJ1c2VyLnJlYWQiLCJ1c2VyLndyaXRlIiwidGFzay5yZWFkIiwidGFzay53cml0ZSIsIndlYmhvb2sucmVhZCIsIndlYmhvb2sud3JpdGUiLCJwcmVzZXQucmVhZCIsInByZXNldC53cml0ZSJdfQ.B6fjE5Ksj1j2G7sY0YqmRq8I61GdvZzMHSBxFugdz89o_T1LhnMxYXnIopxLxOf8ga4BOO1QmDM3xhaXJAoyU2ikNOxpIy9YBjVIKsc3AUiH_8Tj7DpOjSJ7y_rUih9Xla3o1UoK6FEX380QOXGTjIFPlQrQNRm9H-0Sa_HuU8UGKtyRXKwwETlJrNkgA4W3c9uXedRnHVS1Mg8PN3fFo-foMuE148sF6N9xwhsbeVU0t4JiWuoJhx8Ok46l0CJ2HUiYPV43LNhy1X341sCEx2qLMNjn3em0_sO4GXjPAhOTzv0eHudBhLaOgc3qKpkBfC4R9rPi8-7IP4IGvZwM18I3uuS3q_bC7MK-T9m3ZqZrFW6c6xuO4kE_4YJGlTUSbqQWrg7OzMozRXP3zw8L0B6jg0KPDwp9_r1CE3eayJG2rLbGb5DOIn9ZnSNH-UXJwZ4iD7_tVBj5uDZq0_nOxAvsbbC8zO--GM_LeNA9kBESsg4CIHxD1Pi30-8jEOvGm0pVO3Fm-GCwaQ08DUamwIKQ_0YHlve2GQL9IpDwvhRmwvPWLmb4-ypV5sTbBe1Q3mtadarmuiMJpD36RXrRf8yOnSgcxKm4g07lw-Jz7HHWEDXuVs_yQYtGaWVbNrZ-Lu8RdP0D2w16wEb8LfHg60TxqfVShtLnRO8KG5LV9wE";
  var pdfFile = DriveApp.getFileById(pdfFileId);
    var blob = pdfFile.getBlob();

  // CloudConvert API'ye dönüşüm işini başlatma isteği gönder
  var url = "https://api.cloudconvert.com/v2/jobs";
  var options = {
    method: "post",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({
      "tasks": {
        "import-1": {
          "operation": "import/upload"
        },
        "convert-1": {
          "operation": "convert",
          "input": ["import-1"],
          "output_format": "png"
        },
        "export-1": {
          "operation": "export/url",
          "input": ["convert-1"]
        }
      }
    })
  };

  var response = UrlFetchApp.fetch(url, options);
  var jsonResponse = JSON.parse(response.getContentText());

  Logger.log("CloudConvert API Yanıtı: " + JSON.stringify(jsonResponse, null, 2));

  // CloudConvert dönüşüm işinin ID'sini al
  var jobId = jsonResponse.data.id;
  var jobStatusUrl = "https://api.cloudconvert.com/v2/jobs/" + jobId;
  var maxAttempts = 20; // Maksimum 20 deneme (her biri 5 saniye)
  var attempts = 0;
  var pngUrl = null;

  while (attempts < maxAttempts) {
    attempts++;
    Utilities.sleep(5000); // 5 saniye bekle (CloudConvert'in işini bitirmesi için)

    var checkResponse = UrlFetchApp.fetch(jobStatusUrl, {
      method: "get",
      headers: {
        "Authorization": "Bearer " + apiKey
      }
    });

    var checkJson = JSON.parse(checkResponse.getContentText());
    Logger.log("CloudConvert İşlem Durumu: " + JSON.stringify(checkJson, null, 2));

    if (checkJson.data && checkJson.data.tasks) {
      var tasks = checkJson.data.tasks;

      // İşlemin tamamlandığını kontrol et
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].name === "export-1" && tasks[i].status === "finished" && tasks[i].result) {
          pngUrl = tasks[i].result.files[0].url;
          break;
        }
      }
    }

    if (pngUrl) {
      break; // PNG URL'sini bulduk, döngüden çık
    }
  }

  if (!pngUrl) {
    throw new Error("CloudConvert dönüşüm tamamlanamadı veya çıktı alınamadı.");
  }

  // PNG dosyasını Google Drive'a kaydet
  var pngBlob = UrlFetchApp.fetch(pngUrl).getBlob();
  var pngFile = DriveApp.createFile(pngBlob);
  Logger.log("PNG dosyası oluşturuldu: " + pngFile.getUrl());

  return pngFile.getId();
}

function insertPNGintoGoogleSlidesAndExportToPDF(pngFileId) {
  var slideDeck = SlidesApp.create("Converted A4 Document");
  var slide = slideDeck.getSlides()[0];

  // PNG dosyasını ekle
  var pngFile = DriveApp.getFileById(pngFileId);
  var pngBlob = pngFile.getBlob();
  var image = slide.insertImage(pngBlob);

  // A4 boyutuna ayarla (Google Slides: 960 x 720 px, A4 oranı = 1.41)
  var width = 612;  // A4 genişliği (px)
  var height = 792; // A4 yüksekliği (px)
  image.setWidth(width);
  image.setHeight(height);
  image.setLeft((slide.getPageWidth() - width) / 2);
  image.setTop((slide.getPageHeight() - height) / 2);

  Logger.log("Google Slides oluşturuldu: " + slideDeck.getUrl());

  // Google Slides'ı PDF olarak dışa aktar
  var pdfUrl = "https://docs.google.com/presentation/d/" + slideDeck.getId() + "/export/pdf";
  var pdfBlob = UrlFetchApp.fetch(pdfUrl, {
    headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() }
  }).getBlob();

  var finalPdf = DriveApp.createFile(pdfBlob);
  Logger.log("Son PDF oluşturuldu: " + finalPdf.getUrl());

  return finalPdf.getId();
}

function fullProcess() {
  var pdfId = convertGoogleDocToPDF(); // 1. Adım: Google Docs'u PDF'e çevir
  var pngId = convertPDFtoPNG(pdfId);  // 2. Adım: PDF'yi PNG'ye çevir
  var finalPdfId = insertPNGintoGoogleSlidesAndExportToPDF(pngId); // 3. Adım: PNG'yi Google Slides’a ekleyip PDF yap

  Logger.log("Tam işlem tamamlandı. Son PDF: " + DriveApp.getFileById(finalPdfId).getUrl());
}