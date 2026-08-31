/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
	loadOperatingSystemAudioCodecRuntime,
	mapOperatingSystemAudioCodecOperationResult,
} from '../desktop/os-audio-codec-runtime.ts';
import { createDesktopAudioCodecBroker } from '../desktop/desktop-audio-codec-broker.ts';
import {
	OPERATING_SYSTEM_AAC_M4A_ENCODE_CANARY_SHA256,
	OPERATING_SYSTEM_AAC_M4A_CANARY_SHA256,
	OPERATING_SYSTEM_MP3_ENCODE_CANARY_SHA256,
	OPERATING_SYSTEM_MP3_CANARY_SHA256,
} from '../desktop/os-audio-codec-canary-adapter.ts';
import type {
	OperatingSystemAudioCodecChild,
	OperatingSystemAudioCodecChildConfiguration,
	OperatingSystemAudioCodecTarget,
} from '../desktop/os-audio-codec-operation-runner.ts';
import type { DesktopCodecOperation } from '../src/common/editor/desktop-codec-coordinator.ts';
import {
	aacLcM4a44_100Fixture,
	aacLcM4a48_000Fixture,
	mp3Mpeg1Fixture,
} from './helpers/os-audio-codec-fixtures.ts';

const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
const decoded = new Uint8Array(new Float32Array([0.25, -0.25, 0.5, -0.5]).buffer);
const nativeSelfTest = readFileSync(new URL(
	'../native/soundscaper-professional-host/tests/os_audio_codec_self_test.cpp', import.meta.url,
), 'utf8');

function aacM4aFixture(): Uint8Array {
	const block = /constexpr char aacM4aCanaryBase64\[\] =([\s\S]*?);/u.exec(nativeSelfTest)?.[1];
	assert.ok(block !== undefined);
	const encoded = [...block.matchAll(/"([^"]*)"/gu)].map((match) => match[1]).join('');
	return new Uint8Array(Buffer.from(encoded, 'base64'));
}

const request = Object.freeze({
	operation: 'audio-decode' as const,
	format: 'mp3' as const,
	input: mp3Mpeg1Fixture(1),
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
const aacRequest = Object.freeze({
	operation: 'audio-decode' as const,
	format: 'aac-m4a' as const,
	input: aacM4aFixture(),
	sampleRate: null,
	channelCount: null,
	settings: Object.freeze({ sampleFormat: 'f32le' as const }),
	maximumOutputBytes: 1_024,
	requestId: 'os-aac-one',
});
const aacOperation = Object.freeze({
	direction: 'decode' as const,
	mediaKind: 'audio' as const,
	container: 'm4a',
	codec: 'aac',
	profile: 'lc',
	sampleFormat: 'f32p',
	pixelFormat: null,
	sampleRate: null,
	channelCount: null,
	width: null,
	height: null,
});
const aacEncodeRequest = Object.freeze({
	operation: 'audio-encode' as const,
	format: 'aac-m4a' as const,
	input: decoded,
	sampleRate: 48_000,
	channelCount: 2,
	settings: Object.freeze({ bitrateKbps: 160 }),
	maximumOutputBytes: 4_096,
	requestId: 'os-aac-encode-one',
});
const aacEncodeOperation = Object.freeze({
	direction: 'encode' as const,
	mediaKind: 'audio' as const,
	container: 'm4a',
	codec: 'aac',
	profile: 'lc',
	sampleFormat: 'f32p',
	pixelFormat: null,
	sampleRate: 48_000,
	channelCount: 2,
	width: null,
	height: null,
});
const mp3EncodeRequest = Object.freeze({
	...aacEncodeRequest, format: 'mp3' as const,
	settings: Object.freeze({ bitrateKbps: 192 }), requestId: 'os-mp3-encode-one',
});
const mp3EncodeOperation = Object.freeze({
	...aacEncodeOperation, container: 'mp3', codec: 'mp3', profile: null,
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
				request: Readonly<{
					operation: 'audio-decode' | 'audio-encode'; format: 'mp3' | 'aac-m4a';
					inputSha256: string;
					inputBytes: number; outputPath: string; sampleRate?: number;
					channelCount?: number; bitrateKbps?: number;
				}>;
			}>;
			inputDigests.push(envelope.request.inputSha256);
			const encoding = envelope.request.operation === 'audio-encode';
			const output = encoding
				? envelope.request.format === 'mp3' ? mp3Mpeg1Fixture(1, 11) : aacLcM4a48_000Fixture()
				: decoded;
			void writeFile(envelope.request.outputPath, output, { flag: 'wx' }).then(() => {
				child.emitMessage({
					contractVersion: 1,
					type: 'result',
					result: encoding ? {
						contractVersion: 1,
						status: 'encoded',
						nativeApiReached: true,
						exactTuplePassed: true,
						outputBytes: output.byteLength,
						outputSha256: digest(output),
						encodedTuple: {
							sampleRate: envelope.request.sampleRate,
							channelCount: envelope.request.channelCount,
							frameCount: envelope.request.inputBytes / (2 * Float32Array.BYTES_PER_ELEMENT),
							bitrateKbps: envelope.request.bitrateKbps,
						},
					} : {
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
	assert.equal(verifications, 5);
	assert.deepEqual(inputDigests, [
		OPERATING_SYSTEM_MP3_CANARY_SHA256,
		OPERATING_SYSTEM_AAC_M4A_CANARY_SHA256,
		OPERATING_SYSTEM_AAC_M4A_ENCODE_CANARY_SHA256,
		OPERATING_SYSTEM_MP3_ENCODE_CANARY_SHA256,
		digest(request.input),
	]);
	assert.deepEqual(await readdir(scratchRoot), []);

	const resolvedOutsideCanary = { ...operation, sampleRate: 44_100, channelCount: 2 };
	assert.deepEqual(await runtime.provider.preflight(resolvedOutsideCanary, {}), {
		disposition: 'unsupported',
		reason: 'No exact canary-verified operating-system codec tuple matches this operation.',
	});
});

test('loader verifies and executes AAC-LC M4A through the registered OS runtime', async (context) => {
	const scratchRoot = await scratch(context);
	const inputDigests: string[] = [];
	const runtime = await loadOperatingSystemAudioCodecRuntime({
		target: 'mac-arm64', osVersion: '15.6.1', scratchRoot,
		verifyAddon: async () => ({
			target: 'mac-arm64', path: '/authenticated/soundscaper_professional.node',
			sha256: '1'.repeat(64),
		}),
		spawn: successfulSpawn('mac-arm64', inputDigests),
	});
	assert.notEqual(runtime, null);
	assert.deepEqual(await runtime?.provider.preflight(aacOperation, {}), {
		disposition: 'supported', reason: null,
	});
	assert.equal((await runtime?.provider.preflight(mp3EncodeOperation, {}))?.disposition, 'unsupported');
	assert.deepEqual(await runtime?.preflightRequest?.(aacRequest, { operation: aacOperation }), {
		disposition: 'supported', reason: null,
	});
	assert.deepEqual(await runtime?.execute(aacRequest, { operation: aacOperation }), {
		status: 'executed', output: decoded,
		decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 2 },
	});
	assert.deepEqual(inputDigests, [
		OPERATING_SYSTEM_MP3_CANARY_SHA256,
		OPERATING_SYSTEM_AAC_M4A_CANARY_SHA256,
		OPERATING_SYSTEM_AAC_M4A_ENCODE_CANARY_SHA256,
		digest(aacRequest.input),
	]);
	assert.deepEqual(await readdir(scratchRoot), []);
});

test('loader verifies exact AAC-LC M4A encode and rejects other settings before spawn', async (context) => {
	const scratchRoot = await scratch(context);
	const inputDigests: string[] = [];
	let helperSpawns = 0;
	const spawn = successfulSpawn('win-arm64', inputDigests);
	const runtime = await loadOperatingSystemAudioCodecRuntime({
		target: 'win-arm64', osVersion: '10.0.26100', scratchRoot,
		verifyAddon: async () => ({
			target: 'win-arm64', path: '/authenticated/soundscaper_professional.node',
			sha256: '4'.repeat(64),
		}),
		spawn: (configuration) => { helperSpawns += 1; return spawn(configuration); },
	});
	assert.notEqual(runtime, null);
	assert.deepEqual(await runtime?.provider.preflight(aacEncodeOperation, {}), {
		disposition: 'supported', reason: null,
	});
	assert.deepEqual(await runtime?.preflightRequest?.(
		aacEncodeRequest, { operation: aacEncodeOperation },
	), { disposition: 'supported', reason: null });
	const output = aacLcM4a48_000Fixture();
	assert.deepEqual(await runtime?.execute(aacEncodeRequest, { operation: aacEncodeOperation }), {
		status: 'executed', output,
	});
	assert.deepEqual(await runtime?.provider.preflight(mp3EncodeOperation, {}), {
		disposition: 'supported', reason: null,
	});
	assert.deepEqual(await runtime?.preflightRequest?.(
		mp3EncodeRequest, { operation: mp3EncodeOperation },
	), { disposition: 'supported', reason: null });
	assert.deepEqual(await runtime?.execute(mp3EncodeRequest, { operation: mp3EncodeOperation }), {
		status: 'executed', output: mp3Mpeg1Fixture(1, 11),
	});
	const unsupported = Object.freeze({
		...aacEncodeRequest, settings: Object.freeze({ bitrateKbps: 192 }),
	});
	assert.deepEqual(await runtime?.preflightRequest?.(
		unsupported, { operation: aacEncodeOperation },
	), {
		disposition: 'unsupported',
		reason: 'The OS AAC-LC M4A encoder admits only 48 kHz stereo float PCM at 160 kbps.',
	});
	assert.equal((await runtime?.preflightRequest?.({
		...mp3EncodeRequest, settings: { bitrateKbps: 160 },
	}, { operation: mp3EncodeOperation }))?.disposition, 'unsupported');
	assert.equal(helperSpawns, 6, 'four startup canaries and two exact encodes may spawn');
	assert.deepEqual(inputDigests, [
		OPERATING_SYSTEM_MP3_CANARY_SHA256,
		OPERATING_SYSTEM_AAC_M4A_CANARY_SHA256,
		OPERATING_SYSTEM_AAC_M4A_ENCODE_CANARY_SHA256,
		OPERATING_SYSTEM_MP3_ENCODE_CANARY_SHA256,
		digest(aacEncodeRequest.input),
		digest(mp3EncodeRequest.input),
	]);
	assert.deepEqual(await readdir(scratchRoot), []);
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
		reason: 'The OS audio request does not match its admitted operation.',
	});
	assert.deepEqual(await runtime?.execute(request, { operation: substituted }), {
		status: 'failed', reason: 'security-failed',
		detail: 'The OS audio request does not match its admitted operation.',
	});
	assert.equal(spawns, 4, 'only the four Windows startup canaries may spawn');
});

test('nonverified MP3 source geometry falls through before the OS helper executes', async (context) => {
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
	const outsideTuple = Object.freeze({ ...request, input: mp3Mpeg1Fixture(0) });
	assert.deepEqual(await runtime?.preflightRequest?.(outsideTuple, { operation }), {
		disposition: 'unsupported',
		reason: 'The OS MP3 source geometry is outside the exact canary-verified tuple.',
	});
	assert.deepEqual(await runtime?.preflightRequest?.(
		Object.freeze({ ...request, input: mp3Mpeg1Fixture(1, 9, 3) }), { operation },
	), {
		disposition: 'unsupported',
		reason: 'The OS MP3 source geometry is outside the exact canary-verified tuple.',
	});
	assert.deepEqual(await runtime?.preflightRequest?.(
		Object.freeze({ ...request, input: mp3Mpeg1Fixture(1, 9, 0, 0) }), { operation },
	), {
		disposition: 'unsupported',
		reason: 'The OS MP3 source geometry is outside the exact canary-verified tuple.',
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
	assert.equal(helperSpawns, 4, 'only the four Windows startup canaries may spawn');
});

test('unverified AAC profile falls through before the OS helper executes', async (context) => {
	const scratchRoot = await scratch(context);
	let helperSpawns = 0;
	const spawn = successfulSpawn('win-arm64', []);
	const runtime = await loadOperatingSystemAudioCodecRuntime({
		target: 'win-arm64', osVersion: '10.0.26100', scratchRoot,
		verifyAddon: async () => ({
			target: 'win-arm64', path: '/authenticated/professional.node', sha256: '2'.repeat(64),
		}),
		spawn: (configuration) => { helperSpawns += 1; return spawn(configuration); },
	});
	assert.notEqual(runtime, null);
	const heInput = new Uint8Array(aacRequest.input);
	const config = Buffer.from(heInput).indexOf(Buffer.from('119056e500', 'hex'));
	assert.equal(config, 528);
	heInput[config + 4] = 0x80;
	const heRequest = Object.freeze({ ...aacRequest, input: heInput });
	assert.deepEqual(await runtime?.preflightRequest?.(heRequest, { operation: aacOperation }), {
		disposition: 'unsupported',
		reason: 'The OS AAC-LC M4A source is outside the exact canary-verified tuple.',
	});
	assert.equal(helperSpawns, 4, 'only the four Windows startup canaries may spawn');
});

test('valid unreviewed AAC-LC geometry falls through before the OS helper executes', async (context) => {
	const scratchRoot = await scratch(context);
	let helperSpawns = 0;
	const spawn = successfulSpawn('mac-arm64', []);
	const runtime = await loadOperatingSystemAudioCodecRuntime({
		target: 'mac-arm64', osVersion: '15.6.1', scratchRoot,
		verifyAddon: async () => ({
			target: 'mac-arm64', path: '/authenticated/professional.node', sha256: '3'.repeat(64),
		}),
		spawn: (configuration) => { helperSpawns += 1; return spawn(configuration); },
	});
	assert.notEqual(runtime, null);
	const request44_100 = Object.freeze({ ...aacRequest, input: aacLcM4a44_100Fixture() });
	assert.deepEqual(await runtime?.preflightRequest?.(request44_100, { operation: aacOperation }), {
		disposition: 'unsupported',
		reason: 'The OS AAC-LC M4A source is outside the exact canary-verified tuple.',
	});
	assert.equal(helperSpawns, 3, 'only the three startup canaries may spawn');
});
