/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	loadOperatingSystemAudioCodecRuntime,
	mapOperatingSystemAudioCodecOperationResult,
} from '../desktop/os-audio-codec-runtime.ts';
import { createDesktopAudioCodecBroker } from '../desktop/desktop-audio-codec-broker.ts';
import { OPERATING_SYSTEM_MP3_CANARY_SHA256 } from '../desktop/os-audio-codec-canary-adapter.ts';
import type {
	OperatingSystemAudioCodecChild,
	OperatingSystemAudioCodecChildConfiguration,
	OperatingSystemAudioCodecTarget,
} from '../desktop/os-audio-codec-operation-runner.ts';
import type { DesktopCodecOperation } from '../src/common/editor/desktop-codec-coordinator.ts';

const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const decoded = new Uint8Array(new Float32Array([0.25, -0.25, 0.5, -0.5]).buffer);

function mp3Fixture(
	sampleRateIndex: 0 | 1,
	channelMode = 0,
	secondSampleRateIndex = sampleRateIndex,
): Uint8Array {
	const sampleRate = sampleRateIndex === 0 ? 44_100 : 48_000;
	const secondSampleRate = secondSampleRateIndex === 0 ? 44_100 : 48_000;
	const frameBytes = Math.floor(144_000 * 128 / sampleRate);
	const secondFrameBytes = Math.floor(144_000 * 128 / secondSampleRate);
	const bytes = new Uint8Array(frameBytes + secondFrameBytes);
	const header = 0xffe0_0000 | 3 << 19 | 1 << 17 | 1 << 16
		| 9 << 12 | sampleRateIndex << 10 | channelMode << 6;
	const secondHeader = 0xffe0_0000 | 3 << 19 | 1 << 17 | 1 << 16
		| 9 << 12 | secondSampleRateIndex << 10 | channelMode << 6;
	const view = new DataView(bytes.buffer);
	view.setUint32(0, header, false);
	view.setUint32(frameBytes, secondHeader, false);
	return bytes;
}

const request = Object.freeze({
	operation: 'audio-decode' as const,
	format: 'mp3' as const,
	input: mp3Fixture(1),
	sampleRate: null,
	channelCount: null,
	settings: Object.freeze({ sampleFormat: 'f32le' as const }),
	maximumOutputBytes: 1_024,
	requestId: 'os-mp3-one',
});
const operation = Object.freeze({
	direction: 'decode' as const,
	mediaKind: 'audio' as const,
	container: 'mp3',
	codec: 'mp3',
	profile: null,
	sampleFormat: 'f32',
	pixelFormat: null,
	sampleRate: null,
	channelCount: null,
	width: null,
	height: null,
});

class FakeChild implements OperatingSystemAudioCodecChild {
	readonly posted: unknown[] = [];
	killed = false;
	readonly #onPost: (message: unknown, child: FakeChild) => void;
	readonly #messageListeners = new Set<(message: unknown) => void>();
	readonly #exitListeners = new Set<(code: number | null) => void>();

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
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-os-audio-runtime-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

function successfulSpawn(
	target: OperatingSystemAudioCodecTarget,
	inputDigests: string[],
): (configuration: OperatingSystemAudioCodecChildConfiguration) => OperatingSystemAudioCodecChild {
	return (configuration) => {
		assert.equal(configuration.target, target);
		const child = new FakeChild((message) => {
			const envelope = message as Readonly<{
				request: Readonly<{ inputSha256: string; outputPath: string }>;
			}>;
			inputDigests.push(envelope.request.inputSha256);
			void writeFile(envelope.request.outputPath, decoded, { flag: 'wx' }).then(() => {
				child.emitMessage({
					contractVersion: 1,
					type: 'result',
					result: {
						contractVersion: 1,
						status: 'decoded',
						nativeApiReached: true,
						exactTuplePassed: true,
						outputBytes: decoded.byteLength,
						outputSha256: digest(decoded),
						decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 2 },
					},
				});
				child.emitExit(0);
			});
		});
		queueMicrotask(() => child.emitMessage({ contractVersion: 1, type: 'ready', target }));
		return child;
	};
}

test('loader composes authenticated helper, embedded canary, exact provider, and MP3 decode', async (context) => {
	const scratchRoot = await scratch(context);
	const inputDigests: string[] = [];
	let verifications = 0;
	const runtime = await loadOperatingSystemAudioCodecRuntime({
		target: 'win-x64',
		osVersion: '10.0.26100',
		scratchRoot,
		verifyAddon: async () => {
			verifications += 1;
			return {
				target: 'win-x64',
				path: '/authenticated/soundscaper_professional.node',
				sha256: 'a'.repeat(64),
			};
		},
		spawn: successfulSpawn('win-x64', inputDigests),
	});
	assert.notEqual(runtime, null);
	if (runtime === null) assert.fail('The exact native MP3 canary must admit the runtime.');
	assert.equal(runtime.provider.kind, 'operating-system');
	assert.equal(runtime.provider.id, 'operating-system-codecs-win-x64');
	assert.equal(runtime.provider.implementation, 'windows-media-foundation');
	assert.deepEqual(await runtime.provider.preflight(operation, {}), {
		disposition: 'supported', reason: null,
	});
	assert.deepEqual(await runtime.preflightRequest?.(request, { operation }), {
		disposition: 'supported', reason: null,
	});
	assert.deepEqual(await runtime.execute(request, { operation }), {
		status: 'executed', output: decoded,
		decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 2 },
	});
	assert.equal(verifications, 2);
	assert.deepEqual(inputDigests, [OPERATING_SYSTEM_MP3_CANARY_SHA256, digest(request.input)]);
	assert.deepEqual(await readdir(scratchRoot), []);

	const resolvedOutsideCanary = { ...operation, sampleRate: 44_100, channelCount: 2 };
	assert.deepEqual(await runtime.provider.preflight(resolvedOutsideCanary, {}), {
		disposition: 'unsupported',
		reason: 'No exact canary-qualified operating-system codec tuple matches this operation.',
	});
});

test('loader admits only Windows x64/ARM64 and macOS ARM64 target-native payloads', async (context) => {
	for (const target of ['win-x64', 'win-arm64', 'mac-arm64'] as const) {
		const scratchRoot = await scratch(context);
		const runtime = await loadOperatingSystemAudioCodecRuntime({
			target,
			osVersion: target === 'mac-arm64' ? '15.6.1' : '10.0.26100',
			scratchRoot,
			verifyAddon: async () => ({
				target,
				path: '/authenticated/soundscaper_professional.node',
				sha256: 'b'.repeat(64),
			}),
			spawn: successfulSpawn(target, []),
		});
		assert.notEqual(runtime, null, target);
		assert.equal(runtime?.provider.id, `operating-system-codecs-${target}`);
	}
});

test('loader returns null without payload work on Linux and explicitly unsupported macOS x64', async () => {
	let verifications = 0;
	let spawns = 0;
	for (const target of ['linux-x64', 'linux-arm64', 'mac-x64'] as const) {
		assert.equal(await loadOperatingSystemAudioCodecRuntime({
			target,
			osVersion: 'unused',
			scratchRoot: '/unused',
			verifyAddon: async () => {
				verifications += 1;
				throw new Error('must not run');
			},
			spawn: () => { spawns += 1; throw new Error('must not run'); },
		}), null);
	}
	assert.equal(verifications, 0);
	assert.equal(spawns, 0);
});

test('loader rejects mismatched payload targets and fails closed when payload custody changes after canary', async (context) => {
	const mismatchRoot = await scratch(context);
	let mismatchSpawns = 0;
	assert.equal(await loadOperatingSystemAudioCodecRuntime({
		target: 'win-arm64',
		osVersion: '10.0.26100',
		scratchRoot: mismatchRoot,
		verifyAddon: async () => ({
			target: 'win-x64', path: '/authenticated/professional.node', sha256: 'c'.repeat(64),
		}),
		spawn: () => { mismatchSpawns += 1; return new FakeChild(); },
	}), null);
	assert.equal(mismatchSpawns, 0);

	const changedRoot = await scratch(context);
	let verifications = 0;
	const runtime = await loadOperatingSystemAudioCodecRuntime({
		target: 'mac-arm64',
		osVersion: '15.6.1',
		scratchRoot: changedRoot,
		verifyAddon: async () => {
			verifications += 1;
			if (verifications > 1) throw new Error('payload disappeared after admission');
			return {
				target: 'mac-arm64', path: '/authenticated/professional.node', sha256: 'd'.repeat(64),
			};
		},
		spawn: successfulSpawn('mac-arm64', []),
	});
	assert.notEqual(runtime, null);
	assert.deepEqual(await runtime?.execute(request, { operation }), {
		status: 'failed', reason: 'security-failed',
		detail: 'No authenticated target-native OS audio codec payload is available.',
	});
});

test('post-admission OS runner outcomes map to terminal broker categories except true unavailability', () => {
	const expected = new Map([
		['api-unavailable', 'unavailable'],
		['tuple-unsupported', 'unavailable'],
		['cancelled', 'cancelled'],
		['helper-protocol', 'security-failed'],
		['payload-unavailable', 'security-failed'],
		['request-rejected', 'security-failed'],
		['output-invalid', 'result-failed'],
		['helper-crashed', 'process-failed'],
		['helper-failed', 'process-failed'],
		['helper-timeout', 'process-failed'],
		['spawn-failed', 'process-failed'],
		['busy', 'execution-failed'],
		['cleanup-failed', 'execution-failed'],
		['scratch-failed', 'execution-failed'],
	] as const);
	for (const [reason, brokerReason] of expected) {
		assert.deepEqual(mapOperatingSystemAudioCodecOperationResult({
			status: 'unavailable', reason, detail: `native ${reason}`,
		}), {
			status: 'failed', reason: brokerReason, detail: `native ${reason}`,
		}, reason);
	}
});

test('exact request gate rejects request/operation substitution before helper execution', async (context) => {
	const scratchRoot = await scratch(context);
	let spawns = 0;
	const spawn = successfulSpawn('win-x64', []);
	const runtime = await loadOperatingSystemAudioCodecRuntime({
		target: 'win-x64', osVersion: '10.0.26100', scratchRoot,
		verifyAddon: async () => ({
			target: 'win-x64', path: '/authenticated/professional.node', sha256: 'e'.repeat(64),
		}),
		spawn: (configuration) => { spawns += 1; return spawn(configuration); },
	});
	assert.notEqual(runtime, null);
	const substituted: DesktopCodecOperation = Object.freeze({ ...operation, codec: 'aac' });
	assert.deepEqual(await runtime?.preflightRequest?.(request, { operation: substituted }), {
		disposition: 'rejected',
		reason: 'The OS MP3 request does not match its admitted operation.',
	});
	assert.deepEqual(await runtime?.execute(request, { operation: substituted }), {
		status: 'failed', reason: 'security-failed',
		detail: 'The OS MP3 request does not match its admitted operation.',
	});
	assert.equal(spawns, 1, 'only the startup canary may spawn');
});

test('nonqualified MP3 source geometry falls through before the OS helper executes', async (context) => {
	const scratchRoot = await scratch(context);
	let helperSpawns = 0;
	let externalExecutions = 0;
	const spawn = successfulSpawn('win-x64', []);
	const runtime = await loadOperatingSystemAudioCodecRuntime({
		target: 'win-x64', osVersion: '10.0.26100', scratchRoot,
		verifyAddon: async () => ({
			target: 'win-x64', path: '/authenticated/professional.node', sha256: 'f'.repeat(64),
		}),
		spawn: (configuration) => { helperSpawns += 1; return spawn(configuration); },
	});
	assert.notEqual(runtime, null);
	const outsideTuple = Object.freeze({ ...request, input: mp3Fixture(0) });
	assert.deepEqual(await runtime?.preflightRequest?.(outsideTuple, { operation }), {
		disposition: 'unsupported',
		reason: 'The OS MP3 source geometry is outside the exact canary-qualified tuple.',
	});
	assert.deepEqual(await runtime?.preflightRequest?.(
		Object.freeze({ ...request, input: mp3Fixture(1, 3) }), { operation },
	), {
		disposition: 'unsupported',
		reason: 'The OS MP3 source geometry is outside the exact canary-qualified tuple.',
	});
	assert.deepEqual(await runtime?.preflightRequest?.(
		Object.freeze({ ...request, input: mp3Fixture(1, 0, 0) }), { operation },
	), {
		disposition: 'unsupported',
		reason: 'The OS MP3 source geometry is outside the exact canary-qualified tuple.',
	});
	const unsupportedProvider = Object.freeze({
		kind: 'bundled' as const,
		id: 'bundled-test', implementation: 'test-bundled', version: '1', capabilityGeneration: 'test-1',
		preflight: async () => Object.freeze({
			disposition: 'unsupported' as const, reason: 'not bundled',
		}),
	});
	const externalProvider = Object.freeze({
		kind: 'external-ffmpeg' as const,
		id: 'external-test', implementation: 'test-external', version: '1', capabilityGeneration: 'test-1',
		preflight: async () => Object.freeze({ disposition: 'supported' as const, reason: null }),
	});
	const broker = createDesktopAudioCodecBroker({
		runtimes: [
			{ provider: unsupportedProvider, execute: async () => assert.fail('bundled must not execute') },
			runtime!,
			{
				provider: externalProvider,
				execute: async () => {
					externalExecutions += 1;
					return {
						status: 'executed',
						output: new Uint8Array(new Float32Array([0.25, -0.25]).buffer),
						decodedGeometry: { sampleRate: 44_100, channelCount: 2, frameCount: 1 },
					};
				},
			},
		],
	});
	const result = await broker.execute(outsideTuple);
	assert.equal(result.receipt.provider.kind, 'external-ffmpeg');
	assert.equal(externalExecutions, 1);
	assert.equal(helperSpawns, 1, 'only the startup canary may spawn');
});
