import { Router } from "express";
import { col } from "../config/db.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();
router.use(verifyJWT);

router.get(
  "/customer",
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const customerId = req.user._id;
    const [total, pending, confirmed, cancelled] = await Promise.all([
      col.appointments().countDocuments({ customerId }),
      col.appointments().countDocuments({ customerId, status: "pending" }),
      col.appointments().countDocuments({ customerId, status: "confirmed" }),
      col.appointments().countDocuments({ customerId, status: "cancelled" }),
    ]);
    res.json({ success: true, stats: { total, pending, confirmed, cancelled } });
  })
);

router.get(
  "/admin",
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    const [customers, activeServices, total, pending, confirmed, payments, revenue] = await Promise.all([
      col.users().countDocuments({ role: { $ne: "admin" } }),
      col.services().countDocuments({ status: "active" }),
      col.appointments().countDocuments({}),
      col.appointments().countDocuments({ status: "pending" }),
      col.appointments().countDocuments({ status: "confirmed" }),
      col.transactions().countDocuments({ status: "paid" }),
      col.transactions().aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, sum: { $sum: "$amount" } } }]).toArray(),
    ]);
    res.json({
      success: true,
      stats: { customers, activeServices, total, pending, confirmed, payments, revenue: revenue[0]?.sum || 0 },
    });
  })
);

export default router;
