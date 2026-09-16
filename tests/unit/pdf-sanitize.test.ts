// PDF document-metadata stripping — the PDF counterpart to
// image-sanitize.test.ts. Same shape of proof: build a tagged document
// in-test, strip it, then show the fields are gone BOTH by re-parsing the
// output and by scanning the raw bytes (stripPdfMetadata saves without object
// streams precisely so a byte-scan is honest — nothing hides compressed).

import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { stripPdfMetadata, UnstrippablePdfError } from "@/lib/pdf-sanitize";

// A document-level XMP packet the way a design tool writes one, carrying the
// same author the Info dictionary does. pdf-lib never writes XMP itself, so
// the fixture attaches the stream by hand (catalog /Metadata).
const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:creator><rdf:Seq><rdf:li>Casey Q. Fixture</rdf:li></rdf:Seq></dc:creator>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

/** Every Info entry the strip must remove, as it appears in the raw bytes. */
const INFO_KEYS = [
  "/Title",
  "/Author",
  "/Subject",
  "/Keywords",
  "/Producer",
  "/Creator",
  "/CreationDate",
  "/ModDate",
];

async function taggedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.setTitle("Fixture Flyer");
  doc.setAuthor("Casey Q. Fixture");
  doc.setSubject("a fixture subject line");
  doc.setKeywords(["kingston", "fixture"]);
  doc.setProducer("Fixture Producer 1.0");
  doc.setCreator("Fixture Creator 2.0");
  doc.setCreationDate(new Date("2020-01-02T03:04:05Z"));
  doc.setModificationDate(new Date("2021-06-07T08:09:10Z"));
  const xmpStream = doc.context.stream(XMP, { Type: "Metadata", Subtype: "XML" });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(xmpStream));
  // No object streams in the fixture either, so the sanity checks below can
  // see the Info keys as plaintext and prove the fixture is really tagged.
  return doc.save({ useObjectStreams: false });
}

/** The output bytes as latin1 text — PDF dict keys and XML are plaintext. */
function text(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

describe("stripPdfMetadata — document metadata never survives", () => {
  it("removes every Info field and the XMP stream, keeping the page", async () => {
    const src = await taggedPdf();
    // Sanity: the fixture really is tagged, or this test proves nothing.
    const srcText = text(src);
    for (const key of INFO_KEYS) expect(srcText, `fixture lacks ${key}`).toContain(key);
    expect(srcText).toContain("adobe:ns:meta");
    expect(srcText).toContain("Casey Q. Fixture");

    const out = await stripPdfMetadata(src);

    // Byte-level: no Info keys, no XMP markers, no author string. This is the
    // check that catches a pointer-only delete — pdf-lib does not garbage-
    // collect, so an object merely unlinked would still show up here.
    const outText = text(out);
    for (const key of INFO_KEYS) expect(outText, `${key} survived stripping`).not.toContain(key);
    expect(outText).not.toContain("adobe:ns:meta");
    expect(outText).not.toContain("Casey Q. Fixture");
    expect(outText).not.toContain("Fixture Flyer");
    expect(outText).not.toContain("/Metadata");

    // Parser-level: a fresh load sees no metadata and an intact page.
    const reloaded = await PDFDocument.load(out, { updateMetadata: false });
    expect(reloaded.getTitle()).toBeUndefined();
    expect(reloaded.getAuthor()).toBeUndefined();
    expect(reloaded.getSubject()).toBeUndefined();
    expect(reloaded.getKeywords()).toBeUndefined();
    expect(reloaded.getProducer()).toBeUndefined();
    expect(reloaded.getCreator()).toBeUndefined();
    expect(reloaded.getCreationDate()).toBeUndefined();
    expect(reloaded.getModificationDate()).toBeUndefined();
    expect(reloaded.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
    expect(reloaded.getPageCount()).toBe(1);
    const { width, height } = reloaded.getPage(0).getSize();
    expect(width).toBe(200);
    expect(height).toBe(200);
  });

  it("never mutates the caller's buffer", async () => {
    const src = await taggedPdf();
    const before = new Uint8Array(src);
    await stripPdfMetadata(src);
    expect(src).toEqual(before);
  });

  it("stripping already-clean bytes still parses and stays clean", async () => {
    const once = await stripPdfMetadata(await taggedPdf());
    const twice = await stripPdfMetadata(once);
    const twiceText = text(twice);
    for (const key of INFO_KEYS) expect(twiceText).not.toContain(key);
    expect((await PDFDocument.load(twice)).getPageCount()).toBe(1);
  });
});

describe("stripPdfMetadata — fails closed", () => {
  it("rejects bytes that are not a PDF", async () => {
    await expect(stripPdfMetadata(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      UnstrippablePdfError,
    );
    const truncated = (await taggedPdf()).subarray(0, 40);
    await expect(stripPdfMetadata(truncated)).rejects.toThrow(UnstrippablePdfError);
    // A bare header with nothing behind it gets PAST pdf-lib's lenient loader
    // (no catalog, no objects) — it must still be the same typed rejection,
    // not an internal error surfacing as a 500.
    const headerOnly = new TextEncoder().encode("%PDF-1.4");
    await expect(stripPdfMetadata(headerOnly)).rejects.toThrow(UnstrippablePdfError);
  });

  it("rejects an encrypted document rather than passing it through", async () => {
    // pdf-lib cannot CREATE encrypted output, but the writer does serialize a
    // trailer /Encrypt pointer — enough to build a document its own loader
    // refuses, which is exactly the refusal the save path must surface.
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.context.trailerInfo.Encrypt = doc.context.register(
      doc.context.obj({ Filter: "Standard", V: 1, R: 2, P: -44 }),
    );
    const encrypted = await doc.save({ useObjectStreams: false });
    await expect(stripPdfMetadata(encrypted)).rejects.toThrow(UnstrippablePdfError);
    await expect(stripPdfMetadata(encrypted)).rejects.toThrow(/encrypted/);
  });
});
