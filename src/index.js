import "dotenv/config";
import app, { ready } from "./app.js";

const PORT = process.env.PORT || 8000;

ready
  .then(() => {
    app.listen(PORT, () => console.log(`Glamora API running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  });
