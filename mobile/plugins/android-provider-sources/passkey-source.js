function buildPasskeySource(packageName) {
  return `package ${packageName}.credentialprovider

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.provider.CallingAppInfo
import androidx.credentials.webauthn.AuthenticatorAssertionResponse
import androidx.credentials.webauthn.AuthenticatorAttestationResponse
import androidx.credentials.webauthn.FidoPublicKeyCredential
import androidx.credentials.webauthn.PublicKeyCredentialCreationOptions
import androidx.credentials.webauthn.PublicKeyCredentialRequestOptions
import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyFactory
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECParameterSpec
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import java.time.Instant
import org.json.JSONObject

object KlarkeyPasskeys {
  private const val keyPrefix = "klarkey_passkey_"
  private const val publicKeyAlgorithm = -7
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
  private data class OriginResult(val origin: String, val packageName: String?)

  fun rpIdFromRequestJson(requestJson: String): String? {
    return try {
      val request = JSONObject(requestJson)
      normalizeRpId(request.optString("rpId").takeIf { value -> value.isNotBlank() }
        ?: request.optJSONObject("rp")?.optString("id")?.takeIf { value -> value.isNotBlank() }
      )
    } catch (_: Exception) {
      null
    }
  }

  fun requiresUserVerification(requestJson: String): Boolean {
    return try {
      JSONObject(requestJson).optString("userVerification", "preferred") != "discouraged"
    } catch (_: Exception) {
      true
    }
  }

  fun trustedCredentialSaveDomain(callingAppInfo: CallingAppInfo?): String? {
    return privilegedWebOrigin(callingAppInfo)
      ?: callingAppInfo?.packageName?.takeIf { value -> value.isNotBlank() }
  }

  fun rpIdMatchesCaller(requestJson: String, callingAppInfo: CallingAppInfo?): Boolean {
    val rpId = rpIdFromRequestJson(requestJson) ?: return false
    val origin = originFor(callingAppInfo) ?: return false
    return rpIdMatchesOrigin(rpId, origin.origin)
  }

  fun createRegistration(
    context: Context,
    request: CreatePublicKeyCredentialRequest,
    callingAppInfo: CallingAppInfo?
  ): CreatePublicKeyCredentialResponse? {
    return try {
    val options = PublicKeyCredentialCreationOptions(request.requestJson)
    val rpId = normalizeRpId(options.rp.id) ?: return null
    val username = options.user.name.takeIf { value -> value.isNotBlank() }
      ?: options.user.displayName.takeIf { value -> value.isNotBlank() }
      ?: return null
    val userHandle = base64Url(options.user.id)
    val credentialIdBytes = randomBytes(32)
    val credentialId = base64Url(credentialIdBytes)
    val alias = keyPrefix + credentialId
    val keyPair = generateSoftwareKeyPair()
    val publicKey = keyPair.public as ECPublicKey
    val privateKeyJwk = privateKeyJwk(keyPair.private as ECPrivateKey, publicKey)
    val coseKey = cosePublicKey(publicKey)
    val origin = originFor(callingAppInfo) ?: return null
    if (!rpIdMatchesOrigin(rpId, origin.origin)) {
      return null
    }
    val response = AuthenticatorAttestationResponse(
      options,
      credentialIdBytes,
      coseKey,
      origin.origin,
      true,
      true,
      true,
      false,
      origin.packageName,
      null
    )
    response.clientJson.put("crossOrigin", false)

    val passkey = ProviderPasskey(
      id = credentialId,
      alias = alias,
      rpId = rpId,
      username = username,
      userHandle = userHandle,
      itemId = null,
      privateKeyJwk = privateKeyJwk,
      signCount = 0,
      lastUsedTime = Instant.now()
    )
    KlarkeyCredentialStore.savePasskeyCredential(context, passkey)

    val responseJson = registrationJson(
      FidoPublicKeyCredential(credentialIdBytes, response, "platform").json(),
      rpId,
      credentialIdBytes,
      coseKey,
      publicKey
    )
    CreatePublicKeyCredentialResponse(responseJson)
    } catch (_: Exception) {
      null
    }
  }

  fun getAssertion(option: GetPublicKeyCredentialOption, passkey: ProviderPasskey, callingAppInfo: CallingAppInfo?, userVerified: Boolean): PublicKeyCredential? {
    return try {
    val requestJson = option.requestJson
    if (!allowsCredential(requestJson, passkey.id)) {
      return null
    }

    val requestOptions = PublicKeyCredentialRequestOptions(requestJson)
    val origin = originFor(callingAppInfo) ?: return null
    val requestRpId = rpIdFromRequestJson(requestJson) ?: return null
    if (requestRpId != passkey.rpId || !rpIdMatchesOrigin(passkey.rpId, origin.origin)) {
      return null
    }
    val credentialIdBytes = base64UrlDecode(passkey.id)
    val clientDataHash = clientDataHashForAssertion(callingAppInfo, option.clientDataHash)
    val response = AuthenticatorAssertionResponse(
      requestOptions,
      credentialIdBytes,
      origin.origin,
      true,
      userVerified,
      true,
      false,
      base64UrlDecode(passkey.userHandle),
      origin.packageName,
      clientDataHash
    )
    response.clientJson.put("crossOrigin", false)
    val signCount = if (passkey.privateKeyJwk.isNullOrBlank()) passkey.signCount + 1 else 0
    response.authenticatorData = assertionAuthenticatorData(passkey.rpId, userVerified, signCount)
    response.signature = sign(passkey, response.dataToSign())

    val responseJson = FidoPublicKeyCredential(credentialIdBytes, response, "platform").json()
    PublicKeyCredential(responseJson)
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

  private fun clientDataHashForAssertion(callingAppInfo: CallingAppInfo?, clientDataHash: ByteArray?): ByteArray? {
    if (callingAppInfo?.isOriginPopulated() != true) {
      return null
    }

    return clientDataHash?.takeIf { value -> value.isNotEmpty() }
  }

  private fun assertionAuthenticatorData(rpId: String, userVerified: Boolean, signCount: Int): ByteArray {
    val out = ByteArrayOutputStream()
    var flags = 0x19
    if (userVerified) {
      flags = flags or 0x04
    }
    out.write(sha256(rpId.toByteArray(Charsets.UTF_8)))
    out.write(flags)
    out.write(byteArrayOf(
      (signCount ushr 24).toByte(),
      (signCount ushr 16).toByte(),
      (signCount ushr 8).toByte(),
      signCount.toByte()
    ))
    return out.toByteArray()
  }

  private fun generateSoftwareKeyPair(): KeyPair {
    val generator = KeyPairGenerator.getInstance("EC")
    generator.initialize(ECGenParameterSpec("secp256r1"), random)
    return generator.generateKeyPair()
  }

  private fun sign(passkey: ProviderPasskey, data: ByteArray): ByteArray {
    val privateKey = passkey.privateKeyJwk
      ?.takeIf { value -> value.isNotBlank() }
      ?.let { jwk -> privateKeyFromJwk(jwk) }
      ?: privateKeyFromAndroidKeyStore(passkey.alias)
    val signature = Signature.getInstance("SHA256withECDSA")
    signature.initSign(privateKey)
    signature.update(data)
    return signature.sign()
  }

  private fun privateKeyFromAndroidKeyStore(alias: String): PrivateKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore")
    keyStore.load(null)
    return keyStore.getKey(alias, null) as PrivateKey
  }

  private fun privateKeyJwk(privateKey: ECPrivateKey, publicKey: ECPublicKey): String {
    return JSONObject()
      .put("kty", "EC")
      .put("crv", "P-256")
      .put("x", base64Url(coordinate(publicKey.w.affineX)))
      .put("y", base64Url(coordinate(publicKey.w.affineY)))
      .put("d", base64Url(coordinate(privateKey.s)))
      .put("ext", true)
      .toString()
  }

  private fun privateKeyFromJwk(jwk: String): PrivateKey {
    val parsed = JSONObject(jwk)
    require(parsed.optString("kty") == "EC" && parsed.optString("crv") == "P-256")
    val params = AlgorithmParameters.getInstance("EC")
    params.init(ECGenParameterSpec("secp256r1"))
    val spec = ECPrivateKeySpec(
      jwkCoordinate(parsed, "d"),
      params.getParameterSpec(ECParameterSpec::class.java)
    )
    val keyFactory = KeyFactory.getInstance("EC")
    val privateKey = keyFactory.generatePrivate(spec)
    val publicKey = keyFactory.generatePublic(ECPublicKeySpec(
      ECPoint(jwkCoordinate(parsed, "x"), jwkCoordinate(parsed, "y")),
      params.getParameterSpec(ECParameterSpec::class.java)
    ))
    require(keyPairMatches(privateKey, publicKey))
    return privateKey
  }

  private fun jwkCoordinate(jwk: JSONObject, key: String): BigInteger {
    val value = base64UrlDecode(jwk.getString(key))
    require(value.size == 32)
    return BigInteger(1, value)
  }

  private fun keyPairMatches(privateKey: PrivateKey, publicKey: java.security.PublicKey): Boolean {
    return try {
      val probe = "klarkey-passkey-jwk-check".toByteArray(Charsets.UTF_8)
      val signer = Signature.getInstance("SHA256withECDSA")
      signer.initSign(privateKey, random)
      signer.update(probe)
      val signatureBytes = signer.sign()
      val verifier = Signature.getInstance("SHA256withECDSA")
      verifier.initVerify(publicKey)
      verifier.update(probe)
      verifier.verify(signatureBytes)
    } catch (_: Exception) {
      false
    }
  }

  private fun registrationJson(responseJson: String, rpId: String, credentialId: ByteArray, credentialPublicKey: ByteArray, publicKey: ECPublicKey): String {
    val credential = JSONObject(responseJson)
    val response = credential.getJSONObject("response")
    response.put("authenticatorData", base64Url(authenticatorData(rpId, credentialId, credentialPublicKey)))
    response.put("publicKey", base64Url(publicKey.encoded))
    response.put("publicKeyAlgorithm", publicKeyAlgorithm)
    return credential.toString()
  }

  private fun authenticatorData(rpId: String, credentialId: ByteArray, credentialPublicKey: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    out.write(sha256(rpId.toByteArray(Charsets.UTF_8)))
    out.write(0x5d)
    out.write(byteArrayOf(0, 0, 0, 0))
    out.write(ByteArray(16))
    out.write(byteArrayOf((credentialId.size shr 8).toByte(), credentialId.size.toByte()))
    out.write(credentialId)
    out.write(credentialPublicKey)
    return out.toByteArray()
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

  private fun originFor(callingAppInfo: CallingAppInfo?): OriginResult? {
    val webOrigin = privilegedWebOrigin(callingAppInfo)
    if (webOrigin != null) {
      return OriginResult(webOrigin, null)
    }

    val appOrigin = callingAppOrigin(callingAppInfo)
    if (appOrigin != null) {
      return OriginResult(appOrigin, callingAppInfo?.packageName)
    }
    return null
  }

  private fun rpIdMatchesOrigin(rpId: String, origin: String): Boolean {
    val normalizedRpId = normalizeRpId(rpId) ?: return false
    if (!isValidRpId(normalizedRpId)) {
      return false
    }

    if (origin.startsWith("android:apk-key-hash:")) {
      return true
    }

    return try {
      val parsed = Uri.parse(origin)
      val scheme = parsed.scheme
      val host = parsed.host?.lowercase()?.removeSuffix(".") ?: return false
      val localHttp = scheme == "http" && isLocalHost(host)
      if (scheme != "https" && !localHttp) {
        return false
      }
      host == normalizedRpId || (!isLocalHost(normalizedRpId) && host.endsWith("." + normalizedRpId))
    } catch (_: Exception) {
      false
    }
  }

  private fun isValidRpId(value: String): Boolean {
    if (value.isBlank() || value.startsWith(".") || value.endsWith(".") || value.contains("..")) {
      return false
    }
    if (isLocalHost(value)) {
      return true
    }
    return value.contains(".") && value.matches(Regex("""[a-z0-9.-]+"""))
  }

  private fun normalizeRpId(value: String?): String? {
    val normalized = value?.trim()?.lowercase()?.removeSuffix(".") ?: return null
    return normalized.takeIf { item -> item.isNotBlank() }
  }

  private fun isLocalHost(value: String): Boolean {
    return value == "localhost" || value == "127.0.0.1" || value == "::1"
  }

  private fun privilegedWebOrigin(callingAppInfo: CallingAppInfo?): String? {
    if (callingAppInfo?.isOriginPopulated() != true) {
      return null
    }

    val privilegedOrigin = try {
      callingAppInfo.getOrigin(privilegedAllowlist)?.takeIf { value -> value.isNotBlank() }
    } catch (_: Exception) {
      null
    }
    return privilegedOrigin?.let { value -> normalizeWebOrigin(value) }
  }

  private fun normalizeWebOrigin(value: String): String {
    if (value.startsWith("android:apk-key-hash:")) {
      return value
    }
    return try {
      val parsed = Uri.parse(value.trim())
      val scheme = parsed.scheme
      val host = parsed.host
      val normalizedHost = host?.lowercase()
      val localHttp = scheme == "http" && (normalizedHost == "localhost" || normalizedHost == "127.0.0.1" || normalizedHost == "::1")
      if ((scheme == "https" || localHttp) && !normalizedHost.isNullOrBlank()) {
        scheme + "://" + normalizedHost + (if (parsed.port >= 0) ":" + parsed.port else "")
      } else {
        value.trimEnd('/')
      }
    } catch (_: Exception) {
      value.trimEnd('/')
    }
  }

  private fun callingAppOrigin(callingAppInfo: CallingAppInfo?): String? {
    val cert = callingAppInfo?.signingInfo?.apkContentsSigners?.firstOrNull()?.toByteArray() ?: return null
    return "android:apk-key-hash:" + base64Url(sha256(cert))
  }

  private fun randomBytes(size: Int): ByteArray {
    val bytes = ByteArray(size)
    random.nextBytes(bytes)
    return bytes
  }

  private fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

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
