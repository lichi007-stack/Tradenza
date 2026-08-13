CREATE TYPE "public"."checklist_block" AS ENUM('gate', 'setup', 'exit');--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"strategy_id" uuid,
	"block" "checklist_block" NOT NULL,
	"label" text NOT NULL,
	"definition" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"effective_from" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conditional_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"definition" text,
	"mistake_tag_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"effective_from" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditional_rules" ADD CONSTRAINT "conditional_rules_mistake_tag_id_tags_id_fk" FOREIGN KEY ("mistake_tag_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_items_user_block_idx" ON "checklist_items" USING btree ("user_id","block");--> statement-breakpoint
CREATE INDEX "checklist_items_strategy_idx" ON "checklist_items" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "conditional_rules_user_id_idx" ON "conditional_rules" USING btree ("user_id");--> statement-breakpoint
-- Seed the new items from the text arrays they replace, so no user loses their playbook.
--
-- `effective_from` is the MIGRATION DAY, not the strategy's history. The reason is the
-- review window (see lib/adherence): a trade's checklist locks 24 hours after the trade
-- was recorded, so every trade that already exists when this runs is locked the moment it
-- is upgraded. Back-dating the criteria onto those trades would attach a checklist that
-- can never be filled in — they would count in every coverage denominator forever and
-- read as "reviewed on 0 of 800 trades", which is an artefact of the migration rather
-- than a fact about the trader. Dating from today instead lets adherence start clean:
-- history simply sits outside it, and the first figure the user sees is one they made.
--
-- Stored v1 progress on those old trades is left alone and stays readable — it is
-- normalised on read (see normalizeProgress), never rewritten.
--
-- The deprecated flat `checklist` stands in where `entry_checklist` is null — on an old
-- journal it is the only playbook there is. The source columns are left untouched: this
-- migration adds, so rolling back is switching the reader, not restoring data.
INSERT INTO "checklist_items" ("user_id", "strategy_id", "block", "label", "sort_order", "effective_from")
SELECT
  s."user_id",
  s."id",
  'setup'::"public"."checklist_block",
  btrim(item."label"),
  (item."ord" - 1)::integer,
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
FROM "strategies" s
CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(s."entry_checklist", s."checklist", '[]'::jsonb))
  WITH ORDINALITY AS item("label", "ord")
WHERE jsonb_typeof(coalesce(s."entry_checklist", s."checklist", '[]'::jsonb)) = 'array'
  AND length(btrim(item."label")) > 0;--> statement-breakpoint
INSERT INTO "checklist_items" ("user_id", "strategy_id", "block", "label", "sort_order", "effective_from")
SELECT
  s."user_id",
  s."id",
  'exit'::"public"."checklist_block",
  btrim(item."label"),
  (item."ord" - 1)::integer,
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
FROM "strategies" s
CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(s."exit_checklist", '[]'::jsonb))
  WITH ORDINALITY AS item("label", "ord")
WHERE jsonb_typeof(coalesce(s."exit_checklist", '[]'::jsonb)) = 'array'
  AND length(btrim(item."label")) > 0;