/* SPDX-License-Identifier: AGPL-3.0-only */
/** Closed grants and terminal results for contract-v1 media and OpenFX jobs. */

import {
	HELPER_DATA_PLANE_MAXIMUM_BYTES,
	type HelperDataPlaneBinding,
	validateHelperDataPlaneBinding,
} from './helper-data-plane.ts';
import {
	type HelperDataPlaneInputReservation,
	validateHelperDataPlaneInputReservation,
} from './helper-data-plane-input-reservation.ts';
import {
	type HelperDataPlaneOutputReservation,
	validateHelperDataPlaneOutputReservation,
} from './helper-data-plane-output-reservation.ts';
import {
	HelperContractViolationError,
	assertHelperWireEnvelope,
} from './helper-wire-admission.ts';
import {
	type HelperMediaImageSequenceDecodeGrant,
	type HelperNativeInputRole,
	validateHelperMediaImageSequenceDecodeGrant,
	validateHelperNativeInputRole,
} from './helper-native-image-sequence-grant.ts';
import {
	type HelperOfxHostJobGrantV1OrV2,
	validateHelperOfxHostJobGrantV1OrV2,
} from './helper-native-ofx-host-grant-v2.ts';
import { helperNativeOfxHostResourceUsage } from './helper-native-ofx-resource-usage.ts';
import {
	type HelperOpenFxPluginCustody,
	validateHelperOpenFxPluginCustody,
} from './helper-native-ofx-plugin-custody.ts';
import {
	type HelperOfxScanJobGrant,
	validateHelperOfxScanJobGrant,
} from './helper-native-ofx-scan-grant.ts';
import { assertHelperMediaFileRoles } from './helper-native-media-file-roles.ts';
import { type HelperNativeMediaEncodeBackend, validateHelperNativeMediaEncodeBackend } from './helper-native-media-backend.ts';
import {
	type HelperMediaProxyRecipeGrant,
	validateHelperMediaProxyRecipeGrant,
} from './helper-native-proxy-recipe-grant.ts';
import {
	type HelperOutputFileGrant,
	type HelperOutputGrant,
	isHelperOutputDirectoryGrant,
	validateHelperOutputGrant,
} from './helper-native-output-grant.ts';
import {
	type HelperVideoTimingAssetGrant,
	validateHelperVideoTimingAssetGrants,
} from './helper-native-video-timing-grant.ts';
export { HELPER_NATIVE_INPUT_ROLES } from './helper-native-image-sequence-grant.ts';
export {
	OFX_RGBA_FRAME_MAXIMUM_BYTES,
	OFX_RGBA_FRAME_MAXIMUM_DIMENSION,
	OFX_RGBA_FRAME_MAXIMUM_ROW_BYTES,
	OFX_RGBA_FRAME_SET_MAXIMUM_BYTES,
} from './helper-native-ofx-host-grant.ts';
export type {
	HelperMediaImageSequenceDecodeGrant,
	HelperNativeInputRole,
} from './helper-native-image-sequence-grant.ts';
export type { HelperVideoTimingAssetGrant } from './helper-native-video-timing-grant.ts';
export type {
	HelperOutputDirectoryGrant,
	HelperOutputFileGrant,
	HelperOutputGrant,
} from './helper-native-output-grant.ts';
export type { HelperOfxVideoTimingAssetGrant } from './helper-native-ofx-video-timing-grant.ts';
export type { HelperMediaProxyRecipeGrant } from './helper-native-proxy-recipe-grant.ts';
export type {
	HelperOfxHostJobGrant,
	HelperOfxInputFrameGrant,
	HelperOfxOutputFrameGrant,
} from './helper-native-ofx-host-grant.ts';
export type {
	HelperOfxHostJobGrantV1OrV2,
	HelperOfxHostJobGrantV2,
} from './helper-native-ofx-host-grant-v2.ts';
export type { HelperOfxInteractJobGrantV1 } from './helper-native-ofx-interact-grant.ts';
export type { HelperOfxScanJobGrant } from './helper-native-ofx-scan-grant.ts';
export type {
	HelperOpenFxPluginCustody,
	HelperOpenFxPluginRuntimeFile,
} from './helper-native-ofx-plugin-custody.ts';
export {
	validateHelperNativeJobResult,
} from './helper-native-job-result.ts';
export type {
	HelperFileOutputJobResult,
	HelperNativeJobResultByKind,
	HelperOfxScanJobResult,
	HelperStreamOutputJobResult,
	HelperOfxHostJobResult,
	HelperOfxInteractJobResultV1,
	HelperTemporaryOutputResult,
	HelperTemporaryOutputTreeResult,
} from './helper-native-job-result.ts';
export const HELPER_NATIVE_JOB_KINDS = Object.freeze([
	'media-decode', 'media-encode', 'media-render', 'media-proxy',
	'ofx-scan',
	'ofx-host',
] as const);
export type HelperNativeJobKind = (typeof HELPER_NATIVE_JOB_KINDS)[number];
export const HELPER_EXECUTABLE_ROLES = Object.freeze([
	'ffmpeg', 'ffprobe', 'ofx-scanner', 'ofx-host', 'ofx-plugin',
] as const);
export type HelperExecutableRole = (typeof HELPER_EXECUTABLE_ROLES)[number];
export interface HelperNativeFileIdentity {
	readonly dev: number;
	readonly ino: number;
}
export interface HelperExecutableGrant {
	readonly role: HelperExecutableRole;
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly identity: Readonly<HelperNativeFileIdentity>;
	readonly custody?: HelperOpenFxPluginCustody;
}
export interface HelperFileInputGrant {
	readonly type: 'file';
	readonly role: HelperNativeInputRole;
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly identity: Readonly<HelperNativeFileIdentity>;
}
export interface HelperStreamInputGrant {
	readonly type: 'stream';
	readonly role: HelperNativeInputRole;
	readonly binding: HelperDataPlaneBinding | HelperDataPlaneInputReservation;
}

export type HelperNativeInputGrant = HelperFileInputGrant | HelperStreamInputGrant;
export interface HelperScratchGrant {
	readonly rootPath: string;
	readonly rootIdentity: Readonly<HelperNativeFileIdentity>;
	readonly reservationId: string;
	readonly maximumBytes: number;
}

interface HelperMediaStreamJobGrantBase {
	readonly executable: HelperExecutableGrant;
	readonly plan: HelperDataPlaneBinding;
	readonly sources: readonly HelperNativeInputGrant[];
	readonly videoTimingAssets?: readonly HelperVideoTimingAssetGrant[];
	readonly scratch: HelperScratchGrant;
}

export interface HelperMediaOrdinaryDecodeJobGrant extends HelperMediaStreamJobGrantBase {
	readonly output: HelperDataPlaneBinding;
	readonly imageSequence?: never;
}

export interface HelperMediaImageSequenceDecodeJobGrant extends HelperMediaStreamJobGrantBase {
	/** Still decode has no caller-known digest; completion authenticates it inside this bound. */
	readonly output: HelperDataPlaneOutputReservation;
	readonly imageSequence: HelperMediaImageSequenceDecodeGrant;
}

interface HelperMediaFileJobGrant {
	readonly executable: HelperExecutableGrant;
	readonly backend: HelperNativeMediaEncodeBackend;
	readonly plan: HelperDataPlaneBinding;
	readonly sources: readonly HelperNativeInputGrant[];
	readonly videoTimingAssets?: readonly HelperVideoTimingAssetGrant[];
	readonly output: HelperOutputGrant;
	readonly scratch: HelperScratchGrant;
}

export type HelperMediaDecodeJobGrant =
	| HelperMediaOrdinaryDecodeJobGrant
	| HelperMediaImageSequenceDecodeJobGrant;
export type HelperMediaEncodeJobGrant = HelperMediaFileJobGrant;
export type HelperMediaRenderJobGrant = HelperMediaFileJobGrant;

export interface HelperMediaProxyJobGrant {
	readonly executable: HelperExecutableGrant;
	readonly plan: HelperDataPlaneBinding;
	readonly source: HelperNativeInputGrant;
	readonly videoTimingAssets?: readonly HelperVideoTimingAssetGrant[];
	readonly proxyRecipe: HelperMediaProxyRecipeGrant;
	readonly output: HelperOutputFileGrant;
	readonly scratch: HelperScratchGrant;
}

export interface HelperNativeJobGrantByKind {
	readonly 'media-decode': HelperMediaDecodeJobGrant;
	readonly 'media-encode': HelperMediaEncodeJobGrant;
	readonly 'media-render': HelperMediaRenderJobGrant;
	readonly 'media-proxy': HelperMediaProxyJobGrant;
	readonly 'ofx-scan': HelperOfxScanJobGrant;
	readonly 'ofx-host': HelperOfxHostJobGrantV1OrV2;
}

export interface HelperNativeJobResourceUsage {
	readonly inputBytes: number;
	readonly outputBytes: number;
	readonly scratchBytes: number;
	readonly dataPlaneBytes: number;
	readonly maximumInFlightChunks: number;
}

const MEDIA_STREAM_KEYS = Object.freeze(['executable', 'plan', 'sources', 'output', 'scratch']);
const MEDIA_SEQUENCE_STREAM_KEYS = Object.freeze([...MEDIA_STREAM_KEYS, 'imageSequence']);
const MEDIA_FILE_KEYS = Object.freeze([...MEDIA_STREAM_KEYS, 'backend']);
const TIMING_KEY = 'videoTimingAssets';
const MEDIA_PROXY_KEYS = Object.freeze([
	'executable', 'plan', 'source', 'proxyRecipe', 'output', 'scratch',
]);
const EXECUTABLE_KEYS = Object.freeze(['role', 'path', 'bytes', 'sha256', 'identity']);
const PLUGIN_EXECUTABLE_KEYS = Object.freeze([...EXECUTABLE_KEYS, 'custody']);
const FILE_INPUT_KEYS = Object.freeze(['type', 'role', 'path', 'bytes', 'sha256', 'identity']);
const STREAM_INPUT_KEYS = Object.freeze(['type', 'role', 'binding']);
const SCRATCH_KEYS = Object.freeze(['rootPath', 'rootIdentity', 'reservationId', 'maximumBytes']);
const IDENTITY_KEYS = Object.freeze(['dev', 'ino']);
const SHA256 = /^[a-f\d]{64}$/u;
const RESERVATION_ID = /^[a-f\d]{40}$/u;
const MAXIMUM_INPUTS = 4_096;
const MAXIMUM_PATH_BYTES = 4_096;

export function validateHelperNativeJobGrant<Kind extends HelperNativeJobKind>(
	kind: Kind,
	value: unknown,
): HelperNativeJobGrantByKind[Kind] {
	try {
		assertHelperWireEnvelope(value);
		if (kind === 'media-decode') return validateMediaStreamGrant(value) as HelperNativeJobGrantByKind[Kind];
		if (kind === 'media-encode' || kind === 'media-render') {
			return validateMediaFileGrant(value) as HelperNativeJobGrantByKind[Kind];
		}
		if (kind === 'media-proxy') return validateMediaProxyGrant(value) as HelperNativeJobGrantByKind[Kind];
		if (kind === 'ofx-scan') return validateHelperOfxScanJobGrant(value, {
			executable, scratch,
		}) as HelperNativeJobGrantByKind[Kind];
		if (kind === 'ofx-host') return validateHelperOfxHostJobGrantV1OrV2(value, {
			executable, dataBinding, scratch,
		}) as HelperNativeJobGrantByKind[Kind];
		return unsafe('The native helper grant kind is not part of contract v1.');
	} catch (error) {
		if (error instanceof HelperContractViolationError && error.code === 'unsafe-grant') throw error;
		return unsafe(error instanceof Error ? error.message : String(error));
	}
}

export function helperNativeJobGrantResourceUsage<Kind extends HelperNativeJobKind>(
	kind: Kind,
	grant: HelperNativeJobGrantByKind[Kind],
): HelperNativeJobResourceUsage {
	const admitted = validateHelperNativeJobGrant(kind, grant);
	if (kind === 'media-decode') {
		const value = admitted as HelperMediaDecodeJobGrant;
		return usage(value.executable.bytes, value.plan, value.sources, value.output, value.scratch,
			value.videoTimingAssets);
	}
	if (kind === 'media-encode' || kind === 'media-render') {
		const value = admitted as HelperMediaEncodeJobGrant;
		return usage(value.executable.bytes, value.plan, value.sources, value.output, value.scratch,
			value.videoTimingAssets);
	}
	if (kind === 'media-proxy') {
		const value = admitted as HelperMediaProxyJobGrant;
		return usage(value.executable.bytes, value.plan, [value.source], value.output, value.scratch,
			value.videoTimingAssets);
	}
	if (kind === 'ofx-scan') {
		const value = admitted as HelperOfxScanJobGrant;
		return Object.freeze({
			inputBytes: safeSum([value.executable.bytes, value.pluginBinary.custody?.byteLength
				?? value.pluginBinary.bytes]),
			outputBytes: value.descriptor.maximumByteLength,
			scratchBytes: value.scratch.maximumBytes,
			dataPlaneBytes: value.descriptor.maximumByteLength,
			maximumInFlightChunks: value.descriptor.maximumInFlightChunks,
		});
	}
	const value = admitted as HelperOfxHostJobGrantV1OrV2;
	return helperNativeOfxHostResourceUsage(value);
}

function validateMediaStreamGrant(value: unknown): HelperMediaDecodeJobGrant {
	const record = plainRecord(value);
	const timing = timingAssets(record);
	const sequenceValue = Object.hasOwn(record, 'imageSequence')
		? validateHelperMediaImageSequenceDecodeGrant(record.imageSequence) : null;
	exactKeys(record, withTiming(
		sequenceValue === null ? MEDIA_STREAM_KEYS : MEDIA_SEQUENCE_STREAM_KEYS, timing,
	));
	const sourceValues = inputs(record.sources);
	if (sequenceValue === null) {
		assertRoles(sourceValues, ['original'], 'ordinary media decode');
	} else {
		if (sourceValues.length !== 2 || sourceValues.some((input_) => input_.type !== 'file')
			|| sourceValues.filter(({ role }) => role === 'image-sequence-pack').length !== 1
			|| sourceValues.filter(({ role }) => role === 'image-sequence-inventory').length !== 1) {
			unsafe('Image-sequence decode requires one file pack and one file inventory with exact roles.');
		}
	}
	const base = {
		executable: executable(record.executable, 'ffmpeg'),
		plan: dataBinding(record.plan, 'host-to-helper', 'plan'),
		sources: sourceValues,
		...(timing === null ? {} : { videoTimingAssets: timing }),
		scratch: scratch(record.scratch),
	};
	return sequenceValue === null
		? Object.freeze({ ...base, output: dataBinding(record.output, 'helper-to-host', 'output') })
		: Object.freeze({
			...base, output: validateHelperDataPlaneOutputReservation(record.output),
			imageSequence: sequenceValue,
		});
}

function validateMediaFileGrant(value: unknown): HelperMediaEncodeJobGrant {
	const record = plainRecord(value);
	const timing = timingAssets(record);
	exactKeys(record, withTiming(MEDIA_FILE_KEYS, timing));
	const sourceValues = inputs(record.sources);
	assertRoles(
		sourceValues,
		['original', 'evaluated-rgba-frame-pack', 'staged-audio-mix'],
		'media file job',
	);
	assertHelperMediaFileRoles(sourceValues);
	const plan = dataBinding(record.plan, 'host-to-helper', 'plan');
	const output = validateHelperOutputGrant(record.output);
	if (isHelperOutputDirectoryGrant(output) && output.treeIdentity.planFingerprint !== plan.sha256) {
		unsafe('A helper output tree identity disagrees with its exact plan fingerprint.');
	}
	return Object.freeze({
		executable: executable(record.executable, 'ffmpeg'),
		backend: validateHelperNativeMediaEncodeBackend(record.backend),
		plan,
		sources: sourceValues,
		...(timing === null ? {} : { videoTimingAssets: timing }),
		output,
		scratch: scratch(record.scratch),
	});
}

function validateMediaProxyGrant(value: unknown): HelperMediaProxyJobGrant {
	const record = plainRecord(value);
	const timing = timingAssets(record);
	exactKeys(record, withTiming(MEDIA_PROXY_KEYS, timing));
	const sourceValue = input(record.source);
	assertRoles([sourceValue], ['original'], 'media proxy');
	const output = validateHelperOutputGrant(record.output);
	if (isHelperOutputDirectoryGrant(output)) unsafe('A media proxy output must be one regular file.');
	return Object.freeze({
		executable: executable(record.executable, 'ffmpeg'),
		plan: dataBinding(record.plan, 'host-to-helper', 'plan'),
		source: sourceValue,
		...(timing === null ? {} : { videoTimingAssets: timing }),
		proxyRecipe: validateHelperMediaProxyRecipeGrant(record.proxyRecipe),
		output,
		scratch: scratch(record.scratch),
	});
}

function timingAssets(record: Record<string, unknown>): readonly HelperVideoTimingAssetGrant[] | null {
	return Object.hasOwn(record, TIMING_KEY)
		? validateHelperVideoTimingAssetGrants(record[TIMING_KEY]) : null;
}

function withTiming(keys: readonly string[], timing: readonly HelperVideoTimingAssetGrant[] | null): readonly string[] {
	return timing === null ? keys : [...keys, TIMING_KEY];
}

function executable(value: unknown, expectedRole: HelperExecutableRole): HelperExecutableGrant {
	const record = plainRecord(value);
	const hasCustody = expectedRole === 'ofx-plugin' && Object.hasOwn(record, 'custody');
	exactKeys(record, hasCustody ? PLUGIN_EXECUTABLE_KEYS : EXECUTABLE_KEYS);
	if (record.role !== expectedRole) unsafe(`A helper job requires the exact ${expectedRole} executable role.`);
	const base = {
		role: expectedRole,
		path: absolutePath(record.path, 'executable'),
		bytes: bytes(record.bytes, 'executable'),
		sha256: sha256(record.sha256, true),
		identity: identity(record.identity),
	};
	return Object.freeze(hasCustody ? {
		...base, custody: validateHelperOpenFxPluginCustody(record.custody, base),
	} : base);
}

function inputs(value: unknown): readonly HelperNativeInputGrant[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAXIMUM_INPUTS) {
		unsafe(`A helper native job requires between one and ${String(MAXIMUM_INPUTS)} inputs.`);
	}
	return Object.freeze(value.map(input));
}

function input(value: unknown): HelperNativeInputGrant {
	const record = plainRecord(value);
	if (record.type === 'file') {
		exactKeys(record, FILE_INPUT_KEYS);
		return Object.freeze({
			type: 'file',
			role: validateHelperNativeInputRole(record.role),
			path: absolutePath(record.path, 'input'),
			bytes: bytes(record.bytes, 'input'),
			sha256: sha256(record.sha256, true),
			identity: identity(record.identity),
		});
	}
	if (record.type === 'stream') {
		exactKeys(record, STREAM_INPUT_KEYS);
		const binding = plainRecord(record.binding);
		return Object.freeze({
			type: 'stream',
			role: validateHelperNativeInputRole(record.role),
			binding: Object.hasOwn(binding, 'authentication')
				? validateHelperDataPlaneInputReservation(binding)
				: dataBinding(binding, 'host-to-helper', 'input'),
		});
	}
	return unsafe('A helper native input must be an exact file or MessagePort stream grant.');
}

function assertRoles(
	values: readonly HelperNativeInputGrant[],
	allowed: readonly HelperNativeInputRole[],
	label: string,
): void {
	if (values.some(({ role }) => !allowed.includes(role))) {
		unsafe(`A ${label} grant contains an input role outside its closed authority.`);
	}
}

function scratch(value: unknown): HelperScratchGrant {
	const record = plainRecord(value);
	exactKeys(record, SCRATCH_KEYS);
	if (typeof record.reservationId !== 'string' || !RESERVATION_ID.test(record.reservationId)) {
		unsafe('A helper scratch grant must name its fixed-length reservation id.');
	}
	return Object.freeze({
		rootPath: absolutePath(record.rootPath, 'scratch root'),
		rootIdentity: identity(record.rootIdentity),
		reservationId: record.reservationId,
		maximumBytes: bytes(record.maximumBytes, 'scratch maximum'),
	});
}

function dataBinding(
	value: unknown,
	direction: HelperDataPlaneBinding['direction'],
	label: string,
): HelperDataPlaneBinding {
	const binding = validateHelperDataPlaneBinding(value);
	if (binding.direction !== direction) unsafe(`A helper ${label} stream has the wrong direction.`);
	return binding;
}

function usage(
	executableBytes: number,
	plan: HelperDataPlaneBinding,
	inputs_: readonly HelperNativeInputGrant[],
	output: HelperDataPlaneBinding | HelperDataPlaneOutputReservation | HelperOutputGrant,
	scratch_: HelperScratchGrant,
	timing: readonly HelperVideoTimingAssetGrant[] | undefined,
): HelperNativeJobResourceUsage {
	const outputBytes = 'byteLength' in output ? output.byteLength
		: 'maximumByteLength' in output ? output.maximumByteLength : output.maximumBytes;
	return Object.freeze({
		inputBytes: safeSum([
			executableBytes, plan.byteLength, ...inputs_.map(inputBytes),
			...(timing ?? []).map(({ bytes: byteLength }) => byteLength),
		]),
		outputBytes,
		scratchBytes: scratch_.maximumBytes,
		dataPlaneBytes: safeSum([
			plan.byteLength,
			...inputs_.map(inputDataPlaneBytes),
			...('byteLength' in output ? [output.byteLength]
				: 'maximumByteLength' in output ? [output.maximumByteLength] : []),
		]),
		maximumInFlightChunks: maximumInFlightChunks(
			[plan, ...(isDataPlaneOutput(output) ? [output] : [])],
			inputs_,
		),
	});
}

function isDataPlaneOutput(
	value: HelperDataPlaneBinding | HelperDataPlaneOutputReservation | HelperOutputGrant,
): value is HelperDataPlaneBinding | HelperDataPlaneOutputReservation {
	return 'maximumInFlightChunks' in value;
}

function maximumInFlightChunks(
	bindings: readonly Readonly<{ maximumInFlightChunks: number }>[],
	inputs_: readonly HelperNativeInputGrant[] = [],
): number {
	return Math.max(
		0,
		...bindings.map((binding) => binding.maximumInFlightChunks),
		...inputs_.filter((value) => value.type === 'stream')
			.map((value) => value.binding.maximumInFlightChunks),
	);
}

function inputBytes(value: HelperNativeInputGrant): number {
	return value.type === 'file' ? value.bytes : value.binding.byteLength;
}

function inputDataPlaneBytes(value: HelperNativeInputGrant): number {
	return value.type === 'stream' ? value.binding.byteLength : 0;
}

function identity(value: unknown, grant = true): Readonly<HelperNativeFileIdentity> {
	const record = plainRecord(value, grant);
	exactKeys(record, IDENTITY_KEYS, grant);
	if (!Number.isSafeInteger(record.dev) || Number(record.dev) < 0
		|| !Number.isSafeInteger(record.ino) || Number(record.ino) < 0) {
		if (grant) unsafe('A helper file authority must carry its captured non-negative identity.');
		malformed('A helper file result must carry a non-negative file identity.');
	}
	return Object.freeze({ dev: Number(record.dev), ino: Number(record.ino) });
}

function absolutePath(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || utf8Bytes(value) > MAXIMUM_PATH_BYTES
		|| value.includes('\0')
		|| !(value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\'))
		|| value.split(/[\\/]/u).includes('..')) {
		unsafe(`A helper ${label} authority must be one absolute traversal-free path.`);
	}
	return value;
}

function bytes(value: unknown, label: string): number {
	return boundedBytes(value, label, true);
}

function boundedBytes(value: unknown, label: string, grant: boolean): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > HELPER_DATA_PLANE_MAXIMUM_BYTES) {
		if (grant) unsafe(`A helper ${label} authority must declare its bounded byte length.`);
		malformed(`A helper ${label} result must declare its bounded byte length.`);
	}
	return Number(value);
}

function sha256(value: unknown, grant: boolean): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		if (grant) unsafe('A helper executable authority must carry lowercase SHA-256.');
		malformed('A helper file result must carry lowercase SHA-256.');
	}
	return value;
}

function plainRecord(value: unknown, grant = true): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		if (grant) unsafe('A helper native capability grant must be a plain record.');
		malformed('A helper native result must be a plain record.');
	}
	return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], grant = true): void {
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		if (grant) unsafe('A helper native grant must carry exactly its kind-specific schema keys.');
		malformed('A helper native result must carry exactly its kind-specific schema keys.');
	}
}

function safeSum(values: readonly number[]): number {
	let total = 0;
	for (const value of values) {
		total += value;
		if (!Number.isSafeInteger(total)) unsafe('A helper native grant has an unsafe aggregate byte count.');
	}
	return total;
}

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function unsafe(message: string): never {
	throw new HelperContractViolationError('unsafe-grant', message);
}

function malformed(message: string): never {
	throw new HelperContractViolationError('malformed', message);
}
