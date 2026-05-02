function buildStoreSource(packageName) {
  return `package ${packageName}.credentialprovider

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.time.Instant
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONObject

data class ProviderCredential(
  val id: String,
  val title: String,
  val username: String,
  val domain: String?,
  val domains: List<String>,
  val password: String?,
  val hasPassword: Boolean,
  val hasPasskey: Boolean,
  val lastUsedTime: Instant
)

data class ProviderPasskey(
  val id: String,
  val alias: String,
  val rpId: String,
  val username: String,
  val userHandle: String,
  val signCount: Int,
  val lastUsedTime: Instant
)

object KlarkeyCredentialStore {
  private const val alias = "klarkey_android_provider_store"
  private const val storeName = "klarkey_android_provider"
  private const val credentialsKey = "credentials"
  private const val passkeysKey = "passkeys"
  private const val unlockedUntilKey = "unlockedUntil"
  private const val transformation = "AES/GCM/NoPadding"

  fun replaceCredentials(context: Context, payload: String, unlockedUntil: Long) {
    writeEncrypted(context, credentialsKey, payload)
    prefs(context).edit().putLong(unlockedUntilKey, unlockedUntil).apply()
  }

  fun lock(context: Context) {
    prefs(context).edit().putLong(unlockedUntilKey, 0).apply()
  }

  fun isUnlocked(context: Context): Boolean {
    return prefs(context).getLong(unlockedUntilKey, 0) > System.currentTimeMillis()
  }

  fun loadCredentials(context: Context): List<ProviderCredential> {
    val payload = readEncrypted(context, credentialsKey) ?: return emptyList()
    val items = JSONArray(payload)
    val credentials = mutableListOf<ProviderCredential>()

    for (index in 0 until items.length()) {
      val item = items.optJSONObject(index) ?: continue
      val id = item.optString("id")
      val username = item.optString("username")
      if (id.isBlank() || username.isBlank()) {
        continue
      }

      val password = item.optString("password").takeIf { value -> value.isNotBlank() }
      val domains = credentialDomains(item)
      credentials.add(
        ProviderCredential(
          id = id,
          title = item.optString("title", username),
          username = username,
          domain = domains.firstOrNull(),
          domains = domains,
          password = password,
          hasPassword = item.optBoolean("hasPassword", false) && password != null,
          hasPasskey = item.optBoolean("hasPasskey", false),
          lastUsedTime = Instant.ofEpochMilli(item.optLong("lastUsedAt", System.currentTimeMillis()))
        )
      )
    }

    return credentials
  }

  fun savePasswordCredential(context: Context, username: String, password: String, domain: String?) {
    val items = JSONArray(readEncrypted(context, credentialsKey) ?: "[]")
    val next = JSONArray()
    val id = "password:" + (domain ?: "app") + ":" + username
    var replaced = false

    for (index in 0 until items.length()) {
      val item = items.optJSONObject(index) ?: continue
      val domains = credentialDomains(item)
      val isSameAccount = item.optString("id") == id ||
        (item.optString("username") == username && domain != null && domains.contains(domain))
      if (isSameAccount) {
        next.put(passwordJson(id, username, password, domain))
        replaced = true
      } else {
        next.put(item)
      }
    }

    if (!replaced) {
      next.put(passwordJson(id, username, password, domain))
    }

    writeEncrypted(context, credentialsKey, next.toString())
  }

  fun loadPasskeys(context: Context): List<ProviderPasskey> {
    val payload = readEncrypted(context, passkeysKey) ?: return emptyList()
    val items = JSONArray(payload)
    val passkeys = mutableListOf<ProviderPasskey>()

    for (index in 0 until items.length()) {
      val item = items.optJSONObject(index) ?: continue
      val id = item.optString("id")
      val alias = item.optString("alias")
      val rpId = item.optString("rpId")
      val username = item.optString("username")
      val userHandle = item.optString("userHandle")
      if (id.isBlank() || alias.isBlank() || rpId.isBlank() || username.isBlank() || userHandle.isBlank()) {
        continue
      }

      passkeys.add(
        ProviderPasskey(
          id = id,
          alias = alias,
          rpId = rpId,
          username = username,
          userHandle = userHandle,
          signCount = item.optInt("signCount", 0),
          lastUsedTime = Instant.ofEpochMilli(item.optLong("lastUsedAt", System.currentTimeMillis()))
        )
      )
    }

    return passkeys
  }

  fun savePasskey(context: Context, passkey: ProviderPasskey) {
    val items = JSONArray(readEncrypted(context, passkeysKey) ?: "[]")
    val next = JSONArray()
    var replaced = false

    for (index in 0 until items.length()) {
      val item = items.optJSONObject(index) ?: continue
      if (item.optString("id") == passkey.id) {
        next.put(passkeyJson(passkey))
        replaced = true
      } else {
        next.put(item)
      }
    }

    if (!replaced) {
      next.put(passkeyJson(passkey))
    }

    writeEncrypted(context, passkeysKey, next.toString())
  }

  fun passkeyById(context: Context, id: String?): ProviderPasskey? {
    if (id.isNullOrBlank()) {
      return null
    }

    return loadPasskeys(context).firstOrNull { passkey -> passkey.id == id }
  }

  fun passkeysPayload(context: Context): String {
    val items = JSONArray()
    loadPasskeys(context).forEach { passkey ->
      items.put(
        JSONObject()
          .put("id", passkey.id)
          .put("rpId", passkey.rpId)
          .put("username", passkey.username)
          .put("createdAt", passkey.lastUsedTime.toString().take(10))
          .put("lastUsedAt", "Provider")
          .put("providerBacked", true)
      )
    }
    return items.toString()
  }

  fun credentialsPayload(context: Context): String {
    val items = JSONArray()
    loadCredentials(context).forEach { credential ->
      items.put(
        JSONObject()
          .put("id", credential.id)
          .put("title", credential.title)
          .put("username", credential.username)
          .put("domain", credential.domain ?: "")
          .put("domains", JSONArray(credential.domains))
          .put("password", credential.password ?: "")
          .put("lastUsedAt", "Saved from autofill")
      )
    }
    return items.toString()
  }

  private fun passwordJson(id: String, username: String, password: String, domain: String?): JSONObject {
    return JSONObject()
      .put("id", id)
      .put("title", domain ?: username)
      .put("username", username)
      .put("domain", domain ?: "")
      .put("domains", if (domain.isNullOrBlank()) JSONArray() else JSONArray().put(domain))
      .put("password", password)
      .put("hasPassword", true)
      .put("hasPasskey", false)
      .put("lastUsedAt", System.currentTimeMillis())
  }

  private fun credentialDomains(item: JSONObject): List<String> {
    val domains = mutableListOf<String>()
    val domainList = item.optJSONArray("domains")

    if (domainList != null) {
      for (index in 0 until domainList.length()) {
        domainList.optString(index).takeIf { value -> value.isNotBlank() }?.let { domain ->
          domains.add(domain)
        }
      }
    }

    item.optString("domain").takeIf { value -> value.isNotBlank() }?.let { domain ->
      domains.add(domain)
    }

    return domains.distinct()
  }

  private fun passkeyJson(passkey: ProviderPasskey): JSONObject {
    return JSONObject()
      .put("id", passkey.id)
      .put("alias", passkey.alias)
      .put("rpId", passkey.rpId)
      .put("username", passkey.username)
      .put("userHandle", passkey.userHandle)
      .put("signCount", passkey.signCount)
      .put("lastUsedAt", passkey.lastUsedTime.toEpochMilli())
  }

  private fun prefs(context: Context) = context.getSharedPreferences(storeName, Context.MODE_PRIVATE)

  private fun writeEncrypted(context: Context, key: String, value: String) {
    val cipher = Cipher.getInstance(transformation)
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    val payload = listOf(cipher.iv, encrypted).joinToString(":") { bytes ->
      Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
    prefs(context).edit().putString(key, payload).apply()
  }

  private fun readEncrypted(context: Context, key: String): String? {
    val payload = prefs(context).getString(key, null) ?: return null
    val parts = payload.split(":")
    if (parts.size != 2) {
      return null
    }

    return try {
      val iv = Base64.decode(parts[0], Base64.NO_WRAP)
      val encrypted = Base64.decode(parts[1], Base64.NO_WRAP)
      val cipher = Cipher.getInstance(transformation)
      cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
      String(cipher.doFinal(encrypted), Charsets.UTF_8)
    } catch (_: Exception) {
      null
    }
  }

  private fun secretKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore")
    keyStore.load(null)
    val existing = keyStore.getKey(alias, null) as? SecretKey
    if (existing != null) {
      return existing
    }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    val spec = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .build()

    generator.init(spec)
    return generator.generateKey()
  }
}
`;
}

module.exports = { buildStoreSource };
