/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The milestone-5 helper contract, version 1: the one versioned wire schema
 * every Electron native helper process speaks with the main process. Both
 * sides validate every message before acting on it — a malformed, oversized,
 * or wrongly versioned message is rejected with a typed error, never trusted.
 * Renderer processes never see this wire: helpers are spawned and owned by
 * main only, and every path or binary authority stays on the main side of
 * the renderer bridge.
 */

import {
	VIDEO_TIMING_ASSET_HEADER_BYTES,
	VIDEO_TIMING_ASSET_MAXIMUM_BYTES,
} from '../src/common/editor/video-timing-asset-reference.ts';

export const HELPER_CONTRACT_VERSION = 1;

export const HELPER_JOB_KINDS = Object.freeze(['probe-video-source'] as const);

export type HelperJobKind = (typeof HELPER_JOB_KINDS)[number];

/** Fixed-length lowercase-hex job identifier minted by the main process. */
export const HELPER_JOB_ID_LENGTH = 40;

/**
 * JSON-shaped wire content may not exceed this byte length; the one binary
 * payload the contract admits — an encoded timing asset — crosses as a
 * bounded byte array under its own persisted maximum, never as JSON.
 */
export const MAXIMUM_HELPER_WIRE_MESSAGE_BYTES = 64 * 1024;

/** Helpers must report liveness at least this often while alive. */
export const HELPER_HEARTBEAT_INTERVAL_MS = 1_000;

/** Silence longer than this is a detected crash (quality budget: 2000 ms). */
export const HELPER_CRASH_DETECTION_MS = 2_000;

/** Cancellation must be acknowledged within this budget (p95 ≤ 1000 ms). */
export const HELPER_CANCELLATION_BUDGET_MS = 1_000;

/** Hard lower-only ceilings for per-job resource policy. */
export const HELPER_RESOURCE_HARD_LIMITS = Object.freeze({
	maximumInputBytes: 4 * 1024 ** 3,
	maximumJobDurationMs: 10 * 60 * 1_000,
	maximumRssBytes: 1024 ** 3,
	maximumConcurrentJobs: 1,
});

export type HelperContractViolationCode =
	| 'malformed'
	| 'oversized'
	| 'unsupported-version'
	| 'unknown-kind'
	| 'unsafe-grant';

/** Typed rejection for any wire payload the contract refuses to trust. */
export class HelperContractViolationError extends Error {
	readonly code: HelperContractViolationCode;

	constructor(code: HelperContractViolationCode, message: string) {
		super(message);
		this.name = 'HelperContractViolationError';
		this.code = code;
	}
}

/**
 * The per-job capability grant. Paths are absolute, main-verified, and never
 * renderer-supplied; the grant names everything the helper may read for this
 * one job. Helpers have no output paths and no network authority in v1 —
 * both are deny-by-default and absent from the wire on purpose, so granting
 * them later is a deliberate contract revision.
 */
export interface HelperJobGrant {
	readonly mediaPath: string;
	readonly mediaBytes: number;
	/** Device/inode captured from main's own open handle; the helper must re-verify after reopening. */
	readonly identity: Readonly<{ dev: number; ino: number }>;
}

export interface HelperJobResourcePolicy {
	readonly maximumInputBytes: number;
	readonly maximumJobDurationMs: number;
	readonly maximumRssBytes: number;
}

export interface HelperJobMessage {
	readonly contractVersion: typeof HELPER_CONTRACT_VERSION;
	readonly type: 'job';
	readonly jobId: string;
	readonly kind: HelperJobKind;
	readonly grant: HelperJobGrant;
	readonly resourcePolicy: HelperJobResourcePolicy;
}

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
const JOB_KEYS = Object.freeze(['contractVersion', 'type', 'jobId', 'kind', 'grant', 'resourcePolicy']);
const CANCEL_KEYS = Object.freeze(['contractVersion', 'type', 'jobId']);
const SHUTDOWN_KEYS = Object.freeze(['contractVersion', 'type']);
const HELLO_KEYS = Object.freeze(['contractVersion', 'type', 'kinds']);
const HEARTBEAT_KEYS = Object.freeze(['contractVersion', 'type', 'jobId']);
const PROGRESS_KEYS = Object.freeze(['contractVersion', 'type', 'jobId', 'value']);
const RESULT_KEYS = Object.freeze(['contractVersion', 'type', 'jobId', 'result']);
const ERROR_KEYS = Object.freeze(['contractVersion', 'type', 'jobId', 'error']);
const GRANT_KEYS = Object.freeze(['mediaPath', 'mediaBytes', 'identity']);
const POLICY_KEYS = Object.freeze(['maximumInputBytes', 'maximumJobDurationMs', 'maximumRssBytes']);
const WIRE_ERROR_KEYS = Object.freeze(['name', 'message', 'code']);

export function assertHelperJobId(value: unknown): string {
	if (typeof value !== 'string'
		|| value.length !== HELPER_JOB_ID_LENGTH
		|| !HELPER_JOB_ID_PATTERN.test(value)) {
		throw new HelperContractViolationError('malformed', 'A helper job id must be fixed-length lowercase hex.');
	}
	return value;
}

export function normalizeHelperResourcePolicy(value?: Partial<HelperJobResourcePolicy>): HelperJobResourcePolicy {
	return Object.freeze({
		maximumInputBytes: lowerOnlyLimit(value?.maximumInputBytes, HELPER_RESOURCE_HARD_LIMITS.maximumInputBytes, 'input bytes'),
		maximumJobDurationMs: lowerOnlyLimit(value?.maximumJobDurationMs, HELPER_RESOURCE_HARD_LIMITS.maximumJobDurationMs, 'job duration'),
		maximumRssBytes: lowerOnlyLimit(value?.maximumRssBytes, HELPER_RESOURCE_HARD_LIMITS.maximumRssBytes, 'peak RSS'),
	});
}

/**
 * The one admission gate for anything arriving on the wire in either
 * direction: a structured clone that is not a plain object, exceeds the
 * byte bound, or fails the closed-key schema is rejected with a typed error.
 */
export function validateHelperHostMessage(value: unknown): HelperHostMessage {
	const record = wireRecord(value);
	const type = versionedType(record, HOST_MESSAGE_TYPES);
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
	return Object.freeze({
		contractVersion: HELPER_CONTRACT_VERSION,
		type: 'job',
		jobId: assertHelperJobId(record.jobId),
		kind: kind as HelperJobKind,
		grant: validateHelperJobGrant(record.grant),
		resourcePolicy: validateWirePolicy(record.resourcePolicy),
	});
}

export function validateHelperProcessMessage(value: unknown): HelperProcessMessage {
	const record = wireRecord(value);
	const type = versionedType(record, PROCESS_MESSAGE_TYPES);
	if (type === 'hello') {
		exactWireKeys(record, HELLO_KEYS);
		const kinds = record.kinds;
		if (!Array.isArray(kinds) || kinds.length === 0
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

function validateHelperJobGrant(value: unknown): HelperJobGrant {
	const record = wireRecord(value);
	exactWireKeys(record, GRANT_KEYS);
	const mediaPath = record.mediaPath;
	if (typeof mediaPath !== 'string' || mediaPath.length === 0 || mediaPath.length > 4_096
		|| mediaPath.includes('\0')
		|| !(mediaPath.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(mediaPath) || mediaPath.startsWith('\\\\'))
		|| mediaPath.split(/[\\/]/u).includes('..')) {
		throw new HelperContractViolationError('unsafe-grant', 'A helper media grant must be one absolute, traversal-free path.');
	}
	const mediaBytes = record.mediaBytes;
	if (!Number.isSafeInteger(mediaBytes) || (mediaBytes as number) < 0) {
		throw new HelperContractViolationError('unsafe-grant', 'A helper media grant must declare its byte length.');
	}
	const identity = wireRecord(record.identity);
	if (Object.keys(identity).length !== 2
		|| !Number.isSafeInteger(identity.dev) || !Number.isSafeInteger(identity.ino)) {
		throw new HelperContractViolationError('unsafe-grant', 'A helper media grant must carry its captured file identity.');
	}
	return Object.freeze({
		mediaPath,
		mediaBytes: mediaBytes as number,
		identity: Object.freeze({ dev: identity.dev as number, ino: identity.ino as number }),
	});
}

function validateWirePolicy(value: unknown): HelperJobResourcePolicy {
	const record = wireRecord(value);
	exactWireKeys(record, POLICY_KEYS);
	try {
		return normalizeHelperResourcePolicy(record as Partial<HelperJobResourcePolicy>);
	} catch (error) {
		throw new HelperContractViolationError('malformed', error instanceof Error ? error.message : String(error));
	}
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
	let serialized: string;
	try {
		serialized = JSON.stringify(characteristics) ?? 'null';
	} catch {
		throw new HelperContractViolationError('malformed', 'Helper probe characteristics must be JSON-serializable.');
	}
	if (byteLength(serialized) > MAXIMUM_HELPER_WIRE_MESSAGE_BYTES) {
		throw new HelperContractViolationError('oversized', 'Helper probe characteristics exceed the contract byte bound.');
	}
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
): Type {
	if (record.contractVersion !== HELPER_CONTRACT_VERSION) {
		throw new HelperContractViolationError('unsupported-version', 'The helper contract version is unsupported.');
	}
	const type = record.type;
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

function lowerOnlyLimit(value: unknown, hardMaximum: number, label: string): number {
	if (value === undefined) return hardMaximum;
	if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > hardMaximum) {
		throw new RangeError(`Helper ${label} must be a lower-only safe integer no greater than ${hardMaximum}.`);
	}
	return value as number;
}

function bounded(value: string): string {
	return value.length > 2_048 ? value.slice(0, 2_048) : value;
}

function byteLength(value: string): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.codePointAt(index) as number;
		if (code > 0xffff) index += 1;
		bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
	}
	return bytes;
}
