// Minimal documents that satisfy the strict E07 domain schemas. Since the
// STORE_SCHEMAS swap (docs/SCHEMAS.md §"Wiring the importer") the write choke
// point validates restaurants/lodging/webcams/itineraries strictly, so
// mechanics-focused suites build their throwaway records from these instead
// of hand-rolled { id, name } stubs. Tombstone writes ({ id, _deleted: true })
// don't need these — the choke point validates tombstones as { id } only.

type Doc = { id: string; name: string } & Record<string, unknown>;

export function validRestaurant(overrides: Partial<Doc> = {}): Doc {
  return {
    id: "cafe",
    name: "Test Cafe",
    cuisine: "coffee",
    address: "1 Test St, Kingston WA",
    priceLevel: 1,
    lat: 47.79,
    lng: -122.49,
    walkMinutesFromFerry: 5,
    ...overrides,
  };
}

export function validLodging(overrides: Partial<Doc> = {}): Doc {
  return { id: "inn", name: "Test Inn", type: "hotel", ...overrides };
}

export function validWebcam(overrides: Partial<Doc> = {}): Doc {
  return {
    id: "cam",
    name: "Test Cam",
    imageUrl: "https://example.test/cam.jpg",
    sourceUrl: "https://example.test/cam",
    refreshSeconds: 60,
    ...overrides,
  };
}
