// oxlint-disable-next-line import/no-unassigned-import -- the Tailwind stylesheet
import "./index.css";
import { boot } from "./app";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");
// Without this, a failure to open storage would leave the page blank with no word why.
boot(root).catch((error: unknown) => {
    root.textContent = `Chronoscribe couldn't start: ${String(error)}`;
});
