/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * How a native media job's final output reaches the user's destination.
 *
 * Every output is written to a temporary sibling inside the destination root,
 * verified, and then atomically renamed into place. A cancelled, failed, stale,
 * or superseded job publishes nothing at all — not a truncated file, not a
 * zero-byte placeholder, and not a file that "will be overwritten next time".
 * The user's destination directory is theirs; a job either puts a complete,
 * verified artefact there or leaves it exactly as it found it.
 *
 * The temporary name is derived deterministically from the job id so a restart
 * reuses and overwrites its own partial file rather than littering the
 * destination with one orphan per attempt.
 */

export const NATIVE_MEDIA_DESTINATION_MAXIMUM_LENGTH = 1_024;
export const NATIVE_MEDIA_DESTINATION_SEGMENT_MAXIMUM_LENGTH = 255;
export const NATIVE_MEDIA_PARTIAL_SUFFIX = '.partial';

export const NATIVE_MEDIA_PUBLICATION_REFUSALS = Object.freeze([
	'job-cancelled',
	'job-failed',
	'output-not-finalized',
	'plan-superseded',
	'byte-length-mismatch',
	'digest-mismatch',
	'unverified-output',
] as const);

export type NativeMediaPublicationRefusal = (typeof NATIVE_MEDIA_PUBLICATION_REFUSALS)[number];

export interface NativeMediaPublicationPlanV1 {
	readonly jobId: string;
	readonly relativeDestination: string;
	readonly temporaryRelativePath: string;
	readonly planFingerprint: string;
}

export interface NativeMediaPublicationAttemptV1 {
	readonly plan: NativeMediaPublicationPlanV1;
	readonly outcome: 'completed' | 'cancelled' | 'failed';
	/** The fingerprint the project currently expects for this destination. */
	readonly currentPlanFingerprint: string;
	/** The muxer reported a complete container rather than a truncated stream. */
	readonly finalized: boolean;
	readonly declaredByteLength: number;
	readonly observedByteLength: number;
	readonly declaredSha256: string | null;
	readonly observedSha256: string | null;
}

export interface NativeMediaPublicationVerdictV1 {
	readonly publish: boolean;
	readonly refusals: readonly NativeMediaPublicationRefusal[];
}

export class NativeMediaPublicationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NativeMediaPublicationError';
	}
}

const JOB_ID_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
// Control characters plus the set Windows refuses in a file name.
const RESERVED_SEGMENT_CHARACTERS = /[\u0000-\u001f<>:"|?*]/u;
const RESERVED_WINDOWS_NAMES = new Set([
	'con', 'prn', 'aux', 'nul',
	'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
	'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Validate one renderer-declared destination relative to a granted root.
 *
 * The root itself is main-private and never crosses the bridge, so this is the
 * only path text a job description carries. It must stay inside the root by
 * construction: no absolute prefix, no drive letter, no UNC prefix, no `..`,
 * and no separator that lets a platform reinterpret the string.
 */
export function assertNativeMediaRelativeDestination(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new NativeMediaPublicationError('A native media destination must be non-empty relative text.');
	}
	if (value.length > NATIVE_MEDIA_DESTINATION_MAXIMUM_LENGTH) {
		throw new NativeMediaPublicationError('A native media destination exceeds its length ceiling.');
	}
	if (value.includes('\0') || value.includes('\\')) {
		throw new NativeMediaPublicationError('A native media destination must use forward slashes and no NUL.');
	}
	if (value.startsWith('/') || /^[A-Za-z]:/u.test(value)) {
		throw new NativeMediaPublicationError('A native media destination must be relative to its granted root.');
	}
	const segments = value.split('/');
	for (const segment of segments) {
		if (segment.length === 0) {
			throw new NativeMediaPublicationError('A native media destination must not contain empty path segments.');
		}
		if (segment === '.' || segment === '..') {
			throw new NativeMediaPublicationError('A native media destination must not traverse its granted root.');
		}
		if (segment.length > NATIVE_MEDIA_DESTINATION_SEGMENT_MAXIMUM_LENGTH) {
			throw new NativeMediaPublicationError('A native media destination segment exceeds its length ceiling.');
		}
		if (segment.endsWith('.') || segment.endsWith(' ') || segment.startsWith(' ')) {
			throw new NativeMediaPublicationError('A native media destination segment must not be space or dot padded.');
		}
		if (RESERVED_SEGMENT_CHARACTERS.test(segment)) {
			throw new NativeMediaPublicationError('A native media destination segment carries a reserved character.');
		}
		const stem = segment.split('.')[0]!.toLowerCase();
		if (RESERVED_WINDOWS_NAMES.has(stem)) {
			throw new NativeMediaPublicationError('A native media destination segment is a reserved device name.');
		}
	}
	if (segments.at(-1)!.endsWith(NATIVE_MEDIA_PARTIAL_SUFFIX)) {
		throw new NativeMediaPublicationError('A native media destination must not claim the partial-output suffix.');
	}
	return value;
}

/**
 * Derive the publication plan for one job. The temporary sibling shares the
 * destination directory so the final rename is same-filesystem and therefore
 * atomic; a cross-directory temporary would silently become a copy.
 */
export function createNativeMediaPublicationPlan(input: Readonly<{
	jobId: string;
	relativeDestination: string;
	planFingerprint: string;
}>): NativeMediaPublicationPlanV1 {
	const jobId = assertJobId(input.jobId);
	const relativeDestination = assertNativeMediaRelativeDestination(input.relativeDestination);
	const planFingerprint = assertFingerprint(input.planFingerprint, 'plan fingerprint');
	const separator = relativeDestination.lastIndexOf('/');
	const directory = separator < 0 ? '' : relativeDestination.slice(0, separator + 1);
	const name = relativeDestination.slice(separator + 1);
	return Object.freeze({
		jobId,
		relativeDestination,
		temporaryRelativePath: `${directory}${name}.${jobId.slice(0, 16)}${NATIVE_MEDIA_PARTIAL_SUFFIX}`,
		planFingerprint,
	});
}

/**
 * Decide whether one attempt may be renamed into place.
 *
 * Every refusal is collected rather than short-circuited: an operator reading
 * why nothing was published should see all of it at once. Publication requires
 * a completed, finalized output whose plan is still the current one and whose
 * observed size and digest match what the writer declared.
 */
export function evaluateNativeMediaPublication(
	attempt: NativeMediaPublicationAttemptV1,
): NativeMediaPublicationVerdictV1 {
	const refusals: NativeMediaPublicationRefusal[] = [];
	if (attempt.outcome === 'cancelled') refusals.push('job-cancelled');
	if (attempt.outcome === 'failed') refusals.push('job-failed');
	if (attempt.outcome !== 'cancelled' && attempt.outcome !== 'failed' && !attempt.finalized) {
		refusals.push('output-not-finalized');
	}
	if (assertFingerprint(attempt.plan.planFingerprint, 'plan fingerprint')
		!== assertFingerprint(attempt.currentPlanFingerprint, 'current plan fingerprint')) {
		refusals.push('plan-superseded');
	}
	const declaredByteLength = byteLength(attempt.declaredByteLength, 'declared');
	const observedByteLength = byteLength(attempt.observedByteLength, 'observed');
	if (declaredByteLength !== observedByteLength) refusals.push('byte-length-mismatch');
	if (attempt.declaredSha256 === null || attempt.observedSha256 === null) {
		refusals.push('unverified-output');
	} else if (assertFingerprint(attempt.declaredSha256, 'declared digest')
		!== assertFingerprint(attempt.observedSha256, 'observed digest')) {
		refusals.push('digest-mismatch');
	}
	return Object.freeze({
		publish: refusals.length === 0,
		refusals: Object.freeze(refusals),
	});
}

/**
 * Whether a refused attempt's temporary sibling may be removed immediately.
 *
 * A superseded or cancelled attempt has nothing worth keeping. A failed or
 * unverified one is retained so the retry path and diagnostics can look at it.
 */
export function nativeMediaPartialOutputIsDisposable(
	verdict: NativeMediaPublicationVerdictV1,
): boolean {
	if (verdict.publish) return true;
	return verdict.refusals.every((refusal) => (
		refusal === 'job-cancelled' || refusal === 'plan-superseded'
	));
}

function assertJobId(value: unknown): string {
	if (typeof value !== 'string' || !JOB_ID_PATTERN.test(value)) {
		throw new NativeMediaPublicationError('A native media publication requires the main-minted job id.');
	}
	return value;
}

function assertFingerprint(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
		throw new NativeMediaPublicationError(`A native media publication requires a lowercase SHA-256 ${label}.`);
	}
	return value;
}

function byteLength(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new NativeMediaPublicationError(`A native media publication requires a ${label} byte length.`);
	}
	return value as number;
}
