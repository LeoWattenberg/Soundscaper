/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	createBundledAudioCodecOperationRunner,
	type BundledAudioCodecChild,
} from '../desktop/bundled-audio-codec-operation-runner.ts';
import {
	bundledAudioCodecSpec,
	type BundledAudioCodecId,
	type BundledAudioCodecHelperConfiguration,
} from '../desktop/bundled-audio-codec-helper-configuration.ts';

const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

class FakeChild implements BundledAudioCodecChild {
	readonly posted: unknown[] = [];
	killed = false;
	#messages = new Set<(value: unknown) => void>();
	#exits = new Set<(code: number | null) => void>();
	readonly #onPost: (value: unknown, child: FakeChild) => void;

	constructor(onPost: (value: unknown, child: FakeChild) => void = () => undefined) {
		this.#onPost = onPost;
	}

	postMessage(value: unknown): void {
		this.posted.push(value);
		this.#onPost(value, this);
	}

	onMessage(listener: (value: unknown) => void): () => void {
		this.#messages.add(listener);
		return () => this.#messages.delete(listener);
	}

	onExit(listener: (code: number | null) => void): () => void {
		this.#exits.add(listener);
		return () => this.#exits.delete(listener);
	}

	kill(): void { this.killed = true; }
	emitMessage(value: unknown): void { for (const listener of this.#messages) listener(value); }
	emitExit(code: number | null): void { for (const listener of this.#exits) listener(code); }
}

async function scratch(context: TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-bundled-runner-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

const configuration: BundledAudioCodecHelperConfiguration = Object.freeze({
	contractVersion: 1, target: 'linux-x64', codec: 'flac', runtimeRoot: '/app/runtime',
	moduleBytes: 10_000, moduleSha256: 'a'.repeat(64),
	dependencies: Object.freeze(bundledAudioCodecSpec('flac').dependencies.map((path) => Object.freeze({
		path, byteLength: 1_000, sha256: 'c'.repeat(64),
	}))),
	wasmBytes: 153_044, wasmSha256: 'b'.repeat(64),
});

const request = Object.freeze({
	operation: 'audio-decode' as const, format: 'flac' as const,
	input: Uint8Array.of(102, 76, 97, 67), sampleRate: null, channelCount: null,
	settings: Object.freeze({ sampleFormat: 'f32le' as const }),
	maximumOutputBytes: 1_024, requestId: 'isolated-one',
});

const operation = Object.freeze({
	direction: 'decode' as const, mediaKind: 'audio' as const,
	container: 'flac', codec: 'flac', profile: null,
	sampleFormat: 'f32', pixelFormat: null,
	sampleRate: null, channelCount: null, width: null, height: null,
});

test('startup canary verifies, forks once, and drains the terminal helper', async (context) => {
	const scratchRoot = await scratch(context);
	let child: FakeChild;
	let verifications = 0;
	const runner = createBundledAudioCodecOperationRunner({
		target: 'linux-x64', scratchRoot,
		verifyPayload: async (codec: BundledAudioCodecId) => {
			verifications += 1;
			assert.equal(codec, 'flac');
			return configuration;
		},
		spawn: () => {
			child = new FakeChild((message) => {
				assert.deepEqual(message, { contractVersion: 1, type: 'canary' });
				child.emitMessage({
					contractVersion: 1, type: 'result',
					result: { contractVersion: 1, status: 'canary' },
				});
				child.emitExit(0);
			});
			queueMicrotask(() => child.emitMessage({
				contractVersion: 1, type: 'ready', target: 'linux-x64', codec: 'flac',
			}));
			return child;
		},
	});
	assert.equal(await runner.canary('flac'), true);
	assert.equal(verifications, 1);
	assert.equal(child!.killed, false);
	assert.deepEqual(await readdir(scratchRoot), []);
});

test('startup canary uses its short deadline and drains a killed child', async (context) => {
	const scratchRoot = await scratch(context);
	assert.throws(() => createBundledAudioCodecOperationRunner({
		target: 'linux-x64', scratchRoot, verifyPayload: async () => configuration,
		spawn: () => new FakeChild(), canaryDurationMs: 5_001,
	}), /canary duration/iu);
	let child: FakeChild;
	let resolveCanarySpawn: (() => void) | undefined;
	const canarySpawned = new Promise<void>((resolve) => { resolveCanarySpawn = resolve; });
	const runner = createBundledAudioCodecOperationRunner({
		target: 'linux-x64', scratchRoot, verifyPayload: async () => configuration,
		spawn: () => {
			child = new FakeChild();
			resolveCanarySpawn?.();
			queueMicrotask(() => child.emitMessage({
				contractVersion: 1, type: 'ready', target: 'linux-x64', codec: 'flac',
			}));
			return child;
		},
		maximumDurationMs: 1_000, canaryDurationMs: 5, killWaitMs: 50,
	});
	const canary = runner.canary('flac');
	await canarySpawned;
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(child!.killed, true);
	child!.emitExit(null);
	assert.equal(await canary, false);
});

test('runner stages an exact preflight only after the authenticated helper is ready', async (context) => {
	const scratchRoot = await scratch(context);
	let child: FakeChild;
	const runner = createBundledAudioCodecOperationRunner({
		target: 'linux-x64', scratchRoot,
		verifyPayload: async (codec) => {
			assert.equal(codec, 'flac');
			return configuration;
		},
		spawn: (value) => {
			assert.deepEqual(value, configuration);
			child = new FakeChild((message) => {
				const envelope = message as { phase: string; request: {
					inputPath: string; outputPath: string; inputBytes: number; inputSha256: string;
				} };
				assert.equal(envelope.phase, 'preflight');
				assert.match(envelope.request.inputPath, /input\.bin$/u);
				assert.match(envelope.request.outputPath, /output\.bin$/u);
				assert.equal(envelope.request.inputBytes, request.input.byteLength);
				assert.equal(envelope.request.inputSha256, digest(request.input));
				child.emitMessage({
					contractVersion: 1, type: 'result', result: {
						contractVersion: 1, status: 'preflight', disposition: 'supported', reason: null,
					},
				});
				child.emitExit(0);
			});
			queueMicrotask(() => child.emitMessage({
				contractVersion: 1, type: 'ready', target: 'linux-x64', codec: 'flac',
			}));
			return child;
		},
	});
	assert.deepEqual(await runner.preflight('flac', request, operation), {
		disposition: 'supported', reason: null,
	});
	assert.equal(child!.killed, false);
	assert.deepEqual(await readdir(scratchRoot), []);
});

test('runner authenticates execution output and source-authoritative geometry', async (context) => {
	const scratchRoot = await scratch(context);
	const output = new Uint8Array(new Float32Array([0.25, -0.25]).buffer);
	const runner = createBundledAudioCodecOperationRunner({
		target: 'linux-x64', scratchRoot, verifyPayload: async () => configuration,
		spawn: () => {
			const child = new FakeChild((message) => {
				const envelope = message as { phase: string; request: { outputPath: string } };
				assert.equal(envelope.phase, 'execute');
				void writeFile(envelope.request.outputPath, output, { flag: 'wx' }).then(() => {
					child.emitMessage({
						contractVersion: 1, type: 'result', result: {
							contractVersion: 1, status: 'executed', outputBytes: output.byteLength,
							outputSha256: digest(output),
							decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 1 },
						},
					});
					child.emitExit(0);
				});
			});
			queueMicrotask(() => child.emitMessage({
				contractVersion: 1, type: 'ready', target: 'linux-x64', codec: 'flac',
			}));
			return child;
		},
	});
	assert.deepEqual(await runner.execute('flac', request, operation), {
		status: 'executed', output,
		decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 1 },
	});
	assert.deepEqual(await readdir(scratchRoot), []);
});

test('abort kills the helper and waits for child exit before resolving', async (context) => {
	const scratchRoot = await scratch(context);
	let child: FakeChild;
	let ready: (() => void) | undefined;
	const spawned = new Promise<void>((resolve) => { ready = resolve; });
	const runner = createBundledAudioCodecOperationRunner({
		target: 'linux-x64', scratchRoot, verifyPayload: async () => configuration,
		spawn: () => {
			child = new FakeChild();
			queueMicrotask(() => {
				child.emitMessage({
					contractVersion: 1, type: 'ready', target: 'linux-x64', codec: 'flac',
				});
				ready?.();
			});
			return child;
		},
		killWaitMs: 100,
	});
	const controller = new AbortController();
	let settled = false;
	const result = runner.execute('flac', request, operation, { signal: controller.signal })
		.finally(() => { settled = true; });
	await spawned;
	controller.abort();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(child!.killed, true);
	assert.equal(settled, false);
	child!.emitExit(null);
	assert.deepEqual(await result, {
		status: 'failed', reason: 'cancelled', detail: 'The isolated bundled codec job was cancelled.',
	});
	assert.deepEqual(await readdir(scratchRoot), []);
});

test('timeout and malformed or duplicate messages kill and drain the child', async (context) => {
	const timeoutRoot = await scratch(context);
	let timeoutChild: FakeChild;
	let resolveTimeoutSpawn: (() => void) | undefined;
	const timeoutSpawned = new Promise<void>((resolve) => { resolveTimeoutSpawn = resolve; });
	const timeoutRunner = createBundledAudioCodecOperationRunner({
		target: 'linux-x64', scratchRoot: timeoutRoot, verifyPayload: async () => configuration,
		spawn: () => {
			timeoutChild = new FakeChild();
			resolveTimeoutSpawn?.();
			queueMicrotask(() => timeoutChild.emitMessage({
				contractVersion: 1, type: 'ready', target: 'linux-x64', codec: 'flac',
			}));
			return timeoutChild;
		},
		maximumDurationMs: 5, killWaitMs: 20,
	});
	const timeout = timeoutRunner.execute('flac', request, operation);
	await timeoutSpawned;
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(timeoutChild!.killed, true);
	timeoutChild!.emitExit(null);
	assert.deepEqual(await timeout, {
		status: 'failed', reason: 'process-failed', detail: 'The isolated bundled codec helper timed out.',
	});

	const protocolRoot = await scratch(context);
	let protocolChild: FakeChild;
	let resolveProtocolSpawn: (() => void) | undefined;
	const protocolSpawned = new Promise<void>((resolve) => { resolveProtocolSpawn = resolve; });
	const protocolRunner = createBundledAudioCodecOperationRunner({
		target: 'linux-x64', scratchRoot: protocolRoot, verifyPayload: async () => configuration,
		spawn: () => {
			protocolChild = new FakeChild();
			resolveProtocolSpawn?.();
			queueMicrotask(() => protocolChild.emitMessage({
				contractVersion: 1, type: 'ready', target: 'linux-x64', codec: 'flac', extra: true,
			}));
			return protocolChild;
		},
	});
	const malformed = protocolRunner.preflight('flac', request, operation);
	await protocolSpawned;
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(protocolChild!.killed, true);
	protocolChild!.emitExit(null);
	assert.deepEqual(await malformed, {
		disposition: 'rejected', reason: 'The isolated bundled codec helper violated its closed protocol.',
	});

	const duplicateRoot = await scratch(context);
	let resolveDuplicateChild: ((child: FakeChild) => void) | undefined;
	const duplicateSpawned = new Promise<FakeChild>((resolve) => { resolveDuplicateChild = resolve; });
	const duplicateRunner = createBundledAudioCodecOperationRunner({
		target: 'linux-x64', scratchRoot: duplicateRoot, verifyPayload: async () => configuration,
		spawn: () => {
			const child = new FakeChild(() => {
				const terminal = {
					contractVersion: 1, type: 'result', result: {
						contractVersion: 1, status: 'preflight', disposition: 'supported', reason: null,
					},
				};
				child.emitMessage(terminal);
				child.emitMessage(terminal);
			});
			resolveDuplicateChild?.(child);
			queueMicrotask(() => child.emitMessage({
				contractVersion: 1, type: 'ready', target: 'linux-x64', codec: 'flac',
			}));
			return child;
		},
	});
	const duplicate = duplicateRunner.preflight('flac', request, operation);
	const duplicateChild = await duplicateSpawned;
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(duplicateChild!.killed, true);
	duplicateChild!.emitExit(null);
	assert.deepEqual(await duplicate, {
		disposition: 'rejected', reason: 'The isolated bundled codec helper violated its closed protocol.',
	});
});

test('identity and spawn failures reject preflight and remain terminal during execution', async (context) => {
	const scratchRoot = await scratch(context);
	const identity = createBundledAudioCodecOperationRunner({
		target: 'linux-x64', scratchRoot,
		verifyPayload: async () => { throw new Error('changed'); },
		spawn: () => assert.fail('must not spawn'),
	});
	assert.deepEqual(await identity.preflight('flac', request, operation), {
		disposition: 'rejected', reason: 'The isolated bundled codec payload identity changed.',
	});
	assert.deepEqual(await identity.execute('flac', request, operation), {
		status: 'failed', reason: 'security-failed',
		detail: 'The isolated bundled codec payload identity changed.',
	});

	const spawn = createBundledAudioCodecOperationRunner({
		target: 'linux-x64', scratchRoot, verifyPayload: async () => configuration,
		spawn: () => { throw new Error('fork failed'); },
	});
	assert.deepEqual(await spawn.execute('flac', request, operation), {
		status: 'failed', reason: 'process-failed',
		detail: 'The isolated bundled codec helper could not be started.',
	});
});
