"use client";

// Anonymous visitor survey feeding the Chamber's LTAC/JLARC reporting.
// No PII, no cookies — a localStorage flag just prevents re-asking.

import { useEffect, useState } from "react";
import { EditableText } from "@/lib/copy-context";

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

  useEffect(() => {
    if (!localStorage.getItem("vk-survey-done")) setVisible(true);
  }, []);

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
              className="text-sm text-ink-soft"
              copyKey="survey.intro.subtitle"/>
          </div>
          <button onClick={dismiss} className="text-sm text-ink-soft hover:text-ink" aria-label="Dismiss survey">
            ✕
          </button>
        </div>
      )}

      {step === "distance" && (
        <div className="flex flex-wrap gap-2">
          {DISTANCE_OPTIONS.map((o) => (
            <button
              key={o.value}
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
            className="mb-2 text-sm font-medium text-ink"
            copyKey="survey.overnight.question"/>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setOvernight(true);
                setStep("details");
              }}
              className="rounded-full border border-tide bg-white px-5 py-2 text-sm font-medium text-tide-deep hover:bg-tide hover:text-white"
            >
              Yes
            </button>
            <button
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
          <label className="block text-sm font-medium text-ink">
            <EditableText copyKey="survey.details.nightsLabel"/>
            <input
              type="number"
              min={1}
              max={60}
              value={lodgingNights}
              onChange={(e) => setLodgingNights(Number(e.target.value))}
              className="mt-1 block w-24 rounded-lg border border-sand bg-white px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium text-ink">
            <EditableText copyKey="survey.details.lodgingLabel"/>
            <select
              value={lodgingType ?? ""}
              onChange={(e) => setLodgingType(e.target.value || undefined)}
              className="mt-1 block w-full max-w-xs rounded-lg border border-sand bg-white px-3 py-2"
            >
              <option value="">Prefer not to say</option>
              {LODGING_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-ink">
            <EditableText copyKey="survey.details.partyLabel"/>
            <input
              type="number"
              min={1}
              max={50}
              value={partySize}
              onChange={(e) => setPartySize(Number(e.target.value))}
              className="mt-1 block w-24 rounded-lg border border-sand bg-white px-3 py-2"
            />
          </label>
          <button
            onClick={() => submit({ overnight, withDetails: true })}
            className="rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white hover:bg-coral-deep"
          >
            Done
          </button>
        </div>
      )}

      {step === "done" && (
        <EditableText
          as="p"
          className="font-medium text-fern"
          copyKey="survey.thankyou"/>
      )}
    </div>
  );
}
