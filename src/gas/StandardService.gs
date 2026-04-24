/**
 * 📚 StandardService shim
 *
 * Standart lookup artik GAS yerine Worker -> D1 uzerinden cozuluyor.
 * Bu shim, yanlislikla GAS tarafindan cagrilirsa sessizce bos donmek yerine
 * anlamli bir hata ureterek problemi erken fark ettirir.
 */
const StandardService = {
  getById: function(id) {
    const message = "StandardService.getById artik GAS tarafinda kullanilmiyor. Standart verisini Worker/D1 uzerinden api.getStandardById(...) ile okuyun.";
    BaseService.logError("StandardService.getById", new Error(message), { id: id });
    throw new Error(message);
  }
};
