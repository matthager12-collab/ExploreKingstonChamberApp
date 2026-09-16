import "server-only";
import { redirect } from "next/navigation";
import { can, getSessionUser, type SessionUser } from "@/lib/auth";
import { getRestaurant } from "@/lib/stores/business-store";
import { getLodging } from "@/lib/stores/listing-stores";
import { getDirectoryListingsAdmin } from "@/lib/stores/directory-store";
import type { Restaurant } from "@/lib/types";

/* One route ([id]) serves THREE record kinds, and since the editor split into
 * tabs there are now four entry points into it. Centralising the gate here
 * means the session check and the can(…, "edit-record") check cannot be
 * forgotten on a new tab — adding a route file that skips this helper is the
 * only way to get it wrong, and that is visible in review.
 *
 * The gate is unchanged from the pre-split page: no session → /portal, no
 * permission → /portal, no such record → /portal/business. */

export type BusinessRecord =
  | { kind: "restaurant"; id: string; name: string; restaurant: Restaurant }
  | { kind: "lodging"; id: string; name: string; lodging: Awaited<ReturnType<typeof getLodging>>[number] }
  | {
      kind: "directory";
      id: string;
      name: string;
      isDraft: boolean;
      record: Omit<Awaited<ReturnType<typeof getDirectoryListingsAdmin>>[number], "status">;
    };

export async function requireBusinessRecord(
  id: string,
): Promise<{ user: SessionUser; record: BusinessRecord }> {
  const user = await getSessionUser();
  if (!user) redirect("/portal");
  if (!can(user, "edit-record", id)) redirect("/portal");

  const restaurant = await getRestaurant(id);
  if (restaurant) {
    return {
      user,
      record: { kind: "restaurant", id, name: restaurant.name, restaurant },
    };
  }

  const lodging = (await getLodging()).find((l) => l.id === id);
  if (lodging) {
    return { user, record: { kind: "lodging", id, name: lodging.name, lodging } };
  }

  // Directory branch — the ADMIN read on purpose: imported listings are
  // drafts, and the owner must be able to load their own draft. Access is
  // already proven by the can() gate above, so surfacing the draft leaks
  // nothing.
  const dir = (await getDirectoryListingsAdmin()).find((d) => d.id === id);
  if (!dir) redirect("/portal/business");

  const { status, ...record } = dir;
  return {
    user,
    record: {
      kind: "directory",
      id,
      name: record.name,
      isDraft: status !== "live",
      record,
    },
  };
}

/** The "what happens when I save" line. Differs by role and, for directory
 *  drafts, by publish state — copy carried over verbatim. */
export function introFor(record: BusinessRecord, user: SessionUser): string {
  const isAdmin = user.role === "admin";
  const reviewLine =
    "Edits below are submitted for a quick Chamber review — they go live once approved, usually within a couple of days.";

  if (record.kind === "restaurant") {
    return isAdmin
      ? "Everything below goes live the moment you save — the food pages, the open-now badge, the town calendar, and your syndication feed."
      : reviewLine;
  }
  if (record.kind === "lodging") {
    return isAdmin
      ? "Everything below goes live the moment you save — the stay page and the kiosk both follow."
      : reviewLine;
  }
  if (isAdmin) {
    return "Edits save immediately; the listing keeps its current publish state.";
  }
  return record.isDraft
    ? "This listing isn't public yet. Fill it in at your own pace — the Chamber reviews and publishes it, and your edits save instantly until then."
    : reviewLine;
}
