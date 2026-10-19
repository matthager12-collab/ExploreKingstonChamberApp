// Public server entry point; persistence stays inside the database layer.
export {
  extractionConfigured,
  ExtractionUnavailable,
  submitPostExtraction,
  readPostExtraction,
} from "@/lib/db/event-extraction";
