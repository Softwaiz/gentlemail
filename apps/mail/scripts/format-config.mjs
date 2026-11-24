// Puts wrangler.jsonc in the layout Wrangler itself writes. Values and comments don't change.
// Wrangler lays out the whole file again when it adds something to it, such as the ID of the database it
// created. Kept in that layout, only the added lines change, and a release merges with people's settings.
import { fileURLToPath } from "node:url";
import { experimental_patchConfig } from "wrangler";

experimental_patchConfig(fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)), {}, false);
