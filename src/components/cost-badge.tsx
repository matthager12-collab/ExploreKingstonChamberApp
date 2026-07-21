// E27 — the single free-vs-paid badge (M-04-06), used on /parking, the amenity
// surfaces, and itinerary stops so the signal reads identically everywhere.
//
// Text-not-colour-alone by construction: the label IS the content, so there is
// no variant of this component that communicates cost through colour only. The
// tone is decorative and drawn from the existing brand badge tones — `green`
// resolves to solid fern on white text, which E14 measured at 4.81:1 (the
// earlier tinted fern was 4.29:1 and failed AA at this size).

import { Badge } from "@/components/ui";
import { COST_LABELS, type CostValue } from "@/lib/cost";

const TONES: Record<CostValue, "green" | "navy" | "teal" | "sand"> = {
  free: "green",
  paid: "navy",
  "free-and-paid": "teal",
  donation: "sand",
};

export function CostBadge({ cost }: { cost: CostValue }) {
  return <Badge tone={TONES[cost]}>{COST_LABELS[cost]}</Badge>;
}
