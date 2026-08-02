import { describe, it, expect } from 'vitest';
import { stripTypeScriptTypes } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Can Node actually run this?
 *
 * The app starts with `node --experimental-strip-types`, which removes types
 * without rewriting anything. That is a strictly smaller language than the one
 * `tsc` accepts and the one the test runner accepts, because esbuild happily
 * compiles constructs Node will refuse at load time.
 *
 * So neither of the other two gates can catch this. `tsc --noEmit` passed and
 * all 400-odd tests passed on a build that could not boot: a parameter
 * property in one class threw ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX before the
 * first line of `main` ran, and the same command is in the Dockerfile.
 *
 * This asks the runtime itself, using the very function Node uses internally,
 * so it stays honest as the rules change rather than encoding a list of
 * constructs I happened to think of.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

async function typescriptFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await typescriptFiles(path)));
    else if (entry.name.endsWith('.ts')) found.push(path);
  }
  return found;
}

describe('every source file survives type stripping', () => {
  it('finds the files at all, so a passing run means something', async () => {
    expect((await typescriptFiles(SRC)).length).toBeGreaterThan(20);
  });

  it('strips cleanly, which is the only thing that proves the app can start', async () => {
    const failures: Array<{ file: string; error: string }> = [];

    for (const file of await typescriptFiles(SRC)) {
      const source = await readFile(file, 'utf8');
      try {
        stripTypeScriptTypes(source, { mode: 'strip' });
      } catch (err) {
        failures.push({
          file: file.slice(SRC.length),
          error: err instanceof Error ? err.message.split('\n')[0]! : String(err),
        });
      }
    }

    expect(failures).toEqual([]);
  });

  it('would have caught the bug that shipped past tsc and vitest', () => {
    // A parameter property. Valid TypeScript, compiled fine by esbuild, and
    // fatal to `node --experimental-strip-types` at load time.
    expect(() =>
      stripTypeScriptTypes('class A { constructor(private readonly x: number) {} }', {
        mode: 'strip',
      }),
    ).toThrow();

    // The rewritten form, which is what the code uses now.
    expect(() =>
      stripTypeScriptTypes('class A { private readonly x: number; constructor(x: number) { this.x = x; } }', {
        mode: 'strip',
      }),
    ).not.toThrow();
  });

  it('rejects the other constructs stripping cannot handle', () => {
    // Not currently used anywhere, and this is why they should stay that way.
    for (const source of ['enum E { a }', 'namespace N { export const x = 1; }']) {
      expect(() => stripTypeScriptTypes(source, { mode: 'strip' })).toThrow();
    }
  });
});
