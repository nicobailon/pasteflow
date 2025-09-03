import crypto from "node:crypto";
import { AuthManager } from "./auth-manager";

type SecretBlobV1 = {
  __type: "secret";
  v: 1;
  alg: "aes-256-gcm";
  iv: string; // base64
  salt: string; // base64
  ct: string; // base64 ciphertext
  tag: string; // base64 auth tag
  meta?: { createdAt?: number };
};

export function isSecretBlob(val: unknown): val is SecretBlobV1 {
  const v = val as any;
  return v && typeof v === "object" && v.__type === "secret" && v.v === 1 && typeof v.iv === "string";
}

function getPassword(): string {
  // Derive from the persistent auth token so secrets remain stable across restarts
  const auth = new AuthManager();
  return auth.getToken();
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, 32); // 32 bytes for AES-256
}

export function encryptSecret(plaintext: string): SecretBlobV1 {
  const iv = crypto.randomBytes(12); // GCM recommended IV size
  const salt = crypto.randomBytes(16);
  const key = deriveKey(getPassword(), salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    __type: "secret",
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
    meta: { createdAt: Date.now() },
  };
}

export function decryptSecret(blob: SecretBlobV1): string {
  const iv = Buffer.from(blob.iv, "base64");
  const salt = Buffer.from(blob.salt, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  const ct = Buffer.from(blob.ct, "base64");
  const key = deriveKey(getPassword(), salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

