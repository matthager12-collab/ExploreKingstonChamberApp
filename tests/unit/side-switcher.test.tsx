// @vitest-environment jsdom

// The side switcher's location contract (MHMDA consent floor).
//
// The regression these tests pin: side-switcher.tsx used to auto-fire
// navigator.geolocation.getCurrentPosition from a mount effect on a visitor's
// very first arrival — an opt-out ask that contradicted /privacy's promise
// that location features ask first. Geolocation may now run ONLY from the
// "use my location" tap (the tap is the affirmative act), and the only thing
// that may persist is the binary kingston/edmonds vk-side cookie — never a
// coordinate. tests/unit/geolocation-consent-guard.test.ts carries the
// matching reviewed-exemption note; this file is its positive enforcement.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { SideSwitcher } from "@/components/side-switcher";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// Near the Kingston terminal — west of the -122.44 divide, inside the
// classifier's crossing box, so sideFromLngLat resolves to "kingston".
const KINGSTON_COORDS = { latitude: 47.79, longitude: -122.5 };

function mockGeolocation() {
  const getCurrentPosition = vi.fn((success: PositionCallback) =>
    success({ coords: KINGSTON_COORDS } as GeolocationPosition),
  );
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

function clearCookies() {
  for (const pair of document.cookie.split("; ")) {
    const name = pair.split("=")[0];
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

beforeEach(clearCookies);

afterEach(() => {
  cleanup();
  clearCookies();
  refresh.mockClear();
  vi.restoreAllMocks();
});

describe("SideSwitcher — location is user-initiated only", () => {
  it("never touches geolocation or cookies on mount (the removed auto-ask must stay removed)", () => {
    const getCurrentPosition = mockGeolocation();
    render(<SideSwitcher side="kingston" />);

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(document.cookie).toBe("");
  });

  it("reads position once per 'Use my location' tap and persists only the binary side", async () => {
    const getCurrentPosition = mockGeolocation();
    const user = userEvent.setup();
    render(<SideSwitcher side="edmonds" />);

    await user.click(screen.getByRole("button", { name: /use my location/i }));

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(document.cookie).toContain("vk-side=kingston");
    // The one-word side is the ONLY thing that may persist — no coordinate.
    expect(document.cookie).not.toMatch(/47\.79|122\.5/);
    expect(refresh).toHaveBeenCalled();
  });

  it("manual side pick writes the cookie without any geolocation call", async () => {
    const getCurrentPosition = mockGeolocation();
    const user = userEvent.setup();
    render(<SideSwitcher side="kingston" />);

    await user.click(screen.getByRole("button", { name: /edmonds side/i }));

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(document.cookie).toContain("vk-side=edmonds");
  });
});
