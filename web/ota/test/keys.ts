import { generateKeyPairSync } from "node:crypto";

/** Throwaway RSA key pair, PKCS#8 private PEM and SPKI public PEM. Nothing is written to disk. */
export function newKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
}
