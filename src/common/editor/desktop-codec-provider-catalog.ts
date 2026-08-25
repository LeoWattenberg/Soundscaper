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
	| 'specialized-pcm' | 'libsndfile' | 'libflac' | 'libogg' | 'libvorbis'
	| 'libopus' | 'mpg123' | 'lame' | 'twolame' | 'wavpack' | 'libwebm'
	| 'libvpx' | 'dav1d' | 'svt-av1' | 'libaom';

export interface DesktopCodecIntegerRange {
	readonly minimum: number;
	readonly maximum: number;
	readonly multipleOf: number;
}

export type DesktopCodecIntegerConstraint = number | Readonly<DesktopCodecIntegerRange>;

/** Categorical fields are exact. A numeric range is an explicit qualified constraint, never a wildcard. */
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
	/** Same-target benchmark decision; absence or incomplete evidence admits no bundled AV1 capability. */
	readonly av1Qualification?: BundledDesktopAv1QualificationDecision;
}

/** Runtime view of the complete decision produced by decideAv1CodecQualification. */
export interface BundledDesktopAv1QualificationDecision {
	readonly target: DesktopCodecTarget;
	readonly benchmark: Readonly<{
		readonly toolchain: Readonly<{
			readonly dav1d: Readonly<{ readonly version: string }>;
			readonly libaom: Readonly<{ readonly version: string }>;
			readonly 'svt-av1': Readonly<{ readonly version: string }>;
		}>;
	}> | null;
	readonly evidenceComplete: boolean;
	readonly evidenceCaseCount: number;
	readonly decode: Readonly<{
		readonly defaultCandidate: 'dav1d';
		readonly comparedAgainst: 'libaom';
		readonly admitted: boolean;
		readonly selected: 'dav1d' | null;
		readonly failures: readonly unknown[];
	}>;
	readonly encode: Readonly<{
		readonly defaultCandidate: 'svt-av1';
		readonly fallbackCandidate: 'libaom' | null;
		readonly admitted: boolean;
		readonly selected: 'svt-av1' | 'libaom' | null;
		readonly defaultFailures: readonly unknown[];
		readonly fallbackFailures: readonly unknown[] | null;
	}>;
}

export interface DesktopCodecQualifiedCapability {
	readonly capability: DesktopCodecCapability;
	readonly implementation: string;
}

export interface OperatingSystemDesktopCodecProviderOptions {
	readonly target: DesktopCodecTarget;
	readonly osVersion: string;
	readonly capabilityGeneration: string;
	readonly canaryQualifiedCapabilities: readonly DesktopCodecQualifiedCapability[];
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

export interface ExternalFfmpegQualifiedCapability extends DesktopCodecQualifiedCapability {
	readonly requires: ExternalFfmpegCapabilityRequirements;
}

export interface ExternalFfmpegDesktopCodecProviderOptions {
	readonly target: DesktopCodecTarget;
	readonly version: string;
	readonly capabilityGeneration: string;
	readonly capabilitySets: ExternalFfmpegCapabilitySets;
	readonly qualifiedCapabilities: readonly ExternalFfmpegQualifiedCapability[];
}

interface CapabilityBinding extends DesktopCodecQualifiedCapability {
	readonly capability: DesktopCodecCapability;
}

const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9+._:/-]{0,127}$/u;
const AUDIO_RATE = Object.freeze({ minimum: 1, maximum: 768_000, multipleOf: 1 });
const AUDIO_CHANNELS = Object.freeze({ minimum: 1, maximum: 64, multipleOf: 1 });
const VIDEO_DIMENSION = Object.freeze({ minimum: 16, maximum: 8_192, multipleOf: 2 });

export function createBundledDesktopCodecProvider(
	options: BundledDesktopCodecProviderOptions,
): DesktopCodecCatalogProvider {
	const target = desktopTarget(options?.target);
	const generation = token(options?.capabilityGeneration, 'bundled capability generation');
	const inventory = validateBundledInventory(options?.inventory);
	const qualification = targetAv1Qualification(target, options?.av1Qualification);
	const bindings = bundledBindings(target, inventory, qualification);
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
	const target = desktopTarget(options?.target);
	const version = token(options?.osVersion, 'operating-system version');
	const generation = token(options?.capabilityGeneration, 'operating-system capability generation');
	const supplied = validateQualifiedCapabilities(options?.canaryQualifiedCapabilities, 'OS canary');
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
		unsupportedReason: 'No exact canary-qualified operating-system codec tuple matches this operation.',
	});
}

export function createExternalFfmpegDesktopCodecProvider(
	options: ExternalFfmpegDesktopCodecProviderOptions,
): DesktopCodecCatalogProvider {
	const target = desktopTarget(options?.target);
	const version = externalFfmpegVersion(options?.version);
	const generation = token(options?.capabilityGeneration, 'external FFmpeg capability generation');
	const sets = validateExternalCapabilitySets(options?.capabilitySets);
	if (!Array.isArray(options?.qualifiedCapabilities)) {
		throw new TypeError('External FFmpeg qualified capabilities are invalid.');
	}
	const bindings = options.qualifiedCapabilities.map((entry) => {
		const [binding] = validateQualifiedCapabilities([entry], 'external FFmpeg');
		if (!binding) throw new TypeError('An external FFmpeg capability is invalid.');
		const requirements = validateExternalRequirements(entry.requires, binding.capability.direction);
		return Object.freeze({ binding, requirements });
	}).filter(({ requirements }) => requirements.every(({ kind, name }) => sets[kind].has(name)))
		.map(({ binding }) => binding);
	return provider({
		kind: 'external-ffmpeg', target, id: `external-ffmpeg-${target}`,
		implementation: 'ffmpeg-cli', version, capabilityGeneration: generation, bindings,
		unavailableReason: null,
		unsupportedReason: 'External FFmpeg has no exact probed and qualified capability for this operation.',
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
	target: DesktopCodecTarget,
	inventory: Readonly<Partial<Record<BundledDesktopCodecComponent, string>>>,
	av1Qualification: BundledDesktopAv1QualificationDecision | null,
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
	const video = (
		codec: string, directions: readonly ('encode' | 'decode')[], profilesAndFormats: readonly (readonly [string | null, string])[],
		implementation: string, components: readonly BundledDesktopCodecComponent[],
	) => {
		for (const direction of directions) for (const [profile, pixelFormat] of profilesAndFormats) definitions.push({
			capability: capability({
				id: `${implementation}-${direction}-webm-${profile ?? 'default'}-${pixelFormat}`,
				direction, mediaKind: 'video', container: 'webm', codec, profile,
				sampleFormat: null, pixelFormat, sampleRate: null, channelCount: null,
				width: VIDEO_DIMENSION, height: VIDEO_DIMENSION,
			}), implementation, components,
		});
	};
	audio(['wav', 'bwf', 'bw64', 'aiff'], 'pcm', ['encode', 'decode'],
		['u8', 's16', 's24', 's32', 'f32', 'f64'], [AUDIO_RATE], AUDIO_CHANNELS,
		'specialized-pcm', ['specialized-pcm']);
	audio(['flac'], 'flac', ['encode', 'decode'], ['s16', 's24'], [AUDIO_RATE],
		{ minimum: 1, maximum: 8, multipleOf: 1 }, 'libflac', ['libsndfile', 'libflac']);
	audio(['ogg'], 'vorbis', ['encode', 'decode'], ['f32p'], [AUDIO_RATE],
		{ minimum: 1, maximum: 8, multipleOf: 1 }, 'libvorbis', ['libsndfile', 'libogg', 'libvorbis']);
	audio(['ogg'], 'opus', ['encode', 'decode'], ['f32p'], [8_000, 12_000, 16_000, 24_000, 48_000],
		{ minimum: 1, maximum: 8, multipleOf: 1 }, 'libopus', ['libogg', 'libopus']);
	audio(['mp3'], 'mp3', ['decode'], ['f32'], [32_000, 44_100, 48_000],
		{ minimum: 1, maximum: 2, multipleOf: 1 }, 'mpg123', ['mpg123']);
	audio(['mp3'], 'mp3', ['encode'], ['f32p'], [32_000, 44_100, 48_000],
		{ minimum: 1, maximum: 2, multipleOf: 1 }, 'lame', ['lame']);
	audio(['mp2'], 'mp2', ['encode'], ['f32p'], [32_000, 44_100, 48_000],
		{ minimum: 1, maximum: 2, multipleOf: 1 }, 'twolame', ['twolame']);
	audio(['mp2'], 'mp2', ['decode'], ['f32'], [32_000, 44_100, 48_000],
		{ minimum: 1, maximum: 2, multipleOf: 1 }, 'mpg123', ['mpg123']);
	audio(['wavpack'], 'wavpack', ['encode', 'decode'], ['s16', 's24', 's32', 'f32'], [AUDIO_RATE],
		{ minimum: 1, maximum: 8, multipleOf: 1 }, 'wavpack', ['wavpack']);
	video('vp8', ['encode', 'decode'], [[null, 'yuv420p']], 'libvpx', ['libwebm', 'libvpx']);
	video('vp9', ['encode', 'decode'], [['profile-0', 'yuv420p'], ['profile-2', 'yuv420p10le']],
		'libvpx', ['libwebm', 'libvpx']);
	if (qualifiedAv1Decoder(av1Qualification, inventory)) {
		video('av1', ['decode'], [['main', 'yuv420p'], ['main', 'yuv420p10le']],
			'dav1d', ['libwebm', 'dav1d']);
	}
	const encoder = qualifiedAv1Encoder(target, av1Qualification, inventory);
	if (encoder === 'svt-av1') {
		video('av1', ['encode'], [['main', 'yuv420p'], ['main', 'yuv420p10le']],
			'svt-av1', ['libwebm', 'svt-av1']);
	} else if (encoder === 'libaom') {
		video('av1', ['encode'], [['main', 'yuv420p'], ['main', 'yuv420p10le']],
			'libaom', ['libwebm', 'libaom']);
	}
	return Object.freeze(definitions
		.filter(({ components }) => components.every((component) => inventory[component] !== undefined))
		.map(({ capability: admitted, implementation }) => Object.freeze({ capability: admitted, implementation })));
}

function targetAv1Qualification(
	target: DesktopCodecTarget, value: BundledDesktopAv1QualificationDecision | undefined,
): BundledDesktopAv1QualificationDecision | null {
	if (value === undefined) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value) || value.target !== target) {
		throw new TypeError('Bundled AV1 qualification must name the same desktop target as its provider.');
	}
	return value;
}

function completeAv1Qualification(
	value: BundledDesktopAv1QualificationDecision | null,
): value is BundledDesktopAv1QualificationDecision & Readonly<{
	benchmark: NonNullable<BundledDesktopAv1QualificationDecision['benchmark']>;
}> {
	return value !== null && value.evidenceComplete === true && value.evidenceCaseCount === 12
		&& value.benchmark !== null;
}

function qualifiedAv1Decoder(
	value: BundledDesktopAv1QualificationDecision | null,
	inventory: Readonly<Partial<Record<BundledDesktopCodecComponent, string>>>,
): boolean {
	return completeAv1Qualification(value)
		&& value.decode.defaultCandidate === 'dav1d' && value.decode.comparedAgainst === 'libaom'
		&& value.decode.admitted === true && value.decode.selected === 'dav1d'
		&& value.decode.failures.length === 0
		&& value.benchmark.toolchain.dav1d.version === inventory.dav1d;
}

function qualifiedAv1Encoder(
	target: DesktopCodecTarget, value: BundledDesktopAv1QualificationDecision | null,
	inventory: Readonly<Partial<Record<BundledDesktopCodecComponent, string>>>,
): 'svt-av1' | 'libaom' | null {
	if (!completeAv1Qualification(value) || value.encode.admitted !== true) return null;
	if (value.encode.selected === 'svt-av1' && value.encode.defaultCandidate === 'svt-av1'
		&& value.encode.defaultFailures.length === 0
		&& value.benchmark.toolchain['svt-av1'].version === inventory['svt-av1']) return 'svt-av1';
	if (target === 'win-arm64' && value.encode.selected === 'libaom'
		&& value.encode.defaultCandidate === 'svt-av1' && value.encode.defaultFailures.length > 0
		&& value.encode.fallbackCandidate === 'libaom' && value.encode.fallbackFailures?.length === 0
		&& value.benchmark.toolchain.libaom.version === inventory.libaom) return 'libaom';
	return null;
}

function capability(value: DesktopCodecCapability): DesktopCodecCapability {
	return cloneCapability(value);
}

function validateQualifiedCapabilities(value: unknown, label: string): readonly CapabilityBinding[] {
	if (!Array.isArray(value) || value.length > 4_096) throw new TypeError(`${label} capabilities are invalid.`);
	const identifiers = new Set<string>();
	return Object.freeze(value.map((candidate: unknown) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError(`A ${label} capability is invalid.`);
		}
		const entry = candidate as DesktopCodecQualifiedCapability;
		const admitted = cloneCapability(entry.capability);
		if (identifiers.has(admitted.id)) throw new TypeError(`${label} capability identifiers must be unique.`);
		identifiers.add(admitted.id);
		return Object.freeze({ capability: admitted, implementation: token(entry.implementation, `${label} implementation`) });
	}));
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
		'specialized-pcm', 'libsndfile', 'libflac', 'libogg', 'libvorbis', 'libopus', 'mpg123',
		'lame', 'twolame', 'wavpack', 'libwebm', 'libvpx', 'dav1d', 'svt-av1', 'libaom',
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
