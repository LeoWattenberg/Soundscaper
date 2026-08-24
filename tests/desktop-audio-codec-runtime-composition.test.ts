/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopAudioCodecRuntimeComposition,
	type DesktopAudioCodecRuntimeFactory,
} from '../desktop/desktop-audio-codec-runtime-composition.ts';
import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';
import type { DesktopAudioCodecRequest } from '../desktop/desktop-audio-codec-operation-contract.ts';
import { DesktopAudioCodecProviderError } from '../desktop/desktop-audio-codec-broker.ts';
import type {
	ExternalFfmpegAudioOperationRunner,
	ExternalFfmpegAudioOperationRunnerOptions,
} from '../desktop/external-ffmpeg-audio-operation-runner.ts';
import type {
	ExternalFfmpegPreferenceService,
	ExternalFfmpegRuntimeAdmission,
} from '../desktop/external-ffmpeg-preference-service.ts';
import {
	DesktopCodecOperationError,
	type DesktopCodecPreflightResult,
	type DesktopCodecProvider,
	type DesktopCodecProviderKind,
} from '../src/common/editor/desktop-codec-coordinator.ts';

const SCRATCH = '/private/soundscaper-codecs';

test('capability status is fail-closed, sanitized, and uses one admission snapshot', async () => {
	let admissionReads = 0;
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'linux-x64', scratchRoot: SCRATCH,
		externalFfmpegPreferences: preferences(() => { admissionReads += 1; return null; }),
	});
	const result = await service.capabilities(capabilityQuery());
	assert.equal(admissionReads, 1);
	assert.equal(result.capabilities.every((entry) => !entry.available), true);
	assert.equal(result.capabilities.every((entry) => entry.provider === null
		&& entry.reason === 'configure-external-ffmpeg'), true);
	assert.equal(JSON.stringify(result).includes('path'), false);
	assert.deepEqual(Reflect.ownKeys(result.capabilities[0] ?? {}), [
		'operation', 'format', 'sampleRate', 'channelCount', 'available', 'provider', 'reason',
	]);
});

test('capability status exposes only exact tuples admitted by the probed FFmpeg snapshot', async () => {
	let runnerFactories = 0;
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'linux-x64', scratchRoot: SCRATCH,
		externalFfmpegPreferences: preferences(() => opusAdmission('/private/ffmpeg')),
		createExternalRunner() { runnerFactories += 1; return neverRunner(); },
	});
	const result = await service.capabilities(capabilityQuery());
	assert.deepEqual(result.capabilities.map(({ operation, format, available, provider, reason }) => ({
		operation, format, available, provider, reason,
	})), [
		{ operation: 'audio-encode', format: 'opus', available: true, provider: 'external-ffmpeg', reason: null },
		{ operation: 'audio-decode', format: 'opus', available: true, provider: 'external-ffmpeg', reason: null },
		{ operation: 'audio-encode', format: 'flac', available: false, provider: null, reason: 'unsupported-by-configured-ffmpeg' },
		{ operation: 'audio-decode', format: 'flac', available: false, provider: null, reason: 'unsupported-by-configured-ffmpeg' },
	]);
	assert.equal(runnerFactories, 0, 'status must never construct or launch the external runner');
});

test('capability status preserves bundled then operating-system provider priority', async () => {
	const trace: string[] = [];
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'mac-arm64', scratchRoot: SCRATCH,
		createBundledRuntime: runtimeFactory('bundled', 'unsupported', trace, Uint8Array.of(1)),
		createOperatingSystemRuntime: runtimeFactory('operating-system', 'supported', trace, Uint8Array.of(2)),
		externalFfmpegPreferences: preferences(() => opusAdmission('/private/ffmpeg')),
	});
	const query = capabilityQuery();
	const result = await service.capabilities({ ...query, operations: [query.operations[0]!] });
	assert.equal(result.capabilities[0]?.provider, 'operating-system');
	assert.deepEqual(trace, ['preflight:bundled', 'preflight:operating-system']);
});

test('missing native factories and FFmpeg admission fail closed in all three priority tiers', async () => {
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'linux-x64', scratchRoot: SCRATCH,
		externalFfmpegPreferences: preferences(() => null),
	});
	await assert.rejects(() => service.execute(encodeRequest('flac'), executionOptions()), (error: unknown) => {
		assert.ok(error instanceof DesktopCodecOperationError);
		assert.deepEqual(error.attempts.map(({ providerKind, disposition }) => ({ providerKind, disposition })), [
			{ providerKind: 'bundled', disposition: 'unavailable' },
			{ providerKind: 'operating-system', disposition: 'unavailable' },
			{ providerKind: 'external-ffmpeg', disposition: 'unavailable' },
		]);
		return true;
	});
});

test('a bundled runtime wins and its receipt remains in the main-owned observation callback', async () => {
	const trace: string[] = [];
	const observations: unknown[] = [];
	const bundled = runtimeFactory('bundled', 'supported', trace, Uint8Array.of(7, 8));
	const operatingSystem = runtimeFactory('operating-system', 'supported', trace, Uint8Array.of(3));
	let externalRunnerFactories = 0;
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'mac-arm64', scratchRoot: SCRATCH,
		createBundledRuntime: bundled,
		createOperatingSystemRuntime: operatingSystem,
		externalFfmpegPreferences: preferences(() => opusAdmission('/tools/ffmpeg-a')),
		createExternalRunner() { externalRunnerFactories += 1; return neverRunner(); },
		onReceipt: (observation) => { observations.push(observation); },
	});
	const result = await service.execute(encodeRequest('flac'), executionOptions());
	assert.deepEqual(result.bytes, Uint8Array.of(7, 8));
	assert.deepEqual(Reflect.ownKeys(result), ['operation', 'bytes', 'metadata', 'requestId']);
	assert.deepEqual(trace, ['preflight:bundled', 'execute:bundled']);
	assert.equal(externalRunnerFactories, 0, 'the external process adapter stays lazy');
	assert.equal(observations.length, 1);
	assert.equal((observations[0] as { receipt: { provider: { kind: string } } }).receipt.provider.kind, 'bundled');
	assert.equal(Object.isFrozen(observations[0]), true);
});

test('an operating-system runtime is second priority and external FFmpeg remains untouched', async () => {
	const trace: string[] = [];
	let externalExecutions = 0;
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'win-arm64', scratchRoot: SCRATCH,
		createBundledRuntime: runtimeFactory('bundled', 'unsupported', trace, Uint8Array.of(1)),
		createOperatingSystemRuntime: runtimeFactory('operating-system', 'supported', trace, Uint8Array.of(5)),
		externalFfmpegPreferences: preferences(() => opusAdmission('C:\\Tools\\ffmpeg.exe')),
		createExternalRunner() {
			return { execute: () => { externalExecutions += 1; return Promise.resolve({
				status: 'executed', output: Uint8Array.of(9), log: '',
			}); } };
		},
	});
	const result = await service.execute(encodeRequest('opus'), executionOptions());
	assert.deepEqual(result.bytes, Uint8Array.of(5));
	assert.deepEqual(trace, [
		'preflight:bundled', 'preflight:operating-system', 'execute:operating-system',
	]);
	assert.equal(externalExecutions, 0);
});

test('external execution uses one immutable admission snapshot and the fixed path adapter', async () => {
	const first = opusAdmission('/opt/homebrew/bin/ffmpeg', '9.0.1', '4');
	const second = opusAdmission('/managed/ffmpeg', '8.1.1', '5');
	let current: ExternalFfmpegRuntimeAdmission | null = first;
	let admissionReads = 0;
	const executablePaths: string[] = [];
	const observations: Array<Readonly<{ readonly receipt: { readonly provider: { readonly version: string } } }>> = [];
	let capturedRunnerOptions: ExternalFfmpegAudioOperationRunnerOptions<DesktopAudioCodecRequest> | null = null;
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'mac-arm64', scratchRoot: SCRATCH,
		externalFfmpegPreferences: preferences(() => { admissionReads += 1; return current; }),
		createExternalRunner(options) {
			capturedRunnerOptions = options;
			return {
				async execute(invocation) {
					current = second;
					const executable = await options.getAdmittedExecutable();
					assert.ok(executable);
					executablePaths.push(executable.executablePath);
					assert.equal(executable.ffmpegSha256, first.identity.ffmpegSha256);
					const admission = options.contract.admitOperation(invocation.operation);
					assert.equal(admission.status, 'admitted');
					if (admission.status !== 'admitted') throw new Error('fixed contract rejected its request');
					assert.equal(options.contract.maximumOutputBytes?.(admission.operation), 1_024);
					const files = {
						inputPath: '/private/job/input.media', outputPath: '/private/job/output.media',
						maximumOutputBytes: 1_024,
					};
					const argv = options.contract.buildArguments(admission.operation, files);
					assert.ok(Array.isArray(argv));
					if (!Array.isArray(argv)) throw new Error('fixed contract did not build argv');
					assert.equal(argv.includes('soundscaper-codec-input.media'), false);
					assert.equal(argv.some((entry) => String(entry).startsWith('soundscaper-codec-output')), false);
					assert.equal(argv.includes(files.inputPath), true);
					assert.equal(argv.at(-1), files.outputPath);
					assert.equal(argv.includes('-xerror'), true);
					assert.equal(argv.includes('-fs'), false, 'the runner owns the final output cap');
					assert.equal(options.contract.validateArguments(argv, admission.operation, files), true);
					assert.equal(options.contract.validateArguments([...argv, '-report'], admission.operation, files), false);
					return { status: 'executed', output: Uint8Array.of(2, 4, 6), log: 'private log' };
				},
			};
		},
		onReceipt: (observation) => { observations.push(observation); },
	});

	const result = await service.execute(encodeRequest('opus'), executionOptions());
	assert.deepEqual(result.bytes, Uint8Array.of(2, 4, 6));
	assert.equal(admissionReads, 1);
	assert.deepEqual(executablePaths, [first.executablePath]);
	assert.ok(capturedRunnerOptions);
	const runnerOptions = capturedRunnerOptions as unknown as ExternalFfmpegAudioOperationRunnerOptions<DesktopAudioCodecRequest>;
	assert.equal(runnerOptions.maximumInputBytes, 32 * 1_024 * 1_024);
	assert.equal(runnerOptions.maximumOutputBytes, 129 * 1_024 * 1_024);
	assert.equal(observations[0]?.receipt.provider.version, '9.0.1');
	assert.equal('receipt' in result, false);
});

test('external decode preserves float-WAV source geometry without resampling or remixing', async () => {
	const pcm = new Uint8Array(Float32Array.from([0.25, -0.5, 0.75]).buffer);
	const wave = floatWave(44_100, 1, pcm);
	const observations: Array<Readonly<{ readonly receipt: {
		readonly operation: { readonly sampleRate: number | null; readonly channelCount: number | null };
	} }>> = [];
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'linux-x64', scratchRoot: SCRATCH,
		externalFfmpegPreferences: preferences(() => opusAdmission('/tools/ffmpeg')),
		createExternalRunner: (options) => ({
			execute(invocation) {
				const admitted = options.contract.admitOperation(invocation.operation);
				assert.equal(admitted.status, 'admitted');
				if (admitted.status !== 'admitted') throw new Error('decode request rejected');
				assert.equal(admitted.operation.sampleRate, null);
				assert.equal(admitted.operation.channelCount, null);
				const maximumOutputBytes = options.contract.maximumOutputBytes?.(admitted.operation);
				assert.equal(maximumOutputBytes, 1_024 * 1_024 + 1_024);
				if (maximumOutputBytes === undefined) throw new Error('decode output bound unavailable');
				const files = {
					inputPath: '/private/job/input.media', outputPath: '/private/job/output.media',
					maximumOutputBytes,
				};
				const argv = options.contract.buildArguments(admitted.operation, files);
				assert.ok(Array.isArray(argv));
				if (!Array.isArray(argv)) throw new Error('decode argv unavailable');
				assert.equal(argv.includes('-ar'), false);
				assert.equal(argv.includes('-ac'), false);
				assert.equal(argv.includes('-af'), false);
				assert.equal(argv.includes('wav'), true);
				return Promise.resolve({ status: 'executed', output: wave, log: '' });
			},
		}),
		onReceipt: (observation) => { observations.push(observation); },
	});

	const result = await service.execute(decodeRequest('opus'), executionOptions());
	assert.deepEqual(result.bytes, pcm);
	assert.deepEqual(result.metadata, {
		kind: 'decoded-audio', sourceFormat: 'opus', sampleFormat: 'f32le',
		interleaving: 'interleaved', sampleRate: 44_100, channelCount: 1, frameCount: 3,
	});
	assert.equal(observations[0]?.receipt.operation.sampleRate, 44_100);
	assert.equal(observations[0]?.receipt.operation.channelCount, 1);
});

test('malformed external decode geometry is terminal at the selected provider', async () => {
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'linux-x64', scratchRoot: SCRATCH,
		externalFfmpegPreferences: preferences(() => opusAdmission('/tools/ffmpeg')),
		createExternalRunner: () => ({
			execute: () => Promise.resolve({
				status: 'executed', output: Uint8Array.of(1, 2, 3), log: '',
			}),
		}),
	});
	await assert.rejects(() => service.execute(decodeRequest('opus'), executionOptions()), (error: unknown) => {
		assert.ok(error instanceof DesktopAudioCodecProviderError);
		assert.equal(error.providerKind, 'external-ffmpeg');
		assert.equal(error.reason, 'result-failed');
		return true;
	});
});

test('an admitted FFmpeg missing one exact tuple component stays unsupported and never launches', async () => {
	const admission = opusAdmission('/tools/ffmpeg');
	const missingEncoder = {
		...admission,
		capabilities: { ...admission.capabilities, encoders: [] },
	};
	let runnerFactories = 0;
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'linux-arm64', scratchRoot: SCRATCH,
		externalFfmpegPreferences: preferences(() => missingEncoder),
		createExternalRunner() { runnerFactories += 1; return neverRunner(); },
	});
	await assert.rejects(() => service.execute(encodeRequest('opus'), executionOptions()), (error: unknown) => {
		assert.ok(error instanceof DesktopCodecOperationError);
		assert.equal(error.attempts.at(-1)?.providerKind, 'external-ffmpeg');
		assert.equal(error.attempts.at(-1)?.disposition, 'unsupported');
		return true;
	});
	assert.equal(runnerFactories, 0);
});

for (const [runnerReason, brokerReason] of [
	['executable-unavailable', 'unavailable'],
	['cancelled', 'cancelled'],
	['identity-changed', 'security-failed'],
	['process-failed', 'process-failed'],
	['output-invalid', 'result-failed'],
	['scratch-failed', 'execution-failed'],
] as const) {
	test(`runner ${runnerReason} maps to terminal broker ${brokerReason}`, async () => {
		let observations = 0;
		const admission = opusAdmission('/tools/ffmpeg');
		const invalidations: Array<Readonly<{
			readonly admission: ExternalFfmpegRuntimeAdmission;
			readonly reason: 'identity-changed' | 'executable-unavailable';
		}>> = [];
		const service = createDesktopAudioCodecRuntimeComposition({
			target: 'linux-x64', scratchRoot: SCRATCH,
			externalFfmpegPreferences: preferences(() => admission, async (failed, reason) => {
				await Promise.resolve();
				invalidations.push({ admission: failed, reason });
				return preferenceStatus('quarantined');
			}),
			createExternalRunner: () => ({
				execute: () => Promise.resolve({
					status: 'unavailable', reason: runnerReason,
					detail: `safe-${runnerReason}`, log: '',
				}),
			}),
			onReceipt: () => { observations += 1; },
		});
		await assert.rejects(() => service.execute(encodeRequest('opus'), executionOptions()), (error: unknown) => {
			assert.ok(error instanceof DesktopAudioCodecProviderError);
			assert.equal(error.providerKind, 'external-ffmpeg');
			assert.equal(error.reason, brokerReason);
			return true;
		});
		assert.equal(observations, 0);
		if (runnerReason === 'identity-changed' || runnerReason === 'executable-unavailable') {
			assert.equal(invalidations.length, 1);
			assert.deepEqual(invalidations[0]?.admission, admission);
			assert.equal(invalidations[0]?.reason, runnerReason);
		} else assert.deepEqual(invalidations, []);
	});
}

test('a failed FFmpeg quarantine escalates executable loss to a security failure', async () => {
	const service = createDesktopAudioCodecRuntimeComposition({
		target: 'linux-x64', scratchRoot: SCRATCH,
		externalFfmpegPreferences: preferences(
			() => opusAdmission('/tools/ffmpeg'),
			() => Promise.reject(new Error('settings unavailable')),
		),
		createExternalRunner: () => ({
			execute: () => Promise.resolve({
				status: 'unavailable', reason: 'executable-unavailable',
				detail: 'executable unavailable', log: '',
			}),
		}),
	});
	await assert.rejects(() => service.execute(encodeRequest('opus'), executionOptions()), (error: unknown) => {
		assert.ok(error instanceof DesktopAudioCodecProviderError);
		assert.equal(error.reason, 'security-failed');
		assert.match(error.message, /could not be quarantined/iu);
		return true;
	});
});

test('macOS x64 and provider factories returning the wrong tier are rejected', () => {
	assert.throws(() => createDesktopAudioCodecRuntimeComposition({
		target: 'mac-x64' as 'mac-arm64', scratchRoot: SCRATCH,
		externalFfmpegPreferences: preferences(() => null),
	}), /target/iu);
	assert.throws(() => createDesktopAudioCodecRuntimeComposition({
		target: 'linux-x64', scratchRoot: SCRATCH,
		createBundledRuntime: runtimeFactory('operating-system', 'unavailable', [], Uint8Array.of(1)),
		externalFfmpegPreferences: preferences(() => null),
	}), /bundled.*runtime/iu);
});

function runtimeFactory(
	kind: DesktopCodecProviderKind,
	disposition: DesktopCodecPreflightResult['disposition'],
	trace: string[],
	output: Uint8Array,
): DesktopAudioCodecRuntimeFactory {
	return ({ target }) => ({
		provider: provider(kind, target, disposition, trace),
		execute: () => { trace.push(`execute:${kind}`); return Promise.resolve({ status: 'executed', output }); },
	});
}

function provider(
	kind: DesktopCodecProviderKind,
	target: string,
	disposition: DesktopCodecPreflightResult['disposition'],
	trace: string[],
): DesktopCodecProvider {
	return {
		kind, id: `${kind}-${target}`, implementation: `${kind}-test-runtime`,
		version: '1.0.0', capabilityGeneration: `${kind}-${target}-generation`,
		preflight: () => {
			trace.push(`preflight:${kind}`);
			return Promise.resolve(disposition === 'supported'
				? { disposition, reason: null }
				: { disposition, reason: `${kind}-${disposition}` });
		},
	};
}

function opusAdmission(
	executablePath: string,
	version = '9.0.1',
	generationCharacter = '4',
): ExternalFfmpegRuntimeAdmission {
	return {
		executablePath, version, capabilityGeneration: generationCharacter.repeat(64),
		identity: {
			version, ffmpegSha256: '1'.repeat(64), ffprobeSha256: '2'.repeat(64),
			declaredFileClosureSha256: '3'.repeat(64),
		},
		capabilities: {
			encoders: ['libopus', 'pcm_f32le'], decoders: ['pcm_f32le', 'opus'],
			muxers: ['opus', 'wav'], demuxers: ['f32le', 'ogg'], filters: ['aresample'],
		},
	};
}

function encodeRequest(format: 'flac' | 'opus'): DesktopAudioCodecRequest {
	return {
		operation: 'audio-encode', format,
		input: new Uint8Array(new Float32Array([0.25, -0.25]).buffer),
		sampleRate: 48_000, channelCount: 2,
		settings: format === 'flac' ? { compressionLevel: 5, bitDepth: 24 } : { bitrateKbps: 128 },
		maximumOutputBytes: 1_024, requestId: 'audio-runtime-1',
	} as DesktopAudioCodecRequest;
}

function decodeRequest(format: 'opus'): DesktopAudioCodecRequest {
	return {
		operation: 'audio-decode', format, input: Uint8Array.of(1, 2, 3),
		sampleRate: null, channelCount: null, settings: { sampleFormat: 'f32le' },
		maximumOutputBytes: 1_024, requestId: 'audio-runtime-decode-1',
	};
}

function floatWave(sampleRate: number, channelCount: number, pcm: Uint8Array): Uint8Array {
	const output = new Uint8Array(44 + pcm.byteLength);
	output.set([0x52, 0x49, 0x46, 0x46], 0);
	output.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
	output.set([0x64, 0x61, 0x74, 0x61], 36);
	const view = new DataView(output.buffer);
	view.setUint32(4, output.byteLength - 8, true);
	view.setUint32(16, 16, true);
	view.setUint16(20, 3, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * channelCount * 4, true);
	view.setUint16(32, channelCount * 4, true);
	view.setUint16(34, 32, true);
	view.setUint32(40, pcm.byteLength, true);
	output.set(pcm, 44);
	return output;
}

function executionOptions(): Readonly<{ readonly signal: AbortSignal }> {
	return { signal: new AbortController().signal };
}

function preferences(
	admission: () => ExternalFfmpegRuntimeAdmission | null,
	invalidateAdmission: Pick<ExternalFfmpegPreferenceService, 'invalidateAdmission'>['invalidateAdmission']
		= () => Promise.resolve(preferenceStatus('quarantined')),
): Pick<ExternalFfmpegPreferenceService, 'admission' | 'invalidateAdmission'> {
	return Object.freeze({ admission, invalidateAdmission });
}

function preferenceStatus(
	state: 'quarantined',
): Awaited<ReturnType<ExternalFfmpegPreferenceService['invalidateAdmission']>> {
	return Object.freeze({
		state, location: '/tools/ffmpeg', version: null, detail: '',
		canInstall: false, canBrowse: true, canClear: true,
	});
}

function capabilityQuery(): DesktopAudioCodecCapabilityQuery {
	return {
		schemaVersion: 1,
		operations: [
			{ operation: 'audio-encode', format: 'opus', sampleRate: 48_000, channelCount: 2 },
			{ operation: 'audio-decode', format: 'opus', sampleRate: 48_000, channelCount: 2 },
			{ operation: 'audio-encode', format: 'flac', sampleRate: 48_000, channelCount: 2 },
			{ operation: 'audio-decode', format: 'flac', sampleRate: 48_000, channelCount: 2 },
		],
	};
}

function neverRunner(): ExternalFfmpegAudioOperationRunner {
	return { execute: () => Promise.reject(new Error('external runner must not execute')) };
}
