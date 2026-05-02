function buildModuleSource(packageName) {
  return `package ${packageName}.credentialprovider

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class KlarkeyCredentialStoreModule(
  private val context: ReactApplicationContext
) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "KlarkeyCredentialStore"

  @ReactMethod
  fun replaceCredentials(payload: String, unlockedUntil: Double, promise: Promise) {
    try {
      KlarkeyCredentialStore.replaceCredentials(context, payload, unlockedUntil.toLong())
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("ERR_KLARKEY_CREDENTIAL_STORE", error)
    }
  }

  @ReactMethod
  fun lock(promise: Promise) {
    try {
      KlarkeyCredentialStore.lock(context)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("ERR_KLARKEY_CREDENTIAL_STORE", error)
    }
  }

  @ReactMethod
  fun getProviderPasskeys(promise: Promise) {
    try {
      promise.resolve(KlarkeyCredentialStore.passkeysPayload(context))
    } catch (error: Exception) {
      promise.reject("ERR_KLARKEY_CREDENTIAL_STORE", error)
    }
  }

  @ReactMethod
  fun getProviderCredentials(promise: Promise) {
    try {
      promise.resolve(KlarkeyCredentialStore.credentialsPayload(context))
    } catch (error: Exception) {
      promise.reject("ERR_KLARKEY_CREDENTIAL_STORE", error)
    }
  }

  @ReactMethod
  fun deleteProviderItem(itemId: String, passkeyIdsPayload: String, promise: Promise) {
    try {
      KlarkeyCredentialStore.deleteProviderItem(context, itemId, passkeyIdsPayload)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("ERR_KLARKEY_CREDENTIAL_STORE", error)
    }
  }
}
`;
}

module.exports = { buildModuleSource };
