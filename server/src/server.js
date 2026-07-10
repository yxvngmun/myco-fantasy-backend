import "dotenv/config";
import { createApp } from "./app.js";

const app = createApp();
const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Myco Fantasy API listening on :${port}`);
});
