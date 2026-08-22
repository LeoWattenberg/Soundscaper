/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed grants and terminal results for contract-v1 media and OpenFX jobs. */

import {
	HELPER_DATA_PLANE_MAXIMUM_BYTES,
	type HelperDataPlaneBinding,
	validateHelperDataPlaneBinding,
} from './helper-data-plane.ts';
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
	type HelperOfxHostJobGrant,
	validateHelperOfxHostJobGrant,
} from './helper-native-ofx-host-grant.ts';
import { assertHelperMediaFileRoles } from './helper-native-media-file-roles.ts';

export {
	HELPER_NATIVE_INPUT_ROLES,
} from './helper-native-image-sequence-grant.ts';
export type {
	HelperMediaImageSequenceDecodeGrant,
	HelperNativeInputRole,
} from './helper-native-image-sequence-grant.ts';
export type {
	HelperOfxHostJobGrant,
	HelperOfxInputFrameGrant,
} from './helper-native-ofx-host-grant.ts';

export {
	validateHelperNativeJobResult,
} from './helper-native-job-result.ts';
export type {
	HelperFileOutputJobResult,
	HelperNativeJobResultByKind,
	HelperOfxScanJobResult,
	HelperStreamOutputJobResult,
	HelperTemporaryOutputResult,
} from './helper-native-job-result.ts';

export const HELPER_NATIVE_JOB_KINDS = Object.freeze([
	'media-decode',
	'media-encode',
	'media-render',
	'media-proxy',
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
	readonly binding: HelperDataPlaneBinding;
}

export type HelperNativeInputGrant = HelperFileInputGrant | HelperStreamInputGrant;

export interface HelperOutputFileGrant {
	readonly rootPath: string;
	readonly rootIdentity: Readonly<HelperNativeFileIdentity>;
	readonly temporaryPath: string;
	readonly finalPath: string;
	readonly maximumBytes: number;
}

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
	readonly output: HelperDataPlaneBinding;
	readonly scratch: HelperScratchGrant;
}

export interface HelperMediaOrdinaryDecodeJobGrant extends HelperMediaStreamJobGrantBase {
	readonly imageSequence?: never;
}

export interface HelperMediaImageSequenceDecodeJobGrant extends HelperMediaStreamJobGrantBase {
	readonly imageSequence: HelperMediaImageSequenceDecodeGrant;
}

interface HelperMediaFileJobGrant {
	readonly executable: HelperExecutableGrant;
	readonly plan: HelperDataPlaneBinding;
	readonly sources: readonly HelperNativeInputGrant[];
	readonly output: HelperOutputFileGrant;
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
	readonly proxyRecipe: HelperMediaProxyRecipeGrant;
	readonly output: HelperOutputFileGrant;
	readonly scratch: HelperScratchGrant;
}

export interface HelperMediaProxyRecipeGrant {
	readonly id: 'framescaper-native-prores-proxy-mov-v1';
	readonly width: number;
	readonly height: number;
}

export interface HelperOfxScanJobGrant {
	readonly executable: HelperExecutableGrant;
	readonly pluginBinary: HelperExecutableGrant;
	readonly descriptor: HelperDataPlaneBinding;
	readonly scratch: HelperScratchGrant;
}

export interface HelperNativeJobGrantByKind {
	readonly 'media-decode': HelperMediaDecodeJobGrant;
	readonly 'media-encode': HelperMediaEncodeJobGrant;
	readonly 'media-render': HelperMediaRenderJobGrant;
	readonly 'media-proxy': HelperMediaProxyJobGrant;
	readonly 'ofx-scan': HelperOfxScanJobGrant;
	readonly 'ofx-host': HelperOfxHostJobGrant;
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
const MEDIA_FILE_KEYS = MEDIA_STREAM_KEYS;
const MEDIA_PROXY_KEYS = Object.freeze([
	'executable', 'plan', 'source', 'proxyRecipe', 'output', 'scratch',
]);
const OFX_SCAN_KEYS = Object.freeze(['executable', 'pluginBinary', 'descriptor', 'scratch']);
const EXECUTABLE_KEYS = Object.freeze(['role', 'path', 'bytes', 'sha256', 'identity']);
const FILE_INPUT_KEYS = Object.freeze(['type', 'role', 'path', 'bytes', 'sha256', 'identity']);
const STREAM_INPUT_KEYS = Object.freeze(['type', 'role', 'binding']);
const OUTPUT_KEYS = Object.freeze([
	'rootPath', 'rootIdentity', 'temporaryPath', 'finalPath', 'maximumBytes',
]);
const SCRATCH_KEYS = Object.freeze(['rootPath', 'rootIdentity', 'reservationId', 'maximumBytes']);
const PROXY_RECIPE_KEYS = Object.freeze(['id', 'width', 'height']);
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
		if (kind === 'ofx-scan') return validateOfxScanGrant(value) as HelperNativeJobGrantByKind[Kind];
		if (kind === 'ofx-host') return validateHelperOfxHostJobGrant(value, {
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
		return usage(value.executable.bytes, value.plan, value.sources, value.output, value.scratch);
	}
	if (kind === 'media-encode' || kind === 'media-render') {
		const value = admitted as HelperMediaEncodeJobGrant;
		return usage(value.executable.bytes, value.plan, value.sources, value.output, value.scratch);
	}
	if (kind === 'media-proxy') {
		const value = admitted as HelperMediaProxyJobGrant;
		return usage(value.executable.bytes, value.plan, [value.source], value.output, value.scratch);
	}
	if (kind === 'ofx-scan') {
		const value = admitted as HelperOfxScanJobGrant;
		return Object.freeze({
			inputBytes: safeSum([value.executable.bytes, value.pluginBinary.bytes]),
			outputBytes: value.descriptor.byteLength,
			scratchBytes: value.scratch.maximumBytes,
			dataPlaneBytes: value.descriptor.byteLength,
			maximumInFlightChunks: value.descriptor.maximumInFlightChunks,
		});
	}
	const value = admitted as HelperOfxHostJobGrant;
	return Object.freeze({
		inputBytes: safeSum([
			value.executable.bytes,
			value.pluginBinary.bytes,
			value.plan.byteLength,
			...value.inputs.map(({ frame }) => frame.byteLength),
		]),
		outputBytes: value.output.byteLength,
		scratchBytes: value.scratch.maximumBytes,
		dataPlaneBytes: safeSum([
			value.plan.byteLength,
			value.output.byteLength,
			...value.inputs.map(({ frame }) => frame.byteLength),
		]),
		maximumInFlightChunks: Math.max(
			...([value.plan, value.output, ...value.inputs.map(({ frame }) => frame)]
				.map(({ maximumInFlightChunks }) => maximumInFlightChunks)),
		),
	});
}

function validateMediaStreamGrant(value: unknown): HelperMediaDecodeJobGrant {
	const record = plainRecord(value);
	const sequenceValue = Object.hasOwn(record, 'imageSequence')
		? validateHelperMediaImageSequenceDecodeGrant(record.imageSequence) : null;
	exactKeys(record, sequenceValue === null ? MEDIA_STREAM_KEYS : MEDIA_SEQUENCE_STREAM_KEYS);
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
		output: dataBinding(record.output, 'helper-to-host', 'output'),
		scratch: scratch(record.scratch),
	};
	return sequenceValue === null
		? Object.freeze(base)
		: Object.freeze({ ...base, imageSequence: sequenceValue });
}

function validateMediaFileGrant(value: unknown): HelperMediaEncodeJobGrant {
	const record = plainRecord(value);
	exactKeys(record, MEDIA_FILE_KEYS);
	const sourceValues = inputs(record.sources);
	assertRoles(
		sourceValues,
		['original', 'evaluated-rgba-frame-pack', 'staged-audio-mix'],
		'media file job',
	);
	assertHelperMediaFileRoles(sourceValues);
	return Object.freeze({
		executable: executable(record.executable, 'ffmpeg'),
		plan: dataBinding(record.plan, 'host-to-helper', 'plan'),
		sources: sourceValues,
		output: outputFile(record.output),
		scratch: scratch(record.scratch),
	});
}

function validateMediaProxyGrant(value: unknown): HelperMediaProxyJobGrant {
	const record = plainRecord(value);
	exactKeys(record, MEDIA_PROXY_KEYS);
	const sourceValue = input(record.source);
	assertRoles([sourceValue], ['original'], 'media proxy');
	return Object.freeze({
		executable: executable(record.executable, 'ffmpeg'),
		plan: dataBinding(record.plan, 'host-to-helper', 'plan'),
		source: sourceValue,
		proxyRecipe: proxyRecipe(record.proxyRecipe),
		output: outputFile(record.output),
		scratch: scratch(record.scratch),
	});
}

function proxyRecipe(value: unknown): HelperMediaProxyRecipeGrant {
	const record = plainRecord(value);
	exactKeys(record, PROXY_RECIPE_KEYS);
	if (record.id !== 'framescaper-native-prores-proxy-mov-v1'
		|| !Number.isSafeInteger(record.width) || Number(record.width) < 2 || Number(record.width) > 1_280
		|| !Number.isSafeInteger(record.height) || Number(record.height) < 2 || Number(record.height) > 720
		|| Number(record.width) % 2 !== 0 || Number(record.height) % 2 !== 0) {
		unsafe('A native media proxy grant requires the exact bounded even ProRes Proxy/MOV recipe.');
	}
	return Object.freeze({
		id: 'framescaper-native-prores-proxy-mov-v1',
		width: Number(record.width),
		height: Number(record.height),
	});
}

function validateOfxScanGrant(value: unknown): HelperOfxScanJobGrant {
	const record = plainRecord(value);
	exactKeys(record, OFX_SCAN_KEYS);
	return Object.freeze({
		executable: executable(record.executable, 'ofx-scanner'),
		pluginBinary: executable(record.pluginBinary, 'ofx-plugin'),
		descriptor: dataBinding(record.descriptor, 'helper-to-host', 'descriptor'),
		scratch: scratch(record.scratch),
	});
}

function executable(value: unknown, expectedRole: HelperExecutableRole): HelperExecutableGrant {
	const record = plainRecord(value);
	exactKeys(record, EXECUTABLE_KEYS);
	if (record.role !== expectedRole) unsafe(`A helper job requires the exact ${expectedRole} executable role.`);
	return Object.freeze({
		role: expectedRole,
		path: absolutePath(record.path, 'executable'),
		bytes: bytes(record.bytes, 'executable'),
		sha256: sha256(record.sha256, true),
		identity: identity(record.identity),
	});
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
		return Object.freeze({
			type: 'stream',
			role: validateHelperNativeInputRole(record.role),
			binding: dataBinding(record.binding, 'host-to-helper', 'input'),
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

function outputFile(value: unknown): HelperOutputFileGrant {
	const record = plainRecord(value);
	exactKeys(record, OUTPUT_KEYS);
	const rootPath = absolutePath(record.rootPath, 'output root');
	const temporaryPath = absolutePath(record.temporaryPath, 'temporary output');
	const finalPath = absolutePath(record.finalPath, 'final output');
	if (temporaryPath === finalPath || !isInside(rootPath, temporaryPath) || !isInside(rootPath, finalPath)
		|| parentPath(temporaryPath) !== parentPath(finalPath)) {
		unsafe('A helper output grant must name distinct sibling files inside its exact destination root.');
	}
	return Object.freeze({
		rootPath,
		rootIdentity: identity(record.rootIdentity),
		temporaryPath,
		finalPath,
		maximumBytes: bytes(record.maximumBytes, 'output maximum'),
	});
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
	output: HelperDataPlaneBinding | HelperOutputFileGrant,
	scratch_: HelperScratchGrant,
): HelperNativeJobResourceUsage {
	const outputBytes = 'byteLength' in output ? output.byteLength : output.maximumBytes;
	return Object.freeze({
		inputBytes: safeSum([executableBytes, plan.byteLength, ...inputs_.map(inputBytes)]),
		outputBytes,
		scratchBytes: scratch_.maximumBytes,
		dataPlaneBytes: safeSum([
			plan.byteLength,
			...inputs_.map(inputDataPlaneBytes),
			...('byteLength' in output ? [output.byteLength] : []),
		]),
		maximumInFlightChunks: maximumInFlightChunks(
			[plan, ...('byteLength' in output ? [output] : [])],
			inputs_,
		),
	});
}

function maximumInFlightChunks(
	bindings: readonly HelperDataPlaneBinding[],
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

function isInside(rootPath: string, childPath: string): boolean {
	const root = normalizedPath(rootPath).replace(/\/$/u, '');
	const child = normalizedPath(childPath);
	return child.startsWith(`${root}/`) && child.length > root.length + 1;
}

function parentPath(value: string): string {
	const normalized = normalizedPath(value);
	return normalized.slice(0, normalized.lastIndexOf('/'));
}

function normalizedPath(value: string): string {
	return value.replace(/\\/gu, '/').replace(/\/{2,}/gu, '/');
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
