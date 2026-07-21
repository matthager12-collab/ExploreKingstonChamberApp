"use client";

// Anonymous visitor survey feeding the Chamber's LTAC/JLARC reporting.
// No PII, no cookies — a localStorage flag just prevents re-asking.

import { useEffect, useRef, useState } from "react";
import { EditableText } from "@/lib/copy-context";

/** Keep a number input inside its own min/max — an out-of-range value used to
 *  be submitted and then silently dropped by /api/survey (E14). */
function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const DISTANCE_OPTIONS = [
  { value: "local", label: "I live nearby (Kitsap)" },
  { value: "10-50mi", label: "Western WA (10–50 mi)" },
  { value: "50mi-plus", label: "50+ miles away in WA" },
  { value: "out-of-state", label: "Out of state" },
  { value: "international", label: "Outside the U.S." },
] as const;

const LODGING_OPTIONS = ["Vacation rental / Airbnb", "B&B or inn", "Camping / RV", "Marina guest dock", "With friends or family", "Day trip only"];

type Step = "distance" | "overnight" | "details" | "done";

export function VisitorSurvey() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>("distance");
  const [distanceBand, setDistanceBand] = useState<string>();
  const [overnight, setOvernight] = useState(false);
  const [lodgingNights, setLodgingNights] = useState(1);
  const [lodgingType, setLodgingType] = useState<string>();
  const [partySize, setPartySize] = useState(2);

  // E14: advancing a step unmounts the button that was just pressed, which
  // dropped focus to <body> and announced nothing. The step panel is a polite
  // live region and takes focus on every change after the first render.
  const stepRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (!localStorage.getItem("vk-survey-done")) setVisible(true);
  }, []);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepRef.current?.focus();
  }, [step]);

  if (!visible) return null;

  async function submit(extra: { overnight: boolean; withDetails?: boolean }) {
    const payload = {
      distanceBand,
      overnight: extra.overnight,
      ...(extra.withDetails ? { lodgingNights, lodgingType, partySize } : {}),
    };
    localStorage.setItem("vk-survey-done", "1");
    setStep("done");
    try {
      await fetch("/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // best-effort; never bother the visitor about it
    }
  }

  function dismiss() {
    localStorage.setItem("vk-survey-done", "1");
    setVisible(false);
  }

  return (
    <div className="rounded-2xl border border-seaglass bg-seaglass/20 p-5">
      {step !== "done" && (
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <EditableText
              as="p"
              className="font-semibold text-sound-deep"
              copyKey="survey.intro.title"/>
            <EditableText
              as="p"
              id="survey-distance-question"
              className="text-sm text-ink"
              copyKey="survey.intro.subtitle"/>
          </div>
          {/* E14: an unpadded glyph is a ~14px tap target — under WCAG 2.2
              SC 2.5.8's 24px floor and far under the 44px bar this epic sets
              for its own controls. The min-h/min-w give it a real 44px box
              without changing the glyph's size or the row's layout. */}
          <button
            type="button"
            onClick={dismiss}
            className="-m-2 inline-flex min-h-11 min-w-11 items-center justify-center text-sm text-ink hover:text-sound"
            aria-label="Dismiss survey"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}

      {/* Every step renders inside this panel: replacing its contents is what
          the live region announces, and it takes focus on each change. */}
      <div ref={stepRef} tabIndex={-1} aria-live="polite">
        {step === "distance" && (
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-labelledby="survey-distance-question"
          >
            {DISTANCE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  setDistanceBand(o.value);
                  if (o.value === "local") {
                    submit({ overnight: false });
                  } else {
                    setStep("overnight");
                  }
                }}
                className="rounded-full border border-tide bg-white px-4 py-2 text-sm font-medium text-tide-deep hover:bg-tide hover:text-white"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        {step === "overnight" && (
          <div>
            <EditableText
              as="p"
              id="survey-overnight-question"
              className="mb-2 text-sm font-medium text-ink"
              copyKey="survey.overnight.question"/>
            <div className="flex gap-2" role="group" aria-labelledby="survey-overnight-question">
              <button
                type="button"
                onClick={() => {
                  setOvernight(true);
                  setStep("details");
                }}
                className="rounded-full border border-tide bg-white px-5 py-2 text-sm font-medium text-tide-deep hover:bg-tide hover:text-white"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => submit({ overnight: false })}
                className="rounded-full border border-tide bg-white px-5 py-2 text-sm font-medium text-tide-deep hover:bg-tide hover:text-white"
              >
                No, day trip
              </button>
            </div>
          </div>
        )}

        {step === "details" && (
          <div className="space-y-3">
            <div>
              <label htmlFor="survey-nights" className="block text-sm font-medium text-ink">
                <EditableText copyKey="survey.details.nightsLabel"/>
              </label>
              <input
                id="survey-nights"
                type="number"
                min={1}
                max={60}
                aria-describedby="survey-nights-hint"
                value={lodgingNights}
                onChange={(e) => setLodgingNights(clampNumber(Number(e.target.value), 1, 60))}
                className="mt-1 block w-24 rounded-lg border border-sand bg-white px-3 py-2"
              />
              <p id="survey-nights-hint" className="mt-1 text-xs text-ink">
                1 to 60 nights.
              </p>
            </div>
            <div>
              <label htmlFor="survey-lodging" className="block text-sm font-medium text-ink">
                <EditableText copyKey="survey.details.lodgingLabel"/>
              </label>
              <select
                id="survey-lodging"
                value={lodgingType ?? ""}
                onChange={(e) => setLodgingType(e.target.value || undefined)}
                className="mt-1 block w-full max-w-xs rounded-lg border border-sand bg-white px-3 py-2"
              >
                <option value="">Prefer not to say</option>
                {LODGING_OPTIONS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="survey-party" className="block text-sm font-medium text-ink">
                <EditableText copyKey="survey.details.partyLabel"/>
              </label>
              <input
                id="survey-party"
                type="number"
                min={1}
                max={50}
                aria-describedby="survey-party-hint"
                value={partySize}
                onChange={(e) => setPartySize(clampNumber(Number(e.target.value), 1, 50))}
                className="mt-1 block w-24 rounded-lg border border-sand bg-white px-3 py-2"
              />
              <p id="survey-party-hint" className="mt-1 text-xs text-ink">
                1 to 50 people.
              </p>
            </div>
            <button
              type="button"
              onClick={() => submit({ overnight, withDetails: true })}
              className="rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white hover:bg-coral-deep"
            >
              Done
            </button>
          </div>
        )}

        {step === "done" && (
          // Contrast: this card's own fill is bg-seaglass/20 and it sits on the
          // bare page (Section adds no background), so the text composites over
          // #edf6fb — where text-fern is 4.39–4.45:1, under AA. text-ink is
          // 13.96:1, the same repair E14 made on the ferry board for fern on a
          // pale blue tint. Static axe never caught this because the node only
          // exists after the survey is submitted.
          <EditableText
            as="p"
            className="font-medium text-ink"
            copyKey="survey.thankyou"/>
        )}
      </div>
    </div>
  );
}
