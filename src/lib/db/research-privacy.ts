import "server-only";
import { eq, or, sql } from "drizzle-orm";
import { getDb } from "./client";
import { researchRequest } from "./schema";
import { isUnderLegalHold } from "./privacy-delete";
import { publicRequest } from "./research";
export async function findResearchByEmail(email: string) {
  const value = email.toLowerCase();
  return (
    await getDb()
      .select()
      .from(researchRequest)
      .where(
        or(
          sql`lower(${researchRequest.createdBy}) = ${value}`,
          sql`position(${value} in lower(${researchRequest.payload}::text)) > 0`,
        ),
      )
  ).map(publicRequest);
}
export async function deleteResearchByEmail(email: string) {
  const rows = await findResearchByEmail(email);
  let affected = 0;
  for (const row of rows) {
    if (await isUnderLegalHold("research_request", row.id)) continue;
    await getDb().delete(researchRequest).where(eq(researchRequest.id, row.id));
    affected++;
  }
  return affected;
}
