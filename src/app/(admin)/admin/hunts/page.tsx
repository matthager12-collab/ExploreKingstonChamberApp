// Chamber-facing scavenger hunt admin: hunt list, recent player submissions,
// and the hunt builder (editor.tsx). Page access is admin-gated by the /admin
// layout; the /api/hunts, /api/hunts/reference, and submission-photo reads are
// admin-gated in their own handlers (route handlers bypass layouts). The only
// open hunt endpoint is /api/hunts/submit (player photo upload, no account).

import type { Metadata } from "next";
import Link from "next/link";
import { getAllHunts, listSubmissions, photoUrl } from "@/lib/hunt-store";
import { Badge, Card, PageHeader, Section } from "@/components/ui";
import { HuntEditor } from "./editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hunt Admin",
  description: "Build scavenger hunts, attach reference photos, and review player submissions.",
};

function formatWhen(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function AdminHuntsPage({
  searchParams,
}: {
  searchParams: Promise<{ hunt?: string | string[] }>;
}) {
  const { hunt } = await searchParams;
  const selectedId = Array.isArray(hunt) ? hunt[0] : hunt;
  const hunts = await getAllHunts();
  const allSubmissions = await listSubmissions();
  const recent = allSubmissions.slice(0, 12);

  const stopTitle = (huntId: string, stopId: string): string => {
    const hunt = hunts.find((h) => h.id === huntId);
    const stop = hunt?.stops.find((s) => s.id === stopId);
    return stop ? `${hunt?.title} · ${stop.title}` : `${huntId} · ${stopId}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Chamber admin"
        title="Scavenger Hunt Builder"
        intro="Create and edit hunts, attach a reference photo to each stop so players know what they're looking for, and review the photos players post from the field."
      />

      <Section
        title="Hunts"
        subtitle="Seed hunts ship with the app; editing one saves a custom copy that overrides it."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {hunts.map((hunt) => {
            const refCount = hunt.stops.filter((s) => s.referencePhoto).length;
            const subCount = allSubmissions.filter((s) => s.huntId === hunt.id).length;
            return (
              <Card key={hunt.id} className="flex flex-col">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={hunt.source === "custom" ? "coral" : "navy"}>
                    {hunt.source === "custom" ? "Custom" : "Seed"}
                  </Badge>
                  <Badge tone="teal">{hunt.stops.length} stops</Badge>
                  <Badge tone={refCount === hunt.stops.length ? "green" : "sand"}>
                    {refCount}/{hunt.stops.length} reference photos
                  </Badge>
                  {subCount > 0 && <Badge tone="sand">{subCount} submissions</Badge>}
                </div>
                <h3 className="mt-3 text-lg font-semibold text-sound-deep">{hunt.title}</h3>
                <p className="mt-1 flex-1 text-sm text-ink-soft">
                  /hunt/{hunt.slug} · ~{hunt.durationMinutes} min · {hunt.difficulty}
                </p>
                <Link
                  href={`/admin/hunts?hunt=${encodeURIComponent(hunt.id)}#editor`}
                  className="mt-3 inline-flex w-fit items-center rounded-full bg-sound px-4 py-2 text-sm font-semibold text-white hover:bg-sound-deep"
                >
                  Open in builder ↓
                </Link>
              </Card>
            );
          })}
        </div>
      </Section>

      <Section
        title="Recent submissions"
        subtitle="Latest photos posted by players across all hunts. Open a hunt in the builder to review submissions stop by stop, next to the reference photo."
      >
        {recent.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-soft">
              No player photos yet. They&apos;ll appear here the moment someone posts one from a
              hunt stop.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {recent.map((sub) => (
              <div
                key={sub.photoPath}
                className="rounded-2xl border border-sand bg-white p-3 shadow-[0_1px_3px_rgba(22,64,94,0.08)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- served by our local photo API */}
                <img
                  src={photoUrl(sub.photoPath)}
                  alt={`Player photo at ${stopTitle(sub.huntId, sub.stopId)}`}
                  className="h-32 w-full rounded-lg border border-sand object-cover"
                />
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {sub.verified ? (
                    <Badge tone="green">Verified on-site ✓</Badge>
                  ) : (
                    <Badge tone="sand">Unverified</Badge>
                  )}
                  {typeof sub.distanceMeters === "number" && (
                    <Badge tone="teal">{sub.distanceMeters} m</Badge>
                  )}
                </div>
                <p className="mt-1.5 text-xs font-medium text-ink">{stopTitle(sub.huntId, sub.stopId)}</p>
                <p className="text-xs text-ink-soft">{formatWhen(sub.ts)}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        id="editor"
        title="Builder"
        subtitle="Pick a hunt to edit — or start a new one. Attach a reference photo to each stop so players see what the spot looks like."
      >
        <HuntEditor initialHunts={hunts} initialSelectedId={selectedId} />
      </Section>
    </>
  );
}
