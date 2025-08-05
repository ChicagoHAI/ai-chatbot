-- Update hypothesis ID column length to support new format: hyp_chatId_messageId_num
ALTER TABLE "Hypothesis" 
ALTER COLUMN "id" TYPE varchar(100);

-- Update individualHypothesisFeedback hypothesisId column length to match
ALTER TABLE "IndividualHypothesisFeedback" 
ALTER COLUMN "hypothesisId" TYPE varchar(100);