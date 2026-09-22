/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	createAssistanceKokoroOfflinePhonemizerV1,
} from '../desktop/assistance-kokoro-g2p-runtime.ts';
import { createAssistanceRuntimeFamilyThreadWorkerSpawner } from
	'../desktop/assistance-runtime-family-thread-worker.ts';
import { waitFor } from './helpers/async-test-control.ts';

const TARGET = 'linux-x64';
const PREFIX = 'assistance/kokoro-g2p/0.9.4';

async function fixture(t: { after(callback: () => Promise<void>): void }, program: string) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-g2p-'));
	t.after(async () => { await rm(root, { recursive: true, force: true }); });
	const runtimeRoot = join(root, 'runtime');
	const manifestPath = join(root, 'config', 'assistance-kokoro-g2p-runtime-manifest.json');
	const executable = join(runtimeRoot, PREFIX, TARGET, 'kokoro-g2p');
	await mkdir(dirname(executable), { recursive: true });
	await mkdir(dirname(manifestPath), { recursive: true });
	await writeFile(executable, program);
	await chmod(executable, 0o755);
	const bytes = await readFile(executable);
	const manifest = {
		schemaVersion: 1, runtimeVersion: '0.9.4', targetId: TARGET,
		runtimePrefix: PREFIX, executable: 'kokoro-g2p',
		files: [{ path: 'kokoro-g2p', byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex') }],
	};
	await writeFile(manifestPath, JSON.stringify(manifest));
	return { runtimeRoot, manifestPath, executable, manifest };
}

function port(fixtureValue: Awaited<ReturnType<typeof fixture>>) {
	return createAssistanceKokoroOfflinePhonemizerV1({
		manifestPath: fixtureValue.manifestPath,
		runtimeRoot: fixtureValue.runtimeRoot,
		platform: 'linux', architecture: 'x64',
		spawn: (entry, _args, options) => {
			assert.equal(entry, fixtureValue.executable);
			assert.equal(options.shell, false);
			return spawn(process.execPath, [entry], options);
		},
	});
}

const GOOD_PROGRAM = `process.stdin.setEncoding('utf8');
let body = '';
process.stdin.on('data', chunk => body += chunk);
process.stdin.on('end', () => {
 const request = JSON.parse(body);
 process.stdout.write(JSON.stringify({schemaVersion: 1, chunks: [request.voice + request.text]}));
});`;

test('the Kokoro helper receives bounded JSON and returns admitted phoneme chunks', async (t) => {
	const files = await fixture(t, GOOD_PROGRAM);
	const chunks = await port(files)({ language: 'a', voice: 'af_heart', text: 'hello' });
	assert.deepEqual(chunks, ['af_hearthello']);
});

test('the helper closure is authenticated before process launch', async (t) => {
	const files = await fixture(t, GOOD_PROGRAM);
	await writeFile(files.executable, `${GOOD_PROGRAM}\n// modified`);
	let spawned = false;
	const phonemize = createAssistanceKokoroOfflinePhonemizerV1({
		manifestPath: files.manifestPath, runtimeRoot: files.runtimeRoot,
		platform: 'linux', architecture: 'x64',
		spawn: (...args) => { spawned = true; return spawn(...args); },
	});
	await assert.rejects(phonemize({ language: 'a', voice: 'af_heart', text: 'hello' }),
		/authenticat|digest|length/iu);
	assert.equal(spawned, false);
});

test('the helper closure is reauthenticated for each speech request', async (t) => {
	const files = await fixture(t, GOOD_PROGRAM);
	const phonemize = port(files);
	assert.deepEqual(await phonemize({ language: 'a', voice: 'af_heart', text: 'hello' }),
		['af_hearthello']);
	await writeFile(files.executable, `${GOOD_PROGRAM}\n// modified`);
	await assert.rejects(phonemize({ language: 'a', voice: 'af_heart', text: 'again' }),
		/authenticat|digest|length/iu);
});

test('the helper refuses unlisted closure files and foreign target manifests', async (t) => {
	const files = await fixture(t, GOOD_PROGRAM);
	await writeFile(join(dirname(files.executable), 'injected'), 'bad');
	await assert.rejects(port(files)({ language: 'a', voice: 'af_heart', text: 'hello' }),
		/closure|inventory/iu);
	await rm(join(dirname(files.executable), 'injected'));
	await writeFile(files.manifestPath, JSON.stringify({ ...files.manifest, targetId: 'win-x64' }));
	await assert.rejects(port(files)({ language: 'a', voice: 'af_heart', text: 'hello' }),
		/target/iu);
});

test('oversized output and malformed protocol fail closed', async (t) => {
	const files = await fixture(t, "process.stdout.write('x'.repeat(600000));");
	await assert.rejects(port(files)({ language: 'a', voice: 'af_heart', text: 'hello' }),
		/output|stdout|bound/iu);
	await writeFile(files.executable, "process.stdout.write('{bad');");
	const bytes = await readFile(files.executable);
	await writeFile(files.manifestPath, JSON.stringify({ ...files.manifest, files: [{
		path: 'kokoro-g2p', byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	}] }));
	await assert.rejects(port(files)({ language: 'a', voice: 'af_heart', text: 'hello' }),
		/JSON|protocol/iu);
});

test('abort stops the helper and rejects the G2P call', async (t) => {
	const files = await fixture(t, 'process.stdin.resume(); setInterval(() => {}, 1000);');
	const controller = new AbortController();
	const promise = port(files)({ language: 'a', voice: 'af_heart', text: 'hello',
		signal: controller.signal });
	setTimeout(() => controller.abort(), 100);
	await assert.rejects(promise, /abort|cancel/iu);
});

test('a helper that never finishes is terminated at the duration bound', async (t) => {
	const files = await fixture(t, 'process.stdin.resume(); setInterval(() => {}, 1000);');
	const phonemize = createAssistanceKokoroOfflinePhonemizerV1({
		manifestPath: files.manifestPath, runtimeRoot: files.runtimeRoot,
		platform: 'linux', architecture: 'x64', maximumDurationMs: 50,
		spawn: (entry, _args, options) => spawn(process.execPath, [entry], options),
	});
	await assert.rejects(phonemize({ language: 'a', voice: 'af_heart', text: 'hello' }),
		/timed out/iu);
});

test('a missing manifest fails before process launch', async (t) => {
	const files = await fixture(t, GOOD_PROGRAM);
	await rm(files.manifestPath);
	let spawned = false;
	const phonemize = createAssistanceKokoroOfflinePhonemizerV1({
		manifestPath: files.manifestPath, runtimeRoot: files.runtimeRoot,
		platform: 'linux', architecture: 'x64',
		spawn: (...args) => { spawned = true; return spawn(...args); },
	});
	await assert.rejects(phonemize({ language: 'a', voice: 'af_heart', text: 'hello' }));
	assert.equal(spawned, false);
});

test('cancelling the runtime-family thread waits for its hanging G2P child to exit',
	async (t) => await assertThreadStopsG2pChild(t, false));

test('a runtime-family thread protocol violation stops its hanging G2P child',
	async (t) => await assertThreadStopsG2pChild(t, true));

async function assertThreadStopsG2pChild(
	t: { after(callback: () => Promise<void>): void },
	malformedAfterSpawn: boolean,
): Promise<void> {
		const files = await fixture(t,
			"process.on('SIGTERM', () => {}); process.stdin.resume(); setInterval(() => {}, 1000);");
		const pidPath = join(dirname(files.manifestPath), 'child.pid');
		const jobId = '1'.repeat(40);
		const sha = '2'.repeat(64);
		const grant = {
			grantVersion: 1 as const, jobId, familyId: 'onnxruntime-node' as const,
			task: 'text-to-speech' as const,
			settingsJson: JSON.stringify({ manifestPath: files.manifestPath,
				runtimeRoot: files.runtimeRoot, pidPath, malformedAfterSpawn }),
			inputs: [{ claimId: '3'.repeat(40), role: 'text' as const,
				mediaType: 'text/plain', path: '/private/input', byteLength: 1,
				sha256: sha, identity: { dev: '1', ino: '1' } }],
			models: [{ modelId: 'kokoro-82m-v1.0', version: '1.0.0',
				artifactRole: 'network', path: '/private/model', byteLength: 1,
				sha256: sha, identity: { dev: '1', ino: '2' } }],
			outputs: [{ claimId: '4'.repeat(40), role: 'synthesized-audio' as const,
				mediaType: 'audio/wav', path: '/private/output', maximumByteLength: 1_024,
				initialByteLength: 0 as const,
				initialSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
				identity: { dev: '1', ino: '3' } }],
		};
		const descriptor = {
			familyId: 'onnxruntime-node' as const, runtimeVersion: '1.29.0',
			target: 'linux-x64' as const, executionProvider: 'cpu' as const,
			entrypoint: '/runtime/runtime.js', files: [{ path: '/runtime/runtime.js',
				relativePath: 'runtime.js', byteLength: 1, sha256: sha, executable: false }],
		};
		const spawnWorker = createAssistanceRuntimeFamilyThreadWorkerSpawner({
			workerEntry: new URL('./fixtures/kokoro-g2p-thread-cancellation.mjs', import.meta.url),
		});
		const worker = spawnWorker({ protocolVersion: 1, jobId,
			familyId: 'onnxruntime-node', task: 'text-to-speech',
			maximumRssBytes: 1024 ** 3, maximumDurationMs: 60_000, grant, descriptor,
		}, { onProgress: () => undefined });
		const completion = assert.rejects(worker.completion, malformedAfterSpawn
			? /protocol/iu : (error: Error) => error.name === 'AbortError');
		await waitFor(async () => {
			try { return Boolean(await readFile(pidPath, 'utf8')); } catch { return false; }
		}, 'a spawned Kokoro G2P child PID', { turns: 100, delayMs: 20 });
		const pid = Number(await readFile(pidPath, 'utf8'));
		assert.ok(Number.isSafeInteger(pid) && pid > 0);
		await new Promise<void>((resolve) => { setTimeout(resolve, 100); });
		try {
			if (!malformedAfterSpawn) await worker.terminate();
			await completion;
			assert.equal(alive(pid), false, 'G2P child must exit before thread termination resolves');
		} finally {
			if (alive(pid)) process.kill(pid, 'SIGKILL');
		}
}

function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch { return false; }
}
