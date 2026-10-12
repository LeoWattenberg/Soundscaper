/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildWindowsArm64Rcedit, patchRceditLocale } from '../scripts/setup-ci-native-tooling.mjs';

const localeStatement = 'wif.imbue(std::locale(std::locale::empty(), new std::codecvt_utf8<wchar_t>));';

test('the pinned resource editor builds with native Ninja and is admitted before use', async () => {
	const root = await mkdtemp(join(tmpdir(), 'scape-native-rcedit-'));
	try {
		const source = Buffer.from('pinned source archive');
		const pin = { url: 'https://fixture.invalid/rcedit', byteLength: source.length,
			sha256: createHash('sha256').update(source).digest('hex') };
		const env = { RUNNER_TEMP: root, ProgramFiles: join(root, 'Program Files'),
			SystemRoot: join(root, 'Windows'), GITHUB_ENV: join(root, 'env') };
		const commands: { executable: string; args: string[] }[] = [];
		const build = async (machine: number, sourceText = localeStatement) => await buildWindowsArm64Rcedit({
			env, pin, fetchImpl: () => Promise.resolve(new Response(source)),
			runImpl: async (executable: string, args: string[]) => {
				commands.push({ executable, args });
				if (args.includes('-xf')) {
					const directory = join(args[args.indexOf('-C') + 1], 'src');
					await mkdir(directory, { recursive: true });
					await writeFile(join(directory, 'rescle.cc'), sourceText);
				}
				if (args.includes('-S')) {
					const sourceFile = join(args[args.indexOf('-S') + 1], 'src', 'rescle.cc');
					assert.doesNotMatch(await readFile(sourceFile, 'utf8'), /std::locale::empty\(\)/u,
						'MSVC 14.51 removed locale::empty; patch the source before configuring');
				}
				if (args.includes('--build')) {
					const directory = args[args.indexOf('--build') + 1];
					const bytes = Buffer.alloc(128);
					bytes.write('MZ'); bytes.writeUInt32LE(64, 60);
					bytes.write('PE\0\0', 64); bytes.writeUInt16LE(machine, 68);
					await mkdir(directory, { recursive: true });
					await writeFile(join(directory, 'rcedit.exe'), bytes);
				}
				return { stdout: args.includes('--get-version-string') ? 'Soundscaper native resource editor\n' : '', stderr: '' };
			},
		});
		const bin = await build(0xaa64);
		assert.equal(commands[1].args[commands[1].args.indexOf('-G') + 1], 'Ninja');
		assert.ok(commands.some(({ args }) => args[0] === '--help'));
		assert.ok(commands.at(-1)?.args.includes('--get-version-string'));
		assert.deepEqual(await readFile(join(bin, 'rcedit-x64.exe')), await readFile(join(bin, 'rcedit-x86.exe')));
		assert.match(await readFile(env.GITHUB_ENV, 'utf8'), /ELECTRON_BUILDER_RCEDIT_PATH=/u);
		await rm(env.GITHUB_ENV);
		await assert.rejects(build(0x8664), /ARM64/u);
		await assert.rejects(readFile(env.GITHUB_ENV), /ENOENT/u);
		const commandCount = commands.length;
		await assert.rejects(build(0xaa64, 'changed upstream source'), /exact source context/u);
		assert.equal(commands.length, commandCount + 1, 'source drift stops before CMake configuration');
		await assert.rejects(readFile(env.GITHUB_ENV), /ENOENT/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('the locale compatibility patch rejects missing, repeated, and already patched source', () => {
	for (const source of ['', `${localeStatement}\n${localeStatement}`, patchRceditLocale(localeStatement)]) {
		assert.throws(() => patchRceditLocale(source), /exact source context/u);
	}
});

test('the patched locale compiles with the standard library and preserves UTF-8 manifest text', async (context) => {
	if (spawnSync('c++', ['--version'], { encoding: 'utf8' }).status !== 0) {
		context.skip('A C++ compiler is needed for the locale compatibility fixture.');
		return;
	}
	const root = await mkdtemp(join(tmpdir(), 'scape-rcedit-locale-'));
	try {
		const source = join(root, 'locale.cc');
		const executable = join(root, 'locale');
		const manifest = join(root, 'manifest.xml');
		await writeFile(manifest, '<description>Grüße 東京</description>\n');
		await writeFile(source, patchRceditLocale(`
#include <codecvt>
#include <fstream>
#include <locale>
#include <sstream>
int main(int argc, char** argv) {
  if (argc != 2) return 1;
  std::wifstream wif(argv[1]);
  ${localeStatement}
  std::wstringstream wss;
  wss << wif.rdbuf();
  return wss.str() == L"<description>Grüße 東京</description>\\n" ? 0 : 2;
}
`));
		const built = spawnSync('c++', ['-std=c++14', '-Wall', '-Wextra', '-Werror', source, '-o', executable],
			{ encoding: 'utf8', timeout: 30_000 });
		assert.equal(built.status, 0, built.stderr || built.stdout);
		const executed = spawnSync(executable, [manifest], { encoding: 'utf8', timeout: 10_000 });
		assert.equal(executed.status, 0, executed.stderr || executed.stdout);
	} finally { await rm(root, { recursive: true, force: true }); }
});
