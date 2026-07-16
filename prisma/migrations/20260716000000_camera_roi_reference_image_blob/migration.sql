ALTER TABLE "Camera"
ADD COLUMN "roiReferenceImageData" BYTEA,
ADD COLUMN "roiReferenceImageMime" TEXT,
ADD COLUMN "roiReferenceImageName" TEXT;
