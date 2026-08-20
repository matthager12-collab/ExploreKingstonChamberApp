// Document-metadata stripping for uploaded PDFs — the PDF counterpart to
// src/lib/image-sanitize.ts, giving both attachment kinds the same treatment:
// strip before storage, fail closed on input that cannot be parsed. A flyer
// exported from a design tool carries the author's name, the tool's producer
// string and edit timestamps in its Info dictionary; the matching fields in an
// uploaded image are already removed, and there is no reason a flyer sent as a
// PDF should keep what the same flyer sent as a PNG loses.
//
// WHAT IS REMOVED (document level only):
//   - The Info dictionary: Title, Author, Subject, Keywords, Producer,
//     Creator, CreationDate, ModDate. Deleted outright rather than blanked —
//     /Info is optional per spec, and an absent dictionary cannot carry
//     stragglers a blanking pass missed.
//   - The XMP metadata stream (the catalog's /Metadata entry), which
//     duplicates the same fields in XML form.
//   pdf-lib does not garbage-collect unreachable objects on save, so both the
//   POINTER (trailer / catalog entry) and the pointed-to OBJECT are deleted;
//   dropping only the pointer would leave the old bytes in the written file.
//
// WHAT IS NOT: page content is untouched — pdf-lib re-serializes the object
// graph but never re-encodes what a page draws. Metadata nested below the
// document level (an embedded image's own XMP, per-page /PieceInfo) is out of
// scope, the same line the image path draws by stripping containers rather
// than re-encoding pixels.
//
// FAIL-CLOSED BY DESIGN, mirroring stripImageMetadata: a document that cannot
// be loaded (encrypted, malformed) throws UnstrippablePdfError, and the caller
// must reject the upload rather than store bytes it could not verify.

import "server-only";

import { PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";

export class UnstrippablePdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnstrippablePdfError";
  }
}

/**
 * Remove document-level metadata (Info dictionary + XMP stream) from an
 * uploaded PDF.
 *
 * Returns NEW bytes; never mutates the input. Throws UnstrippablePdfError when
 * the document is encrypted or cannot be parsed — callers must let that reject
 * the upload, exactly as they do for UnstrippableImageError.
 */
export async function stripPdfMetadata(bytes: Uint8Array): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    // updateMetadata: false — the default load refreshes Producer and ModDate
    // in the Info dict, which would recreate the very entries being removed.
    // ignoreEncryption gets an encrypted document PAST the loader so the
    // isEncrypted check below can name the problem precisely; pdf-lib's own
    // EncryptedPDFError can't be told apart by instanceof (its ES5 build
    // loses the Error prototype chain), and the message the operator needs
    // ("export an unprotected copy") is worth being sure about.
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new UnstrippablePdfError("pdf-sanitize: document could not be parsed");
  }
  // An encrypted document is rejected outright, not decrypted: pdf-lib cannot
  // rewrite one faithfully, and the fail-closed rule forbids storing bytes
  // whose metadata could not be verified removed.
  if (doc.isEncrypted) throw new UnstrippablePdfError("pdf-sanitize: document is encrypted");
  // The loader is lenient enough to accept a bare "%PDF-" header with no
  // object graph behind it — catalog comes back undefined then. No catalog
  // means nothing verifiable, which is the same fail-closed case as a parse
  // error, not an internal fault.
  if (!(doc.catalog instanceof PDFDict)) {
    throw new UnstrippablePdfError("pdf-sanitize: document has no catalog");
  }

  // Info dictionary: delete the indirect object, then the trailer's pointer.
  // The writer skips undefined trailer entries, so the output has no /Info.
  const infoRef = doc.context.trailerInfo.Info;
  if (infoRef instanceof PDFRef) doc.context.delete(infoRef);
  delete doc.context.trailerInfo.Info;

  // Document-level XMP: same two steps for the catalog's /Metadata stream.
  const metadataRef = doc.catalog.get(PDFName.of("Metadata"));
  if (metadataRef instanceof PDFRef) doc.context.delete(metadataRef);
  doc.catalog.delete(PDFName.of("Metadata"));

  // useObjectStreams: false keeps every object individually visible in the
  // output instead of packed into compressed object streams — that is what
  // lets the test suite prove by byte-scan that nothing survived, and it is
  // the most conservative serialization for older viewers.
  return doc.save({ useObjectStreams: false });
}
