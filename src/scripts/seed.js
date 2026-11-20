/**
 * Seeds the database with:
 *  - one Admin account (admins can NEVER be created through public sign-up)
 *  - one demo Customer account
 *  - sample salon services (only if the services collection is empty)
 *
 * Usage:  npm run seed
 * Optional overrides: ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD (set them in your shell or .env)
 */
import "dotenv/config";
import { auth } from "../config/auth.js";
import { client, col, connectDb } from "../config/db.js";

const admin = {
  name: process.env.ADMIN_NAME || "Glamora Admin",
  email: (process.env.ADMIN_EMAIL || "admin@glamora.com").toLowerCase(),
  password: process.env.ADMIN_PASSWORD || "Admin@123",
};
const customer = { name: "Demo Customer", email: "customer@glamora.com", password: "Customer@123" };

const img = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`;

const services = [
  ["Signature Cut & Blow-dry", "Haircut & Styling", "A consultation, precision cut and a smooth salon blow-dry tailored to your face shape and hair texture.", 35, 60, img("photo-1560066984-138dadb4c035")],
  ["Bridal Hair Styling", "Haircut & Styling", "Elegant updos, soft waves or braids for your big day, including a trial-friendly finish that lasts all night.", 90, 120, img("photo-1522337360788-8b13dee7a37e")],
  ["Balayage Colour", "Hair Coloring", "Hand-painted highlights for a soft, sun-kissed finish with natural grow-out. Toner and gloss included.", 120, 180, img("photo-1562322140-8baeececf3df")],
  ["Root Touch-up", "Hair Coloring", "Ammonia-free root colour to cover regrowth and refresh your shade between full colour appointments.", 45, 75, img("photo-1560869713-7d0a29430803")],
  ["Keratin Smoothing Treatment", "Hair Treatment", "Long-lasting smoothing that tames frizz, adds shine and cuts daily styling time by half.", 150, 150, img("photo-1595476108010-b4d1f102b1b1")],
  ["Deep Repair Hair Spa", "Hair Treatment", "Nourishing mask, scalp massage and steam therapy to restore dry or damaged hair.", 40, 60, img("photo-1522337660859-02fbefca4702")],
  ["Hydrating Glow Facial", "Facial & Skincare", "Deep cleanse, exfoliation, massage and a hydrating mask that leaves skin soft and radiant.", 55, 60, img("photo-1570172619644-dfd03ed5d881")],
  ["Anti-Acne Clarifying Facial", "Facial & Skincare", "Targeted treatment with gentle extraction and calming serums to clear congestion and soothe breakouts.", 60, 60, img("photo-1596755389378-c31d21fd1273")],
  ["Party Makeup", "Makeup", "Long-wear, camera-ready makeup for parties and events, with lashes included on request.", 50, 75, img("photo-1487412947147-5cebf100ffc2")],
  ["Gel Manicure", "Manicure & Pedicure", "Nail shaping, cuticle care and a chip-resistant gel polish in the colour of your choice.", 28, 45, img("photo-1604654894610-df63bc536371")],
  ["Spa Pedicure", "Manicure & Pedicure", "Warm soak, scrub, callus care, massage and polish for soft, refreshed feet.", 32, 50, img("photo-1519014816548-bf5fe059798b")],
  ["Aromatherapy Full-Body Massage", "Spa & Massage", "A 90-minute relaxing massage with warm aromatic oils to release tension and restore calm.", 85, 90, img("photo-1544161515-4ab6ce6db874")],
];

async function ensureUser({ name, email, password }, role) {
  let user = await col.users().findOne({ email });
  if (!user) {
    await auth.api.signUpEmail({ body: { name, email, password } });
    user = await col.users().findOne({ email });
    console.log(`Created ${role}: ${email}`);
  } else {
    console.log(`${role} already exists: ${email}`);
  }
  await col.users().updateOne({ _id: user._id }, { $set: { role, isBlocked: false } });
}

async function main() {
  await connectDb();
  await ensureUser(admin, "admin");
  await ensureUser(customer, "customer");

  if ((await col.services().countDocuments()) === 0) {
    const now = new Date();
    await col.services().insertMany(
      services.map(([serviceName, category, description, price, duration, image]) => ({
        serviceName,
        category,
        description,
        price,
        duration,
        image,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }))
    );
    console.log(`Inserted ${services.length} services`);
  } else {
    console.log("Services already exist, skipping.");
  }

  console.log("\nSeed finished.");
  console.log(`Admin login:    ${admin.email} / ${admin.password}`);
  console.log(`Customer login: ${customer.email} / ${customer.password}`);
  await client.close();
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  await client.close();
  process.exit(1);
});
