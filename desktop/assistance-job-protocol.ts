/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The bounded message contract between the editor and the assistance helper.
 *
 * The helper runs native inference code, which is trusted code rather than a
 * sandbox, so every message crossing the boundary is validated in both
 * directions and nothing is inferred from shape alone. A job names exactly the
 * media it may read and the model it may load; the helper is given no way to
 * ask for anything else.
 */

export const ASSISTANCE_JOB_PROTOCOL_VERSION = 1;

export const ASSISTANCE_JOB_KINDS = Object.freeze(['transcribe', 'detect-silence'] as const);

export type AssistanceJobKind = (typeof ASSISTANCE_JOB_KINDS)[number];

/** A job may not run longer than this without a progress report. */
export const ASSISTANCE_JOB_HEARTBEAT_MS = 30_000;

/** Cancellation must be acknowledged inside the privacy budget. */
export const ASSISTANCE_CANCELLATION_BUDGET_MS = 2_000;

const JOB_ID_PATTERN = /^[a-z\d][a-z\d-]{0,62}[a-z\d]$/u;

export interface AssistanceJobRequest {
	readonly protocolVersion: typeof ASSISTANCE_JOB_PROTOCOL_VERSION;
	readonly jobId: string;
	readonly kind: AssistanceJobKind;
	readonly modelId: string;
	/** Absolute paths the helper may read. Nothing else is reachable. */
	readonly mediaPaths: readonly string[];
	readonly options: Readonly<Record<string, unknown>>;
}

export interface AssistanceProgressMessage {
	readonly type: 'progress';
	readonly jobId: string;
	readonly completed: number;
	readonly total: number;
}

export interface AssistanceResultMessage {
	readonly type: 'result';
	readonly jobId: string;
	readonly payload: unknown;
}

export interface AssistanceErrorMessage {
	readonly type: 'error';
	readonly jobId: string;
	readonly reason: string;
}

export interface AssistanceCancelledMessage {
	readonly type: 'cancelled';
	readonly jobId: string;
}

export type AssistanceHelperMessage =
	| AssistanceProgressMessage
	| AssistanceResultMessage
	| AssistanceErrorMessage
	| AssistanceCancelledMessage;

function assertJobId(value: unknown): string {
	if (typeof value !== 'string' || !JOB_ID_PATTERN.test(value)) {
		throw new TypeError('An assistance job id must be lowercase and dash separated.');
	}
	return value;
}

function assertAbsolutePath(value: unknown, index: number): string {
	if (typeof value !== 'string' || value === '' || value.includes('\0')) {
		throw new TypeError(`Assistance media path ${index} is not a usable path.`);
	}
	// Absolute on both platform families; the helper never resolves relatives.
	if (!(value.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(value))) {
		throw new TypeError(`Assistance media path ${index} must be absolute.`);
	}
	if (value.includes('..')) {
		throw new TypeError(`Assistance media path ${index} must not traverse.`);
	}
	return value;
}

/**
 * Validates a request before it leaves the editor. A job that names no media
 * is refused: assistance consumes selected media, and an empty selection is a
 * caller mistake rather than a licence to read everything.
 */
export function validateAssistanceJobRequest(value: unknown): AssistanceJobRequest {
	if (typeof value !== 'object' || value === null) {
		throw new TypeError('An assistance job request must be an object.');
	}
	const candidate = value as Partial<AssistanceJobRequest>;
	if (candidate.protocolVersion !== ASSISTANCE_JOB_PROTOCOL_VERSION) {
		throw new Error('The assistance job protocol version is unsupported.');
	}
	if (!ASSISTANCE_JOB_KINDS.includes(candidate.kind as AssistanceJobKind)) {
		throw new TypeError('An assistance job kind is unrecognised.');
	}
	if (typeof candidate.modelId !== 'string' || candidate.modelId.trim() === '') {
		throw new TypeError('An assistance job must name a model.');
	}
	const mediaPaths = candidate.mediaPaths;
	if (!Array.isArray(mediaPaths) || mediaPaths.length === 0 || mediaPaths.length > 64) {
		throw new RangeError('An assistance job must name between one and 64 media paths.');
	}
	const options = candidate.options ?? {};
	if (typeof options !== 'object' || options === null || Array.isArray(options)) {
		throw new TypeError('Assistance job options must be an object.');
	}
	return Object.freeze({
		protocolVersion: ASSISTANCE_JOB_PROTOCOL_VERSION,
		jobId: assertJobId(candidate.jobId),
		kind: candidate.kind as AssistanceJobKind,
		modelId: candidate.modelId,
		mediaPaths: Object.freeze(mediaPaths.map(assertAbsolutePath)),
		options: Object.freeze({ ...options }),
	});
}

/**
 * Validates a message the helper sent. Malformed output is rejected rather
 * than partially trusted, because the helper hosts third-party native code.
 */
export function validateAssistanceHelperMessage(value: unknown): AssistanceHelperMessage {
	if (typeof value !== 'object' || value === null) {
		throw new TypeError('An assistance helper message must be an object.');
	}
	const candidate = value as { type?: unknown; jobId?: unknown };
	const jobId = assertJobId(candidate.jobId);
	switch (candidate.type) {
		case 'progress': {
			const { completed, total } = candidate as unknown as AssistanceProgressMessage;
			if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0
				|| completed < 0 || completed > total) {
				throw new RangeError('An assistance progress report is out of range.');
			}
			return Object.freeze({ type: 'progress', jobId, completed, total });
		}
		case 'result':
			return Object.freeze({
				type: 'result',
				jobId,
				payload: (candidate as unknown as AssistanceResultMessage).payload,
			});
		case 'error': {
			const { reason } = candidate as unknown as AssistanceErrorMessage;
			if (typeof reason !== 'string' || reason.trim() === '' || reason.length > 2_000) {
				throw new TypeError('An assistance error needs a bounded reason.');
			}
			return Object.freeze({ type: 'error', jobId, reason });
		}
		case 'cancelled':
			return Object.freeze({ type: 'cancelled', jobId });
		default:
			throw new TypeError('An assistance helper message type is unrecognised.');
	}
}
