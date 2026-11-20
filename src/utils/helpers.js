import { ObjectId } from "mongodb";
import { ApiError } from "./ApiError.js";
import { col } from "../config/db.js";

export function toObjectId(id) {
  return ObjectId.isValid(id) && String(new ObjectId(id)) === String(id) ? new ObjectId(id) : null;
}

export function requireObjectId(id, label = "ID") {
  const oid = toObjectId(id);
  if (!oid) throw new ApiError(400, `Invalid ${label}`, "INVALID_ID");
  return oid;
}

export async function findUserById(id) {
  const oid = toObjectId(id);
  const query = oid ? { $or: [{ _id: oid }, { _id: String(id) }] } : { _id: String(id) };
  return col.users().findOne(query);
}

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const todayString = () => new Date().toISOString().slice(0, 10);

export function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const publicUser = (u) =>
  u && {
    id: String(u._id),
    name: u.name,
    email: u.email,
    image: u.image || "",
    phone: u.phone || "",
    role: u.role || "customer",
    isBlocked: !!u.isBlocked,
    createdAt: u.createdAt,
  };
