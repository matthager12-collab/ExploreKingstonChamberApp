// @vitest-environment jsdom

// The nav's "Add to home screen" entry — the way back in.
//
// This exists because dismissing the install card is PERMANENT. The load-bearing
// test is "survives a dismissal": if this entry ever stopped working after the
// card was dismissed, the never-nag doctrine would quietly become never-install,
// which is the trade the entry was added to prevent.
//
// The rest pin the honest-offer rule — the entry appears only where an install
// can actually happen, so it never becomes a control that does nothing on tap.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/outbox", () => ({ flushOutbox: () => Promise.resolve() }));

type Props = { className?: string; onInstalled?: () => void };
type Loaded = {
  InstallAppButton: (props: Props) => React.ReactNode;
  PwaClient: (props: { renderedAt: string }) => React.ReactNode;
};

/** Fresh module graph, so the install store and the page-load flags in
 *  components/pwa.tsx start clean — and so both components below share ONE
 *  store instance, exactly as they do in the real app. */
async function load(): Promise<Loaded> {
  vi.resetModules();
  const button = (await import("@/components/install-app-button")) as {
    InstallAppButton: (props: Props) => React.ReactNode;
  };
  const pwa = (await import("@/components/pwa")) as {
    default: (props: { renderedAt: string }) => React.ReactNode;
  };
  return { InstallAppButton: button.InstallAppButton, PwaClient: pwa.default };
}

function fireInstallPrompt(): void {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, { prompt: () => Promise.resolve() });
  window.dispatchEvent(event);
}

/** iOS Safari is identified by navigator.standalone EXISTING, whatever its
 *  value — a capability check, not a user-agent sniff. */
function pretendIosSafari(installed = false): void {
  Object.defineProperty(navigator, "standalone", {
    value: installed,
    configurable: true,
  });
}

function pretendDisplayMode(standalone: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      matches: standalone && query.includes("standalone"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
    configurable: true,
    writable: true,
  });
}

const entry = () => screen.queryByRole("button", { name: /add to home screen/i });
const card = () => screen.queryByText("Add Explore Kingston to your home screen");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("vk-visits", "2");
  pretendDisplayMode(false);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  // @ts-expect-error — removing the iOS marker between cases.
  delete navigator.standalone;
  vi.restoreAllMocks();
});

describe("InstallAppButton", () => {
  it("renders nothing on a browser that cannot install", async () => {
    const { InstallAppButton } = await load();
    render(<InstallAppButton />);
    await settle();

    // No beforeinstallprompt, no iOS Share route: offering an entry here would
    // be a button that silently does nothing.
    expect(entry()).not.toBeInTheDocument();
  });

  it("appears once Chromium offers a prompt", async () => {
    const { InstallAppButton } = await load();
    render(<InstallAppButton />);

    fireInstallPrompt();

    await waitFor(() => expect(entry()).toBeInTheDocument());
  });

  it("still works after the install card was permanently dismissed", async () => {
    // The reason this component exists. Both components share one store, so the
    // Chromium event is captured even though the card refuses to reappear.
    const user = userEvent.setup();
    const { InstallAppButton, PwaClient } = await load();
    const onInstalled = vi.fn();
    render(
      <>
        <PwaClient renderedAt={new Date().toISOString()} />
        <InstallAppButton onInstalled={onInstalled} />
      </>,
    );

    fireInstallPrompt();
    await waitFor(() => expect(card()).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(card()).not.toBeInTheDocument();

    // The card is gone for good; the menu entry is not.
    expect(entry()).toBeInTheDocument();
    await user.click(entry()!);
    expect(onInstalled).toHaveBeenCalledOnce();
  });

  it("disappears after it has been used (the prompt is single-use)", async () => {
    const user = userEvent.setup();
    const { InstallAppButton } = await load();
    render(<InstallAppButton />);

    fireInstallPrompt();
    await waitFor(() => expect(entry()).toBeInTheDocument());
    await user.click(entry()!);

    // Chromium throws on a second prompt() against a spent event, so the store
    // clears it and every surface reading the store must follow.
    await waitFor(() => expect(entry()).not.toBeInTheDocument());
  });

  it("disappears the moment the app reports itself installed", async () => {
    const { InstallAppButton } = await load();
    render(<InstallAppButton />);

    fireInstallPrompt();
    await waitFor(() => expect(entry()).toBeInTheDocument());

    window.dispatchEvent(new Event("appinstalled"));

    await waitFor(() => expect(entry()).not.toBeInTheDocument());
  });

  it("offers the Share-sheet instructions on iOS instead of a dead button", async () => {
    const user = userEvent.setup();
    pretendIosSafari();
    const { InstallAppButton } = await load();
    render(<InstallAppButton />);

    // No beforeinstallprompt is ever fired on iOS — the entry stands on the
    // capability check alone.
    await waitFor(() => expect(entry()).toBeInTheDocument());
    const toggle = entry()!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Tap the Share button/i)).toBeInTheDocument();
  });

  it("renders nothing when the app is already installed", async () => {
    pretendDisplayMode(true);
    const { InstallAppButton } = await load();
    render(<InstallAppButton />);

    fireInstallPrompt();
    await settle();

    expect(entry()).not.toBeInTheDocument();
  });

  it("renders nothing on an iOS device where it is already on the home screen", async () => {
    pretendIosSafari(true);
    const { InstallAppButton } = await load();
    render(<InstallAppButton />);
    await settle();

    expect(entry()).not.toBeInTheDocument();
  });
});
