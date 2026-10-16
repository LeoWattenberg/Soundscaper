/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createPackage } from '@electron/asar';
import { build } from 'esbuild';

const execFileAsync = promisify(execFile);
const electronPath: unknown = createRequire(import.meta.url)('electron');
const PREFIX = 'assistance/kokoro-g2p/0.9.4/linux-x64';
const MANIFEST_NAME = 'assistance-kokoro-g2p-runtime-manifest.json';
const HELPER_BYTES = Buffer.from('helper closure');

test('Electron reads the packed G2P manifest and reauthenticates its external helper', async (context) => {
	const fixture = await packagedFixture(context);
	const result = await runElectron(fixture, `
		const chunks = await phonemize(request);
		const before = await fs.stat(executable);
		await fs.writeFile(executable, 'tamper closure');
		await fs.utimes(executable, before.atime, before.mtime);
		let mutationError = '';
		try { await phonemize(request); }
		catch (error) { mutationError = error.message; }
		console.log(JSON.stringify({ chunks, mutationError, spawnCalls }));
	`) as { chunks: string[]; mutationError: string; spawnCalls: number };

	assert.deepEqual(result.chunks, ['af_hearthello']);
	assert.match(result.mutationError, /closure file digest changed/u);
	assert.equal(result.spawnCalls, 1, 'changed helper bytes must never reach process launch');
});

test('Electron still authenticates an ordinary manifest inside a directory named app.asar', async (context) => {
	const fixture = await packagedFixture(context, { packed: false });
	assert.deepEqual(await runElectron(fixture, `
		console.log(JSON.stringify(await phonemize(request)));
	`), ['af_hearthello']);
});

test('Electron refuses an oversized packed G2P manifest before helper launch', async (context) => {
	const fixture = await packagedFixture(context);
	const sourceRoot = join(fixture.root, 'source');
	await writeFile(join(sourceRoot, 'config', MANIFEST_NAME), Buffer.alloc(4 * 1024 ** 2 + 1, 0x20));
	await createPackage(sourceRoot, fixture.archivePath);
	const result = await runElectron(fixture, `
		let admissionError = '';
		try { await phonemize(request); }
		catch (error) { admissionError = error.message; }
		console.log(JSON.stringify({ admissionError, spawnCalls }));
	`) as { admissionError: string; spawnCalls: number };

	assert.match(result.admissionError, /manifest is not a regular packaged file/u);
	assert.equal(result.spawnCalls, 0);
});

test('Electron rejects a symbolic archive before launching its external helper', {
	skip: process.platform === 'win32' ? 'Creating Windows symbolic links requires host privileges.' : false,
}, async (context) => {
	const fixture = await packagedFixture(context);
	const linkedArchive = join(fixture.root, 'linked.asar');
	await symlink(fixture.archivePath, linkedArchive);
	fixture.manifestPath = join(linkedArchive, 'config', MANIFEST_NAME);
	const result = await runElectron(fixture, `
		let admissionError = '';
		try { await phonemize(request); }
		catch (error) { admissionError = error.message; }
		console.log(JSON.stringify({ admissionError, spawnCalls }));
	`) as { admissionError: string; spawnCalls: number };

	assert.match(result.admissionError, /canonical|regular|symbolic|archive/u);
	assert.equal(result.spawnCalls, 0);
});

interface Fixture {
	readonly root: string;
	readonly archivePath: string;
	readonly modulePath: string;
	readonly runtimeRoot: string;
	readonly executable: string;
	manifestPath: string;
}

async function packagedFixture(context: TestContext, { packed = true } = {}): Promise<Fixture> {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'soundscaper-g2p-asar-')));
	context.after(() => rm(root, { recursive: true, force: true }));
	const runtimeRoot = join(root, 'runtime');
	const executable = join(runtimeRoot, PREFIX, 'kokoro-g2p');
	await mkdir(dirname(executable), { recursive: true });
	await writeFile(executable, HELPER_BYTES);
	await chmod(executable, 0o755);
	const archivePath = join(root, 'app.asar');
	const sourceRoot = packed ? join(root, 'source') : archivePath;
	const sourceManifest = join(sourceRoot, 'config', MANIFEST_NAME);
	await mkdir(dirname(sourceManifest), { recursive: true });
	await writeFile(sourceManifest, JSON.stringify({
		schemaVersion: 1,
		runtimeVersion: '0.9.4',
		targetId: 'linux-x64',
		runtimePrefix: 'assistance/kokoro-g2p/0.9.4',
		executable: 'kokoro-g2p',
		files: [{ path: 'kokoro-g2p', byteLength: HELPER_BYTES.byteLength,
			sha256: createHash('sha256').update(HELPER_BYTES).digest('hex') }],
	}));
	if (packed) await createPackage(sourceRoot, archivePath);
	const modulePath = join(root, 'phonemizer.mjs');
	const compiled = await build({
		entryPoints: [fileURLToPath(new URL('../desktop/assistance-kokoro-g2p-runtime.ts', import.meta.url))],
		bundle: true,
		platform: 'node',
		format: 'esm',
		packages: 'external',
		write: false,
		logLevel: 'silent',
	});
	const output = compiled.outputFiles[0];
	if (!output) throw new Error('The G2P fixture runtime did not compile.');
	await writeFile(modulePath, output.contents);
	return { root, archivePath, modulePath, runtimeRoot, executable,
		manifestPath: join(archivePath, 'config', MANIFEST_NAME) };
}

async function runElectron(fixture: Fixture, body: string): Promise<unknown> {
	if (typeof electronPath !== 'string') throw new TypeError('Installed Electron executable is unavailable.');
	const script = `
		import * as fs from 'node:fs/promises';
		import { spawn } from 'node:child_process';
		import { createAssistanceKokoroOfflinePhonemizerV1 } from ${JSON.stringify(pathToFileURL(fixture.modulePath).href)};
		process.noAsar = false;
		const executable = ${JSON.stringify(fixture.executable)};
		const request = { language: 'a', voice: 'af_heart', text: 'hello' };
		let spawnCalls = 0;
		const program = "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({schemaVersion:1,chunks:['af_hearthello']})));";
		const phonemize = createAssistanceKokoroOfflinePhonemizerV1({
			manifestPath: ${JSON.stringify(fixture.manifestPath)},
			runtimeRoot: ${JSON.stringify(fixture.runtimeRoot)},
			platform: 'linux', architecture: 'x64',
			spawn: (entry, _args, options) => {
				if (entry !== executable) throw new Error('The G2P executable escaped its fixture.');
				spawnCalls += 1;
				return spawn(process.execPath, ['--input-type=module', '-e', program], {
					...options, env: { ...options.env, ELECTRON_RUN_AS_NODE: '1' },
				});
			},
		});
		${body}
	`;
	const { stdout } = await execFileAsync(electronPath, ['--input-type=module', '-e', script], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		timeout: 30_000,
		maxBuffer: 1024 ** 2,
	});
	return JSON.parse(stdout) as unknown;
}
