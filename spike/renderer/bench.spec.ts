// SPIKE: frame times for each renderer while panning and zooming the real tables, at 1x and 4x CPU throttling,
// scripted through each renderer's own zoom machinery and then with real wheel and drag input.
import { writeFileSync } from "node:fs";
import { type Page, test } from "@playwright/test";

const RENDERERS = ["d3", "echarts-line", "echarts-custom"] as const;
const results: Record<string, unknown> = {};

async function open(page: Page, renderer: string) {
  await page.goto(`/?renderer=${renderer}`);
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready);
}

/** rAF intervals while wheel-zooming and dragging with the real mouse. */
async function realInput(page: Page) {
  const box = (await page.locator("#chart").boundingBox())!;
  const cx = box.x + box.width * 0.8;
  const cy = box.y + box.height / 2;
  await page.evaluate(() => {
    const w = window as unknown as { intervals: number[] };
    w.intervals = [];
    let last = performance.now();
    const tick = (now: number) => {
      w.intervals.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -120);
  await page.mouse.down();
  for (let i = 0; i < 120; i++) await page.mouse.move(cx - i * 8, cy);
  for (let i = 0; i < 120; i++) await page.mouse.move(cx - 960 + i * 8, cy);
  await page.mouse.up();
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 120);
  const intervals = await page.evaluate(() => (window as unknown as { intervals: number[] }).intervals.slice(1));
  const sorted = intervals.toSorted((a, b) => a - b);
  return {
    frames: intervals.length,
    median: Math.round(sorted[sorted.length >> 1]! * 100) / 100,
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]! * 100) / 100,
    max: Math.round(sorted.at(-1)! * 100) / 100,
    over16ms: intervals.filter((v) => v > 17).length,
  };
}

for (const renderer of RENDERERS)
  for (const throttle of [1, 4])
    test(`${renderer} at ${throttle}x CPU`, async ({ page }) => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
      await open(page, renderer);
      // Warm up the JIT and the renderer's caches before measuring.
      await page.evaluate(() => (window as unknown as { bench: () => Promise<unknown> }).bench());
      const scripted = await page.evaluate(() => (window as unknown as { bench: () => Promise<unknown> }).bench());
      const real = await realInput(page);
      results[`${renderer} @${throttle}x`] = { scripted, real };
      if (throttle === 1)
        for (const [label, from, to] of [
          ["full", 0, 2338],
          ["year", 1700, 2065],
          ["quarter", 1900, 1990],
          ["fortnight", 1950, 1964],
        ] as const) {
          await page.evaluate(([f, t]) => (window as unknown as { show: (f: number, t: number) => void }).show(f!, t!), [from, to]);
          await page.locator("#chart").screenshot({ path: `results/${renderer}-${label}.png` });
        }
    });

test.afterAll(() => writeFileSync("results/frame-times.json", JSON.stringify(results, null, 2)));
