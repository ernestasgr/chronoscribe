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
const MODULES = ["lastfm", "db", "ingest", "standings", "timeline", "chart", "app"];

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
            .filter((specifier) => specifier.startsWith("."))
            .flatMap((specifier) => {
                const to = moduleOf(resolve(dirname(file), specifier));
                if (!to || to === from) return [];
                if (!isPublicSurface(resolve(dirname(file), specifier), to)) {
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

test("modules import each other only through their public surface, and only downward", () => {
    expect(violations(resolve(import.meta.dirname))).toEqual([]);
});

test("every directory under src is a known module", () => {
    const dirs = readdirSync(import.meta.dirname).filter((name) =>
        statSync(join(import.meta.dirname, name)).isDirectory(),
    );
    expect(dirs.filter((dir) => !MODULES.includes(dir))).toEqual([]);
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

    expect(violations(root)).toEqual([
        'db/index.ts imports "../ingest", but db sits below ingest',
        'ingest/index.ts imports "../db/internal", which bypasses the db public surface',
    ]);
});
