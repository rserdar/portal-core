function loadPartialHTML_(partial) {
  const htmlServ = HtmlService.createTemplateFromFile(partial);
  return htmlServ.evaluate().getContent();
}

function include(filename){
return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function loadSearchView() {
  return loadPartialHTML_("search");
}

function loadAddCompanyView() {
  return loadPartialHTML_("addcompany");
}

function loadTableCertificateView() {
  return loadPartialHTML_("tableCertificate");
}

function loadCompanyInfoView() {
  return loadPartialHTML_("companyinfo");
}

function loadDocsView() {
  return loadPartialHTML_("addDocs");
}