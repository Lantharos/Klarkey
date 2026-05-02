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
  private const val privilegedAllowlist = """{"apps":[{"type":"android","info":{"package_name":"com.android.chrome","signatures":[{"build":"release","cert_fingerprint_sha256":"F0:FD:6C:5B:41:0F:25:CB:25:C3:B5:33:46:C8:97:2F:AE:30:F8:EE:74:11:DF:91:04:80:AD:6B:2D:60:DB:83"}]}}]}"""
  private val random = SecureRandom()

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
    val clientData = clientDataJson("webauthn.create", challenge, origin)
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
    val clientData = clientDataJson("webauthn.get", challenge, origin)
    val clientDataHash = credentialClientDataHash(option.clientDataHash, clientData)
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

  private fun clientDataJson(type: String, challenge: String, origin: String): ByteArray {
    return JSONObject()
      .put("type", type)
      .put("challenge", challenge)
      .put("origin", origin)
      .put("crossOrigin", false)
      .toString()
      .toByteArray(Charsets.UTF_8)
  }

  private fun originFor(origin: String?, rpId: String, callingAppInfo: CallingAppInfo?): String? {
    if (callingAppInfo?.isOriginPopulated() == true) {
      return try {
        callingAppInfo.getOrigin(privilegedAllowlist)?.takeIf { value -> value.isNotBlank() }
      } catch (_: Exception) {
        null
      }
    }

    return origin?.takeIf { value -> value.isNotBlank() } ?: "https://" + rpId
  }

  private fun credentialClientDataHash(clientDataHash: ByteArray?, clientData: ByteArray): ByteArray {
    return clientDataHash?.takeIf { value -> value.isNotEmpty() } ?: sha256(clientData)
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
