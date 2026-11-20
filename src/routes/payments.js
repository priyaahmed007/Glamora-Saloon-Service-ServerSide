import { Router } from "express";
import { col } from "../config/db.js";
import { getStripe } from "../config/stripe.js";
import { verifyJWT, requireRole } from "../middleware/auth.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireObjectId, toObjectId } from "../utils/helpers.js";

const router = Router();
const CURRENCY = "usd";
const clientUrl = () => process.env.CLIENT_URL || "http://localhost:3000";

/* ------------------------------------------------------------------ */
/* Stripe webhook - the ONLY place where payment status becomes "paid" */
/* ------------------------------------------------------------------ */
async function recordPaid(session) {
  const appointmentId = toObjectId(session.metadata?.appointmentId);
  if (!appointmentId) return;
  const appointment = await col.appointments().findOne({ _id: appointmentId });
  if (!appointment) return;

  await col.transactions().updateOne(
    { stripeSessionId: session.id },
    {
      $set: { status: "paid" },
      $setOnInsert: {
        appointmentId,
        customerId: appointment.customerId,
        amount: (session.amount_total || 0) / 100,
        currency: session.currency || CURRENCY,
        stripeSessionId: session.id,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
  await col.appointments().updateOne({ _id: appointmentId }, { $set: { paymentStatus: "paid", updatedAt: new Date() } });
}

async function recordFailed(session) {
  const appointmentId = toObjectId(session.metadata?.appointmentId);
  if (!appointmentId) return;
  const appointment = await col.appointments().findOne({ _id: appointmentId });
  if (!appointment) return;
  await col.transactions().updateOne(
    { stripeSessionId: session.id, status: { $ne: "paid" } },
    {
      $set: { status: "failed" },
      $setOnInsert: {
        appointmentId,
        customerId: appointment.customerId,
        amount: (session.amount_total || 0) / 100,
        currency: session.currency || CURRENCY,
        stripeSessionId: session.id,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  ).catch((err) => {
    if (err?.code !== 11000) throw err; // already recorded as paid
  });
}

export async function webhookHandler(req, res) {
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    const object = event.data.object;
    console.log(`[stripe webhook] ${event.type} session=${object.id} payment_status=${object.payment_status}`);
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (object.payment_status === "paid") await recordPaid(object);
        break;
      case "checkout.session.async_payment_failed":
        await recordFailed(object);
        break;
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ received: false });
  }
}

/* ------------------------------ Checkout ---------------------------- */
router.post(
  "/checkout/:appointmentId",
  verifyJWT,
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const _id = requireObjectId(req.params.appointmentId, "appointment ID");
    const appointment = await col.appointments().findOne({ _id, customerId: req.user._id });
    if (!appointment) throw new ApiError(404, "Appointment not found.", "NOT_FOUND");
    if (appointment.status !== "confirmed") {
      throw new ApiError(400, "You can only pay for confirmed appointments.", "INVALID_STATE");
    }
    if (appointment.paymentStatus === "paid") throw new ApiError(400, "This appointment is already paid.", "ALREADY_PAID");

    const service = await col.services().findOne({ _id: appointment.serviceId });
    const name = service?.serviceName || "Salon service";

    let session;
    try {
      session = await getStripe().checkout.sessions.create({
        mode: "payment",
        customer_email: req.user.email,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: CURRENCY,
              unit_amount: Math.round(appointment.servicePrice * 100),
              product_data: {
                name,
                description: `Appointment on ${appointment.appointmentDate} at ${appointment.timeSlot}`,
                ...(service?.image?.startsWith("https://") ? { images: [service.image] } : {}),
              },
            },
          },
        ],
        metadata: { appointmentId: String(_id), customerId: req.user.id },
        success_url: `${clientUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl()}/payment/cancel?appointmentId=${_id}`,
      });
    } catch (err) {
      console.error("Stripe checkout error:", err.message);
      throw new ApiError(502, "Could not start the payment. Please try again.", "STRIPE_ERROR");
    }
    res.json({ success: true, url: session.url });
  })
);

// Read-only: lets the success page show what the webhook has recorded so far.
router.get(
  "/session/:sessionId",
  verifyJWT,
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const sessionId = req.params.sessionId;
    let tx = await col.transactions().findOne({ stripeSessionId: sessionId, customerId: req.user._id });

    // Fallback if the webhook has not arrived (e.g. `stripe listen` not running / wrong account):
    // ask Stripe directly. The data comes from the Stripe API with our secret key, so it is trustworthy.
    if (!tx || tx.status !== "paid") {
      try {
        const session = await getStripe().checkout.sessions.retrieve(sessionId);
        const appointmentId = toObjectId(session.metadata?.appointmentId);
        const owned = appointmentId && (await col.appointments().findOne({ _id: appointmentId, customerId: req.user._id }));
        if (owned) {
          if (session.payment_status === "paid") await recordPaid(session);
          else if (session.status === "expired") await recordFailed(session);
          tx = await col.transactions().findOne({ stripeSessionId: sessionId, customerId: req.user._id });
        }
      } catch (err) {
        console.error("Stripe session sync error:", err.message);
      }
    }

    if (tx) {
      const [appointment, service] = await Promise.all([
        col.appointments().findOne({ _id: tx.appointmentId }),
        col.appointments().findOne({ _id: tx.appointmentId }).then((a) => a && col.services().findOne({ _id: a.serviceId })),
      ]);
      return res.json({
        success: true,
        payment: {
          status: tx.status,
          amount: tx.amount,
          currency: tx.currency,
          serviceName: service?.serviceName || "Salon service",
          appointmentDate: appointment?.appointmentDate,
          timeSlot: appointment?.timeSlot,
        },
      });
    }
    res.json({ success: true, payment: { status: "processing" } });
  })
);

const txPipeline = (match) => [
  { $match: match },
  { $sort: { createdAt: -1 } },
  { $lookup: { from: "appointments", localField: "appointmentId", foreignField: "_id", as: "appointment" } },
  { $unwind: { path: "$appointment", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "services", localField: "appointment.serviceId", foreignField: "_id", as: "service" } },
  { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
  { $lookup: { from: "users", localField: "customerId", foreignField: "_id", as: "customer" } },
  { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
  {
    $project: {
      amount: 1,
      currency: 1,
      stripeSessionId: 1,
      status: 1,
      createdAt: 1,
      appointmentId: 1,
      appointmentDate: "$appointment.appointmentDate",
      timeSlot: "$appointment.timeSlot",
      serviceName: "$service.serviceName",
      customer: { _id: "$customer._id", name: "$customer.name", email: "$customer.email", image: "$customer.image" },
    },
  },
];

router.get(
  "/my",
  verifyJWT,
  requireRole("customer"),
  asyncHandler(async (req, res) => {
    const transactions = await col.transactions().aggregate(txPipeline({ customerId: req.user._id })).toArray();
    res.json({ success: true, transactions });
  })
);

// Admin: read-only list. There is intentionally NO endpoint that creates or edits payments.
router.get(
  "/transactions",
  verifyJWT,
  requireRole("admin"),
  asyncHandler(async (_req, res) => {
    const transactions = await col.transactions().aggregate(txPipeline({})).toArray();
    res.json({ success: true, transactions });
  })
);

export default router;
