import { Router } from "express";
import rateLimit from "express-rate-limit";
import { imageUpload } from "../middleware/upload.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

async function uploadToImgBB(file) {
  const key = process.env.IMGBB_API_KEY;
  if (!key) throw new ApiError(500, "Image hosting is not configured on the server.", "UPLOAD_NOT_CONFIGURED");

  const body = new URLSearchParams();
  body.append("image", file.buffer.toString("base64"));

  let response;
  try {
    response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, { method: "POST", body });
  } catch {
    throw new ApiError(502, "Could not reach the image host. Please try again.", "UPLOAD_FAILED");
  }
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success) {
    throw new ApiError(502, "Image upload failed. Please try a different image.", "UPLOAD_FAILED");
  }
  return json.data.display_url || json.data.url;
}

const handle = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "Please choose an image to upload.");
  const url = await uploadToImgBB(req.file);
  res.status(201).json({ success: true, url });
});

// Public so new customers can upload an avatar while signing up (rate limited).
const avatarLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many uploads. Please try again later." },
});

router.post("/avatar", avatarLimiter, imageUpload.single("image"), handle);
router.post("/service", verifyJWT, requireRole("admin"), imageUpload.single("image"), handle);

export default router;
