/* SPDX-License-Identifier: AGPL-3.0-only */

/** Desktop-only provider selection. Browser media composition does not import this module. */

export type DesktopCodecProviderKind = 'bundled' | 'operating-system' | 'external-ffmpeg';
export type DesktopCodecDirection = 'probe' | 'decode' | 'encode' | 'transform';
export type DesktopCodecMediaKind = 'audio' | 'video' | 'audio-video';

export interface DesktopCodecOperation {
	readonly direction: DesktopCodecDirection;
	readonly mediaKind: DesktopCodecMediaKind;
	readonly container: string;
	readonly codec: string;
	readonly profile: string | null;
	readonly sampleFormat: string | null;
	readonly pixelFormat: string | null;
	readonly sampleRate: number | null;
	readonly channelCount: number | null;
	readonly width: number | null;
	readonly height: number | null;
}

export type DesktopCodecPreflightResult = Readonly<{
	readonly disposition: 'supported';
	readonly reason: null;
}> | Readonly<{
	readonly disposition: 'unsupported' | 'unavailable' | 'rejected';
	readonly reason: string;
}>;

export interface DesktopCodecProvider {
	readonly kind: DesktopCodecProviderKind;
	readonly id: string;
	readonly implementation: string;
	readonly version: string;
	readonly capabilityGeneration: string;
	preflight(
		operation: DesktopCodecOperation,
		options: Readonly<{ readonly signal?: AbortSignal }>,
	): Promise<DesktopCodecPreflightResult>;
}

export interface DesktopCodecTimingReceipt {
	readonly startFrame: number;
	readonly frameCount: number;
	readonly encoderDelayFrames: number;
	readonly endPaddingFrames: number;
}

export interface DesktopCodecExecutionResult<Value> {
	readonly value: Value;
	readonly outputDigest: string;
	readonly timing: DesktopCodecTimingReceipt | null;
}

export interface DesktopCodecOperationReceipt {
	readonly operation: DesktopCodecOperation;
	readonly provider: Readonly<{
		readonly kind: DesktopCodecProviderKind;
		readonly id: string;
		readonly implementation: string;
		readonly version: string;
	}>;
	readonly capabilityGeneration: string;
	readonly inputDigests: readonly string[];
	readonly outputDigest: string;
	readonly timing: DesktopCodecTimingReceipt | null;
}

export interface DesktopCodecCoordinator {
	execute<Value>(
		operation: DesktopCodecOperation,
		options: Readonly<{
			readonly inputDigests: readonly string[];
			readonly signal?: AbortSignal;
			readonly run: (selection: Readonly<{
				readonly provider: DesktopCodecProvider;
				readonly operation: DesktopCodecOperation;
				readonly signal?: AbortSignal;
			}>) => Promise<DesktopCodecExecutionResult<Value>>;
		}>,
	): Promise<Readonly<{ readonly value: Value; readonly receipt: DesktopCodecOperationReceipt }>>;
}

export interface DesktopCodecAttempt {
	readonly providerId: string;
	readonly providerKind: DesktopCodecProviderKind;
	readonly disposition: 'unsupported' | 'unavailable';
	readonly reason: string;
}

export class DesktopCodecOperationError extends Error {
	readonly code: 'DESKTOP_CODEC_UNAVAILABLE' | 'DESKTOP_CODEC_PREFLIGHT_REJECTED';
	readonly providerId: string | null;
	readonly attempts: readonly DesktopCodecAttempt[];

	constructor(options: Readonly<{
		readonly code: 'DESKTOP_CODEC_UNAVAILABLE' | 'DESKTOP_CODEC_PREFLIGHT_REJECTED';
		readonly message: string;
		readonly providerId?: string;
		readonly attempts: readonly DesktopCodecAttempt[];
	}>) {
		super(options.message);
		this.name = 'DesktopCodecOperationError';
		this.code = options.code;
		this.providerId = options.providerId ?? null;
		this.attempts = Object.freeze([...options.attempts]);
	}
}

const PROVIDER_ORDER: Readonly<Record<DesktopCodecProviderKind, number>> = Object.freeze({
	bundled: 0,
	'operating-system': 1,
	'external-ffmpeg': 2,
});
const DIRECTIONS = new Set<DesktopCodecDirection>(['probe', 'decode', 'encode', 'transform']);
const MEDIA_KINDS = new Set<DesktopCodecMediaKind>(['audio', 'video', 'audio-video']);
const SHA256 = /^[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9+._:/-]{0,127}$/u;

export function createDesktopCodecCoordinator(options: Readonly<{
	readonly providers: readonly DesktopCodecProvider[];
}>): DesktopCodecCoordinator {
	const providers = validateProviders(options?.providers);
	return Object.freeze({
		async execute<Value>(operationValue: DesktopCodecOperation, executionOptions: Readonly<{
			readonly inputDigests: readonly string[];
			readonly signal?: AbortSignal;
			readonly run: (selection: Readonly<{
				readonly provider: DesktopCodecProvider;
				readonly operation: DesktopCodecOperation;
				readonly signal?: AbortSignal;
			}>) => Promise<DesktopCodecExecutionResult<Value>>;
		}>): Promise<Readonly<{ readonly value: Value; readonly receipt: DesktopCodecOperationReceipt }>> {
			const operation = validateOperation(operationValue);
			const inputDigests = validateDigests(executionOptions?.inputDigests, 'input');
			if (typeof executionOptions?.run !== 'function') {
				throw new TypeError('A desktop codec execution callback is required.');
			}
			throwIfAborted(executionOptions.signal);
			const attempts: DesktopCodecAttempt[] = [];
			for (const provider of providers) {
				throwIfAborted(executionOptions.signal);
				const preflight = validatePreflight(await provider.preflight(
					operation, Object.freeze({ ...(executionOptions.signal ? { signal: executionOptions.signal } : {}) }),
				));
				throwIfAborted(executionOptions.signal);
				if (preflight.disposition === 'rejected') {
					throw new DesktopCodecOperationError({
						code: 'DESKTOP_CODEC_PREFLIGHT_REJECTED',
						message: `Desktop codec provider ${provider.id} rejected the operation: ${preflight.reason}.`,
						providerId: provider.id,
						attempts,
					});
				}
				if (preflight.disposition !== 'supported') {
					attempts.push(Object.freeze({
						providerId: provider.id, providerKind: provider.kind,
						disposition: preflight.disposition, reason: preflight.reason,
					}));
					continue;
				}
				const executed = validateExecutionResult(await executionOptions.run(Object.freeze({
					provider, operation,
					...(executionOptions.signal ? { signal: executionOptions.signal } : {}),
				})));
				throwIfAborted(executionOptions.signal);
				return Object.freeze({
					value: executed.value,
					receipt: Object.freeze({
						operation,
						provider: Object.freeze({
							kind: provider.kind, id: provider.id,
							implementation: provider.implementation, version: provider.version,
						}),
						capabilityGeneration: provider.capabilityGeneration,
						inputDigests,
						outputDigest: executed.outputDigest,
						timing: executed.timing,
					}),
				});
			}
			throw new DesktopCodecOperationError({
				code: 'DESKTOP_CODEC_UNAVAILABLE',
				message: `No desktop codec provider supports ${operation.direction} ${operation.codec} in ${operation.container}.`,
				attempts,
			});
		},
	});
}

function validateProviders(value: unknown): readonly DesktopCodecProvider[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
		throw new TypeError('One to three desktop codec providers are required.');
	}
	const seenKinds = new Set<DesktopCodecProviderKind>();
	const seenIds = new Set<string>();
	let previousOrder = -1;
	const providers = value.map((candidate: unknown) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError('A desktop codec provider is invalid.');
		}
		const provider = candidate as DesktopCodecProvider;
		const order = PROVIDER_ORDER[provider.kind];
		if (order === undefined || order <= previousOrder || seenKinds.has(provider.kind)) {
			throw new TypeError('Desktop codec provider order must be bundled, operating-system, external-ffmpeg.');
		}
		previousOrder = order;
		for (const [entry, label] of [
			[provider.id, 'identifier'], [provider.implementation, 'implementation'],
			[provider.version, 'version'], [provider.capabilityGeneration, 'capability generation'],
		] as const) validateToken(entry, `provider ${label}`);
		if (seenIds.has(provider.id)) throw new TypeError('Desktop codec provider identifiers must be unique.');
		if (typeof provider.preflight !== 'function') throw new TypeError('A desktop codec provider preflight is required.');
		seenKinds.add(provider.kind);
		seenIds.add(provider.id);
		return provider;
	});
	return Object.freeze(providers);
}

function validateOperation(value: unknown): DesktopCodecOperation {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A desktop codec operation is required.');
	}
	const operation = value as DesktopCodecOperation;
	if (!DIRECTIONS.has(operation.direction) || !MEDIA_KINDS.has(operation.mediaKind)) {
		throw new TypeError('The desktop codec operation kind is invalid.');
	}
	validateToken(operation.container, 'operation container');
	validateToken(operation.codec, 'operation codec');
	for (const [entry, label] of [
		[operation.profile, 'profile'], [operation.sampleFormat, 'sample format'],
		[operation.pixelFormat, 'pixel format'],
	] as const) if (entry !== null) validateToken(entry, `operation ${label}`);
	const sampleRate = nullableInteger(operation.sampleRate, 1, 768_000, 'sample rate');
	const channelCount = nullableInteger(operation.channelCount, 1, 64, 'channel count');
	const width = nullableInteger(operation.width, 1, 32_768, 'width');
	const height = nullableInteger(operation.height, 1, 32_768, 'height');
	if (operation.mediaKind === 'audio' && (width !== null || height !== null || operation.pixelFormat !== null)) {
		throw new TypeError('An audio codec operation cannot carry video geometry.');
	}
	if (operation.mediaKind === 'video' && (sampleRate !== null || channelCount !== null || operation.sampleFormat !== null)) {
		throw new TypeError('A video codec operation cannot carry audio geometry.');
	}
	return Object.freeze({
		direction: operation.direction, mediaKind: operation.mediaKind,
		container: operation.container, codec: operation.codec, profile: operation.profile,
		sampleFormat: operation.sampleFormat, pixelFormat: operation.pixelFormat,
		sampleRate, channelCount, width, height,
	});
}

function validatePreflight(value: unknown): DesktopCodecPreflightResult {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A desktop codec preflight result is invalid.');
	}
	const result = value as DesktopCodecPreflightResult;
	if (result.disposition === 'supported' && result.reason === null) return Object.freeze({ ...result });
	if (!['unsupported', 'unavailable', 'rejected'].includes(result.disposition)
		|| typeof result.reason !== 'string' || result.reason.trim() === '' || result.reason.length > 512) {
		throw new TypeError('A desktop codec preflight result is invalid.');
	}
	return Object.freeze({ disposition: result.disposition, reason: result.reason });
}

function validateExecutionResult<Value>(value: DesktopCodecExecutionResult<Value>): DesktopCodecExecutionResult<Value> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'value')) {
		throw new TypeError('The desktop codec execution result is invalid.');
	}
	const outputDigest = digest(value.outputDigest, 'output');
	const timing = value.timing === null ? null : validateTiming(value.timing);
	return Object.freeze({ value: value.value, outputDigest, timing });
}

function validateTiming(value: DesktopCodecTimingReceipt): DesktopCodecTimingReceipt {
	return Object.freeze({
		startFrame: integer(value.startFrame, 0, Number.MAX_SAFE_INTEGER, 'start frame'),
		frameCount: integer(value.frameCount, 0, Number.MAX_SAFE_INTEGER, 'frame count'),
		encoderDelayFrames: integer(value.encoderDelayFrames, 0, 1_048_576, 'encoder delay'),
		endPaddingFrames: integer(value.endPaddingFrames, 0, 1_048_576, 'end padding'),
	});
}

function validateDigests(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value) || value.length > 4_096) throw new TypeError(`Desktop codec ${label} digests are invalid.`);
	return Object.freeze(value.map((entry) => digest(entry, label)));
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`Desktop codec ${label} digest is invalid.`);
	return value;
}

function validateToken(value: unknown, label: string): asserts value is string {
	if (typeof value !== 'string' || !TOKEN.test(value)) throw new TypeError(`Desktop codec ${label} is invalid.`);
}

function nullableInteger(value: unknown, minimum: number, maximum: number, label: string): number | null {
	return value === null ? null : integer(value, minimum, maximum, label);
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new RangeError(`Desktop codec ${label} is invalid.`);
	}
	return value as number;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The desktop codec operation was cancelled.', 'AbortError');
}
