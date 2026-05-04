function buildStoreSource(packageName) {
  return `package ${packageName}.credentialprovider

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.time.Instant
import java.util.UUID
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
  val itemId: String?,
  val privateKeyJwk: String?,
  val signCount: Int,
  val lastUsedTime: Instant
)

object KlarkeyCredentialStore {
  private const val storeAlias = "klarkey_android_provider_store"
  private const val storeName = "klarkey_android_provider"
  private const val credentialsKey = "credentials"
  private const val passkeysKey = "passkeys"
  private const val unlockedUntilKey = "unlockedUntil"
  private const val transformation = "AES/GCM/NoPadding"
  private const val redactedPrivateKeyJwk = "__klarkey_redacted_private_jwk__"
  private const val unlockWindowMs = 5 * 60 * 1000L
  private const val maxProviderPayloadBytes = 2 * 1024 * 1024
  private const val maxEncryptedPayloadChars = maxProviderPayloadBytes * 2
  private const val maxPrivateKeyJwkBytes = 8192

  fun replaceCredentials(context: Context, payload: String, unlockedUntil: Long) {
    if (!safePayload(payload)) {
      return
    }
    writeEncrypted(context, credentialsKey, mergeProviderOwnedCredentials(context, payload))
    prefs(context).edit().putLong(unlockedUntilKey, boundedUnlockedUntil(unlockedUntil)).apply()
  }

  fun replacePasskeys(context: Context, payload: String) {
    if (!safePayload(payload)) {
      return
    }
    val incoming = jsonArray(payload)
    val incomingIds = mutableSetOf<String>()
    val merged = JSONArray()

    for (index in 0 until incoming.length()) {
      val item = incoming.optJSONObject(index) ?: continue
      val id = item.optString("id")
      val rpId = item.optString("rpId")
      val username = item.optString("username")
      val userHandle = item.optString("userHandle")
      val privateKeyJwk = privateKeyJwkPayload(item.opt("privateKeyJwk"))
      if (id.isBlank() || rpId.isBlank() || username.isBlank() || userHandle.isBlank() || privateKeyJwk == null) {
        continue
      }

      incomingIds.add(id)
      merged.put(passkeyJson(
        ProviderPasskey(
          id = id,
          alias = "",
          rpId = rpId,
          username = username,
          userHandle = userHandle,
          itemId = item.optString("itemId").takeIf { value -> value.isNotBlank() },
          privateKeyJwk = privateKeyJwk,
          signCount = 0,
          lastUsedTime = Instant.ofEpochMilli(item.optLong("lastUsedAt", System.currentTimeMillis()))
        )
      ))
    }

    val existing = jsonArray(readEncrypted(context, passkeysKey))
    for (index in 0 until existing.length()) {
      val item = existing.optJSONObject(index) ?: continue
      val id = item.optString("id")
      if (item.optString("privateKeyJwk").isBlank() && !incomingIds.contains(id)) {
        merged.put(item)
      }
    }

    writeEncrypted(context, passkeysKey, merged.toString())
  }

  fun lock(context: Context) {
    prefs(context).edit().putLong(unlockedUntilKey, 0).apply()
  }

  fun deleteProviderItem(context: Context, itemId: String, passkeyIdsPayload: String) {
    deleteCredential(context, itemId)
    deletePasskeys(context, itemId, stringSet(passkeyIdsPayload))
  }

  fun unlock(context: Context, unlockedUntil: Long) {
    prefs(context).edit().putLong(unlockedUntilKey, boundedUnlockedUntil(unlockedUntil)).apply()
  }

  fun isUnlocked(context: Context): Boolean {
    return prefs(context).getLong(unlockedUntilKey, 0) > System.currentTimeMillis()
  }

  fun loadCredentials(context: Context): List<ProviderCredential> {
    val payload = readEncrypted(context, credentialsKey) ?: return emptyList()
    val includeSecrets = isUnlocked(context)
    val items = jsonArray(payload)
    val credentials = mutableListOf<ProviderCredential>()

    for (index in 0 until items.length()) {
      val item = items.optJSONObject(index) ?: continue
      val id = item.optString("id")
      val username = item.optString("username")
      if (id.isBlank() || username.isBlank()) {
        continue
      }

      val storedPassword = item.optString("password").takeIf { value -> value.isNotBlank() }
      val password = storedPassword.takeIf { includeSecrets }
      val hasPassword = item.optBoolean("hasPassword", false) || storedPassword != null
      val domains = credentialDomains(item)
      credentials.add(
        ProviderCredential(
          id = id,
          title = item.optString("title", username),
          username = username,
          domain = domains.firstOrNull(),
          domains = domains,
          password = password,
          hasPassword = hasPassword,
          hasPasskey = item.optBoolean("hasPasskey", false),
          lastUsedTime = Instant.ofEpochMilli(item.optLong("lastUsedAt", System.currentTimeMillis()))
        )
      )
    }

    return credentials
  }

  fun savePasswordCredential(context: Context, username: String, password: String, domain: String?) {
    val host = normalizeHost(domain)
    val items = jsonArray(readEncrypted(context, credentialsKey))
    val next = JSONArray()
    val fallbackId = "password:" + (host ?: "app") + ":" + username
    var replaced = false

    for (index in 0 until items.length()) {
      val item = items.optJSONObject(index) ?: continue
      val isSameAccount = item.optString("id") == fallbackId || matchingCredential(item, username, host)
      if (isSameAccount) {
        val domains = mergeDomain(credentialDomains(item), host)
        next.put(
          credentialJson(
            id = item.optString("id").takeIf { value -> value.isNotBlank() } ?: fallbackId,
            title = item.optString("title").takeIf { value -> value.isNotBlank() } ?: host ?: username,
            username = username,
            password = password,
            domain = domains.firstOrNull(),
            domains = domains,
            hasPassword = true,
            hasPasskey = item.optBoolean("hasPasskey", false),
            lastUsedAt = System.currentTimeMillis()
          )
        )
        replaced = true
      } else {
        next.put(item)
      }
    }

    if (!replaced) {
      val domains = mergeDomain(emptyList(), host)
      next.put(
        credentialJson(
          id = fallbackId,
          title = host ?: username,
          username = username,
          password = password,
          domain = domains.firstOrNull(),
          domains = domains,
          hasPassword = true,
          hasPasskey = false,
          lastUsedAt = System.currentTimeMillis()
        )
      )
    }

    writeEncrypted(context, credentialsKey, next.toString())
  }

  fun loadPasskeys(context: Context, includeSecrets: Boolean = true): List<ProviderPasskey> {
    val payload = readEncrypted(context, passkeysKey) ?: return emptyList()
    val items = jsonArray(payload)
    val passkeys = mutableListOf<ProviderPasskey>()

    for (index in 0 until items.length()) {
      val item = items.optJSONObject(index) ?: continue
      val id = item.optString("id")
      val alias = item.optString("alias")
      val rpId = item.optString("rpId")
      val username = item.optString("username")
      val userHandle = item.optString("userHandle")
      val privateKeyJwk = privateKeyJwkPayload(item.opt("privateKeyJwk"))
      if (id.isBlank() || rpId.isBlank() || username.isBlank() || userHandle.isBlank()) {
        continue
      }
      if (includeSecrets && alias.isBlank() && privateKeyJwk == null) {
        continue
      }

      passkeys.add(
        ProviderPasskey(
          id = id,
          alias = alias.takeIf { includeSecrets } ?: "",
          rpId = rpId,
          username = username,
          userHandle = userHandle,
          itemId = item.optString("itemId").takeIf { value -> value.isNotBlank() },
          privateKeyJwk = privateKeyJwk?.takeIf { includeSecrets } ?: if (privateKeyJwk != null) redactedPrivateKeyJwk else null,
          signCount = item.optInt("signCount", 0),
          lastUsedTime = Instant.ofEpochMilli(item.optLong("lastUsedAt", System.currentTimeMillis()))
        )
      )
    }

    return passkeys
  }

  fun savePasskey(context: Context, passkey: ProviderPasskey) {
    val items = jsonArray(readEncrypted(context, passkeysKey))
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

  fun savePasskeyCredential(context: Context, passkey: ProviderPasskey): ProviderPasskey {
    val credential = upsertPasskeyCredential(context, passkey)
    val itemId = credential.optString("id").takeIf { value -> value.isNotBlank() }
    val linkedPasskey = passkey.copy(itemId = itemId)
    savePasskey(context, linkedPasskey)
    return linkedPasskey
  }

  fun passkeyById(context: Context, id: String?): ProviderPasskey? {
    if (id.isNullOrBlank() || !isUnlocked(context)) {
      return null
    }

    return loadPasskeys(context).firstOrNull { passkey -> passkey.id == id }
  }

  fun passkeysPayload(context: Context): String {
    val items = JSONArray()
    val includeSecrets = isUnlocked(context)
    loadPasskeys(context, includeSecrets = includeSecrets).forEach { passkey ->
      items.put(
        JSONObject()
          .put("id", passkey.id)
          .put("rpId", passkey.rpId)
          .put("username", passkey.username)
          .put("userHandle", passkey.userHandle)
          .put("itemId", passkey.itemId ?: "")
          .put("createdAt", passkey.lastUsedTime.toString().take(10))
          .put("lastUsedAt", if (passkey.privateKeyJwk == null) "Provider" else passkey.lastUsedTime.toString())
          .put("privateKeyJwk", passkey.privateKeyJwk?.takeIf { includeSecrets && it != redactedPrivateKeyJwk }?.let { value -> privateKeyJwkJson(value) } ?: "")
          .put("signCount", if (includeSecrets) 0 else passkey.signCount)
          .put("syncedCounter", includeSecrets && passkey.privateKeyJwk != null)
          .put("providerBacked", passkey.privateKeyJwk == null)
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
          .put("hasPassword", credential.hasPassword)
          .put("hasPasskey", credential.hasPasskey)
          .put("lastUsedAt", "Saved from autofill")
      )
    }
    return items.toString()
  }

  fun matchesCallingPackage(credential: ProviderCredential, packageName: String?): Boolean {
    val targetPackage = normalizeHost(packageName)
    if (targetPackage.isNullOrBlank()) {
      return false
    }

    return credential.domains.any { domain -> normalizeHost(domain) == targetPackage } ||
      normalizeHost(credential.domain) == targetPackage
  }

  private fun upsertPasskeyCredential(context: Context, passkey: ProviderPasskey): JSONObject {
    val host = normalizeHost(passkey.rpId) ?: passkey.rpId
    val items = jsonArray(readEncrypted(context, credentialsKey))
    val next = JSONArray()
    var credential: JSONObject? = null

    for (index in 0 until items.length()) {
      val item = items.optJSONObject(index) ?: continue
      val isSameAccount = (!passkey.itemId.isNullOrBlank() && item.optString("id") == passkey.itemId) ||
        matchingCredential(item, passkey.username, host)

      if (isSameAccount) {
        val password = item.optString("password").takeIf { value -> value.isNotBlank() }
        val domains = mergeDomain(credentialDomains(item), host)
        val updated = credentialJson(
          id = item.optString("id").takeIf { value -> value.isNotBlank() && !value.startsWith("passkey:") } ?: UUID.randomUUID().toString(),
          title = item.optString("title").takeIf { value -> value.isNotBlank() } ?: host,
          username = passkey.username,
          password = password,
          domain = domains.firstOrNull(),
          domains = domains,
          hasPassword = item.optBoolean("hasPassword", false) && password != null,
          hasPasskey = true,
          lastUsedAt = System.currentTimeMillis()
        )
        credential = updated
        next.put(updated)
      } else {
        next.put(item)
      }
    }

    if (credential == null) {
      val domains = listOf(host)
      credential = credentialJson(
        id = UUID.randomUUID().toString(),
        title = host,
        username = passkey.username,
        password = null,
        domain = domains.firstOrNull(),
        domains = domains,
        hasPassword = false,
        hasPasskey = true,
        lastUsedAt = System.currentTimeMillis()
      )
      next.put(credential)
    }

    writeEncrypted(context, credentialsKey, next.toString())
    return credential!!
  }

  private fun credentialJson(
    id: String,
    title: String,
    username: String,
    password: String?,
    domain: String?,
    domains: List<String>,
    hasPassword: Boolean,
    hasPasskey: Boolean,
    lastUsedAt: Long
  ): JSONObject {
    return JSONObject()
      .put("id", id)
      .put("title", title)
      .put("username", username)
      .put("domain", domain ?: "")
      .put("domains", JSONArray(domains))
      .put("password", password ?: "")
      .put("hasPassword", hasPassword && !password.isNullOrBlank())
      .put("hasPasskey", hasPasskey)
      .put("lastUsedAt", lastUsedAt)
  }

  private fun credentialDomains(item: JSONObject): List<String> {
    val domains = mutableListOf<String>()
    val domainList = item.optJSONArray("domains")

    if (domainList != null) {
      for (index in 0 until domainList.length()) {
        normalizeHost(domainList.optString(index))?.let { domain ->
          domains.add(domain)
        }
      }
    }

    normalizeHost(item.optString("domain"))?.let { domain ->
      domains.add(domain)
    }

    return domains.distinct()
  }

  private fun mergeProviderOwnedCredentials(context: Context, payload: String): String {
    val incoming = jsonArray(payload)
    val ids = mutableSetOf<String>()
    for (index in 0 until incoming.length()) {
      incoming.optJSONObject(index)?.optString("id")?.takeIf { id -> id.isNotBlank() }?.let { id -> ids.add(id) }
    }

    val merged = jsonArray(payload)
    val existing = jsonArray(readEncrypted(context, credentialsKey))
    for (index in 0 until existing.length()) {
      val item = existing.optJSONObject(index) ?: continue
      val id = item.optString("id")
      if (providerOwnedCredential(id) && !ids.contains(id)) {
        merged.put(item)
      }
    }

    return merged.toString()
  }

  private fun deleteCredential(context: Context, itemId: String) {
    if (itemId.isBlank()) {
      return
    }

    val existing = jsonArray(readEncrypted(context, credentialsKey))
    val next = JSONArray()
    var changed = false
    for (index in 0 until existing.length()) {
      val item = existing.optJSONObject(index) ?: continue
      if (item.optString("id") == itemId) {
        changed = true
      } else {
        next.put(item)
      }
    }

    if (changed) {
      writeEncrypted(context, credentialsKey, next.toString())
    }
  }

  private fun deletePasskeys(context: Context, itemId: String, passkeyIds: Set<String>) {
    val existing = jsonArray(readEncrypted(context, passkeysKey))
    val next = JSONArray()
    var changed = false
    for (index in 0 until existing.length()) {
      val item = existing.optJSONObject(index) ?: continue
      val id = item.optString("id")
      val linkedItemId = item.optString("itemId")
      val shouldDelete = passkeyIds.contains(id) || (itemId.isNotBlank() && linkedItemId == itemId)
      if (shouldDelete) {
        item.optString("alias").takeIf { alias -> alias.isNotBlank() }?.let { alias -> deletePasskeyKey(alias) }
        changed = true
      } else {
        next.put(item)
      }
    }

    if (changed) {
      writeEncrypted(context, passkeysKey, next.toString())
    }
  }

  private fun stringSet(payload: String): Set<String> {
    if (!safePayload(payload)) {
      return emptySet()
    }
    return try {
      val values = JSONArray(payload)
      val ids = mutableSetOf<String>()
      for (index in 0 until values.length()) {
        values.optString(index).takeIf { value -> value.isNotBlank() }?.let { value -> ids.add(value) }
      }
      ids
    } catch (_: Exception) {
      emptySet()
    }
  }

  private fun jsonArray(payload: String?): JSONArray {
    if (payload.isNullOrBlank()) {
      return JSONArray()
    }
    if (!safePayload(payload)) {
      return JSONArray()
    }
    return try {
      JSONArray(payload)
    } catch (_: Exception) {
      JSONArray()
    }
  }

  private fun privateKeyJwkPayload(value: Any?): String? {
    val raw = when (value) {
      is JSONObject -> value.toString()
      is String -> value.takeIf { item -> item.isNotBlank() }
      else -> null
    } ?: return null

    return raw.takeIf { item -> safePayload(item, maxPrivateKeyJwkBytes) && privateKeyJwkJson(item) != null }
  }

  private fun privateKeyJwkJson(value: String): JSONObject? {
    return try {
      val jwk = JSONObject(value)
      val isValidP256PrivateKey = jwk.optString("kty") == "EC" &&
        jwk.optString("crv") == "P-256" &&
        isP256Coordinate(jwk.optString("x")) &&
        isP256Coordinate(jwk.optString("y")) &&
        isP256Coordinate(jwk.optString("d"))
      if (isValidP256PrivateKey) jwk else null
    } catch (_: Exception) {
      null
    }
  }

  private fun isP256Coordinate(value: String): Boolean {
    if (value.isBlank()) {
      return false
    }
    return try {
      Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING).size == 32
    } catch (_: Exception) {
      false
    }
  }

  private fun matchingCredential(item: JSONObject, username: String, domain: String?): Boolean {
    if (item.optString("username") != username || domain.isNullOrBlank()) {
      return false
    }

    return credentialDomains(item).any { candidate -> domainsMatch(candidate, domain) }
  }

  private fun mergeDomain(domains: List<String>, domain: String?): List<String> {
    val values = domains.toMutableList()
    domain?.takeIf { value -> value.isNotBlank() && values.none { existing -> domainsMatch(existing, value) } }?.let { value ->
      values.add(value)
    }
    return values.distinct()
  }

  private fun providerOwnedCredential(id: String): Boolean {
    return id.startsWith("password:") || id.startsWith("passkey:")
  }

  private fun domainsMatch(candidate: String?, target: String?): Boolean {
    if (candidate.isNullOrBlank() || target.isNullOrBlank()) {
      return false
    }

    return candidate == target || (isSubdomainMatchAllowed(candidate) && target.endsWith("." + candidate))
  }

  private fun isSubdomainMatchAllowed(candidate: String): Boolean {
    return candidate.contains(".") && !candidate.matches(Regex("""\\d{1,3}(\\.\\d{1,3}){3}""")) && !candidate.startsWith("[")
  }

  private fun normalizeHost(value: String?): String? {
    val trimmed = value?.trim()?.lowercase()?.removePrefix("https://")?.removePrefix("http://") ?: return null
    val host = trimmed.substringBefore("/").substringBefore(":").removePrefix("www.")
    return host.takeIf { it.isNotBlank() }
  }

  private fun passkeyJson(passkey: ProviderPasskey): JSONObject {
    return JSONObject()
      .put("id", passkey.id)
      .put("alias", passkey.alias)
      .put("rpId", passkey.rpId)
      .put("username", passkey.username)
      .put("userHandle", passkey.userHandle)
      .put("itemId", passkey.itemId ?: "")
      .put("privateKeyJwk", passkey.privateKeyJwk ?: "")
      .put("signCount", passkey.signCount)
      .put("lastUsedAt", passkey.lastUsedTime.toEpochMilli())
  }

  private fun deletePasskeyKey(alias: String) {
    try {
      val keyStore = KeyStore.getInstance("AndroidKeyStore")
      keyStore.load(null)
      if (keyStore.containsAlias(alias)) {
        keyStore.deleteEntry(alias)
      }
    } catch (_: Exception) {
    }
  }

  private fun prefs(context: Context) = context.getSharedPreferences(storeName, Context.MODE_PRIVATE)

  private fun boundedUnlockedUntil(unlockedUntil: Long): Long {
    val now = System.currentTimeMillis()
    if (unlockedUntil <= now) {
      return 0
    }
    return minOf(unlockedUntil, now + unlockWindowMs)
  }

  private fun writeEncrypted(context: Context, key: String, value: String) {
    val plaintext = value.toByteArray(Charsets.UTF_8)
    if (plaintext.size > maxProviderPayloadBytes) {
      return
    }
    val cipher = Cipher.getInstance(transformation)
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    val encrypted = cipher.doFinal(plaintext)
    val payload = listOf(cipher.iv, encrypted).joinToString(":") { bytes ->
      Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
    prefs(context).edit().putString(key, payload).apply()
  }

  private fun readEncrypted(context: Context, key: String): String? {
    val payload = prefs(context).getString(key, null) ?: return null
    if (payload.length > maxEncryptedPayloadChars) {
      return null
    }
    val secretKey = existingSecretKey() ?: return null
    return decryptPayload(payload, secretKey)
  }

  private fun safePayload(value: String, maxBytes: Int = maxProviderPayloadBytes): Boolean {
    return value.toByteArray(Charsets.UTF_8).size <= maxBytes
  }

  private fun decryptPayload(payload: String, secretKey: SecretKey): String? {
    val parts = payload.split(":")
    if (parts.size != 2) {
      return null
    }

    return try {
      val iv = Base64.decode(parts[0], Base64.NO_WRAP)
      val encrypted = Base64.decode(parts[1], Base64.NO_WRAP)
      val cipher = Cipher.getInstance(transformation)
      cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
      String(cipher.doFinal(encrypted), Charsets.UTF_8)
    } catch (_: Exception) {
      null
    }
  }

  private fun secretKey(): SecretKey {
    existingSecretKey()?.let { key -> return key }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(storeKeySpec())
    return generator.generateKey()
  }

  private fun existingSecretKey(): SecretKey? {
    val keyStore = KeyStore.getInstance("AndroidKeyStore")
    keyStore.load(null)
    return keyStore.getKey(storeAlias, null) as? SecretKey
  }

  private fun storeKeySpec(): KeyGenParameterSpec {
    val builder = KeyGenParameterSpec.Builder(
      storeAlias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
      builder.setUnlockedDeviceRequired(true)
    }

    return builder.build()
  }
}
`;
}

module.exports = { buildStoreSource };
