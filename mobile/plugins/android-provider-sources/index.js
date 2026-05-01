const { buildAutofillSource } = require("./autofill-source");
const { buildActivitySource } = require("./activity-source");
const { buildModuleSource } = require("./module-source");
const { buildPackageSource } = require("./package-source");
const { buildPasskeySource } = require("./passkey-source");
const { buildServiceSource } = require("./service-source");
const { buildStoreSource } = require("./store-source");

module.exports = {
  buildAutofillSource,
  buildActivitySource,
  buildModuleSource,
  buildPackageSource,
  buildPasskeySource,
  buildServiceSource,
  buildStoreSource,
};
