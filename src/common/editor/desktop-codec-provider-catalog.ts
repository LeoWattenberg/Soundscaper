/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed desktop codec inventory and exact, capability-first provider preflight. */

import type {
	DesktopCodecOperation,
	DesktopCodecPreflightResult,
	DesktopCodecProvider,
	DesktopCodecProviderKind,
} from './desktop-codec-coordinator.ts';

export const DESKTOP_CODEC_TARGETS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
] as const);
export type DesktopCodecTarget = typeof DESKTOP_CODEC_TARGETS[number];

export type BundledDesktopCodecComponent =
	| 'specialized-pcm' | 'libflac' | 'libogg' | 'libvorbis' | 'libopus'
	| 'mpg123' | 'lame' | 'twolame' | 'wavpack';

export interface DesktopCodecIntegerRange {
	readonly minimum: number;
	readonly maximum: number;
	readonly multipleOf: number;
}

export type DesktopCodecIntegerConstraint = number | Readonly<DesktopCodecIntegerRange>;

/** Categorical fields are exact. A numeric range is an explicit verified constraint, never a wildcard. */
export interface DesktopCodecCapability {
	readonly id: string;
	readonly direction: DesktopCodecOperation['direction'];
	readonly mediaKind: DesktopCodecOperation['mediaKind'];
	readonly container: string;
	readonly codec: string;
	readonly profile: string | null;
	readonly sampleFormat: string | null;
	readonly pixelFormat: string | null;
	readonly sampleRate: DesktopCodecIntegerConstraint | null;
	readonly channelCount: DesktopCodecIntegerConstraint | null;
	readonly width: DesktopCodecIntegerConstraint | null;
	readonly height: DesktopCodecIntegerConstraint | null;
}

export interface DesktopCodecCapabilityResolution {
	readonly capabilityId: string;
	readonly implementation: string;
}

export interface DesktopCodecCatalogProvider extends DesktopCodecProvider {
	readonly target: DesktopCodecTarget;
	readonly capabilities: readonly DesktopCodecCapability[];
	resolve(operation: DesktopCodecOperation): DesktopCodecCapabilityResolution | null;
}

export interface BundledDesktopCodecProviderOptions {
	readonly target: DesktopCodecTarget;
	readonly capabilityGeneration: string;
	/** Presence means the reviewed payload for this target was admitted; the value is its release version. */
	readonly inventory: Readonly<Partial<Record<BundledDesktopCodecComponent, string>>>;
}

export interface DesktopCodecVerifiedCapability {
	readonly capability: DesktopCodecCapability;
	readonly implementation: string;
}

export interface OperatingSystemDesktopCodecProviderOptions {
	readonly target: DesktopCodecTarget;
	readonly osVersion: string;
	readonly capabilityGeneration: string;
	readonly canaryVerifiedCapabilities: readonly DesktopCodecVerifiedCapability[];
}

export interface ExternalFfmpegCapabilitySets {
	readonly encoders: readonly string[];
	readonly decoders: readonly string[];
	readonly muxers: readonly string[];
	readonly demuxers: readonly string[];
	readonly filters: readonly string[];
}

export interface ExternalFfmpegCapabilityRequirements {
	readonly encoders?: readonly string[];
	readonly decoders?: readonly string[];
	readonly muxers?: readonly string[];
	readonly demuxers?: readonly string[];
	readonly filters?: readonly string[];
}

export interface ExternalFfmpegVerifiedCapability extends DesktopCodecVerifiedCapability {
	readonly requires: ExternalFfmpegCapabilityRequirements;
}

export interface ExternalFfmpegDesktopCodecProviderOptions {
	readonly target: DesktopCodecTarget;
	readonly version: string;
	readonly capabilityGeneration: string;
	readonly capabilitySets: ExternalFfmpegCapabilitySets;
	readonly verifiedCapabilities: readonly ExternalFfmpegVerifiedCapability[];
}

interface CapabilityBinding extends DesktopCodecVerifiedCapability {
	readonly capability: DesktopCodecCapability;
}

const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9+._:/-]{0,127}$/u;
const AUDIO_RATE = Object.freeze({ minimum: 1, maximum: 768_000, multipleOf: 1 });
const AUDIO_CHANNELS = Object.freeze({ minimum: 1, maximum: 64, multipleOf: 1 });
const REVIEWED_AUDIO_RATE = Object.freeze({ minimum: 8_000, maximum: 192_000, multipleOf: 1 });
const REVIEWED_EIGHT_CHANNELS = Object.freeze({ minimum: 1, maximum: 8, multipleOf: 1 });
const REVIEWED_STEREO = Object.freeze({ minimum: 1, maximum: 2, multipleOf: 1 });

export function createBundledDesktopCodecProvider(
	options: BundledDesktopCodecProviderOptions,
): DesktopCodecCatalogProvider {
	const target = desktopTarget(options?.target);
	const generation = token(options?.capabilityGeneration, 'bundled capability generation');
	const inventory = validateBundledInventory(options?.inventory);
	const bindings = bundledBindings(inventory);
	return provider({
		kind: 'bundled', target, id: `bundled-codecs-${target}`,
		implementation: 'soundscaper-reviewed-codecs', version: 'catalog-1',
		capabilityGeneration: generation, bindings,
		unavailableReason: null,
		unsupportedReason: 'The bundled reviewed inventory has no exact capability for this operation.',
	});
}

export function createOperatingSystemDesktopCodecProvider(
	options: OperatingSystemDesktopCodecProviderOptions,
): DesktopCodecCatalogProvider {
	const record = closedDataRecord(options, [
		'target', 'osVersion', 'capabilityGeneration', 'canaryVerifiedCapabilities',
	], 'Operating-system codec provider options');
	const target = desktopTarget(record.target);
	const version = token(record.osVersion, 'operating-system version');
	const generation = token(record.capabilityGeneration, 'operating-system capability generation');
	const supplied = validateVerifiedCapabilities(record.canaryVerifiedCapabilities, 'OS canary');
	const linux = target.startsWith('linux-');
	const implementation = target.startsWith('win-')
		? 'windows-media-foundation'
		: target === 'mac-arm64'
			? 'apple-audiotoolbox-avfoundation-videotoolbox'
			: 'no-linux-system-codec-provider';
	return provider({
		kind: 'operating-system', target, id: `operating-system-codecs-${target}`,
		implementation, version, capabilityGeneration: generation,
		bindings: linux ? [] : supplied,
		unavailableReason: linux ? 'Linux has no admitted operating-system codec provider.' : null,
		unsupportedReason: 'No exact canary-verified operating-system codec tuple matches this operation.',
	});
}

export function createExternalFfmpegDesktopCodecProvider(
	options: ExternalFfmpegDesktopCodecProviderOptions,
): DesktopCodecCatalogProvider {
	const record = closedDataRecord(options, [
		'target', 'version', 'capabilityGeneration', 'capabilitySets', 'verifiedCapabilities',
	], 'External FFmpeg codec provider options');
	const target = desktopTarget(record.target);
	const version = externalFfmpegVersion(record.version);
	const generation = token(record.capabilityGeneration, 'external FFmpeg capability generation');
	const sets = validateExternalCapabilitySets(record.capabilitySets);
	if (!Array.isArray(record.verifiedCapabilities)) {
		throw new TypeError('External FFmpeg verified capabilities are invalid.');
	}
	const bindings = record.verifiedCapabilities.map((entry) => {
		const verified = closedDataRecord(entry, [
			'capability', 'implementation', 'requires',
		], 'External FFmpeg verified capability');
		const [binding] = validateVerifiedCapabilities([{
			capability: verified.capability, implementation: verified.implementation,
		}], 'external FFmpeg');
		if (!binding) throw new TypeError('An external FFmpeg capability is invalid.');
		const requirements = validateExternalRequirements(verified.requires, binding.capability.direction);
		return Object.freeze({ binding, requirements });
	}).filter(({ requirements }) => requirements.every(({ kind, name }) => sets[kind].has(name)))
		.map(({ binding }) => binding);
	return provider({
		kind: 'external-ffmpeg', target, id: `external-ffmpeg-${target}`,
		implementation: 'ffmpeg-cli', version, capabilityGeneration: generation, bindings,
		unavailableReason: null,
		unsupportedReason: 'External FFmpeg has no exact probed and verified capability for this operation.',
	});
}

function provider(options: Readonly<{
	readonly kind: DesktopCodecProviderKind;
	readonly target: DesktopCodecTarget;
	readonly id: string;
	readonly implementation: string;
	readonly version: string;
	readonly capabilityGeneration: string;
	readonly bindings: readonly CapabilityBinding[];
	readonly unavailableReason: string | null;
	readonly unsupportedReason: string;
}>): DesktopCodecCatalogProvider {
	const bindings = Object.freeze([...options.bindings]);
	const capabilities = Object.freeze(bindings.map(({ capability }) => capability));
	function resolve(operation: DesktopCodecOperation): DesktopCodecCapabilityResolution | null {
		if (options.unavailableReason !== null) return null;
		const binding = bindings.find(({ capability }) => matchesCapability(operation, capability));
		return binding ? Object.freeze({
			capabilityId: binding.capability.id, implementation: binding.implementation,
		}) : null;
	}
	return Object.freeze({
		kind: options.kind, target: options.target, id: options.id,
		implementation: options.implementation, version: options.version,
		capabilityGeneration: options.capabilityGeneration, capabilities, resolve,
		async preflight(
			operation: DesktopCodecOperation,
			preflightOptions: Readonly<{ readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			throwIfAborted(preflightOptions.signal);
			if (options.unavailableReason !== null) return unavailable(options.unavailableReason);
			return resolve(operation) === null
				? unsupported(options.unsupportedReason)
				: Object.freeze({ disposition: 'supported', reason: null });
		},
	});
}

function bundledBindings(
	inventory: Readonly<Partial<Record<BundledDesktopCodecComponent, string>>>,
): readonly CapabilityBinding[] {
	const definitions: Array<CapabilityBinding & { readonly components: readonly BundledDesktopCodecComponent[] }> = [];
	const audio = (
		containers: readonly string[], codec: string, directions: readonly ('encode' | 'decode')[],
		formats: readonly string[], rates: readonly DesktopCodecIntegerConstraint[],
		channels: DesktopCodecIntegerConstraint, implementation: string,
		components: readonly BundledDesktopCodecComponent[],
	) => {
		for (const container of containers) for (const direction of directions) {
			for (const sampleFormat of formats) for (const sampleRate of rates) definitions.push({
				capability: capability({
					id: `${implementation}-${direction}-${container}-${sampleFormat}-${constraintId(sampleRate)}`,
					direction, mediaKind: 'audio', container, codec, profile: null,
					sampleFormat, pixelFormat: null, sampleRate, channelCount: channels,
					width: null, height: null,
				}), implementation, components,
			});
		}
	};
	audio(['wav', 'bwf', 'bw64', 'aiff'], 'pcm', ['encode', 'decode'],
		['u8', 's16', 's24', 's32', 'f32', 'f64'], [AUDIO_RATE], AUDIO_CHANNELS,
		'specialized-pcm', ['specialized-pcm']);
	audio(['flac'], 'flac', ['encode'], ['s24'], [REVIEWED_AUDIO_RATE],
		REVIEWED_EIGHT_CHANNELS, 'libflac', ['libflac']);
	audio(['flac'], 'flac', ['decode'], ['f32'], [REVIEWED_AUDIO_RATE],
		REVIEWED_EIGHT_CHANNELS, 'libflac', ['libflac']);
	audio(['ogg'], 'vorbis', ['encode', 'decode'], ['f32p'], [REVIEWED_AUDIO_RATE],
		REVIEWED_STEREO, 'libvorbis', ['libogg', 'libvorbis']);
	audio(['ogg'], 'opus', ['encode', 'decode'], ['f32p'], [48_000],
		REVIEWED_STEREO, 'libopus', ['libogg', 'libopus']);
	audio(['mp3'], 'mp3', ['decode'], ['f32'], [32_000, 44_100, 48_000],
		REVIEWED_STEREO, 'mpg123', ['mpg123']);
	audio(['mp3'], 'mp3', ['encode'], ['f32p'], [32_000, 44_100, 48_000],
		REVIEWED_STEREO, 'lame', ['lame']);
	audio(['mp2'], 'mp2', ['encode'], ['f32p'], [32_000, 44_100, 48_000],
		REVIEWED_STEREO, 'twolame', ['twolame']);
	audio(['mp2'], 'mp2', ['decode'], ['f32'], [32_000, 44_100, 48_000],
		REVIEWED_STEREO, 'mpg123', ['mpg123']);
	audio(['wavpack'], 'wavpack', ['encode', 'decode'], ['f32'], [REVIEWED_AUDIO_RATE],
		REVIEWED_EIGHT_CHANNELS, 'wavpack', ['wavpack']);
	return Object.freeze(definitions
		.filter(({ components }) => components.every((component) => inventory[component] !== undefined))
		.map(({ capability: admitted, implementation }) => Object.freeze({ capability: admitted, implementation })));
}

function capability(value: DesktopCodecCapability): DesktopCodecCapability {
	return cloneCapability(value);
}

function validateVerifiedCapabilities(value: unknown, label: string): readonly CapabilityBinding[] {
	if (!Array.isArray(value) || value.length > 4_096) throw new TypeError(`${label} capabilities are invalid.`);
	const identifiers = new Set<string>();
	return Object.freeze(value.map((candidate: unknown) => {
		const entry = closedDataRecord(candidate, [
			'capability', 'implementation',
		], `${label} verified capability`);
		const admitted = cloneCapability(entry.capability as DesktopCodecCapability);
		if (identifiers.has(admitted.id)) throw new TypeError(`${label} capability identifiers must be unique.`);
		identifiers.add(admitted.id);
		return Object.freeze({ capability: admitted, implementation: token(entry.implementation, `${label} implementation`) });
	}));
}

function closedDataRecord(
	value: unknown, fields: readonly string[], label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`${label} must be one plain record with closed fields.`);
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Object.keys(descriptors).sort();
	const expected = [...fields].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])
		|| Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, 'value'))) {
		throw new TypeError(`${label} must have only its closed data fields.`);
	}
	return value as Record<string, unknown>;
}

function cloneCapability(value: DesktopCodecCapability): DesktopCodecCapability {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A codec capability is invalid.');
	const direction = value.direction;
	const mediaKind = value.mediaKind;
	if (!['probe', 'decode', 'encode', 'transform'].includes(direction)
		|| !['audio', 'video', 'audio-video'].includes(mediaKind)) throw new TypeError('A codec capability kind is invalid.');
	const result = Object.freeze({
		id: token(value.id, 'capability identifier'), direction, mediaKind,
		container: token(value.container, 'capability container'), codec: token(value.codec, 'capability codec'),
		profile: nullableToken(value.profile, 'capability profile'),
		sampleFormat: nullableToken(value.sampleFormat, 'capability sample format'),
		pixelFormat: nullableToken(value.pixelFormat, 'capability pixel format'),
		sampleRate: numericConstraint(value.sampleRate, 1, 768_000, 'capability sample rate'),
		channelCount: numericConstraint(value.channelCount, 1, 64, 'capability channel count'),
		width: numericConstraint(value.width, 1, 32_768, 'capability width'),
		height: numericConstraint(value.height, 1, 32_768, 'capability height'),
	});
	if (mediaKind === 'audio' && (result.sampleFormat === null || result.sampleRate === null
		|| result.channelCount === null || result.pixelFormat !== null || result.width !== null || result.height !== null)) {
		throw new TypeError('An audio codec capability must have exact audio constraints only.');
	}
	if (mediaKind === 'video' && (result.pixelFormat === null || result.width === null || result.height === null
		|| result.sampleFormat !== null || result.sampleRate !== null || result.channelCount !== null)) {
		throw new TypeError('A video codec capability must have exact video constraints only.');
	}
	return result;
}

function matchesCapability(operation: DesktopCodecOperation, admitted: DesktopCodecCapability): boolean {
	const unresolvedDecodeGeometry = operation.direction === 'decode' && operation.mediaKind === 'audio'
		&& operation.sampleRate === null && operation.channelCount === null;
	return operation.direction === admitted.direction && operation.mediaKind === admitted.mediaKind
		&& operation.container === admitted.container && operation.codec === admitted.codec
		&& operation.profile === admitted.profile && operation.sampleFormat === admitted.sampleFormat
		&& operation.pixelFormat === admitted.pixelFormat
		&& matchesInteger(operation.sampleRate, admitted.sampleRate, unresolvedDecodeGeometry)
		&& matchesInteger(operation.channelCount, admitted.channelCount, unresolvedDecodeGeometry)
		&& matchesInteger(operation.width, admitted.width)
		&& matchesInteger(operation.height, admitted.height);
}

function matchesInteger(
	value: number | null,
	constraint: DesktopCodecIntegerConstraint | null,
	allowUnknown = false,
): boolean {
	if (value === null && allowUnknown && constraint !== null) return true;
	if (constraint === null || typeof constraint === 'number') return value === constraint;
	return value !== null && value >= constraint.minimum && value <= constraint.maximum
		&& value % constraint.multipleOf === 0;
}

function validateBundledInventory(value: unknown): Readonly<Partial<Record<BundledDesktopCodecComponent, string>>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Bundled codec inventory is invalid.');
	const known = new Set<BundledDesktopCodecComponent>([
		'specialized-pcm', 'libflac', 'libogg', 'libvorbis', 'libopus', 'mpg123',
		'lame', 'twolame', 'wavpack',
	]);
	const result: Partial<Record<BundledDesktopCodecComponent, string>> = {};
	for (const [component, version] of Object.entries(value)) {
		if (!known.has(component as BundledDesktopCodecComponent)) throw new TypeError('Bundled codec inventory component is invalid.');
		result[component as BundledDesktopCodecComponent] = token(version, `bundled ${component} version`);
	}
	return Object.freeze(result);
}

type ExternalSetKind = keyof ExternalFfmpegCapabilitySets;

function validateExternalCapabilitySets(value: unknown): Readonly<Record<ExternalSetKind, ReadonlySet<string>>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('External FFmpeg capability sets are invalid.');
	const input = value as ExternalFfmpegCapabilitySets;
	const result = {} as Record<ExternalSetKind, ReadonlySet<string>>;
	for (const kind of ['encoders', 'decoders', 'muxers', 'demuxers', 'filters'] as const) {
		if (!Array.isArray(input[kind])) throw new TypeError(`External FFmpeg ${kind} are invalid.`);
		result[kind] = new Set(input[kind].map((entry) => token(entry, `external FFmpeg ${kind} entry`)));
	}
	return Object.freeze(result);
}

function validateExternalRequirements(
	value: unknown, direction: DesktopCodecOperation['direction'],
): readonly Readonly<{ readonly kind: ExternalSetKind; readonly name: string }>[] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('External FFmpeg requirements are invalid.');
	const input = value as ExternalFfmpegCapabilityRequirements;
	const requiredKinds: readonly ExternalSetKind[] = direction === 'encode' ? ['encoders', 'muxers']
		: direction === 'decode' ? ['decoders', 'demuxers']
			: direction === 'probe' ? ['demuxers'] : ['filters'];
	const requirements: Array<Readonly<{ readonly kind: ExternalSetKind; readonly name: string }>> = [];
	for (const kind of ['encoders', 'decoders', 'muxers', 'demuxers', 'filters'] as const) {
		const entries = input[kind] ?? [];
		if (!Array.isArray(entries)) throw new TypeError(`External FFmpeg ${kind} requirements are invalid.`);
		for (const entry of entries) requirements.push(Object.freeze({
			kind, name: token(entry, `external FFmpeg ${kind} requirement`),
		}));
	}
	if (requiredKinds.some((kind) => !requirements.some((entry) => entry.kind === kind))) {
		throw new TypeError(`External FFmpeg ${direction} capabilities require explicit ${requiredKinds.join(' and ')} bindings.`);
	}
	return Object.freeze(requirements);
}

function numericConstraint(
	value: DesktopCodecIntegerConstraint | null, minimum: number, maximum: number, label: string,
): DesktopCodecIntegerConstraint | null {
	if (value === null) return null;
	if (typeof value === 'number') return integer(value, minimum, maximum, label);
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
	const lower = integer(value.minimum, minimum, maximum, `${label} minimum`);
	const upper = integer(value.maximum, minimum, maximum, `${label} maximum`);
	const multipleOf = integer(value.multipleOf, 1, maximum, `${label} multiple`);
	if (lower > upper) throw new RangeError(`${label} range is invalid.`);
	return Object.freeze({ minimum: lower, maximum: upper, multipleOf });
}

function externalFfmpegVersion(value: unknown): string {
	const version = token(value, 'external FFmpeg version');
	const match = /^(\d{1,2})\.(\d{1,3})\.(\d{1,4})$/u.exec(version);
	if (!match) throw new TypeError('External FFmpeg requires a normalized released version.');
	const major = Number(match[1]);
	const minor = Number(match[2]);
	if (major < 4 || (major === 4 && minor < 4) || major >= 10) {
		throw new RangeError('External FFmpeg version is unsupported.');
	}
	return version;
}

function desktopTarget(value: unknown): DesktopCodecTarget {
	if (typeof value !== 'string' || !TARGETS.has(value)) throw new TypeError('The desktop codec target is unsupported.');
	return value as DesktopCodecTarget;
}

function nullableToken(value: unknown, label: string): string | null {
	return value === null ? null : token(value, label);
}

function token(value: unknown, label: string): string {
	if (typeof value !== 'string' || !TOKEN.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return value as number;
}

function constraintId(value: DesktopCodecIntegerConstraint): string {
	return typeof value === 'number' ? String(value) : `${String(value.minimum)}-${String(value.maximum)}`;
}

function unsupported(reason: string): DesktopCodecPreflightResult {
	return Object.freeze({ disposition: 'unsupported', reason });
}

function unavailable(reason: string): DesktopCodecPreflightResult {
	return Object.freeze({ disposition: 'unavailable', reason });
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The desktop codec preflight was cancelled.', 'AbortError');
}
