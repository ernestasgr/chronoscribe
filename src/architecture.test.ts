import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { expect, test } from "vitest";

/** The modules, lowest first: each may import only those before it. */
const MODULES = [
    "events",
    "ui",
    "lastfm",
    "settings",
    "db",
    "ingest",
    "standings",
    "timeline",
    "chart",
    "app",
];

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(name) ? [path] : [];
    });
}

function specifiers(source: string): string[] {
    const pattern = /(?:from\s*|import\s*\(?\s*|new URL\(\s*)["']([^"']+)["']/g;
    return [...source.matchAll(pattern)].map((match) => match[1]!);
}

/** Every import in `root` that crosses into another module other than through its public surface, or upward. */
function violations(root: string): string[] {
    // The module a path belongs to, counting the module directory itself (an `import "../db"`).
    const moduleOf = (path: string) => {
        const first = relative(root, path).split(sep)[0];
        return first && MODULES.includes(first) ? first : undefined;
    };
    const isPublicSurface = (target: string, module: string) =>
        ["", "index", "index.ts", "index.tsx"].some((name) => join(root, module, name) === target);

    return sourceFiles(root).flatMap((file) => {
        const from = moduleOf(file);
        const name = relative(root, file).split(sep).join("/");
        return specifiers(readFileSync(file, "utf8"))
            .filter((specifier) => specifier.startsWith(".") || specifier.startsWith("@/"))
            .flatMap((specifier) => {
                // `@/` is the Vite and TypeScript alias for `src/`.
                const target = specifier.startsWith("@/")
                    ? join(root, specifier.slice(2))
                    : resolve(dirname(file), specifier);
                const to = moduleOf(target);
                if (!to || to === from) return [];
                if (!isPublicSurface(target, to)) {
                    return [
                        `${name} imports "${specifier}", which bypasses the ${to} public surface`,
                    ];
                }
                if (from && MODULES.indexOf(to) > MODULES.indexOf(from)) {
                    return [`${name} imports "${specifier}", but ${from} sits below ${to}`];
                }
                return [];
            });
    });
}

/** An import or export specifier renamed with `as`, alone on its line or in a one-line list. */
const RENAME = /^\s*(?:import\b|export\s*\{|[\w$]+ as [\w$]+,?$)/;
/** A type assertion, other than `as const`: an expression followed by `as` and a type. */
const ASSERTION = /[\w$)\]]\s+as\s+(?:[A-Z[(]|unknown\b|never\b|any\b)/;
/** A line that is only a comment, where `as` is prose. */
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;
/** A brand constructor: a one-line arrow whose result is asserted to its own return type. */
const BRAND_CONSTRUCTOR = /\): ([\w$]+) =>.* as \1;$/;

/** Every `as` assertion in `root` that is neither a brand constructor nor explained by a `// cast:` comment above it. */
function uncheckedCasts(root: string): string[] {
    return sourceFiles(root)
        .filter((file) => !file.endsWith(".test.ts"))
        .flatMap((file) => {
            const name = relative(root, file).split(sep).join("/");
            const lines = readFileSync(file, "utf8").split(/\r?\n/);
            return lines.flatMap((line, i) => {
                const code = line.replace(/\/\/.*$/, "");
                if (COMMENT.test(line) || RENAME.test(code) || !ASSERTION.test(code)) return [];
                if (BRAND_CONSTRUCTOR.test(code.trimEnd())) return [];
                if (/\/\/ cast: \S/.test(lines[i - 1] ?? "")) return [];
                return [`${name}:${i + 1} asserts a type with no // cast: reason`];
            });
        });
}

test("modules import each other only through their public surface, and only downward", () => {
    expect(violations(resolve(import.meta.dirname))).toEqual([]);
});

test("every directory under src is a known module", () => {
    const dirs = readdirSync(import.meta.dirname).filter((name) =>
        statSync(join(import.meta.dirname, name)).isDirectory(),
    );
    expect(dirs.filter((dir) => !MODULES.includes(dir))).toEqual([]);
});

test("only standings and the chart's line-path loop read the raw table arrays", () => {
    const root = resolve(import.meta.dirname);
    const allowed = [join(root, "chart", "lines.ts")];
    const raw = /\.(?:standing|cumulative|rankOrder|dailyVolume)\s*\[|\.rankOrder\b/;
    const readers = sourceFiles(root)
        .filter((file) => !file.startsWith(join(root, "standings") + sep))
        .filter((file) => !allowed.includes(file) && !file.endsWith(".test.ts"))
        .filter((file) => raw.test(readFileSync(file, "utf8")))
        .map((file) => relative(root, file).split(sep).join("/"));
    expect(readers).toEqual([]);
});

test("the check catches a bypassed public surface and an upward import", () => {
    const root = mkdtempSync(join(tmpdir(), "architecture-"));
    const write = (path: string, source: string) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), source);
    };
    write("db/internal.ts", "export const x = 1;\n");
    write("db/index.ts", 'import { y } from "../ingest";\nexport const z = y;\n');
    write(
        "ingest/index.ts",
        'import { x } from "../db/internal";\nimport "../db";\nexport const y = x;\n',
    );

    // Split so this file's own scan doesn't read the fixture as an import.
    const alias = "@";
    write("app/index.ts", `import { x } from "${alias}/db/internal";\nexport const w = x;\n`);

    expect(violations(root)).toEqual([
        'app/index.ts imports "@/db/internal", which bypasses the db public surface',
        'db/index.ts imports "../ingest", but db sits below ingest',
        'ingest/index.ts imports "../db/internal", which bypasses the db public surface',
    ]);
});

test("every type assertion is a brand constructor or says why with // cast:", () => {
    expect(uncheckedCasts(resolve(import.meta.dirname))).toEqual([]);
});

test("the cast check allows brands, renames and explained casts, and catches the rest", () => {
    const root = mkdtempSync(join(tmpdir(), "casts-"));
    writeFileSync(
        join(root, "fixture.ts"),
        [
            'import { a as b } from "x";',
            "export const meters = (n: number): Meters => n as Meters;",
            "const modes = [1, 2] as const;",
            "// cast: the library types this loosely",
            "const tuple = loose() as [number, number];",
            "const body = (await response.json()) as Body;",
            "",
        ].join("\n"),
    );

    expect(uncheckedCasts(root)).toEqual(["fixture.ts:6 asserts a type with no // cast: reason"]);
});
