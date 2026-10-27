// SPIKE: frame times for each renderer while panning and zooming the real tables, at 1x and 4x CPU throttling,
// scripted through each renderer's own zoom machinery and then with real wheel and drag input.
import { writeFileSync } from "node:fs";
import { type Page, test } from "@playwright/test";

declare global {
  interface Window {
    ready?: boolean;
    bench: () => Promise<unknown>;
    show: (from: number, to: number) => void;
    probe: () => { view: number[]; lines: number };
    intervals: number[];
  }
}

const RENDERERS = ["d3", "echarts-line", "echarts-custom"] as const;
const results: Record<string, unknown> = {};

async function open(page: Page, renderer: string) {
  await page.goto(`/?renderer=${renderer}`);
  await page.waitForFunction(() => window.ready);
}

/**
 * rAF intervals while wheel-zooming in and dragging the window back and forth with the real mouse.
 * Playwright awaits each event, so a slow renderer stretches the run (wall time) rather than dropping frames.
 */
async function realInput(page: Page) {
  const box = (await page.locator("#chart").boundingBox())!;
  const cx = box.x + box.width * 0.9;
  const cy = box.y + box.height / 2;
  const probes: Record<string, unknown> = {};
  await page.evaluate(() => {
    window.intervals = [];
    let last = performance.now();
    const tick = (now: number) => {
      window.intervals.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const started = Date.now();
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -120);
  probes.zoomedIn = await page.evaluate(() => window.probe());
  // Drag right pans back towards the start of the history, then return.
  await page.mouse.move(box.x + box.width * 0.1, cy);
  await page.mouse.down();
  for (let i = 1; i <= 120; i++) await page.mouse.move(box.x + box.width * (0.1 + 0.8 * (i / 120)), cy);
  probes.pannedBack = await page.evaluate(() => window.probe());
  for (let i = 1; i <= 120; i++) await page.mouse.move(box.x + box.width * (0.9 - 0.8 * (i / 120)), cy);
  await page.mouse.up();
  probes.pannedForward = await page.evaluate(() => window.probe());
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 120);
  probes.zoomedOut = await page.evaluate(() => window.probe());
  const wallMs = Date.now() - started;
  const intervals = await page.evaluate(() => window.intervals.slice(1));
  const sorted = intervals.toSorted((a, b) => a - b);
  const at = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! * 100) / 100;
  return {
    wallMs,
    frames: intervals.length,
    median: at(0.5),
    p95: at(0.95),
    max: at(1),
    // A frame that took more than one and a half vsync intervals at 60 Hz.
    droppedFrames: intervals.filter((v) => v > 25).length,
    probes,
  };
}

for (const renderer of RENDERERS)
  for (const throttle of [1, 4])
    test(`${renderer} at ${throttle}x CPU`, async ({ page }) => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
      await open(page, renderer);
      // Warm up the JIT and the renderer's caches before measuring.
      await page.evaluate(() => window.bench());
      const scripted = await page.evaluate(() => window.bench());
      const real = await realInput(page);
      results[`${renderer} @${throttle}x`] = { scripted, real };
      if (throttle === 1)
        for (const [label, from, to] of [
          ["full", 0, 2338],
          ["year", 1700, 2065],
          ["quarter", 1900, 1990],
          ["fortnight", 1950, 1964],
        ] as const) {
          await page.evaluate(([f, t]) => window.show(f!, t!), [from, to]);
          await page.locator("#chart").screenshot({ path: `results/${renderer}-${label}.png` });
        }
    });

test.afterAll(() => writeFileSync("results/frame-times.json", JSON.stringify(results, null, 2)));
