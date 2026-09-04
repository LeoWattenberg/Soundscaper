/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	DesktopAudioCodecProviderError,
	createDesktopAudioCodecBroker,
	deriveDesktopAudioCodecOperation,
	type DesktopAudioCodecProviderFailureReason,
	type DesktopAudioCodecProviderRuntime,
} from '../desktop/desktop-audio-codec-broker.ts';
import type {
	DesktopAudioCodecFormat,
	DesktopAudioCodecRequest,
} from '../desktop/desktop-audio-codec-operation-contract.ts';
import {
	DesktopCodecOperationError,
	type DesktopCodecOperation,
	type DesktopCodecPreflightResult,
	type DesktopCodecProvider,
	type DesktopCodecProviderKind,
} from '../src/common/editor/desktop-codec-coordinator.ts';

const FORMATS: readonly DesktopAudioCodecFormat[] = Object.freeze([
	'flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a',
]);

test('all seven closed audio formats derive exact encode and decode operation tuples', () => {
	const expected: Readonly<Record<DesktopAudioCodecFormat, Readonly<{
		readonly container: string;
		readonly codec: string;
		readonly profile: string | null;
		readonly decodeSampleFormat: string;
		readonly encodeSampleFormat: string;
	}>>> = {
		flac: { container: 'flac', codec: 'flac', profile: null, decodeSampleFormat: 'f32', encodeSampleFormat: 's24' },
		mp3: { container: 'mp3', codec: 'mp3', profile: null, decodeSampleFormat: 'f32', encodeSampleFormat: 'f32p' },
		'ogg-vorbis': { container: 'ogg', codec: 'vorbis', profile: null, decodeSampleFormat: 'f32p', encodeSampleFormat: 'f32p' },
		opus: { container: 'ogg', codec: 'opus', profile: null, decodeSampleFormat: 'f32p', encodeSampleFormat: 'f32p' },
		wavpack: { container: 'wavpack', codec: 'wavpack', profile: null, decodeSampleFormat: 'f32', encodeSampleFormat: 'f32' },
		mp2: { container: 'mp2', codec: 'mp2', profile: null, decodeSampleFormat: 'f32', encodeSampleFormat: 'f32p' },
		'aac-m4a': { container: 'm4a', codec: 'aac', profile: 'lc', decodeSampleFormat: 'f32p', encodeSampleFormat: 'f32p' },
	};
	for (const format of FORMATS) {
		for (const direction of ['decode', 'encode'] as const) {
			const operation = deriveDesktopAudioCodecOperation(direction === 'decode'
				? decodeRequest(format)
				: encodeRequest(format));
			assert.deepEqual(operation, {
				direction, mediaKind: 'audio', container: expected[format].container,
				codec: expected[format].codec, profile: expected[format].profile,
				sampleFormat: direction === 'decode'
					? expected[format].decodeSampleFormat
					: expected[format].encodeSampleFormat,
				pixelFormat: null, sampleRate: direction === 'decode' ? null : 48_000,
				channelCount: direction === 'decode' ? null : 2,
				width: null, height: null,
			});
			assert.equal(Object.isFrozen(operation), true);
		}
	}
});

test('preflight falls through in fixed priority and only the selected external runtime executes', async () => {
	const trace: string[] = [];
	const providers = [
		provider('bundled', 'unsupported', trace),
		provider('operating-system', 'unavailable', trace),
		provider('external-ffmpeg', 'supported', trace),
	] as const;
	const input = new Uint8Array(new Float32Array([0.25, -0.25]).buffer);
	const request = { ...encodeRequest('opus'), input, requestId: 'encode-17' };
	const broker = createDesktopAudioCodecBroker({
		runtimes: [
			runtime(providers[0], () => { trace.push('execute:bundled'); return executed([1]); }),
			runtime(providers[1], () => { trace.push('execute:operating-system'); return executed([2]); }),
			runtime(providers[2], () => { trace.push('execute:external-ffmpeg'); return executed([9, 8, 7]); }),
		],
	});

	const outcome = await broker.execute(request);
	assert.deepEqual(trace, [
		'preflight:bundled', 'preflight:operating-system', 'preflight:external-ffmpeg',
		'execute:external-ffmpeg',
	]);
	assert.deepEqual(outcome.result, {
		operation: 'audio-encode', bytes: Uint8Array.of(9, 8, 7), requestId: 'encode-17',
		metadata: {
			kind: 'encoded-audio', format: 'opus', mimeType: 'audio/ogg', fileExtension: '.opus',
			sampleRate: 48_000, channelCount: 2, frameCount: 1,
		},
	});
	assert.deepEqual(outcome.receipt.provider, {
		kind: 'external-ffmpeg', id: 'external-ffmpeg-test',
		implementation: 'external-ffmpeg-test-implementation', version: '1.2.3',
	});
	assert.deepEqual(outcome.receipt.inputDigests, [sha256(input)]);
	assert.equal(outcome.receipt.outputDigest, sha256(Uint8Array.of(9, 8, 7)));
	assert.deepEqual(outcome.receipt.operation, deriveDesktopAudioCodecOperation(request));
	assert.deepEqual(outcome.receipt.settings, { bitrateKbps: 128, vbrMode: 1 });
	assert.equal(Object.isFrozen(outcome.receipt.settings), true);
	assert.equal(outcome.receipt.capabilityGeneration, 'external-ffmpeg-test-generation');
	assert.equal(outcome.receipt.timing, null);
	assert.equal(Object.isFrozen(outcome), true);
	assert.equal(Object.isFrozen(outcome.result), true);
	assert.notEqual(outcome.result.bytes, input);
});

test('request-aware runtime preflight falls through before provider selection and rejects terminally', async () => {
	for (const disposition of ['unsupported', 'rejected'] as const) {
		const trace: string[] = [];
		const bundled = provider('bundled', 'supported', trace);
		const bundledRuntime = Object.freeze({
			provider: bundled,
			preflightRequest() {
				trace.push(`request-preflight:${disposition}`);
				return Promise.resolve({ disposition, reason: `exact-${disposition}` } as const);
			},
			execute() {
				trace.push('execute:bundled');
				return executed([1]);
			},
		}) as DesktopAudioCodecProviderRuntime;
		const broker = createDesktopAudioCodecBroker({ runtimes: [
			bundledRuntime,
			runtime(provider('operating-system', 'unavailable', trace), () => executed([2])),
			runtime(provider('external-ffmpeg', 'supported', trace), () => {
				trace.push('execute:external-ffmpeg');
				return executed([3]);
			}),
		] });

		if (disposition === 'unsupported') {
			const outcome = await broker.execute(encodeRequest('mp3'));
			assert.equal(outcome.receipt.provider.kind, 'external-ffmpeg');
			assert.deepEqual(trace, [
				'preflight:bundled', 'request-preflight:unsupported',
				'preflight:operating-system', 'preflight:external-ffmpeg',
				'execute:external-ffmpeg',
			]);
		} else {
			await assert.rejects(() => broker.execute(encodeRequest('mp3')), (error: unknown) => {
				assert.ok(error instanceof DesktopCodecOperationError);
				assert.equal(error.code, 'DESKTOP_CODEC_PREFLIGHT_REJECTED');
				return true;
			});
			assert.deepEqual(trace, ['preflight:bundled', 'request-preflight:rejected']);
		}
	}
});

test('a supported bundled runtime wins without preflighting or executing lower priorities', async () => {
	const trace: string[] = [];
	const providers = [
		provider('bundled', 'supported', trace),
		provider('operating-system', 'supported', trace),
		provider('external-ffmpeg', 'supported', trace),
	] as const;
	const broker = createDesktopAudioCodecBroker({
		runtimes: [
			runtime(providers[0], () => {
				trace.push('execute:bundled');
				return executed(new Array(8).fill(0), { sampleRate: 48_000, channelCount: 2, frameCount: 1 });
			}),
			runtime(providers[1], () => { trace.push('execute:operating-system'); return executed([2]); }),
			runtime(providers[2], () => { trace.push('execute:external-ffmpeg'); return executed([3]); }),
		],
	});
	const outcome = await broker.execute(decodeRequest('flac'));
	assert.deepEqual(trace, ['preflight:bundled', 'execute:bundled', 'preflight:bundled']);
	assert.equal(outcome.receipt.provider.kind, 'bundled');
	assert.equal(outcome.result.metadata.kind, 'decoded-audio');
	assert.equal(outcome.result.metadata.frameCount, 1);
});

test('decode provider geometry is authoritative for result metadata and the operation receipt', async () => {
	const trace: string[] = [];
	const providers = [
		provider('bundled', 'supported', trace),
		provider('operating-system', 'supported', trace),
		provider('external-ffmpeg', 'supported', trace),
	] as const;
	const broker = createDesktopAudioCodecBroker({ runtimes: [
		runtime(providers[0], () => executed(new Array(8).fill(0), {
			sampleRate: 44_100, channelCount: 1, frameCount: 2,
		})),
		runtime(providers[1], () => executed([2])),
		runtime(providers[2], () => executed([3])),
	] });

	const outcome = await broker.execute(decodeRequest('flac'));
	assert.deepEqual(outcome.result.metadata, {
		kind: 'decoded-audio', sourceFormat: 'flac', sampleFormat: 'f32le',
		interleaving: 'interleaved', sampleRate: 44_100, channelCount: 1, frameCount: 2,
	});
	assert.equal(outcome.receipt.operation.sampleRate, 44_100);
	assert.equal(outcome.receipt.operation.channelCount, 1);
	assert.deepEqual(trace, ['preflight:bundled', 'preflight:bundled']);
});

for (const reason of [
	'unavailable', 'cancelled', 'execution-failed', 'security-failed', 'process-failed', 'result-failed',
] as const satisfies readonly DesktopAudioCodecProviderFailureReason[]) {
	test(`a selected provider ${reason} result is terminal`, async () => {
		const trace: string[] = [];
		const providers = [
			provider('bundled', 'supported', trace),
			provider('operating-system', 'supported', trace),
			provider('external-ffmpeg', 'supported', trace),
		] as const;
		const broker = createDesktopAudioCodecBroker({
			runtimes: [
				runtime(providers[0], () => {
					trace.push('execute:bundled');
					return Promise.resolve({ status: 'failed', reason, detail: `safe-${reason}` });
				}),
				runtime(providers[1], () => { trace.push('execute:operating-system'); return executed([2]); }),
				runtime(providers[2], () => { trace.push('execute:external-ffmpeg'); return executed([3]); }),
			],
		});
		await assert.rejects(() => broker.execute(encodeRequest('flac')), (error: unknown) => {
			assert.ok(error instanceof DesktopAudioCodecProviderError);
			assert.equal(error.providerId, 'bundled-test');
			assert.equal(error.reason, reason);
			return true;
		});
		assert.deepEqual(trace, ['preflight:bundled', 'execute:bundled']);
	});
}

test('throws, malformed execution results, and invalid output bytes are terminal result boundaries', async () => {
	for (const [label, execute, expectedReason] of [
		['throw', () => Promise.reject(new Error('private failure')), 'execution-failed'],
		['malformed', () => Promise.resolve({ status: 'executed', output: Uint8Array.of(1), extra: true }), 'result-failed'],
		['invalid-pcm', () => executed([1, 2, 3], {
			sampleRate: 48_000, channelCount: 2, frameCount: 1,
		}), 'result-failed'],
	] as const) {
		const trace: string[] = [];
		const providers = [
			provider('bundled', 'supported', trace),
			provider('operating-system', 'supported', trace),
			provider('external-ffmpeg', 'supported', trace),
		] as const;
		const broker = createDesktopAudioCodecBroker({ runtimes: [
			runtime(providers[0], () => { trace.push(`execute:${label}`); return execute(); }),
			runtime(providers[1], () => executed([2])),
			runtime(providers[2], () => executed([3])),
		] });
		await assert.rejects(() => broker.execute(decodeRequest('mp3')), (error: unknown) => {
			assert.ok(error instanceof DesktopAudioCodecProviderError);
			assert.equal(error.reason, expectedReason);
			return true;
		});
		assert.deepEqual(trace, ['preflight:bundled', `execute:${label}`]);
	}
});

test('all preflight unsupported or unavailable outcomes preserve coordinator attempt evidence', async () => {
	const trace: string[] = [];
	const providers = [
		provider('bundled', 'unsupported', trace),
		provider('operating-system', 'unavailable', trace),
		provider('external-ffmpeg', 'unsupported', trace),
	] as const;
	const broker = createDesktopAudioCodecBroker({ runtimes: [
		runtime(providers[0], () => executed([1])),
		runtime(providers[1], () => executed([2])),
		runtime(providers[2], () => executed([3])),
	] });
	await assert.rejects(() => broker.execute(encodeRequest('mp3')), (error: unknown) => {
		assert.ok(error instanceof DesktopCodecOperationError);
		assert.equal(error.code, 'DESKTOP_CODEC_UNAVAILABLE');
		assert.deepEqual(error.attempts.map(({ providerKind, disposition }) => ({ providerKind, disposition })), [
			{ providerKind: 'bundled', disposition: 'unsupported' },
			{ providerKind: 'operating-system', disposition: 'unavailable' },
			{ providerKind: 'external-ffmpeg', disposition: 'unsupported' },
		]);
		return true;
	});
	assert.deepEqual(trace, [
		'preflight:bundled', 'preflight:operating-system', 'preflight:external-ffmpeg',
	]);
});

test('broker construction rejects missing, reordered, or mismatched provider runtimes', () => {
	const bundled = provider('bundled', 'supported', []);
	const operatingSystem = provider('operating-system', 'supported', []);
	const external = provider('external-ffmpeg', 'supported', []);
	assert.throws(() => createDesktopAudioCodecBroker({
		runtimes: [runtime(bundled, () => executed([1]))] as unknown as readonly [
			DesktopAudioCodecProviderRuntime, DesktopAudioCodecProviderRuntime, DesktopAudioCodecProviderRuntime,
		],
	}), /three.*ordered/iu);
	assert.throws(() => createDesktopAudioCodecBroker({ runtimes: [
		runtime(operatingSystem, () => executed([1])),
		runtime(bundled, () => executed([1])),
		runtime(external, () => executed([1])),
	] }), /three.*ordered/iu);
});

function provider(
	kind: DesktopCodecProviderKind,
	disposition: DesktopCodecPreflightResult['disposition'],
	trace: string[],
): DesktopCodecProvider {
	return Object.freeze({
		kind, id: `${kind}-test`, implementation: `${kind}-test-implementation`,
		version: '1.2.3', capabilityGeneration: `${kind}-test-generation`,
		preflight(_operation: DesktopCodecOperation): Promise<DesktopCodecPreflightResult> {
			trace.push(`preflight:${kind}`);
			return Promise.resolve(disposition === 'supported'
				? { disposition, reason: null }
				: { disposition, reason: `${kind}-${disposition}` });
		},
	});
}

function runtime(
	providerValue: DesktopCodecProvider,
	execute: DesktopAudioCodecProviderRuntime['execute'],
): DesktopAudioCodecProviderRuntime {
	return Object.freeze({ provider: providerValue, execute });
}

function executed(
	bytes: readonly number[],
	decodedGeometry?: Readonly<{ readonly sampleRate: number; readonly channelCount: number; readonly frameCount: number }>,
): Promise<Readonly<{
	readonly status: 'executed'; readonly output: Uint8Array;
	readonly decodedGeometry?: Readonly<{ readonly sampleRate: number; readonly channelCount: number; readonly frameCount: number }>;
}>> {
	return Promise.resolve({
		status: 'executed', output: Uint8Array.from(bytes),
		...(decodedGeometry === undefined ? {} : { decodedGeometry }),
	});
}

function decodeRequest(format: DesktopAudioCodecFormat): DesktopAudioCodecRequest {
	return {
		operation: 'audio-decode', format, input: Uint8Array.of(1, 2, 3),
		sampleRate: null, channelCount: null, settings: { sampleFormat: 'f32le' },
		maximumOutputBytes: 1_024,
	};
}

function encodeRequest(format: DesktopAudioCodecFormat): DesktopAudioCodecRequest {
	const settings = format === 'flac' ? { compressionLevel: 5, bitDepth: 24 as const }
		: format === 'wavpack' ? { compressionLevel: 5 }
		: format === 'ogg-vorbis' ? { quality: 7 }
			: format === 'opus' ? { bitrateKbps: 128, vbrMode: 1 }
				: { bitrateKbps: format === 'mp2' ? 192 : 128 };
	return {
		operation: 'audio-encode', format, input: new Uint8Array(new Float32Array([0.25, -0.25]).buffer),
		sampleRate: 48_000, channelCount: 2, settings, maximumOutputBytes: 1_024,
	} as DesktopAudioCodecRequest;
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
