import multer from "multer";
import { ApiError } from "../utils/ApiError.js";

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      return cb(new ApiError(400, "Only JPG, PNG, WEBP or GIF images are allowed."));
    }
    cb(null, true);
  },
});
