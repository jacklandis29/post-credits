type JsonObject = Record<string, unknown>;

export async function readBoundedJsonObject(
  request: Request,
  maxBytes: number,
): Promise<JsonObject | null> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maxBytes) {
      return null;
    }
  }

  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Request body exceeds the configured limit");
        return null;
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonObject
      : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
