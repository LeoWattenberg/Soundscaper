/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildWindowsArm64Rcedit } from '../scripts/setup-ci-native-tooling.mjs';

test('the pinned resource editor builds with native Ninja and is admitted before use', async () => {
	const root = await mkdtemp(join(tmpdir(), 'scape-native-rcedit-'));
	try {
		const source = Buffer.from('pinned source archive');
		const pin = { url: 'https://fixture.invalid/rcedit', byteLength: source.length,
			sha256: createHash('sha256').update(source).digest('hex') };
		const env = { RUNNER_TEMP: root, ProgramFiles: join(root, 'Program Files'),
			SystemRoot: join(root, 'Windows'), GITHUB_ENV: join(root, 'env') };
		const commands: { executable: string; args: string[] }[] = [];
		const build = async (machine: number) => await buildWindowsArm64Rcedit({
			env, pin, fetchImpl: () => Promise.resolve(new Response(source)),
			runImpl: async (executable: string, args: string[]) => {
				commands.push({ executable, args });
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
	} finally { await rm(root, { recursive: true, force: true }); }
});
