import "server-only";
import crypto from "crypto";

/**
 * Token Encryption & Decryption Utility (AES-256-GCM).
 *
 * CRITICAL ARCHITECTURE & SECURITY SPECIFICATIONS:
 * 1. Build Boundary: Guarded by 'server-only' package import to trigger build-time
 *    failure if imported anywhere within client component bundles.
 * 2. Algorithm: AES-256-GCM (Authenticated Encryption with Associated Data - AEAD).
 *    GCM provides both confidentiality and cryptographic integrity verification.
 * 3. Key: 256 bits (32 bytes), stored securely in process.env.TOKEN_ENCRYPTION_KEY.
 *    The key is validated against an exact 64-character hexadecimal regex prior to decoding.
 *    The key is NEVER stored in PostgreSQL or sent to the browser.
 * 4. IV (Initialization Vector): 96 bits (12 bytes), cryptographically random per encryption.
 *    An IV is NEVER reused across operations.
 * 5. Authentication Tag: 128 bits (16 bytes). Verifies ciphertext authenticity during decryption.
 *    Any tampering in the database immediately causes decryption to fail.
 * 6. Serialization Format: `<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`
 * 7. Runtime Guard: Explicit runtime window check provides defense-in-depth.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH_BYTES = 16; // 128 bits
const HEX_KEY_REGEX = /^[0-9a-fA-F]{64}$/;

function getEncryptionKey(): Buffer {
  if (typeof window !== "undefined") {
    throw new Error(
      "FATAL SECURITY VIOLATION: Token encryption utility cannot run on the client."
    );
  }

  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY environment variable is missing. " +
        "Generate one using: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  if (!HEX_KEY_REGEX.test(keyHex)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be an exact 64-character hexadecimal string (32 bytes)."
    );
  }

  const keyBuffer = Buffer.from(keyHex, "hex");
  if (keyBuffer.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY decoded to ${keyBuffer.length} bytes, expected exactly 32 bytes.`
    );
  }

  return keyBuffer;
}

/**
 * Encrypts a plaintext string (e.g. Meta Instagram User Access Token).
 *
 * @param plaintext The secret token to encrypt
 * @returns Serialized format: `<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`
 */
export function encryptToken(plaintext: string): string {
  if (!plaintext) {
    throw new Error("Cannot encrypt empty token.");
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a serialized ciphertext string.
 *
 * @param encryptedPayload Format: `<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`
 * @returns Decrypted plaintext string
 */
export function decryptToken(encryptedPayload: string): string {
  if (!encryptedPayload) {
    throw new Error("Cannot decrypt empty payload.");
  }

  const parts = encryptedPayload.split(":");
  if (parts.length !== 3) {
    throw new Error(
      "Invalid encrypted token format. Expected '<iv>:<authTag>:<ciphertext>'."
    );
  }

  const [ivHex, authTagHex, cipherHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(cipherHex, "hex");

  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error("Invalid IV length in encrypted token payload.");
  }

  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error("Invalid Auth Tag length in encrypted token payload.");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
