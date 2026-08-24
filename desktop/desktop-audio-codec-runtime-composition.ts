/* SPDX-License-Identifier: AGPL-3.0-only */

/** One-target main-process composition for bundled, OS, then external audio codecs. */

import { posix, win32 } from 'node:path';

import {
	normalizeDesktopAudioCodecCapabilityQuery,
	normalizeDesktopAudioCodecCapabilityResult,
	type DesktopAudioCodecCapabilityEntry,
	type DesktopAudioCodecCapabilityQuery,
	type DesktopAudioCodecCapabilityResult,
	type DesktopAudioCodecCapabilityTuple,
} from './desktop-audio-codec-capability-contract.ts';
import {
	DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES,
	DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT,
	DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE,
	DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
	DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES,
	desktopAudioCodecEncodeBitRates,
	normalizeDesktopAudioCodecRequest,
	normalizeDesktopAudioCodecResult,
	type DesktopAudioCodecRequest,
	type DesktopAudioCodecResult,
} from './desktop-audio-codec-operation-contract.ts';
import {
	DESKTOP_AUDIO_FFMPEG_WAVE_OVERHEAD_LIMIT_BYTES,
	parseDesktopAudioFfmpegWaveOutput,
} from './desktop-audio-ffmpeg-wave-output.ts';
import {
	buildDesktopAudioFfmpegPlan,
	deriveDesktopAudioFfmpegCapabilityTuple,
	isDesktopAudioFfmpegCapabilityTupleSatisfied,
	type DesktopAudioFfmpegCapabilitySets,
	type DesktopAudioFfmpegCapabilityTuple,
} from './desktop-audio-ffmpeg-plan.ts';
import {
	createDesktopAudioCodecBroker,
	deriveDesktopAudioCodecOperation,
	type DesktopAudioCodecProviderExecutionResult,
	type DesktopAudioCodecProviderFailureReason,
	type DesktopAudioCodecProviderRuntime,
} from './desktop-audio-codec-broker.ts';
import type { DesktopAudioCodecMainIpcService } from './desktop-audio-codec-main-ipc.ts';
import {
	createExternalFfmpegAudioOperationRunner,
	type ExternalFfmpegAudioOperationContract,
	type ExternalFfmpegAudioOperationFiles,
	type ExternalFfmpegAudioOperationRunner,
	type ExternalFfmpegAudioOperationRunnerOptions,
	type ExternalFfmpegAudioUnavailableReason,
} from './external-ffmpeg-audio-operation-runner.ts';
import type {
	ExternalFfmpegPreferenceService,
	ExternalFfmpegRuntimeAdmission,
} from './external-ffmpeg-preference-service.ts';
import {
	DESKTOP_CODEC_TARGETS,
	createExternalFfmpegDesktopCodecProvider,
	type DesktopCodecCapability,
	type DesktopCodecTarget,
	type ExternalFfmpegCapabilityRequirements,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';
import type {
	DesktopCodecOperation,
	DesktopCodecOperationReceipt,
	DesktopCodecPreflightResult,
	DesktopCodecProvider,
	DesktopCodecProviderKind,
} from '../src/common/editor/desktop-codec-coordinator.ts';

export interface DesktopAudioCodecRuntimeFactoryContext {
	readonly target: DesktopCodecTarget;
}

export type DesktopAudioCodecRuntimeFactory = (
	context: DesktopAudioCodecRuntimeFactoryContext,
) => DesktopAudioCodecProviderRuntime;

export type ExternalFfmpegAudioRunnerFactory = (
	options: ExternalFfmpegAudioOperationRunnerOptions<DesktopAudioCodecRequest>,
) => ExternalFfmpegAudioOperationRunner;

export interface DesktopAudioCodecReceiptObservation {
	readonly requestId: string | null;
	readonly receipt: DesktopCodecOperationReceipt;
}

export interface DesktopAudioCodecRuntimeComposition extends DesktopAudioCodecMainIpcService {
	capabilities(query: DesktopAudioCodecCapabilityQuery): Promise<DesktopAudioCodecCapabilityResult>;
	execute(
		request: DesktopAudioCodecRequest,
		options: Readonly<{ readonly signal: AbortSignal }>,
	): Promise<DesktopAudioCodecResult>;
}

export interface DesktopAudioCodecRuntimeCompositionOptions {
	readonly target: DesktopCodecTarget;
	readonly scratchRoot: string;
	readonly externalFfmpegPreferences: Pick<
		ExternalFfmpegPreferenceService,
		'admission' | 'invalidateAdmission'
	>;
	readonly createBundledRuntime?: DesktopAudioCodecRuntimeFactory;
	readonly createOperatingSystemRuntime?: DesktopAudioCodecRuntimeFactory;
	readonly createExternalRunner?: ExternalFfmpegAudioRunnerFactory;
	readonly onReceipt?: (observation: DesktopAudioCodecReceiptObservation) => void;
}

interface ExternalExecutionGate {
	active: boolean;
}

type AdmissionSnapshot = Readonly<ExternalFfmpegRuntimeAdmission>;

const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);
const SHA256 = /^[0-9a-f]{64}$/u;
const CAPABILITY_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const PLAN_PREFIX = Object.freeze([
	'-nostdin', '-hide_banner', '-loglevel', 'error', '-nostats', '-xerror', '-y',
] as const);

const RUNNER_FAILURES: Readonly<Record<
	ExternalFfmpegAudioUnavailableReason,
	DesktopAudioCodecProviderFailureReason
>> = Object.freeze({
	busy: 'unavailable',
	cancelled: 'cancelled',
	'cleanup-failed': 'execution-failed',
	'contract-rejected': 'security-failed',
	'executable-unavailable': 'unavailable',
	'identity-changed': 'security-failed',
	'input-limit': 'security-failed',
	'log-limit': 'process-failed',
	'output-invalid': 'result-failed',
	'output-limit': 'result-failed',
	'output-missing': 'result-failed',
	'process-failed': 'process-failed',
	'process-signalled': 'process-failed',
	'request-rejected': 'security-failed',
	'scratch-failed': 'execution-failed',
	'spawn-failed': 'process-failed',
	timeout: 'process-failed',
});

export function createDesktopAudioCodecRuntimeComposition(
	options: DesktopAudioCodecRuntimeCompositionOptions,
): DesktopAudioCodecRuntimeComposition {
	validateOptions(options);
	const target = options.target;
	const factoryContext = Object.freeze({ target });
	const bundled = runtimeForTier(
		options.createBundledRuntime?.(factoryContext) ?? unavailableRuntime('bundled', target),
		'bundled',
	);
	const operatingSystem = runtimeForTier(
		options.createOperatingSystemRuntime?.(factoryContext)
			?? unavailableRuntime('operating-system', target),
		'operating-system',
	);
	const createRunner = options.createExternalRunner ?? createExternalFfmpegAudioOperationRunner;
	const externalGate: ExternalExecutionGate = { active: false };

	return Object.freeze({
		async capabilities(
			queryValue: DesktopAudioCodecCapabilityQuery,
		): Promise<DesktopAudioCodecCapabilityResult> {
			const query = normalizeDesktopAudioCodecCapabilityQuery(queryValue);
			const admission = snapshotAdmission(options.externalFfmpegPreferences);
			const capabilities: DesktopAudioCodecCapabilityEntry[] = [];
			for (const tuple of query.operations) {
				capabilities.push(await inspectCapability(
					tuple, target, bundled.provider, operatingSystem.provider, admission,
				));
			}
			return normalizeDesktopAudioCodecCapabilityResult({
				schemaVersion: 1, capabilities,
			}, query);
		},
		async execute(
			requestValue: DesktopAudioCodecRequest,
			executionOptions: Readonly<{ readonly signal: AbortSignal }>,
		): Promise<DesktopAudioCodecResult> {
			if (!executionOptions || !(executionOptions.signal instanceof AbortSignal)
				|| Reflect.ownKeys(executionOptions).some((key) => key !== 'signal')) {
				throw new TypeError('Desktop audio codec main execution options are invalid.');
			}
			const request = normalizeDesktopAudioCodecRequest(requestValue);
			const admission = snapshotAdmission(options.externalFfmpegPreferences);
			const external = externalRuntime({
				target, request, admission, scratchRoot: options.scratchRoot,
				createRunner, gate: externalGate,
				preferences: options.externalFfmpegPreferences,
			});
			const broker = createDesktopAudioCodecBroker({ runtimes: [bundled, operatingSystem, external] });
			const outcome = await broker.execute(request, { signal: executionOptions.signal });
			const result = normalizeDesktopAudioCodecResult(outcome.result, request.maximumOutputBytes);
			options.onReceipt?.(Object.freeze({
				requestId: request.requestId ?? null,
				receipt: outcome.receipt,
			}));
			return result;
		},
	});
}

async function inspectCapability(
	tuple: DesktopAudioCodecCapabilityTuple,
	target: DesktopCodecTarget,
	bundled: DesktopCodecProvider,
	operatingSystem: DesktopCodecProvider,
	admission: AdmissionSnapshot | null,
): Promise<DesktopAudioCodecCapabilityEntry> {
	let request: DesktopAudioCodecRequest;
	try { request = capabilityRequest(tuple); }
	catch { return unavailableCapability(tuple, 'unsupported-settings'); }
	const operation = deriveDesktopAudioCodecOperation(request);
	for (const provider of [bundled, operatingSystem, externalProvider(target, request, admission)]) {
		let preflight: DesktopCodecPreflightResult;
		try { preflight = await provider.preflight(operation, Object.freeze({})); }
		catch { continue; }
		if (preflight.disposition === 'supported' && preflight.reason === null) {
			return Object.freeze({
				...tuple, available: true, provider: provider.kind, reason: null,
			});
		}
		if (preflight.disposition === 'rejected') break;
	}
	return unavailableCapability(tuple, admission === null
		? 'configure-external-ffmpeg' : 'unsupported-by-configured-ffmpeg');
}

function capabilityRequest(tuple: DesktopAudioCodecCapabilityTuple): DesktopAudioCodecRequest {
	const input = tuple.operation === 'audio-encode'
		? new Uint8Array(tuple.channelCount * Float32Array.BYTES_PER_ELEMENT)
		: Uint8Array.of(0);
	return normalizeDesktopAudioCodecRequest({
		...tuple, input,
		...(tuple.operation === 'audio-decode' ? { sampleRate: null, channelCount: null } : {}),
		settings: tuple.operation === 'audio-decode'
			? { sampleFormat: 'f32le' }
			: capabilityEncodeSettings(tuple.format, tuple.sampleRate, tuple.channelCount),
		maximumOutputBytes: 1_024,
	});
}

function capabilityEncodeSettings(
	format: DesktopAudioCodecRequest['format'],
	sampleRate: number,
	channelCount: number,
): Readonly<Record<string, number>> {
	if (format === 'flac') return Object.freeze({ compressionLevel: 5, bitDepth: 24 });
	if (format === 'wavpack') return Object.freeze({ compressionLevel: 2 });
	if (format === 'ogg-vorbis') return Object.freeze({ quality: 5 });
	if (format === 'opus') return Object.freeze({ bitrateKbps: 160 });
	if (format === 'mp2') return Object.freeze({ bitrateKbps: 256 });
	return Object.freeze({
		bitrateKbps: desktopAudioCodecEncodeBitRates(format, sampleRate, channelCount)[0] ?? 32,
	});
}

function unavailableCapability(
	tuple: DesktopAudioCodecCapabilityTuple,
	reason: 'configure-external-ffmpeg' | 'unsupported-by-configured-ffmpeg' | 'unsupported-settings',
): DesktopAudioCodecCapabilityEntry {
	return Object.freeze({ ...tuple, available: false, provider: null, reason });
}

function externalRuntime(options: Readonly<{
	target: DesktopCodecTarget;
	request: DesktopAudioCodecRequest;
	admission: AdmissionSnapshot | null;
	scratchRoot: string;
	createRunner: ExternalFfmpegAudioRunnerFactory;
	gate: ExternalExecutionGate;
	preferences: Pick<ExternalFfmpegPreferenceService, 'invalidateAdmission'>;
}>): DesktopAudioCodecProviderRuntime {
	const provider = externalProvider(options.target, options.request, options.admission);
	return Object.freeze({
		provider,
		async execute(
			request: DesktopAudioCodecRequest,
			executionOptions: Readonly<{
				readonly operation: DesktopCodecOperation;
				readonly signal?: AbortSignal;
			}>,
		): Promise<DesktopAudioCodecProviderExecutionResult> {
			if (options.gate.active) return failed('unavailable',
				'Another external FFmpeg audio operation is already active.');
			if (options.admission === null) return failed('unavailable',
				'No admitted external FFmpeg executable is available.');
			options.gate.active = true;
			try {
				const snapshot = options.admission;
				const runner = options.createRunner({
					scratchRoot: options.scratchRoot,
					contract: fixedFfmpegContract(request),
					getAdmittedExecutable: () => Promise.resolve(Object.freeze({
						executablePath: snapshot.executablePath,
						ffmpegSha256: snapshot.identity.ffmpegSha256,
					})),
					maximumInputBytes: DESKTOP_AUDIO_CODEC_INPUT_LIMIT_BYTES,
					maximumOutputBytes: DESKTOP_AUDIO_CODEC_OUTPUT_LIMIT_BYTES
						+ DESKTOP_AUDIO_FFMPEG_WAVE_OVERHEAD_LIMIT_BYTES,
				});
				const outcome = await runner.execute(Object.freeze({
					operation: request, input: request.input,
					...(executionOptions.signal ? { signal: executionOptions.signal } : {}),
				}));
				if (outcome.status !== 'executed') {
					if (outcome.reason === 'identity-changed'
						|| outcome.reason === 'executable-unavailable') {
						try {
							await options.preferences.invalidateAdmission(snapshot, outcome.reason);
						} catch {
							return failed('security-failed',
								'The failed FFmpeg admission could not be quarantined.');
						}
					}
					return failed(RUNNER_FAILURES[outcome.reason], outcome.detail);
				}
				if (request.operation === 'audio-encode') {
					return Object.freeze({ status: 'executed', output: outcome.output });
				}
				try {
					return Object.freeze({
						status: 'executed',
						...parseDesktopAudioFfmpegWaveOutput(outcome.output, request.maximumOutputBytes),
					});
				} catch {
					return failed('result-failed',
						'The external FFmpeg decoder returned invalid float WAV geometry.');
				}
			} finally { options.gate.active = false; }
		},
	});
}

function externalProvider(
	target: DesktopCodecTarget,
	request: DesktopAudioCodecRequest,
	admission: AdmissionSnapshot | null,
): DesktopCodecProvider {
	if (admission === null) return unavailableProvider('external-ffmpeg', target);
	try {
		const operation = deriveDesktopAudioCodecOperation(request);
		const tuple = deriveDesktopAudioFfmpegCapabilityTuple(request);
		const requirements = satisfiedRequirements(tuple, admission.capabilities);
		const capability = externalCapability(operation, request);
		const qualifiedCapabilities = requirements === null ? [] : [Object.freeze({
			capability: Object.freeze({
				id: `external-audio-${operation.direction}-${request.format}`
					+ (request.operation === 'audio-encode'
						? `-${String(request.sampleRate)}-${String(request.channelCount)}` : '-source-geometry'),
				...capability,
			}),
			implementation: `ffmpeg-${selectedImplementation(tuple, admission.capabilities)}`,
			requires: requirements,
		})];
		return createExternalFfmpegDesktopCodecProvider({
			target, version: admission.version,
			capabilityGeneration: admission.capabilityGeneration,
			capabilitySets: admission.capabilities,
			qualifiedCapabilities,
		});
	} catch { return unavailableProvider('external-ffmpeg', target); }
}

function externalCapability(
	operation: DesktopCodecOperation,
	request: DesktopAudioCodecRequest,
): Omit<DesktopCodecCapability, 'id'> {
	if (request.operation === 'audio-encode') return operation;
	return Object.freeze({
		...operation,
		sampleRate: Object.freeze({
			minimum: DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
			maximum: DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE,
			multipleOf: 1,
		}),
		channelCount: Object.freeze({
			minimum: 1,
			maximum: request.format === 'mp3' || request.format === 'mp2'
				? 2 : DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT,
			multipleOf: 1,
		}),
	});
}

function satisfiedRequirements(
	tuple: DesktopAudioFfmpegCapabilityTuple,
	capabilities: DesktopAudioFfmpegCapabilitySets,
): ExternalFfmpegCapabilityRequirements | null {
	if (!isDesktopAudioFfmpegCapabilityTupleSatisfied(tuple, capabilities)) return null;
	return Object.freeze({
		demuxers: Object.freeze([selected(tuple.demuxerAnyOf, capabilities.demuxers)]),
		decoders: Object.freeze([selected(tuple.decoderAnyOf, capabilities.decoders)]),
		encoders: Object.freeze([selected(tuple.encoderAnyOf, capabilities.encoders)]),
		muxers: Object.freeze([selected(tuple.muxerAnyOf, capabilities.muxers)]),
		filters: Object.freeze([...tuple.filterAllOf]),
	});
}

function selectedImplementation(
	tuple: DesktopAudioFfmpegCapabilityTuple,
	capabilities: DesktopAudioFfmpegCapabilitySets,
): string {
	return tuple.direction === 'encode'
		? selected(tuple.encoderAnyOf, capabilities.encoders)
		: selected(tuple.decoderAnyOf, capabilities.decoders);
}

function selected(candidates: readonly string[], available: readonly string[]): string {
	const entries = new Set(available);
	const selectedEntry = candidates.find((candidate) => entries.has(candidate));
	if (selectedEntry === undefined) throw new TypeError('The external FFmpeg tuple is incomplete.');
	return selectedEntry;
}

function fixedFfmpegContract(
	request: DesktopAudioCodecRequest,
): ExternalFfmpegAudioOperationContract<DesktopAudioCodecRequest> {
	const contract: ExternalFfmpegAudioOperationContract<DesktopAudioCodecRequest> = {
		admitOperation(value: unknown) {
			return value === request
				? Object.freeze({ status: 'admitted' as const, operation: request })
				: Object.freeze({ status: 'rejected' as const });
		},
		maximumOutputBytes(operation: DesktopAudioCodecRequest) {
			if (operation !== request) throw new TypeError('The fixed FFmpeg request changed.');
			return request.maximumOutputBytes + (request.operation === 'audio-decode'
				? DESKTOP_AUDIO_FFMPEG_WAVE_OVERHEAD_LIMIT_BYTES : 0);
		},
		buildArguments(operation: DesktopAudioCodecRequest, files: ExternalFfmpegAudioOperationFiles) {
			if (operation !== request) throw new TypeError('The fixed FFmpeg request changed.');
			return adaptedArguments(request, files);
		},
		validateArguments(
			arguments_: readonly string[],
			operation: DesktopAudioCodecRequest,
			files: ExternalFfmpegAudioOperationFiles,
		) {
			if (operation !== request) return false;
			try { return sameArguments(arguments_, adaptedArguments(request, files)); }
			catch { return false; }
		},
	};
	return Object.freeze(contract);
}

function adaptedArguments(
	request: DesktopAudioCodecRequest,
	files: ExternalFfmpegAudioOperationFiles,
): readonly string[] {
	const plan = buildDesktopAudioFfmpegPlan(request);
	if (!PLAN_PREFIX.every((entry, index) => plan.arguments[index] === entry)) {
		throw new TypeError('The fixed FFmpeg plan prefix changed.');
	}
	const arguments_ = ['-xerror', ...plan.arguments.slice(PLAN_PREFIX.length)];
	const outputLimitIndex = arguments_.lastIndexOf('-fs');
	if (outputLimitIndex < 0 || arguments_[outputLimitIndex + 1] !== String(request.maximumOutputBytes)
		|| arguments_.indexOf('-fs') !== outputLimitIndex) {
		throw new TypeError('The fixed FFmpeg output limit changed.');
	}
	arguments_.splice(outputLimitIndex, 2);
	const substituted = arguments_.map((entry) => entry === plan.inputName ? files.inputPath
		: entry === plan.outputName ? files.outputPath : entry);
	if (substituted.filter((entry) => entry === files.inputPath).length !== 1
		|| substituted.filter((entry) => entry === files.outputPath).length !== 1
		|| substituted.at(-1) !== files.outputPath) {
		throw new TypeError('The fixed FFmpeg file bindings changed.');
	}
	return Object.freeze(substituted);
}

function sameArguments(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function snapshotAdmission(
	preferences: Pick<ExternalFfmpegPreferenceService, 'admission'>,
): AdmissionSnapshot | null {
	let value: ExternalFfmpegRuntimeAdmission | null;
	try { value = preferences.admission(); }
	catch { return null; }
	if (!value || typeof value !== 'object' || typeof value.executablePath !== 'string'
		|| typeof value.version !== 'string' || typeof value.capabilityGeneration !== 'string'
		|| !value.identity || !SHA256.test(value.identity.ffmpegSha256)
		|| !SHA256.test(value.identity.ffprobeSha256)
		|| !SHA256.test(value.identity.declaredFileClosureSha256)) return null;
	const capabilities = cloneCapabilities(value.capabilities);
	if (capabilities === null) return null;
	return Object.freeze({
		executablePath: value.executablePath, version: value.version,
		capabilityGeneration: value.capabilityGeneration,
		identity: Object.freeze({ ...value.identity }), capabilities,
	});
}

function cloneCapabilities(value: unknown): DesktopAudioFfmpegCapabilitySets | null {
	if (!value || typeof value !== 'object') return null;
	const source = value as DesktopAudioFfmpegCapabilitySets;
	const result = {} as Record<keyof DesktopAudioFfmpegCapabilitySets, readonly string[]>;
	for (const kind of ['encoders', 'decoders', 'muxers', 'demuxers', 'filters'] as const) {
		if (!Array.isArray(source[kind]) || source[kind].length > 16_384
			|| source[kind].some((entry) => typeof entry !== 'string' || !CAPABILITY_TOKEN.test(entry))) return null;
		result[kind] = Object.freeze([...new Set(source[kind])]);
	}
	return Object.freeze(result);
}

function unavailableRuntime(
	kind: 'bundled' | 'operating-system',
	target: DesktopCodecTarget,
): DesktopAudioCodecProviderRuntime {
	return Object.freeze({
		provider: unavailableProvider(kind, target),
		execute: () => Promise.resolve(failed('unavailable', 'The provider runtime is unavailable.')),
	});
}

function unavailableProvider(
	kind: DesktopCodecProviderKind,
	target: DesktopCodecTarget,
): DesktopCodecProvider {
	return Object.freeze({
		kind, id: `${kind}-unavailable-${target}`, implementation: 'not-configured',
		version: '0.0.0', capabilityGeneration: `unavailable-${target}`,
		async preflight(
			_operation: DesktopCodecOperation,
			preflightOptions: Readonly<{ readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			throwIfAborted(preflightOptions.signal);
			return Object.freeze({
				disposition: 'unavailable', reason: `The ${kind} codec provider is not configured.`,
			});
		},
	});
}

function runtimeForTier(
	runtime: DesktopAudioCodecProviderRuntime,
	kind: 'bundled' | 'operating-system',
): DesktopAudioCodecProviderRuntime {
	if (!runtime || typeof runtime !== 'object' || runtime.provider?.kind !== kind
		|| typeof runtime.execute !== 'function') {
		throw new TypeError(`The ${kind} desktop audio codec runtime is invalid.`);
	}
	return runtime;
}

function failed(
	reason: DesktopAudioCodecProviderFailureReason,
	detail: string,
): Extract<DesktopAudioCodecProviderExecutionResult, { status: 'failed' }> {
	return Object.freeze({ status: 'failed', reason, detail });
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The desktop audio codec operation was cancelled.', 'AbortError');
}

function validateOptions(options: DesktopAudioCodecRuntimeCompositionOptions): void {
	if (!options || typeof options !== 'object' || !TARGETS.has(options.target)
		|| typeof options.scratchRoot !== 'string'
		|| !(posix.isAbsolute(options.scratchRoot) || win32.isAbsolute(options.scratchRoot))
		|| options.scratchRoot.length > 4_096 || options.scratchRoot.includes('\0')
		|| !options.externalFfmpegPreferences
		|| typeof options.externalFfmpegPreferences.admission !== 'function'
		|| typeof options.externalFfmpegPreferences.invalidateAdmission !== 'function'
		|| options.createBundledRuntime !== undefined && typeof options.createBundledRuntime !== 'function'
		|| options.createOperatingSystemRuntime !== undefined
			&& typeof options.createOperatingSystemRuntime !== 'function'
		|| options.createExternalRunner !== undefined && typeof options.createExternalRunner !== 'function'
		|| options.onReceipt !== undefined && typeof options.onReceipt !== 'function') {
		throw new TypeError('Desktop audio codec runtime composition options are invalid or target is unsupported.');
	}
}
