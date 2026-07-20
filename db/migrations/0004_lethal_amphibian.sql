CREATE INDEX "audit_store_record_idx" ON "audit" USING btree ("store","record_id");--> statement-breakpoint
CREATE INDEX "audit_ts_idx" ON "audit" USING btree ("ts");