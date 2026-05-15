const express = require("express");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const router = express.Router();

const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

router.post("/presigned-url", async (req, res) => {
    try {
        const { fileName, fileType } = req.body;

        if (!fileName || !fileType) {
            return res.status(400).json({
                message: "Missing fileName or fileType",
            });
        }

        if (!fileType.startsWith("image/")) {
            return res.status(400).json({
                message: "Only image files are allowed",
            });
        }

        const ext = fileName.split(".").pop();

        const key = `restaurants/${Date.now()}-${Math.round(
            Math.random() * 1e9
        )}.${ext}`;

        const command = new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
            ContentType: fileType,
        });

        const uploadUrl = await getSignedUrl(s3, command, {
            expiresIn: 60,
        });

        const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

        return res.json({
            uploadUrl,
            imageUrl,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            message: "Cannot create presigned URL",
        });
    }
});

module.exports = router;