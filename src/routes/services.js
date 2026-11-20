import { Router } from "express";
import { col } from "../config/db.js";
import { CATEGORIES, ACTIVE_APPOINTMENT_STATUS } from "../config/constants.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { escapeRegex, requireObjectId } from "../utils/helpers.js";

const router = Router();

const SORTS = {
  price_asc: { price: 1, createdAt: -1 },
  price_desc: { price: -1, createdAt: -1 },
  newest: { createdAt: -1 },
};

function validateService(body, { partial = false } = {}) {
  const data = {};
  const errors = [];

  if (!partial || body.serviceName !== undefined) {
    const name = String(body.serviceName || "").trim();
    if (name.length < 3 || name.length > 80) errors.push("Service name must be 3-80 characters.");
    data.serviceName = name;
  }
  if (!partial || body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) errors.push("Please choose a valid category.");
    data.category = body.category;
  }
  if (!partial || body.description !== undefined) {
    const description = String(body.description || "").trim();
    if (description.length < 10 || description.length > 1500) errors.push("Description must be 10-1500 characters.");
    data.description = description;
  }
  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) errors.push("Price must be a positive number.");
    data.price = Math.round(price * 100) / 100;
  }
  if (!partial || body.duration !== undefined) {
    const duration = Number(body.duration);
    if (!Number.isInteger(duration) || duration <= 0) errors.push("Duration must be a positive whole number of minutes.");
    data.duration = duration;
  }
  if (!partial || body.image !== undefined) {
    const image = String(body.image || "").trim();
    if (!/^https?:\/\//i.test(image)) errors.push("A service image is required.");
    data.image = image;
  }
  if (body.status !== undefined) {
    if (!["active", "inactive"].includes(body.status)) errors.push("Status must be active or inactive.");
    data.status = body.status;
  }
  if (errors.length) throw new ApiError(400, errors[0], "VALIDATION_ERROR");
  return data;
}

function buildQuery({ q, category, status }) {
  const query = {};
  if (status) query.status = status;
  if (category) query.category = category;
  if (q) query.serviceName = { $regex: escapeRegex(q.trim()), $options: "i" };
  return query;
}

async function list(query, req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const sort = SORTS[req.query.sort] || SORTS.newest;
  const [services, total] = await Promise.all([
    col.services().find(query).sort(sort).skip((page - 1) * limit).limit(limit).toArray(),
    col.services().countDocuments(query),
  ]);
  res.json({ success: true, services, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}

// Public: active services with search, category filter, price sorting and pagination
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = buildQuery({ q: req.query.q, category: req.query.category, status: "active" });
    await list(query, req, res);
  })
);

// Public: categories with the number of active services in each
router.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const counts = await col
      .services()
      .aggregate([{ $match: { status: "active" } }, { $group: { _id: "$category", count: { $sum: 1 } } }])
      .toArray();
    const map = Object.fromEntries(counts.map((c) => [c._id, c.count]));
    res.json({ success: true, categories: CATEGORIES.map((name) => ({ name, count: map[name] || 0 })) });
  })
);

// Admin: every service (active + inactive)
router.get(
  "/admin/all",
  verifyJWT,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const status = ["active", "inactive"].includes(req.query.status) ? req.query.status : undefined;
    await list(buildQuery({ q: req.query.q, category: req.query.category, status }), req, res);
  })
);

// Protected: single service (inactive services are hidden from customers)
router.get(
  "/:id",
  verifyJWT,
  asyncHandler(async (req, res) => {
    const _id = requireObjectId(req.params.id, "service ID");
    const service = await col.services().findOne({ _id });
    if (!service) throw new ApiError(404, "Service not found.", "NOT_FOUND");
    if (service.status !== "active" && req.user.role !== "admin") {
      throw new ApiError(404, "This service is currently unavailable.", "UNAVAILABLE");
    }
    res.json({ success: true, service });
  })
);

router.post(
  "/",
  verifyJWT,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const data = validateService(req.body);
    const now = new Date();
    const doc = { ...data, status: data.status || "active", createdAt: now, updatedAt: now };
    const result = await col.services().insertOne(doc);
    res.status(201).json({ success: true, message: "Service created.", service: { ...doc, _id: result.insertedId } });
  })
);

router.put(
  "/:id",
  verifyJWT,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const _id = requireObjectId(req.params.id, "service ID");
    const data = validateService(req.body, { partial: true });
    const result = await col
      .services()
      .findOneAndUpdate({ _id }, { $set: { ...data, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!result) throw new ApiError(404, "Service not found.", "NOT_FOUND");
    res.json({ success: true, message: "Service updated.", service: result });
  })
);

router.patch(
  "/:id/status",
  verifyJWT,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const _id = requireObjectId(req.params.id, "service ID");
    if (!["active", "inactive"].includes(req.body.status)) throw new ApiError(400, "Status must be active or inactive.");
    const result = await col
      .services()
      .findOneAndUpdate({ _id }, { $set: { status: req.body.status, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!result) throw new ApiError(404, "Service not found.", "NOT_FOUND");
    res.json({ success: true, message: `Service ${req.body.status === "active" ? "activated" : "deactivated"}.`, service: result });
  })
);

router.delete(
  "/:id",
  verifyJWT,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const _id = requireObjectId(req.params.id, "service ID");
    const open = await col.appointments().countDocuments({ serviceId: _id, status: { $in: ACTIVE_APPOINTMENT_STATUS } });
    if (open > 0) {
      throw new ApiError(409, "This service has pending or confirmed appointments. Deactivate it instead of deleting.", "HAS_APPOINTMENTS");
    }
    const result = await col.services().deleteOne({ _id });
    if (!result.deletedCount) throw new ApiError(404, "Service not found.", "NOT_FOUND");
    res.json({ success: true, message: "Service deleted." });
  })
);

export default router;
