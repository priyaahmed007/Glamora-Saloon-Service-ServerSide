// Optional Vercel entry point. For local development and long-running hosts use `npm start`.
import app, { ready } from "../src/app.js";

export default async function handler(req, res) {
  await ready;
  return app(req, res);
}
