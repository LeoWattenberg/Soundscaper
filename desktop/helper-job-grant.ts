/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Closed job-kind and main-to-helper authority families. Renderers never see
 * these grants: main resolves opaque renderer capabilities into the minimum
 * concrete authority one helper job needs, and each kind admits exact keys.
 */

import {
	HelperContractViolationError,
	assertHelperWireEnvelope,
} from './helper-wire-admission.ts';
import {
	HELPER_NATIVE_JOB_KINDS,
	type HelperNativeJobGrantByKind,
	type HelperNativeJobKind,
	type HelperNativeJobResourceUsage,
	type HelperNativeJobResultByKind,
	helperNativeJobGrantResourceUsage,
	validateHelperNativeJobGrant,
	validateHelperNativeJobResult,
} from './helper-native-job-contract.ts';

export {
	HELPER_EXECUTABLE_ROLES,
	HELPER_NATIVE_INPUT_ROLES,
	HELPER_NATIVE_JOB_KINDS,
} from './helper-native-job-contract.ts';
export type {
	HelperExecutableGrant,
	HelperExecutableRole,
	HelperFileInputGrant,
	HelperFileOutputJobResult,
	HelperMediaDecodeJobGrant,
	HelperMediaEncodeJobGrant,
	HelperMediaImageSequenceDecodeGrant,
	HelperMediaImageSequenceDecodeJobGrant,
	HelperMediaProxyJobGrant,
	HelperMediaProxyRecipeGrant,
	HelperMediaRenderJobGrant,
	HelperNativeFileIdentity,
	HelperNativeInputGrant,
	HelperNativeInputRole,
	HelperNativeJobKind,
	HelperNativeJobResourceUsage,
	HelperOfxInputFrameGrant,
	HelperOfxHostJobGrant,
	HelperOfxScanJobGrant,
	HelperOfxScanJobResult,
	HelperOutputFileGrant,
	HelperScratchGrant,
	HelperStreamInputGrant,
	HelperStreamOutputJobResult,
	HelperTemporaryOutputResult,
} from './helper-native-job-contract.ts';

export const HELPER_JOB_KINDS = Object.freeze([
	'probe-video-source',
	'audio-device',
	'plugin-scan',
	'plugin-host',
	...HELPER_NATIVE_JOB_KINDS,
] as const);

export type HelperJobKind = (typeof HELPER_JOB_KINDS)[number];

/** The current probe utility must not advertise unimplemented future kinds. */
export const HELPER_PROBE_JOB_KINDS = Object.freeze([
	'probe-video-source',
] as const satisfies readonly HelperJobKind[]);

/**
 * `pipewire` is the preferred Linux backend: it is the session manager on every
 * mainstream desktop, and reaching it through the ALSA or JACK compatibility
 * shims would make us a compat client rather than a graph node the user can see
 * and route. ALSA stays for direct `hw:` access when a user wants the card to
 * themselves. Adding this value is a deliberate contract-v1 change, not an
 * incidental one.
 *
 * `synthetic` is the milestone-5A-0c loopback proof backend. It is a real
 * backend on the wire so the transport, supervision and fault suites exercise
 * exactly the admission path an operating-system backend will, but it never
 * names an operating-system device and is never offered as one: the device
 * inventory refuses to publish it.
 */
export const HELPER_AUDIO_BACKENDS = Object.freeze([
	'coreaudio', 'wasapi', 'asio', 'jack', 'alsa', 'pipewire', 'synthetic',
] as const);
export type HelperAudioBackend = (typeof HELPER_AUDIO_BACKENDS)[number];

/**
 * The reserved handle that asks a backend to describe itself rather than open a
 * device. Discovery is a distinct operation with a distinct answer, but it
 * travels as an ordinary audio-device grant so it passes exactly the admission
 * an open does — a second grant family would be a second thing to get wrong. It
 * belongs to the grant vocabulary, so every main-side caller names it from here.
 */
export const NATIVE_AUDIO_INVENTORY_DEVICE_HANDLE = 'inventory';

/**
 * `fixture` is the benign proof format milestone 5A-3 asks for. It is a real
 * format on the wire so the scanner, registry, host and fault suites exercise
 * exactly the admission a licensed format will, but it names only our own
 * fixture binaries: every third-party format below stays fail-closed behind its
 * licensing row, and the format waits rather than the gate bending.
 */
export const HELPER_PLUGIN_FORMATS = Object.freeze([
	'vst3', 'clap', 'au', 'lv2', 'fixture',
] as const);
export type HelperPluginFormat = (typeof HELPER_PLUGIN_FORMATS)[number];

export interface HelperFileIdentity {
	readonly dev: number;
	readonly ino: number;
}

/** Existing probe behavior: one main-verified media file, unchanged on wire. */
export interface HelperProbeJobGrant {
	readonly mediaPath: string;
	readonly mediaBytes: number;
	readonly identity: Readonly<HelperFileIdentity>;
}

export interface HelperAudioDeviceJobGrant {
	readonly backend: HelperAudioBackend;
	readonly deviceHandle: string;
	readonly direction: 'input' | 'output' | 'duplex';
	readonly mode: 'shared' | 'exclusive';
}

export interface HelperPluginScanJobGrant {
	readonly rootPath: string;
	readonly format: HelperPluginFormat;
	readonly identity: Readonly<HelperFileIdentity>;
}

export interface HelperPluginHostJobGrant {
	readonly binaryPath: string;
	readonly binaryBytes: number;
	readonly binarySha256: string;
	readonly format: HelperPluginFormat;
	readonly identity: Readonly<HelperFileIdentity>;
}

export interface HelperLegacyJobGrantByKind {
	readonly 'probe-video-source': HelperProbeJobGrant;
	readonly 'audio-device': HelperAudioDeviceJobGrant;
	readonly 'plugin-scan': HelperPluginScanJobGrant;
	readonly 'plugin-host': HelperPluginHostJobGrant;
}

export type HelperJobGrantByKind = HelperLegacyJobGrantByKind & HelperNativeJobGrantByKind;

export interface HelperLegacyJobResultByKind {
	readonly 'probe-video-source': unknown;
	readonly 'audio-device': unknown;
	readonly 'plugin-scan': unknown;
	readonly 'plugin-host': unknown;
}

export type HelperJobResultByKind = HelperLegacyJobResultByKind & HelperNativeJobResultByKind;

/** The default keeps the existing probe supervisor/service source-compatible. */
export type HelperJobGrant<Kind extends HelperJobKind = 'probe-video-source'> =
	HelperJobGrantByKind[Kind];

export type AnyHelperJobGrant = HelperJobGrant<HelperJobKind>;
export type HelperJobResult<Kind extends HelperJobKind> = HelperJobResultByKind[Kind];

const PROBE_KEYS = Object.freeze(['mediaPath', 'mediaBytes', 'identity']);
const AUDIO_DEVICE_KEYS = Object.freeze(['backend', 'deviceHandle', 'direction', 'mode']);
const PLUGIN_SCAN_KEYS = Object.freeze(['rootPath', 'format', 'identity']);
const PLUGIN_HOST_KEYS = Object.freeze([
	'binaryPath', 'binaryBytes', 'binarySha256', 'format', 'identity',
]);
const IDENTITY_KEYS = Object.freeze(['dev', 'ino']);
const SHA256 = /^[a-f0-9]{64}$/u;

export function validateHelperJobGrant<Kind extends HelperJobKind>(
	kind: Kind,
	value: unknown,
): HelperJobGrant<Kind> {
	if (!(HELPER_JOB_KINDS as readonly string[]).includes(kind)) {
		throw new HelperContractViolationError('unknown-kind', 'The helper grant job kind is not part of contract v1.');
	}
	assertHelperWireEnvelope(value);
	if (kind === 'probe-video-source') return validateProbeGrant(value) as HelperJobGrant<Kind>;
	if (kind === 'audio-device') return validateAudioDeviceGrant(value) as HelperJobGrant<Kind>;
	if (kind === 'plugin-scan') return validatePluginScanGrant(value) as HelperJobGrant<Kind>;
	if (kind === 'plugin-host') return validatePluginHostGrant(value) as HelperJobGrant<Kind>;
	return validateHelperNativeJobGrant(
		kind as HelperNativeJobKind,
		value,
	) as HelperJobGrant<Kind>;
}

/** Total admitted-input accounting used before a supervisor posts any job. */
export function helperJobGrantInputBytes(kind: HelperJobKind, value: unknown): number {
	return helperJobGrantResourceUsage(kind, value).inputBytes;
}

export function helperJobGrantResourceUsage(
	kind: HelperJobKind,
	value: unknown,
): HelperNativeJobResourceUsage {
	const grant: AnyHelperJobGrant = validateHelperJobGrant(kind, value);
	if ((HELPER_NATIVE_JOB_KINDS as readonly string[]).includes(kind)) {
		return helperNativeJobGrantResourceUsage(
			kind as HelperNativeJobKind,
			grant as HelperNativeJobGrantByKind[HelperNativeJobKind],
		);
	}
	let inputBytes = 0;
	if ('mediaBytes' in grant) inputBytes = grant.mediaBytes;
	if ('binaryBytes' in grant) inputBytes = grant.binaryBytes;
	return Object.freeze({
		inputBytes,
		outputBytes: 0,
		scratchBytes: 0,
		dataPlaneBytes: 0,
		maximumInFlightChunks: 0,
	});
}

export function helperJobGrantExceedsResourcePolicy(
	usage: HelperNativeJobResourceUsage,
	policy: Readonly<{
		maximumInputBytes: number;
		maximumOutputBytes?: number;
		maximumScratchBytes?: number;
		maximumDataPlaneBytes?: number;
		maximumInFlightChunks?: number;
	}>,
): boolean {
	return usage.inputBytes > policy.maximumInputBytes
		|| usage.outputBytes > (policy.maximumOutputBytes ?? 0)
		|| usage.scratchBytes > (policy.maximumScratchBytes ?? 0)
		|| usage.dataPlaneBytes > (policy.maximumDataPlaneBytes ?? 0)
		|| usage.maximumInFlightChunks > (policy.maximumInFlightChunks ?? 0);
}

export function validateHelperJobResult<Kind extends HelperJobKind>(
	kind: Kind,
	value: unknown,
	grant: HelperJobGrant<Kind>,
): HelperJobResult<Kind> {
	const admittedGrant = validateHelperJobGrant(kind, grant);
	if ((HELPER_NATIVE_JOB_KINDS as readonly string[]).includes(kind)) {
		return validateHelperNativeJobResult(
			kind as HelperNativeJobKind,
			value,
			admittedGrant as HelperNativeJobGrantByKind[HelperNativeJobKind],
		) as HelperJobResult<Kind>;
	}
	assertHelperWireEnvelope(value);
	return value as HelperJobResult<Kind>;
}

function validateProbeGrant(value: unknown): HelperProbeJobGrant {
	const record = grantRecord(value);
	exactKeys(record, PROBE_KEYS);
	return Object.freeze({
		mediaPath: absolutePath(record.mediaPath, 'media'),
		mediaBytes: byteCount(record.mediaBytes, 'media'),
		identity: fileIdentity(record.identity),
	});
}

function validateAudioDeviceGrant(value: unknown): HelperAudioDeviceJobGrant {
	const record = grantRecord(value);
	exactKeys(record, AUDIO_DEVICE_KEYS);
	const backend = enumValue(record.backend, HELPER_AUDIO_BACKENDS, 'audio backend');
	const deviceHandle = boundedText(record.deviceHandle, 1_024, 'audio device handle');
	if (deviceHandle.includes('\0')) unsafe('A helper audio device handle must not contain NUL.');
	const direction = enumValue(record.direction, ['input', 'output', 'duplex'] as const, 'audio direction');
	const mode = enumValue(record.mode, ['shared', 'exclusive'] as const, 'audio mode');
	return Object.freeze({ backend, deviceHandle, direction, mode });
}

function validatePluginScanGrant(value: unknown): HelperPluginScanJobGrant {
	const record = grantRecord(value);
	exactKeys(record, PLUGIN_SCAN_KEYS);
	return Object.freeze({
		rootPath: absolutePath(record.rootPath, 'plug-in scan root'),
		format: pluginFormat(record.format),
		identity: fileIdentity(record.identity),
	});
}

function validatePluginHostGrant(value: unknown): HelperPluginHostJobGrant {
	const record = grantRecord(value);
	exactKeys(record, PLUGIN_HOST_KEYS);
	if (typeof record.binarySha256 !== 'string' || !SHA256.test(record.binarySha256)) {
		unsafe('A helper plug-in binary grant must carry a lowercase SHA-256 digest.');
	}
	return Object.freeze({
		binaryPath: absolutePath(record.binaryPath, 'plug-in binary'),
		binaryBytes: byteCount(record.binaryBytes, 'plug-in binary'),
		binarySha256: record.binarySha256,
		format: pluginFormat(record.format),
		identity: fileIdentity(record.identity),
	});
}

function fileIdentity(value: unknown): Readonly<HelperFileIdentity> {
	const record = grantRecord(value);
	exactKeys(record, IDENTITY_KEYS);
	if (!Number.isSafeInteger(record.dev) || Number(record.dev) < 0
		|| !Number.isSafeInteger(record.ino) || Number(record.ino) < 0) {
		unsafe('A helper file grant must carry its captured non-negative file identity.');
	}
	return Object.freeze({ dev: Number(record.dev), ino: Number(record.ino) });
}

function absolutePath(value: unknown, label: string): string {
	const path = boundedText(value, 4_096, `${label} path`);
	if (path.includes('\0')
		|| !(path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith('\\\\'))
		|| path.split(/[\\/]/u).includes('..')) {
		unsafe(`A helper ${label} grant must be one absolute, traversal-free path.`);
	}
	return path;
}

function byteCount(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		unsafe(`A helper ${label} grant must declare its byte length.`);
	}
	return Number(value);
}

function pluginFormat(value: unknown): HelperPluginFormat {
	return enumValue(value, HELPER_PLUGIN_FORMATS, 'plug-in format');
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	label: string,
): Values[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		unsafe(`A helper grant must name a supported ${label}.`);
	}
	return value as Values[number];
}

function boundedText(value: unknown, maximumBytes: number, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || utf8ByteLength(value) > maximumBytes) {
		unsafe(`A helper ${label} must be non-empty and no greater than ${String(maximumBytes)} bytes.`);
	}
	return value;
}

function grantRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) {
		unsafe('A helper capability grant must be a plain record.');
	}
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		unsafe('A helper capability grant must carry exactly its kind-specific schema keys.');
	}
}

function unsafe(message: string): never {
	throw new HelperContractViolationError('unsafe-grant', message);
}

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}
