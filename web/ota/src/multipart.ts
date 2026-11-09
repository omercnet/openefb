// Expo Updates protocol v1 multipart/mixed body with exactly one part, CRLF line endings.
export const BOUNDARY = "kanaf-ota-3f9c1d7a5b2e4860a1c7d9e3";

export function buildPart(kind: "manifest" | "directive", body: string, signature: string): string {
  if (body.includes(BOUNDARY)) throw new Error("body contains the multipart boundary");
  return [
    `--${BOUNDARY}`,
    `content-disposition: form-data; name="${kind}"`,
    "content-type: application/json",
    `expo-signature: ${signature}`,
    "",
    body,
    `--${BOUNDARY}--`,
    "",
  ].join("\r\n");
}
