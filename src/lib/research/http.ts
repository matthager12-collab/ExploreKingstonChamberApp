import { ZodError } from "zod";
import { ResearchConflict } from "@/lib/db/research";
export async function boundedJson(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 250_000)
    throw new ResearchConflict("Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 250_000) {
        await reader.cancel();
        throw new ResearchConflict("Request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function researchError(error: unknown) {
  if (error instanceof ResearchConflict)
    return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof ZodError)
    return Response.json(
      {
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  if (error instanceof SyntaxError)
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  console.error(
    "Research request failed",
    error instanceof Error ? error.name : "unknown",
  );
  return Response.json(
    { error: "The request could not be saved. Please try again." },
    { status: 500 },
  );
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}
