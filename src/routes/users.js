import { Router } from "express";
import { col, db } from "../config/db.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { escapeRegex, findUserById, publicUser, requireObjectId, toObjectId } from "../utils/helpers.js";

const router = Router();
router.use(verifyJWT);

// Current user
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const user = await findUserById(req.user.id);
    res.json({ success: true, user: publicUser(user) });
  })
);

// Update own profile. Only whitelisted fields: role / isBlocked / email can never be changed here.
router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const update = {};
    const { name, image, phone } = req.body || {};

    if (name !== undefined) {
      const clean = String(name).trim();
      if (clean.length < 2 || clean.length > 60) throw new ApiError(400, "Name must be 2-60 characters.");
      update.name = clean;
    }
    if (image !== undefined) {
      const clean = String(image).trim();
      if (clean && !/^https?:\/\/\S+$/i.test(clean)) throw new ApiError(400, "Profile image must be a valid URL.");
      update.image = clean;
    }
    if (phone !== undefined) {
      const clean = String(phone).trim();
      if (clean && !/^[+\d][\d\s-]{6,18}$/.test(clean)) throw new ApiError(400, "Please enter a valid phone number.");
      update.phone = clean;
    }
    if (!Object.keys(update).length) throw new ApiError(400, "Nothing to update.");

    await col.users().updateOne({ _id: req.user._id }, { $set: { ...update, updatedAt: new Date() } });
    const user = await findUserById(req.user.id);
    res.json({ success: true, message: "Profile updated successfully.", user: publicUser(user) });
  })
);

// Admin: list customers
router.get(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const query = { role: { $ne: "admin" } };
    if (req.query.status === "blocked") query.isBlocked = true;
    if (req.query.status === "active") query.isBlocked = { $ne: true };
    if (req.query.q) {
      const rx = { $regex: escapeRegex(String(req.query.q).trim()), $options: "i" };
      query.$or = [{ name: rx }, { email: rx }];
    }
    const users = await col.users().find(query).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, users: users.map(publicUser) });
  })
);

// Admin: customer details with booking summary
router.get(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    requireObjectId(req.params.id, "user ID");
    const user = await findUserById(req.params.id);
    if (!user) throw new ApiError(404, "User not found.", "NOT_FOUND");
    const customerId = user._id;
    const [total, pending, confirmed, paid] = await Promise.all([
      col.appointments().countDocuments({ customerId }),
      col.appointments().countDocuments({ customerId, status: "pending" }),
      col.appointments().countDocuments({ customerId, status: "confirmed" }),
      col.transactions().countDocuments({ customerId, status: "paid" }),
    ]);
    res.json({ success: true, user: publicUser(user), summary: { total, pending, confirmed, paid } });
  })
);

async function setBlocked(req, res, blocked) {
  requireObjectId(req.params.id, "user ID");
  const user = await findUserById(req.params.id);
  if (!user) throw new ApiError(404, "User not found.", "NOT_FOUND");
  if (user.role === "admin") throw new ApiError(400, "Admin accounts cannot be blocked.");

  await col.users().updateOne({ _id: user._id }, { $set: { isBlocked: blocked, updatedAt: new Date() } });
  if (blocked) {
    // Force sign-out everywhere by removing Better Auth sessions.
    const ids = [user._id, String(user._id)];
    await db.collection("session").deleteMany({ userId: { $in: ids } });
  }
  res.json({ success: true, message: blocked ? "User blocked." : "User unblocked." });
}

router.patch("/:id/block", requireRole("admin"), asyncHandler((req, res) => setBlocked(req, res, true)));
router.patch("/:id/unblock", requireRole("admin"), asyncHandler((req, res) => setBlocked(req, res, false)));

export default router;
