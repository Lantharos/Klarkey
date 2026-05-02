function buildPasskeySource(packageName) {
  return `package ${packageName}.credentialprovider

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.provider.CallingAppInfo
import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

object KlarkeyPasskeys {
  private const val keyPrefix = "klarkey_passkey_"
  private const val privilegedAllowlist = """{
  "apps": [
    {"type":"android","info":{"package_name":"com.android.chrome","signatures":[{"build":"release","cert_fingerprint_sha256":"F0:FD:6C:5B:41:0F:25:CB:25:C3:B5:33:46:C8:97:2F:AE:30:F8:EE:74:11:DF:91:04:80:AD:6B:2D:60:DB:83"}]}},
    {"type":"android","info":{"package_name":"com.chrome.beta","signatures":[{"build":"release","cert_fingerprint_sha256":"DA:63:3D:34:B6:9E:63:AE:21:03:B4:9D:53:CE:05:2F:C5:F7:F3:C5:3A:AB:94:FD:C2:A2:08:BD:FD:14:24:9C"},{"build":"release","cert_fingerprint_sha256":"3D:7A:12:23:01:9A:A3:9D:9E:A0:E3:43:6A:B7:C0:89:6B:FB:4F:B6:79:F4:DE:5F:E7:C2:3F:32:6C:8F:99:4A"}]}},
    {"type":"android","info":{"package_name":"com.chrome.dev","signatures":[{"build":"release","cert_fingerprint_sha256":"90:44:EE:5F:EE:4B:BC:5E:21:DD:44:66:54:31:C4:EB:1F:1F:71:A3:27:16:A0:BC:92:7B:CB:B3:92:33:CA:BF"},{"build":"release","cert_fingerprint_sha256":"3D:7A:12:23:01:9A:A3:9D:9E:A0:E3:43:6A:B7:C0:89:6B:FB:4F:B6:79:F4:DE:5F:E7:C2:3F:32:6C:8F:99:4A"}]}},
    {"type":"android","info":{"package_name":"com.chrome.canary","signatures":[{"build":"release","cert_fingerprint_sha256":"20:19:DF:A1:FB:23:EF:BF:70:C5:BC:D1:44:3C:5B:EA:B0:4F:3F:2F:F4:36:6E:9A:C1:E3:45:76:39:A2:4C:FC"}]}},
    {"type":"android","info":{"package_name":"org.mozilla.firefox","signatures":[{"build":"release","cert_fingerprint_sha256":"A7:8B:62:A5:16:5B:44:94:B2:FE:AD:9E:76:A2:80:D2:2D:93:7F:EE:62:51:AE:CE:59:94:46:B2:EA:31:9B:04"}]}},
    {"type":"android","info":{"package_name":"org.mozilla.firefox_beta","signatures":[{"build":"release","cert_fingerprint_sha256":"A7:8B:62:A5:16:5B:44:94:B2:FE:AD:9E:76:A2:80:D2:2D:93:7F:EE:62:51:AE:CE:59:94:46:B2:EA:31:9B:04"}]}},
    {"type":"android","info":{"package_name":"org.mozilla.fenix","signatures":[{"build":"release","cert_fingerprint_sha256":"50:04:77:90:88:E7:F9:88:D5:BC:5C:C5:F8:79:8F:EB:F4:F8:CD:08:4A:1B:2A:46:EF:D4:C8:EE:4A:EA:F2:11"}]}},
    {"type":"android","info":{"package_name":"org.mozilla.focus","signatures":[{"build":"release","cert_fingerprint_sha256":"62:03:A4:73:BE:36:D6:4E:E3:7F:87:FA:50:0E:DB:C7:9E:AB:93:06:10:AB:9B:9F:A4:CA:7D:5C:1F:1B:4F:FC"}]}},
    {"type":"android","info":{"package_name":"org.mozilla.focus.beta","signatures":[{"build":"release","cert_fingerprint_sha256":"62:03:A4:73:BE:36:D6:4E:E3:7F:87:FA:50:0E:DB:C7:9E:AB:93:06:10:AB:9B:9F:A4:CA:7D:5C:1F:1B:4F:FC"}]}},
    {"type":"android","info":{"package_name":"org.mozilla.focus.nightly","signatures":[{"build":"release","cert_fingerprint_sha256":"62:03:A4:73:BE:36:D6:4E:E3:7F:87:FA:50:0E:DB:C7:9E:AB:93:06:10:AB:9B:9F:A4:CA:7D:5C:1F:1B:4F:FC"}]}},
    {"type":"android","info":{"package_name":"org.mozilla.klar","signatures":[{"build":"release","cert_fingerprint_sha256":"62:03:A4:73:BE:36:D6:4E:E3:7F:87:FA:50:0E:DB:C7:9E:AB:93:06:10:AB:9B:9F:A4:CA:7D:5C:1F:1B:4F:FC"}]}},
    {"type":"android","info":{"package_name":"com.microsoft.emmx","signatures":[{"build":"release","cert_fingerprint_sha256":"01:E1:99:97:10:A8:2C:27:49:B4:D5:0C:44:5D:C8:5D:67:0B:61:36:08:9D:0A:76:6A:73:82:7C:82:A1:EA:C9"}]}},
    {"type":"android","info":{"package_name":"com.microsoft.emmx.beta","signatures":[{"build":"release","cert_fingerprint_sha256":"01:E1:99:97:10:A8:2C:27:49:B4:D5:0C:44:5D:C8:5D:67:0B:61:36:08:9D:0A:76:6A:73:82:7C:82:A1:EA:C9"}]}},
    {"type":"android","info":{"package_name":"com.microsoft.emmx.dev","signatures":[{"build":"release","cert_fingerprint_sha256":"01:E1:99:97:10:A8:2C:27:49:B4:D5:0C:44:5D:C8:5D:67:0B:61:36:08:9D:0A:76:6A:73:82:7C:82:A1:EA:C9"}]}},
    {"type":"android","info":{"package_name":"com.microsoft.emmx.canary","signatures":[{"build":"release","cert_fingerprint_sha256":"01:E1:99:97:10:A8:2C:27:49:B4:D5:0C:44:5D:C8:5D:67:0B:61:36:08:9D:0A:76:6A:73:82:7C:82:A1:EA:C9"}]}},
    {"type":"android","info":{"package_name":"com.brave.browser","signatures":[{"build":"release","cert_fingerprint_sha256":"9C:2D:B7:05:13:51:5F:DB:FB:BC:58:5B:3E:DF:3D:71:23:D4:DC:67:C9:4F:FD:30:63:61:C1:D7:9B:BF:18:AC"}]}},
    {"type":"android","info":{"package_name":"com.brave.browser_beta","signatures":[{"build":"release","cert_fingerprint_sha256":"9C:2D:B7:05:13:51:5F:DB:FB:BC:58:5B:3E:DF:3D:71:23:D4:DC:67:C9:4F:FD:30:63:61:C1:D7:9B:BF:18:AC"}]}},
    {"type":"android","info":{"package_name":"com.brave.browser_nightly","signatures":[{"build":"release","cert_fingerprint_sha256":"9C:2D:B7:05:13:51:5F:DB:FB:BC:58:5B:3E:DF:3D:71:23:D4:DC:67:C9:4F:FD:30:63:61:C1:D7:9B:BF:18:AC"}]}},
    {"type":"android","info":{"package_name":"com.duckduckgo.mobile.android","signatures":[{"build":"release","cert_fingerprint_sha256":"BB:7B:B3:1C:57:3C:46:A1:DA:7F:C5:C5:28:A6:AC:F4:32:10:84:56:FE:EC:50:81:0C:7F:33:69:4E:B3:D2:D4"}]}},
    {"type":"android","info":{"package_name":"com.sec.android.app.sbrowser","signatures":[{"build":"release","cert_fingerprint_sha256":"C8:A2:E9:BC:CF:59:7C:2F:B6:DC:66:BE:E2:93:FC:13:F2:FC:47:EC:77:BC:6B:2B:0D:52:C1:1F:51:19:2A:B8"},{"build":"release","cert_fingerprint_sha256":"34:DF:0E:7A:9F:1C:F1:89:2E:45:C0:56:B4:97:3C:D8:1C:CF:14:8A:40:50:D1:1A:EA:4A:C5:A6:5F:90:0A:42"}]}},
    {"type":"android","info":{"package_name":"com.sec.android.app.sbrowser.beta","signatures":[{"build":"release","cert_fingerprint_sha256":"C8:A2:E9:BC:CF:59:7C:2F:B6:DC:66:BE:E2:93:FC:13:F2:FC:47:EC:77:BC:6B:2B:0D:52:C1:1F:51:19:2A:B8"},{"build":"release","cert_fingerprint_sha256":"34:DF:0E:7A:9F:1C:F1:89:2E:45:C0:56:B4:97:3C:D8:1C:CF:14:8A:40:50:D1:1A:EA:4A:C5:A6:5F:90:0A:42"}]}}
  ]
}"""
  private val random = SecureRandom()
  private data class OriginResult(val origin: String, val usesProvidedClientDataHash: Boolean)

  fun rpIdFromRequestJson(requestJson: String): String? {
    return try {
      val request = JSONObject(requestJson)
      request.optString("rpId").takeIf { value -> value.isNotBlank() }
        ?: request.optJSONObject("rp")?.optString("id")?.takeIf { value -> value.isNotBlank() }
    } catch (_: Exception) {
      null
    }
  }

  fun createRegistration(
    context: Context,
    request: CreatePublicKeyCredentialRequest,
    callingAppInfo: CallingAppInfo?
  ): CreatePublicKeyCredentialResponse? {
    return try {
    val options = JSONObject(request.requestJson)
    val rp = options.optJSONObject("rp") ?: return null
    val user = options.optJSONObject("user") ?: return null
    val rpId = rp.optString("id").takeIf { value -> value.isNotBlank() } ?: return null
    val username = user.optString("name").takeIf { value -> value.isNotBlank() }
      ?: user.optString("displayName").takeIf { value -> value.isNotBlank() }
      ?: return null
    val userHandle = user.optString("id").takeIf { value -> value.isNotBlank() } ?: return null
    val challenge = options.optString("challenge").takeIf { value -> value.isNotBlank() } ?: return null
    val credentialId = base64Url(randomBytes(32))
    val alias = keyPrefix + credentialId
    val keyPair = generateKeyPair(alias)
    val publicKey = keyPair.public as ECPublicKey
    val coseKey = cosePublicKey(publicKey)
    val authData = registrationAuthData(rpId, base64UrlDecode(credentialId), coseKey)
    val origin = originFor(request.origin, rpId, callingAppInfo) ?: return null
    val clientData = clientDataJson("webauthn.create", challenge, origin.origin, origin.usesProvidedClientDataHash)
    val attestationObject = Cbor.writer()
      .map(3)
      .text("fmt").text("none")
      .text("attStmt").map(0)
      .text("authData").bytes(authData)
      .bytes()

    val passkey = ProviderPasskey(
      id = credentialId,
      alias = alias,
      rpId = rpId,
      username = username,
      userHandle = userHandle,
      itemId = null,
      signCount = 0,
      lastUsedTime = Instant.now()
    )
    KlarkeyCredentialStore.savePasskeyCredential(context, passkey)

    CreatePublicKeyCredentialResponse(
      JSONObject()
        .put("id", credentialId)
        .put("rawId", credentialId)
        .put("type", "public-key")
        .put("authenticatorAttachment", "platform")
        .put("clientExtensionResults", JSONObject())
        .put(
          "response",
          JSONObject()
            .put("clientDataJSON", base64Url(clientData))
            .put("attestationObject", base64Url(attestationObject))
            .put("authenticatorData", base64Url(authData))
            .put("publicKey", base64Url(coseKey))
            .put("publicKeyAlgorithm", -7)
            .put("transports", JSONArray().put("internal"))
        )
        .toString()
    )
    } catch (_: Exception) {
      null
    }
  }

  fun getAssertion(option: GetPublicKeyCredentialOption, passkey: ProviderPasskey, callingAppInfo: CallingAppInfo?): PublicKeyCredential? {
    return try {
    val requestJson = option.requestJson
    if (!allowsCredential(requestJson, passkey.id)) {
      return null
    }

    val challenge = JSONObject(requestJson).optString("challenge").takeIf { value -> value.isNotBlank() }
      ?: return null
    val signCount = passkey.signCount + 1
    val authData = assertionAuthData(passkey.rpId, signCount)
    val origin = originFor(null, passkey.rpId, callingAppInfo) ?: return null
    val clientData = clientDataJson("webauthn.get", challenge, origin.origin, origin.usesProvidedClientDataHash)
    val clientDataHash = credentialClientDataHash(option.clientDataHash, clientData, origin.usesProvidedClientDataHash)
    val signedData = authData + clientDataHash
    val signature = sign(passkey.alias, signedData)

    PublicKeyCredential(
      JSONObject()
        .put("id", passkey.id)
        .put("rawId", passkey.id)
        .put("type", "public-key")
        .put("authenticatorAttachment", "platform")
        .put("clientExtensionResults", JSONObject())
        .put(
          "response",
          JSONObject()
            .put("clientDataJSON", base64Url(clientData))
            .put("authenticatorData", base64Url(authData))
            .put("signature", base64Url(signature))
            .put("userHandle", passkey.userHandle)
        )
        .toString()
    )
    } catch (_: Exception) {
      null
    }
  }

  private fun allowsCredential(requestJson: String, credentialId: String): Boolean {
    val allowCredentials = JSONObject(requestJson).optJSONArray("allowCredentials") ?: return true
    if (allowCredentials.length() == 0) {
      return true
    }

    for (index in 0 until allowCredentials.length()) {
      val item = allowCredentials.optJSONObject(index) ?: continue
      if (item.optString("id") == credentialId) {
        return true
      }
    }

    return false
  }

  private fun generateKeyPair(alias: String): KeyPair {
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    val spec = KeyGenParameterSpec.Builder(
      alias,
      KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
    )
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .build()
    generator.initialize(spec)
    return generator.generateKeyPair()
  }

  private fun sign(alias: String, data: ByteArray): ByteArray {
    val keyStore = KeyStore.getInstance("AndroidKeyStore")
    keyStore.load(null)
    val privateKey = keyStore.getKey(alias, null) as PrivateKey
    val signature = Signature.getInstance("SHA256withECDSA")
    signature.initSign(privateKey)
    signature.update(data)
    return signature.sign()
  }

  private fun registrationAuthData(rpId: String, credentialId: ByteArray, coseKey: ByteArray): ByteArray {
    val aaguid = ByteArray(16)
    val credentialIdLength = byteArrayOf(((credentialId.size ushr 8) and 0xff).toByte(), (credentialId.size and 0xff).toByte())
    return sha256(rpId.toByteArray(Charsets.UTF_8)) +
      byteArrayOf(0x45.toByte()) +
      intBytes(0) +
      aaguid +
      credentialIdLength +
      credentialId +
      coseKey
  }

  private fun assertionAuthData(rpId: String, signCount: Int): ByteArray {
    return sha256(rpId.toByteArray(Charsets.UTF_8)) + byteArrayOf(0x05.toByte()) + intBytes(signCount)
  }

  private fun cosePublicKey(publicKey: ECPublicKey): ByteArray {
    return Cbor.writer()
      .map(5)
      .int(1).int(2)
      .int(3).int(-7)
      .int(-1).int(1)
      .int(-2).bytes(coordinate(publicKey.w.affineX))
      .int(-3).bytes(coordinate(publicKey.w.affineY))
      .bytes()
  }

  private fun coordinate(value: BigInteger): ByteArray {
    val raw = value.toByteArray()
    return when {
      raw.size == 32 -> raw
      raw.size > 32 -> raw.copyOfRange(raw.size - 32, raw.size)
      else -> ByteArray(32 - raw.size) + raw
    }
  }

  private fun clientDataJson(type: String, challenge: String, origin: String, placeholder: Boolean): ByteArray {
    if (placeholder) {
      return "{}".toByteArray(Charsets.UTF_8)
    }

    return JSONObject()
      .put("type", type)
      .put("challenge", challenge)
      .put("origin", origin)
      .put("crossOrigin", false)
      .toString()
      .toByteArray(Charsets.UTF_8)
  }

  private fun originFor(origin: String?, rpId: String, callingAppInfo: CallingAppInfo?): OriginResult? {
    if (callingAppInfo?.isOriginPopulated() == true) {
      val privilegedOrigin = try {
        callingAppInfo.getOrigin(privilegedAllowlist)?.takeIf { value -> value.isNotBlank() }
      } catch (_: Exception) {
        null
      }
      return privilegedOrigin?.let { value -> OriginResult(value, true) }
    }

    val appOrigin = callingAppOrigin(callingAppInfo)
    val requestOrigin = origin?.takeIf { value -> value.isNotBlank() }
    return OriginResult(appOrigin ?: requestOrigin ?: "https://" + rpId, false)
  }

  private fun callingAppOrigin(callingAppInfo: CallingAppInfo?): String? {
    val cert = callingAppInfo?.signingInfo?.apkContentsSigners?.firstOrNull()?.toByteArray() ?: return null
    return "android:apk-key-hash:" + base64Url(sha256(cert))
  }

  private fun credentialClientDataHash(clientDataHash: ByteArray?, clientData: ByteArray, required: Boolean): ByteArray {
    val provided = clientDataHash?.takeIf { value -> value.isNotEmpty() }
    return if (required) provided ?: throw IllegalArgumentException("clientDataHash is required") else provided ?: sha256(clientData)
  }

  private fun randomBytes(size: Int): ByteArray {
    val bytes = ByteArray(size)
    random.nextBytes(bytes)
    return bytes
  }

  private fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

  private fun intBytes(value: Int): ByteArray {
    return byteArrayOf(
      ((value ushr 24) and 0xff).toByte(),
      ((value ushr 16) and 0xff).toByte(),
      ((value ushr 8) and 0xff).toByte(),
      (value and 0xff).toByte()
    )
  }

  private fun base64Url(bytes: ByteArray): String {
    return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
  }

  private fun base64UrlDecode(value: String): ByteArray {
    return Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
  }
}

private class Cbor {
  private val out = ByteArrayOutputStream()

  fun map(size: Int): Cbor {
    type(5, size)
    return this
  }

  fun int(value: Int): Cbor {
    if (value >= 0) {
      type(0, value)
    } else {
      type(1, -1 - value)
    }
    return this
  }

  fun text(value: String): Cbor {
    val bytes = value.toByteArray(Charsets.UTF_8)
    type(3, bytes.size)
    out.write(bytes)
    return this
  }

  fun bytes(value: ByteArray): Cbor {
    type(2, value.size)
    out.write(value)
    return this
  }

  fun bytes(): ByteArray = out.toByteArray()

  private fun type(major: Int, value: Int) {
    when {
      value < 24 -> out.write((major shl 5) or value)
      value < 256 -> {
        out.write((major shl 5) or 24)
        out.write(value)
      }
      value < 65536 -> {
        out.write((major shl 5) or 25)
        out.write((value ushr 8) and 0xff)
        out.write(value and 0xff)
      }
      else -> {
        out.write((major shl 5) or 26)
        out.write((value ushr 24) and 0xff)
        out.write((value ushr 16) and 0xff)
        out.write((value ushr 8) and 0xff)
        out.write(value and 0xff)
      }
    }
  }

  companion object {
    fun writer() = Cbor()
  }
}
`;
}

module.exports = { buildPasskeySource };
