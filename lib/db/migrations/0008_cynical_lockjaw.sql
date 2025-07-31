CREATE TABLE IF NOT EXISTS "Hypothesis" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"messageId" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"orderIndex" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "IndividualHypothesisFeedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hypothesisId" varchar(32) NOT NULL,
	"userId" uuid NOT NULL,
	"rating" varchar NOT NULL,
	"feedbackText" text,
	"feedbackCategory" varchar,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "IndividualHypothesisFeedback_userId_hypothesisId_unique" UNIQUE("userId","hypothesisId")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Hypothesis" ADD CONSTRAINT "Hypothesis_messageId_Message_v2_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message_v2"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "IndividualHypothesisFeedback" ADD CONSTRAINT "IndividualHypothesisFeedback_hypothesisId_Hypothesis_id_fk" FOREIGN KEY ("hypothesisId") REFERENCES "public"."Hypothesis"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "IndividualHypothesisFeedback" ADD CONSTRAINT "IndividualHypothesisFeedback_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hypothesis_messageId_idx" ON "Hypothesis" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "individual_feedback_hypothesisId_idx" ON "IndividualHypothesisFeedback" USING btree ("hypothesisId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "individual_feedback_userId_idx" ON "IndividualHypothesisFeedback" USING btree ("userId");