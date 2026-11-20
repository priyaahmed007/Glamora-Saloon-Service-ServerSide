import { Router } from "express";
import { col } from "../config/db.js";
import { ACTIVE_APPOINTMENT_STATUS, APPOINTMENT_STATUS, TIME_SLOTS } from "../config/constants.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { isValidDateString, requireObjectId, todayString } from "../utils/helpers.js";

const router = Router();
router.use(verifyJWT);

const hydrate = (match) => [
  { $match: match },
  { $sort: { createdAt: -1 } },
  { $lookup: { from: "services", localField: "serviceId", foreignField: "_id", as: "service" } },
  { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "customerId", foreignField: "_id", as: "customer" } },
  { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      activeSlotKey: 0,
      "service.description": 0,
      "service.createdAt": 0,
      "service.updatedAt": 0,
      "customer.emailVerified": 0,
      "customer.createdAt": 0,
      "customer.updatedAt": 0,
      "customer.isBlocked": 0,
      "customer.role": 0,
    },
  },
];

const slotKey = (serviceId, date, slot) => `${serviceId}|${date}|${slot}`;

// Time slots already taken for a service on a date (pending or confirmed)
router.get(
  "/booked-slots",
  asyncHandler(async (req, res) => {
    const serviceId = requireObjectId(req.query.serviceId, "service ID");
    if (!isValidDateString(req.query.date)) throw new ApiError(400, "Invalid date.");
    const rows = await col
      .appointments()
      .find({ serviceId, appointmentDate: req.query.date, status: { $in: ACTIVE_APPOINTMENT_STATUS } })
      .project({ timeSlot: 1 })
      .toArray();
    res.json({ success: true, slots: rows.map((r) => r.timeSlot), allSlots: TIME_SLOTS });
  })
);

// Customer: my appointments
router.get(
  "/my",
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const match = { customerId: req.user._id };
    if (APPOINTMENT_STATUS.includes(req.query.status)) match.status = req.query.status;
    const appointments = await col.appointments().aggregate(hydrate(match)).toArray();
    res.json({ success: true, appointments });
  })
);

// Admin: all appointments
router.get(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const match = {};
    if (APPOINTMENT_STATUS.includes(req.query.status)) match.status = req.query.status;
    const appointments = await col.appointments().aggregate(hydrate(match)).toArray();
    res.json({ success: true, appointments });
  })
);

// Single appointment (owner or admin)
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const _id = requireObjectId(req.params.id, "appointment ID");
    const match = req.user.role === "admin" ? { _id } : { _id, customerId: req.user._id };
    const [appointment] = await col.appointments().aggregate(hydrate(match)).toArray();
    if (!appointment) throw new ApiError(404, "Appointment not found.", "NOT_FOUND");
    res.json({ success: true, appointment });
  })
);

// Customer: request an appointment
router.post(
  "/",
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const serviceId = requireObjectId(req.body.serviceId, "service ID");
    const { appointmentDate, timeSlot } = req.body;
    const message = String(req.body.message || "").trim();

    if (!isValidDateString(appointmentDate)) throw new ApiError(400, "Please choose a valid appointment date.");
    if (appointmentDate < todayString()) throw new ApiError(400, "Appointment date cannot be in the past.");
    if (!TIME_SLOTS.includes(timeSlot)) throw new ApiError(400, "Please choose a valid time slot.");
    if (message.length > 500) throw new ApiError(400, "Message must be 500 characters or fewer.");

    const service = await col.services().findOne({ _id: serviceId });
    if (!service) throw new ApiError(404, "Service not found.", "NOT_FOUND");
    if (service.status !== "active") throw new ApiError(400, "This service is not available for booking.", "INACTIVE_SERVICE");

    const clash = await col.appointments().findOne({
      customerId: req.user._id,
      appointmentDate,
      timeSlot,
      status: { $in: ACTIVE_APPOINTMENT_STATUS },
    });
    if (clash) throw new ApiError(409, "You already have an appointment at this date and time.", "SLOT_CONFLICT");

    const now = new Date();
    const doc = {
      serviceId,
      customerId: req.user._id,
      appointmentDate,
      timeSlot,
      message,
      servicePrice: service.price,
      paymentStatus: "unpaid",
      status: "pending",
      activeSlotKey: slotKey(serviceId, appointmentDate, timeSlot),
      createdAt: now,
      updatedAt: now,
    };

    try {
      const result = await col.appointments().insertOne(doc);
      const { activeSlotKey, ...clean } = doc;
      res.status(201).json({ success: true, message: "Appointment request sent. We will confirm it shortly.", appointment: { ...clean, _id: result.insertedId } });
    } catch (err) {
      if (err?.code === 11000) {
        throw new ApiError(409, "That time slot was just booked. Please choose another one.", "SLOT_CONFLICT");
      }
      throw err;
    }
  })
);

// Admin: confirm a pending appointment
router.patch(
  "/:id/confirm",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const _id = requireObjectId(req.params.id, "appointment ID");
    const result = await col
      .appointments()
      .findOneAndUpdate({ _id, status: "pending" }, { $set: { status: "confirmed", updatedAt: new Date() } }, { returnDocument: "after" });
    if (!result) {
      const exists = await col.appointments().findOne({ _id }, { projection: { status: 1 } });
      if (!exists) throw new ApiError(404, "Appointment not found.", "NOT_FOUND");
      throw new ApiError(400, "Only pending appointments can be confirmed.", "INVALID_STATE");
    }
    res.json({ success: true, message: "Appointment confirmed." });
  })
);

// Cancel: customers can cancel their own pending requests, admins can cancel pending or confirmed
router.patch(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const _id = requireObjectId(req.params.id, "appointment ID");
    const isAdmin = req.user.role === "admin";
    const filter = isAdmin ? { _id } : { _id, customerId: req.user._id };
    const appointment = await col.appointments().findOne(filter);
    if (!appointment) throw new ApiError(404, "Appointment not found.", "NOT_FOUND");

    const allowed = isAdmin ? ["pending", "confirmed"] : ["pending"];
    if (!allowed.includes(appointment.status)) {
      throw new ApiError(
        400,
        isAdmin ? "This appointment is already cancelled." : "Only pending appointment requests can be cancelled.",
        "INVALID_STATE"
      );
    }

    await col
      .appointments()
      .updateOne({ _id }, { $set: { status: "cancelled", updatedAt: new Date() }, $unset: { activeSlotKey: "" } });
    res.json({ success: true, message: "Appointment cancelled." });
  })
);

export default router;
