import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./config/auth.js";
import { connectDb } from "./config/db.js";
import { errorHandler, notFound } from "./middleware/error.js";
import servicesRouter from "./routes/services.js";
import appointmentsRouter from "./routes/appointments.js";
import usersRouter from "./routes/users.js";
import statsRouter from "./routes/stats.js";
import uploadRouter from "./routes/upload.js";
import paymentsRouter, { webhookHandler } from "./routes/payments.js";

const app = express();
const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
if (process.env.NODE_ENV !== "test") app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.use(
  cors({
    origin: [clientUrl],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Better Auth must be mounted BEFORE express.json()
app.all("/api/auth/*", toNodeHandler(auth));

// Stripe webhook needs the raw body for signature verification, so it is mounted BEFORE express.json()
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), webhookHandler);

app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.json({ success: true, name: "Glamora API", status: "ok" }));
app.get("/api/health", (_req, res) => res.json({ success: true, status: "ok", time: new Date().toISOString() }));

app.use("/api/services", servicesRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/users", usersRouter);
app.use("/api/stats", statsRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/payments", paymentsRouter);

app.use(notFound);
app.use(errorHandler);

// Memoised so serverless hosts reuse the connection between invocations.
export const ready = connectDb();
export default app;
