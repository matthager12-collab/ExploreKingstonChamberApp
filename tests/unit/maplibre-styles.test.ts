import { expect, it, vi } from "vitest";

const css = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return { ready, release, started: false };
});
const addProtocol = vi.hoisted(() => vi.fn());
vi.mock("maplibre-gl", () => ({ addProtocol }));
vi.mock("pmtiles", () => ({ Protocol: class { tile = vi.fn(); } }));
vi.mock("maplibre-gl/dist/maplibre-gl.css", async () => {
  css.started = true;
  await css.ready;
  return {};
});

it("keeps styles off import and waits for them before returning the map library", async () => {
  const { loadMapLibre } = await import("@/lib/map/maplibre");
  expect(css.started).toBe(false);
  let ready = false;
  const loading = loadMapLibre().then((library) => { ready = true; return library; });
  await vi.waitFor(() => expect(css.started).toBe(true));
  expect(ready).toBe(false);
  expect(addProtocol).not.toHaveBeenCalled();
  css.release();
  expect((await loading).addProtocol).toBe(addProtocol);
  expect(addProtocol).toHaveBeenCalledOnce();
});
