import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is missing. Add it to your .env file.");
}

export const client = new MongoClient(uri);
export const db = client.db(process.env.MONGODB_DB || "glamora");

export const col = {
  users: () => db.collection("users"),
  services: () => db.collection("services"),
  appointments: () => db.collection("appointments"),
  transactions: () => db.collection("transactions"),
};

export async function connectDb() {
  await client.connect();
  await Promise.all([
    col.services().createIndex({ status: 1, category: 1 }),
    col.services().createIndex({ serviceName: 1 }),
    col.appointments().createIndex({ customerId: 1, createdAt: -1 }),
    // Race-safe protection against double booking: only active appointments carry this key.
    col.appointments().createIndex({ activeSlotKey: 1 }, { unique: true, sparse: true }),
    col.transactions().createIndex({ stripeSessionId: 1 }, { unique: true }),
    col.transactions().createIndex({ customerId: 1, createdAt: -1 }),
  ]);
}
