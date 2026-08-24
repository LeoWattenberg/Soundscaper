/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createOperatingSystemAudioCodecOperationRunner,
	type OperatingSystemAudioCodecChild,
	type OperatingSystemAudioCodecChildConfiguration,
} from '../desktop/os-audio-codec-operation-runner.ts';

const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

class FakeChild implements OperatingSystemAudioCodecChild {
	readonly posted: unknown[] = [];
	killed = false;
	#messageListeners = new Set<(message: unknown) => void>();
	#exitListeners = new Set<(code: number | null) => void>();
	readonly #onPost: (message: unknown, child: FakeChild) => void;

	constructor(onPost: (message: unknown, child: FakeChild) => void = () => undefined) {
		this.#onPost = onPost;
	}

	postMessage(message: unknown): void {
		this.posted.push(message);
		this.#onPost(message, this);
	}

	onMessage(listener: (message: unknown) => void): () => void {
		this.#messageListeners.add(listener);
		return () => this.#messageListeners.delete(listener);
	}

	onExit(listener: (code: number | null) => void): () => void {
		this.#exitListeners.add(listener);
		return () => this.#exitListeners.delete(listener);
	}

	kill(): void {
		this.killed = true;
		queueMicrotask(() => this.emitExit(null));
	}

	emitMessage(message: unknown): void {
		for (const listener of this.#messageListeners) listener(message);
	}

	emitExit(code: number | null): void {
		for (const listener of this.#exitListeners) listener(code);
	}
}

async function scratch(context: TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-os-audio-runner-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

const request = Object.freeze({
	operation: 'audio-decode' as const,
	format: 'mp3' as const,
	input: Uint8Array.of(1, 2, 3, 4),
	sampleRate: null,
	channelCount: null,
	settings: Object.freeze({ sampleFormat: 'f32le' as const }),
	maximumOutputBytes: 1_024,
	requestId: 'decode-one',
});

const descriptor = Object.freeze({
	target: 'mac-arm64' as const,
	path: '/authenticated/soundscaper_professional.node',
	sha256: 'a'.repeat(64),
});

test('runner stages one MP3 job, supervises the helper, and returns authoritative geometry', async (context) => {
	const scratchRoot = await scratch(context);
	const output = new Uint8Array(new Float32Array([0.25, -0.25, 0.5, -0.5]).buffer);
	let spawnedConfiguration: OperatingSystemAudioCodecChildConfiguration | null = null;
	const runner = createOperatingSystemAudioCodecOperationRunner({
		scratchRoot,
		verifyAddon: async () => descriptor,
		spawn: (configuration) => {
			spawnedConfiguration = configuration;
			const child = new FakeChild((message) => {
				const job = message as { request: {
					format: string; inputPath: string; outputPath: string; inputSha256: string;
				} };
				void (async () => {
					assert.equal(job.request.format, 'mp3');
					assert.match(job.request.inputPath, /input\.mp3$/u);
					assert.equal(job.request.inputSha256, digest(request.input));
					await writeFile(job.request.outputPath, output, { flag: 'wx' });
					child.emitMessage({
						contractVersion: 1, type: 'result', result: {
							contractVersion: 1, status: 'decoded', nativeApiReached: true,
							exactTuplePassed: true, outputBytes: output.byteLength,
							outputSha256: digest(output),
							decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 2 },
						},
					});
					child.emitExit(0);
				})();
			});
			queueMicrotask(() => child.emitMessage({
				contractVersion: 1, type: 'ready', target: 'mac-arm64',
			}));
			return child;
		},
	});
	const result = await runner.execute(request);
	assert.deepEqual(spawnedConfiguration, {
		contractVersion: 1, target: 'mac-arm64',
		addonPath: descriptor.path, addonSha256: descriptor.sha256,
	});
	assert.deepEqual(result, {
		status: 'executed', output,
		decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 2 },
	});
	assert.deepEqual(await readdir(scratchRoot), []);
});

test('runner stages AAC M4A through the same supervised one-shot protocol', async (context) => {
	const scratchRoot = await scratch(context);
	const output = new Uint8Array(new Float32Array([0.25, -0.25]).buffer);
	const aacRequest = Object.freeze({ ...request, format: 'aac-m4a' as const, requestId: 'decode-aac' });
	const runner = createOperatingSystemAudioCodecOperationRunner({
		scratchRoot, verifyAddon: async () => descriptor,
		spawn: () => {
			const child = new FakeChild((message) => {
				const job = message as { request: { format: string; inputPath: string; outputPath: string } };
				void (async () => {
					assert.equal(job.request.format, 'aac-m4a');
					assert.match(job.request.inputPath, /input\.m4a$/u);
					await writeFile(job.request.outputPath, output, { flag: 'wx' });
					child.emitMessage({
						contractVersion: 1, type: 'result', result: {
							contractVersion: 1, status: 'decoded', nativeApiReached: true,
							exactTuplePassed: true, outputBytes: output.byteLength,
							outputSha256: digest(output),
							decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 1 },
						},
					});
					child.emitExit(0);
				})();
			});
			queueMicrotask(() => child.emitMessage({
				contractVersion: 1, type: 'ready', target: 'mac-arm64',
			}));
			return child;
		},
	});
	assert.deepEqual(await runner.execute(aacRequest), {
		status: 'executed', output,
		decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 1 },
	});
	assert.deepEqual(await readdir(scratchRoot), []);
});

test('runner fails closed for unavailable payloads and unsupported requests', async (context) => {
	const scratchRoot = await scratch(context);
	let spawns = 0;
	const runner = createOperatingSystemAudioCodecOperationRunner({
		scratchRoot,
		verifyAddon: async () => { throw new Error('pending external'); },
		spawn: () => { spawns += 1; return new FakeChild(); },
	});
	assert.deepEqual(await runner.execute(request), {
		status: 'unavailable', reason: 'payload-unavailable',
		detail: 'No authenticated target-native OS audio codec payload is available.',
	});
	assert.equal(spawns, 0);
	assert.deepEqual(await runner.execute({ ...request, format: 'opus' }), {
		status: 'unavailable', reason: 'request-rejected',
		detail: 'The OS audio codec runtime admits only reviewed MP3 or AAC-LC M4A decode.',
	});
	assert.equal(spawns, 0);
	assert.deepEqual(await readdir(scratchRoot), []);
});

test('runner rejects malformed evidence and output digest mismatches', async (context) => {
	const malformedRoot = await scratch(context);
	let malformedChild: FakeChild;
	const malformed = createOperatingSystemAudioCodecOperationRunner({
		scratchRoot: malformedRoot, verifyAddon: async () => descriptor,
		spawn: () => {
			malformedChild = new FakeChild();
			queueMicrotask(() => malformedChild.emitMessage({
				contractVersion: 1, type: 'ready', target: 'mac-arm64', extra: true,
			}));
			return malformedChild;
		},
	});
	assert.deepEqual(await malformed.execute(request), {
		status: 'unavailable', reason: 'helper-protocol',
		detail: 'The OS audio codec helper violated its closed protocol.',
	});
	assert.equal(malformedChild!.killed, true);

	const digestRoot = await scratch(context);
	const output = new Uint8Array(new Float32Array([0.5]).buffer);
	const changed = createOperatingSystemAudioCodecOperationRunner({
		scratchRoot: digestRoot, verifyAddon: async () => descriptor,
		spawn: () => {
			const child = new FakeChild((message) => {
				const job = message as { request: { outputPath: string } };
				void writeFile(job.request.outputPath, output, { flag: 'wx' }).then(() => {
					child.emitMessage({
						contractVersion: 1, type: 'result', result: {
							contractVersion: 1, status: 'decoded', nativeApiReached: true,
							exactTuplePassed: true, outputBytes: 4, outputSha256: '0'.repeat(64),
							decodedGeometry: { sampleRate: 48_000, channelCount: 1, frameCount: 1 },
						},
					});
					child.emitExit(0);
				});
			});
			queueMicrotask(() => child.emitMessage({
				contractVersion: 1, type: 'ready', target: 'mac-arm64',
			}));
			return child;
		},
	});
	assert.deepEqual(await changed.execute(request), {
		status: 'unavailable', reason: 'output-invalid',
		detail: 'The OS audio codec helper output failed exact authentication.',
	});
});

test('runner kills a hung helper on cancellation and enforces one active job', async (context) => {
	const scratchRoot = await scratch(context);
	let child: FakeChild;
	let resolveSpawn: (() => void) | undefined;
	const spawned = new Promise<void>((resolve) => { resolveSpawn = resolve; });
	const runner = createOperatingSystemAudioCodecOperationRunner({
		scratchRoot, verifyAddon: async () => descriptor,
		spawn: () => {
			child = new FakeChild();
			resolveSpawn?.();
			queueMicrotask(() => child.emitMessage({
				contractVersion: 1, type: 'ready', target: 'mac-arm64',
			}));
			return child;
		},
	});
	const controller = new AbortController();
	const active = runner.execute(request, { signal: controller.signal });
	await spawned;
	assert.deepEqual(await runner.execute(request), {
		status: 'unavailable', reason: 'busy',
		detail: 'Another OS audio codec operation is already active.',
	});
	controller.abort();
	assert.deepEqual(await active, {
		status: 'unavailable', reason: 'cancelled',
		detail: 'The OS audio codec operation was cancelled.',
	});
	assert.equal(child!.killed, true);
	assert.deepEqual(await readdir(scratchRoot), []);
});
