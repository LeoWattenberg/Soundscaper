/* SPDX-License-Identifier: AGPL-3.0-only */
/** Closed milestone-5 helper wire; renderers never receive its concrete authority. */

import {
	VIDEO_TIMING_ASSET_HEADER_BYTES,
	VIDEO_TIMING_ASSET_MAXIMUM_BYTES,
} from '../src/common/editor/video-timing-asset-reference.ts';
import {
	HELPER_JOB_KINDS,
	type HelperJobGrant,
	type HelperJobKind,
	validateHelperJobGrant,
} from './helper-job-grant.ts';
import {
	HelperContractViolationError,
	assertHelperWireEnvelope,
} from './helper-wire-admission.ts';
import {
	admitsHelperJobSubcontract,
	helperJobSubcontractVersion,
	type HelperJobSubcontractVersion,
} from './helper-job-subcontract.ts';
import {
	type HelperJobResourcePolicy,
	validateHelperWireResourcePolicy,
} from './helper-resource-policy.ts';
import {
	isHelperOutputDirectoryGrant,
	type HelperOutputGrant,
} from './helper-native-output-grant.ts';

export {
	HELPER_AUDIO_BACKENDS,
	HELPER_JOB_KINDS,
	HELPER_PLUGIN_FORMATS,
	HELPER_PROBE_JOB_KINDS,
	OFX_RGBA_FRAME_MAXIMUM_BYTES,
	OFX_RGBA_FRAME_MAXIMUM_DIMENSION,
	OFX_RGBA_FRAME_MAXIMUM_ROW_BYTES,
	OFX_RGBA_FRAME_SET_MAXIMUM_BYTES,
	helperJobGrantExceedsResourcePolicy,
	helperJobGrantInputBytes,
	helperJobGrantResourceUsage,
	validateHelperJobGrant,
	validateHelperJobResult,
} from './helper-job-grant.ts';
export type {
	AnyHelperJobGrant,
	HelperAudioBackend,
	HelperAudioDeviceJobGrant,
	HelperFileIdentity,
	HelperJobGrant,
	HelperJobGrantByKind,
	HelperJobKind,
	HelperJobResult,
	HelperJobResultByKind,
	HelperPluginFormat,
	HelperPluginHostJobGrant,
	HelperPluginScanJobGrant,
	HelperProbeJobGrant,
} from './helper-job-grant.ts';
export * from './helper-data-plane.ts';
export * from './helper-data-plane-input-reservation.ts';
export * from './helper-data-plane-output-reservation.ts';
export { helperJobTransferredPortCount } from './helper-data-plane-transfer.ts';
export {
	HELPER_PERSISTENT_PORT_CONTRACT_VERSION,
	HELPER_PERSISTENT_PORT_MAXIMUM_IN_FLIGHT_MESSAGES,
	HELPER_PERSISTENT_PORT_MAXIMUM_MESSAGE_BYTES,
	HELPER_PERSISTENT_PORT_PURPOSES,
	validateHelperPersistentPortBinding,
} from './helper-persistent-port.ts';
export type {
	HelperPersistentPortBinding,
	HelperPersistentPortPurpose,
} from './helper-persistent-port.ts';
export {
	HELPER_EXECUTABLE_ROLES,
	HELPER_NATIVE_INPUT_ROLES,
	HELPER_NATIVE_JOB_KINDS,
} from './helper-job-grant.ts';
export type {
	HelperExecutableGrant,
	HelperExecutableRole,
	HelperFileInputGrant,
	HelperFileOutputJobResult,
	HelperMediaDecodeJobGrant,
	HelperMediaImageSequenceDecodeGrant,
	HelperMediaImageSequenceDecodeJobGrant,
	HelperMediaEncodeJobGrant,
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
	HelperOpenFxPluginCustody, HelperOpenFxPluginRuntimeFile,
	HelperOfxScanJobGrant, HelperOfxScanJobResult, HelperOfxOutputFrameGrant,
	HelperOfxHostJobResult, HelperOfxInteractJobGrantV1, HelperOfxInteractJobResultV1,
	HelperOfxVideoTimingAssetGrant, HelperOutputDirectoryGrant, HelperOutputFileGrant, HelperOutputGrant,
	HelperScratchGrant,
	HelperStreamInputGrant,
	HelperStreamOutputJobResult,
	HelperTemporaryOutputResult,
	HelperTemporaryOutputTreeResult,
	HelperVideoTimingAssetGrant,
} from './helper-job-grant.ts';
export {
	HelperContractViolationError,
	MAXIMUM_HELPER_WIRE_MESSAGE_BYTES,
} from './helper-wire-admission.ts';
export type { HelperContractViolationCode } from './helper-wire-admission.ts';
export {
	HELPER_JOB_SUBCONTRACT_VERSIONS,
	admitsHelperJobSubcontract,
	helperJobSubcontractVersion,
} from './helper-job-subcontract.ts';
export type { HelperJobSubcontractVersion } from './helper-job-subcontract.ts';
export {
	HELPER_JOB_DURATION_HARD_LIMITS,
	HELPER_JOB_RESOURCE_HARD_LIMITS,
	HELPER_RESOURCE_HARD_LIMITS,
	normalizeHelperResourcePolicy,
} from './helper-resource-policy.ts';
export type { HelperJobResourcePolicy } from './helper-resource-policy.ts';
export const HELPER_CONTRACT_VERSION = 1;

/** Fixed-length lowercase-hex job identifier minted by the main process. */
export const HELPER_JOB_ID_LENGTH = 40;

/** Helpers must report liveness at least this often while alive. */
export const HELPER_HEARTBEAT_INTERVAL_MS = 1_000;

/** Silence longer than this is a detected crash (quality budget: 2000 ms). */
export const HELPER_CRASH_DETECTION_MS = 2_000;

/** Cancellation must be acknowledged within this budget (p95 ≤ 1000 ms). */
export const HELPER_CANCELLATION_BUDGET_MS = 1_000;

export interface HelperJobMessageFor<Kind extends HelperJobKind> {
	readonly contractVersion: typeof HELPER_CONTRACT_VERSION;
	readonly type: 'job';
	readonly jobId: string;
	readonly kind: Kind;
	readonly jobContractVersion: HelperJobSubcontractVersion<Kind>;
	readonly grant: HelperJobGrant<Kind>;
	readonly resourcePolicy: HelperJobResourcePolicy;
}

export type HelperJobMessage = {
	readonly [Kind in HelperJobKind]: HelperJobMessageFor<Kind>;
}[HelperJobKind];

export interface HelperCancelMessage {
	readonly contractVersion: typeof HELPER_CONTRACT_VERSION;
	readonly type: 'cancel';
	readonly jobId: string;
}

export interface HelperShutdownMessage {
	readonly contractVersion: typeof HELPER_CONTRACT_VERSION;
	readonly type: 'shutdown';
}

export type HelperHostMessage = HelperJobMessage | HelperCancelMessage | HelperShutdownMessage;

export interface HelperHelloMessage {
	readonly contractVersion: typeof HELPER_CONTRACT_VERSION;
	readonly type: 'hello';
	readonly kinds: readonly HelperJobKind[];
}

export interface HelperHeartbeatMessage {
	readonly contractVersion: typeof HELPER_CONTRACT_VERSION;
	readonly type: 'heartbeat';
	readonly jobId: string | null;
}

export interface HelperProgressMessage {
	readonly contractVersion: typeof HELPER_CONTRACT_VERSION;
	readonly type: 'progress';
	readonly jobId: string;
	readonly value: number | null;
}

export interface HelperResultMessage {
	readonly contractVersion: typeof HELPER_CONTRACT_VERSION;
	readonly type: 'result';
	readonly jobId: string;
	readonly result: unknown;
}

export interface HelperErrorMessage {
	readonly contractVersion: typeof HELPER_CONTRACT_VERSION;
	readonly type: 'error';
	readonly jobId: string;
	readonly error: HelperWireError;
}

export interface HelperCancelledMessage {
	readonly contractVersion: typeof HELPER_CONTRACT_VERSION;
	readonly type: 'cancelled';
	readonly jobId: string;
}

export type HelperProcessMessage =
	| HelperHelloMessage
	| HelperHeartbeatMessage
	| HelperProgressMessage
	| HelperResultMessage
	| HelperErrorMessage
	| HelperCancelledMessage;

export interface HelperWireError {
	readonly name: string;
	readonly message: string;
	readonly code?: string;
}

const HELPER_JOB_ID_PATTERN = /^[a-f0-9]+$/u;
const HOST_MESSAGE_TYPES = Object.freeze(['job', 'cancel', 'shutdown'] as const);
const PROCESS_MESSAGE_TYPES = Object.freeze([
	'hello', 'heartbeat', 'progress', 'result', 'error', 'cancelled',
] as const);
const JOB_KEYS = Object.freeze([
	'contractVersion', 'type', 'jobId', 'kind', 'jobContractVersion', 'grant', 'resourcePolicy',
]);
const CANCEL_KEYS = Object.freeze(['contractVersion', 'type', 'jobId']);
const SHUTDOWN_KEYS = Object.freeze(['contractVersion', 'type']);
const HELLO_KEYS = Object.freeze(['contractVersion', 'type', 'kinds']);
const HEARTBEAT_KEYS = Object.freeze(['contractVersion', 'type', 'jobId']);
const PROGRESS_KEYS = Object.freeze(['contractVersion', 'type', 'jobId', 'value']);
const RESULT_KEYS = Object.freeze(['contractVersion', 'type', 'jobId', 'result']);
const ERROR_KEYS = Object.freeze(['contractVersion', 'type', 'jobId', 'error']);
const WIRE_ERROR_KEYS = Object.freeze(['name', 'message', 'code']);

export function assertHelperJobId(value: unknown): string {
	if (typeof value !== 'string'
		|| value.length !== HELPER_JOB_ID_LENGTH
		|| !HELPER_JOB_ID_PATTERN.test(value)) {
		throw new HelperContractViolationError('malformed', 'A helper job id must be fixed-length lowercase hex.');
	}
	return value;
}

/**
 * The one admission gate for anything arriving on the wire in either
 * direction: a structured clone that is not a plain object, exceeds the
 * byte bound, or fails the closed-key schema is rejected with a typed error.
 */
export function validateHelperHostMessage(value: unknown): HelperHostMessage {
	assertHelperWireEnvelope(value);
	const record = wireRecord(value);
	const type = versionedType(record, HOST_MESSAGE_TYPES, PROCESS_MESSAGE_TYPES);
	if (type === 'shutdown') {
		exactWireKeys(record, SHUTDOWN_KEYS);
		return Object.freeze({ contractVersion: HELPER_CONTRACT_VERSION, type });
	}
	if (type === 'cancel') {
		exactWireKeys(record, CANCEL_KEYS);
		return Object.freeze({
			contractVersion: HELPER_CONTRACT_VERSION,
			type,
			jobId: assertHelperJobId(record.jobId),
		});
	}
	exactWireKeys(record, JOB_KEYS);
	const kind = record.kind;
	if (typeof kind !== 'string' || !(HELPER_JOB_KINDS as readonly string[]).includes(kind)) {
		throw new HelperContractViolationError('unknown-kind', 'The helper job kind is not part of contract v1.');
	}
	const jobId = assertHelperJobId(record.jobId);
	const admittedGrant = validateHelperJobGrant(kind as HelperJobKind, record.grant);
	assertNativeOutputJobIdentity(kind as HelperJobKind, jobId, admittedGrant);
	return Object.freeze({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'job',
		jobId,
		kind: kind as HelperJobKind,
		jobContractVersion: validateJobSubcontractVersion(kind as HelperJobKind, record.jobContractVersion),
		grant: admittedGrant,
		resourcePolicy: validateHelperWireResourcePolicy(record.resourcePolicy, kind as HelperJobKind),
	}) as HelperJobMessage;
}

function assertNativeOutputJobIdentity(kind: HelperJobKind, jobId: string, grant: unknown): void {
	if (kind !== 'media-encode' && kind !== 'media-render') return;
	const output = (grant as Readonly<{ readonly output?: HelperOutputGrant }>).output;
	if (output && isHelperOutputDirectoryGrant(output) && output.treeIdentity.jobId !== jobId) {
		throw new HelperContractViolationError(
			'unsafe-grant', 'A helper output tree identity disagrees with its exact job id.',
		);
	}
}

export function validateHelperProcessMessage(value: unknown): HelperProcessMessage {
	assertHelperWireEnvelope(value);
	const record = wireRecord(value);
	const type = versionedType(record, PROCESS_MESSAGE_TYPES, HOST_MESSAGE_TYPES);
	if (type === 'hello') {
		exactWireKeys(record, HELLO_KEYS);
		const kinds = record.kinds;
		if (!Array.isArray(kinds) || kinds.length === 0
			|| new Set(kinds).size !== kinds.length
			|| kinds.some((kind) => typeof kind !== 'string' || !(HELPER_JOB_KINDS as readonly string[]).includes(kind))) {
			throw new HelperContractViolationError('unknown-kind', 'A helper hello must announce only contract-v1 job kinds.');
		}
		return Object.freeze({
			contractVersion: HELPER_CONTRACT_VERSION,
			type,
			kinds: Object.freeze([...kinds] as HelperJobKind[]),
		});
	}
	if (type === 'heartbeat') {
		exactWireKeys(record, HEARTBEAT_KEYS);
		return Object.freeze({
			contractVersion: HELPER_CONTRACT_VERSION,
			type,
			jobId: record.jobId === null ? null : assertHelperJobId(record.jobId),
		});
	}
	if (type === 'progress') {
		exactWireKeys(record, PROGRESS_KEYS);
		const value_ = record.value;
		if (value_ !== null && (typeof value_ !== 'number' || !Number.isFinite(value_) || value_ < 0 || value_ > 1)) {
			throw new HelperContractViolationError('malformed', 'Helper progress must be null or a finite ratio in [0, 1].');
		}
		return Object.freeze({
			contractVersion: HELPER_CONTRACT_VERSION,
			type,
			jobId: assertHelperJobId(record.jobId),
			value: value_ as number | null,
		});
	}
	if (type === 'cancelled') {
		exactWireKeys(record, CANCEL_KEYS);
		return Object.freeze({
			contractVersion: HELPER_CONTRACT_VERSION,
			type,
			jobId: assertHelperJobId(record.jobId),
		});
	}
	if (type === 'error') {
		exactWireKeys(record, ERROR_KEYS);
		return Object.freeze({
			contractVersion: HELPER_CONTRACT_VERSION,
			type,
			jobId: assertHelperJobId(record.jobId),
			error: validateHelperWireError(record.error),
		});
	}
	exactWireKeys(record, RESULT_KEYS);
	return Object.freeze({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'result',
		jobId: assertHelperJobId(record.jobId),
		result: record.result,
	});
}

export function serializeHelperError(error: unknown): HelperWireError {
	const candidate = error as { name?: unknown; message?: unknown; code?: unknown } | null;
	const name = typeof candidate?.name === 'string' && candidate.name ? candidate.name : 'Error';
	const message = typeof candidate?.message === 'string' ? candidate.message : String(error);
	const code = typeof candidate?.code === 'string' && candidate.code ? candidate.code : undefined;
	return Object.freeze(code === undefined
		? { name: bounded(name), message: bounded(message) }
		: { name: bounded(name), message: bounded(message), code: bounded(code) });
}

export function deserializeHelperError(value: HelperWireError): Error {
	const error = new Error(value.message);
	error.name = value.name;
	if (value.code !== undefined) (error as Error & { code: string }).code = value.code;
	return error;
}

function validateJobSubcontractVersion<Kind extends HelperJobKind>(
	kind: Kind,
	version: unknown,
): HelperJobSubcontractVersion<Kind> {
	if (!admitsHelperJobSubcontract(kind, version)) {
		throw new HelperContractViolationError(
			'unsupported-version',
			`The ${kind} helper job subcontract version is unsupported.`,
		);
	}
	return helperJobSubcontractVersion(kind);
}

function validateHelperWireError(value: unknown): HelperWireError {
	const record = wireRecord(value);
	for (const key of Object.keys(record)) {
		if (!WIRE_ERROR_KEYS.includes(key)) {
			throw new HelperContractViolationError('malformed', `A helper wire error carries the unsupported key ${key}.`);
		}
	}
	if (typeof record.name !== 'string' || typeof record.message !== 'string'
		|| (record.code !== undefined && typeof record.code !== 'string')) {
		throw new HelperContractViolationError('malformed', 'A helper wire error must be a structured name/message record.');
	}
	return serializeHelperError(record);
}

/**
 * The probe job's result payload: one encoded timing asset (bounded binary),
 * the nominal rate, and the JSON-bounded probed characteristics record.
 * Every field is re-validated by its consumer as well — the timing asset by
 * `decodeVideoTimingAsset`, the characteristics by the source contract.
 */
export interface HelperProbeResultPayload {
	readonly timingAsset: Uint8Array;
	readonly nominalRate: Readonly<{ num: number; den: number }>;
	readonly characteristics: unknown;
}

const PROBE_RESULT_KEYS = Object.freeze(['timingAsset', 'nominalRate', 'characteristics']);

export function validateHelperProbeResult(value: unknown): HelperProbeResultPayload {
	assertHelperWireEnvelope(value);
	const record = wireRecord(value);
	exactWireKeys(record, PROBE_RESULT_KEYS);
	const timingAsset = record.timingAsset;
	if (!(timingAsset instanceof Uint8Array) || timingAsset.byteLength < VIDEO_TIMING_ASSET_HEADER_BYTES) {
		throw new HelperContractViolationError('malformed', 'A helper probe result must carry an encoded timing asset.');
	}
	if (timingAsset.byteLength > VIDEO_TIMING_ASSET_MAXIMUM_BYTES) {
		throw new HelperContractViolationError('oversized', 'A helper probe timing asset exceeds its persisted maximum.');
	}
	const rate = wireRecord(record.nominalRate);
	if (Object.keys(rate).length !== 2
		|| !Number.isSafeInteger(rate.num) || (rate.num as number) <= 0
		|| !Number.isSafeInteger(rate.den) || (rate.den as number) <= 0) {
		throw new HelperContractViolationError('malformed', 'A helper probe result must carry a positive rational rate.');
	}
	const characteristics = record.characteristics;
	return Object.freeze({
		timingAsset: new Uint8Array(timingAsset),
		nominalRate: Object.freeze({ num: rate.num as number, den: rate.den as number }),
		characteristics,
	});
}

function wireRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) {
		throw new HelperContractViolationError('malformed', 'A helper wire message must be a plain record.');
	}
	return value as Record<string, unknown>;
}

function versionedType<Type extends string>(
	record: Record<string, unknown>,
	types: readonly Type[],
	oppositeTypes: readonly string[],
): Type {
	if (record.contractVersion !== HELPER_CONTRACT_VERSION) {
		throw new HelperContractViolationError('unsupported-version', 'The helper contract version is unsupported.');
	}
	const type = record.type;
	if (typeof type === 'string' && oppositeTypes.includes(type)) {
		throw new HelperContractViolationError('wrong-direction', 'A helper wire message arrived in the wrong direction.');
	}
	if (typeof type !== 'string' || !(types as readonly string[]).includes(type)) {
		throw new HelperContractViolationError('malformed', 'A known helper wire message type is required.');
	}
	return type as Type;
}

function exactWireKeys(record: Record<string, unknown>, keys: readonly string[]): void {
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new HelperContractViolationError('malformed', 'A helper wire message must carry exactly its schema keys.');
	}
}

function bounded(value: string): string {
	return value.length > 2_048 ? value.slice(0, 2_048) : value;
}
