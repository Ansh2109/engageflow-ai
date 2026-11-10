type DatabaseRpcError = {
  code?: unknown;
  message?: unknown;
};

function redactSensitiveValues(message: string, values: string[]): string {
  return values
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (sanitized, value) => {
        const encodedValue = encodeURIComponent(value);
        const plusEncodedValue = encodedValue.replaceAll("%20", "+");
        return [value, encodedValue, plusEncodedValue].reduce(
          (redacted, variant) =>
            variant ? redacted.replaceAll(variant, "[redacted]") : redacted,
          sanitized
        );
      },
      message
    );
}

export function sanitizeDatabaseErrorMessage(
  message: unknown,
  sensitiveValues: string[] = []
): string {
  if (typeof message !== "string") {
    return "Database returned an unrecognized error.";
  }

  return redactSensitiveValues(message, sensitiveValues)
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, "[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
    .replace(
      /([?&](?:access_token|appsecret_proof|client_secret|client_id|code|config_id|instagram_business_id|nonce|owner_id|state|system_user_id|token|user_id)=)[^&\s]*/gi,
      "$1[redacted]"
    )
    .replace(/\b(?:EA|IG)[A-Za-z0-9._-]{16,}\b/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .replace(/\b\d+\b/g, "[redacted]")
    .replace(/'[^']*'/g, "'[redacted]'")
    .replace(/"[^"]*"/g, '"[redacted]"')
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function logInstagramPersistenceError(
  error: DatabaseRpcError,
  sensitiveValues: string[]
): void {
  const code =
    typeof error.code === "string" && /^[A-Z0-9]{3,10}$/.test(error.code)
      ? error.code
      : "unknown";

  console.error("[Instagram] Connection persistence failed.", {
    stage: "database_persistence",
    databaseCode: code,
    databaseMessage: sanitizeDatabaseErrorMessage(
      error.message,
      sensitiveValues
    ),
  });
}
