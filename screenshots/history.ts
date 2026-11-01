import type { FixtureScrobble, FixtureUser } from "../test-support/lastfm";

/** The made-up history spans these Days, and the screenshots' clock stops the Day after. */
export const FIRST_DAY = "2025-01-01";
export const LAST_DAY = "2026-06-30";

const DAY_MS = 86_400_000;

/** A seeded generator, so every run draws the same history. */
const mulberry32 = (seed: number) => {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/** An Artist's appetite over the history: a base, and a burst that peaks on `peakDay`. */
interface Fan {
    artist: string;
    album: string;
    tracks: readonly string[];
    base: number;
    peak: number;
    peakDay: number;
    spread: number;
    /** The Day before which the Listener hadn't heard of them. */
    discovered: number;
}

const fanOf = (
    artist: string,
    album: string,
    tracks: readonly string[],
    [base, peak, peakDay, spread, discovered = 0]: readonly [
        number,
        number,
        number,
        number,
        number?,
    ],
): Fan => ({ artist, album, tracks, base, peak, peakDay, spread, discovered });

const FANS: readonly Fan[] = [
    fanOf(
        "Glass Harbour",
        "Low Tide",
        ["Undertow", "Salt Lines", "Breakwater", "Pier Lights"],
        [6, 10, 60, 50],
    ),
    fanOf(
        "The Velvet Static",
        "Signal Loss",
        ["Dial Tone", "Carrier Wave", "Feedback Loop"],
        [5, 4, 200, 80],
    ),
    fanOf(
        "Juniper Kite",
        "Paper Skies",
        ["Updraft", "Tailwind", "String Theory", "Lift"],
        [3, 14, 330, 35, 260],
    ),
    fanOf(
        "Moth & Lantern",
        "Night Walks",
        ["Porch Light", "Dusk Song", "Wingbeat"],
        [4, 6, 420, 70],
    ),
    fanOf(
        "Northern Arcade",
        "Coin Op",
        ["High Score", "Insert Coin", "Continue?"],
        [4, 3, 100, 60],
    ),
    fanOf(
        "Sable Coast",
        "Driftwood",
        ["Shoreline", "Sea Glass", "Low Sun", "Tidepool"],
        [2, 12, 480, 40, 400],
    ),
    fanOf("Copper Lungs", "Breathe In", ["Inhale", "Hold", "Exhale"], [3, 7, 250, 45, 150]),
    fanOf(
        "Polaroid Summer",
        "Overexposed",
        ["Flashbulb", "Sunburn", "Developing"],
        [2, 9, 170, 30, 120],
    ),
    fanOf("Hollow Pines", "Clearing", ["Timberline", "Firewatch", "Rings"], [3, 2, 300, 90]),
    fanOf("Neon Orchard", "Ripe", ["Windfall", "Grafted", "Harvest Moon"], [2, 8, 520, 25, 470]),
    fanOf("Quiet Engines", "Idle", ["Ignition", "Coast", "Redline"], [3, 3, 380, 100]),
    fanOf("Lux Avenue", "Boulevard", ["Streetlamp", "Crosswalk", "Late Bus"], [2, 4, 30, 40]),
    fanOf(
        "Marlowe Fields",
        "Acreage",
        ["Hayride", "Fence Post", "County Line"],
        [2, 5, 440, 50, 330],
    ),
    fanOf("Cinder Choir", "Ashfall", ["Ember", "Soot", "Kindling"], [2, 3, 140, 60]),
    fanOf(
        "Echo Atlas",
        "Cartography",
        ["Meridian", "Contour", "Compass Rose"],
        [1, 6, 560, 20, 500],
    ),
    fanOf("Paper Lions", "Roar Quietly", ["Mane", "Pride", "Savannah"], [2, 2, 220, 80]),
    fanOf("Tin Satellites", "Orbit", ["Apogee", "Perigee", "Telemetry"], [1, 3, 280, 60]),
    fanOf("Wren Hollow", "Nesting", ["Twig", "Fledge", "Morning Call"], [1, 4, 360, 40, 300]),
];

/** How many Scrobbles a Fan logs on `day`, give or take. */
const appetite = (fan: Fan, day: number, weekend: boolean, random: () => number) => {
    if (day < fan.discovered) return 0;
    const burst = fan.peak * Math.exp(-(((day - fan.peakDay) / fan.spread) ** 2));
    const mean = (fan.base + burst) * (weekend ? 1.4 : 1);
    return random() < 0.25 ? 0 : Math.round(mean * (0.4 + random() * 1.2));
};

/** A Listener with a year and a half of made-up but lifelike listening. */
export const sampleListener = (): FixtureUser => {
    const random = mulberry32(2025);
    const start = Date.parse(`${FIRST_DAY}T00:00:00Z`);
    const days = (Date.parse(`${LAST_DAY}T00:00:00Z`) - start) / DAY_MS + 1;
    const history: FixtureScrobble[] = Array.from({ length: days }, (_, day) => {
        const midnight = start + day * DAY_MS;
        const weekend = [0, 6].includes(new Date(midnight).getUTCDay());
        return FANS.flatMap((fan) =>
            Array.from({ length: appetite(fan, day, weekend, random) }, () => ({
                // Spread through the waking hours, 08:00 to 23:59.
                uts: Math.floor((midnight + (8 + random() * 16) * 3_600_000) / 1000),
                artist: fan.artist,
                track: fan.tracks[Math.floor(random() ** 1.6 * fan.tracks.length)]!,
                album: fan.album,
            })),
        );
    }).flat();
    return { username: "sample", history };
};
