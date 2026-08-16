/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * How a watched folder actually decides to import something.
 *
 * `fs.watch` is a latency hint and nothing more. It coalesces, drops events
 * under load, reports renames as unrelated add/remove pairs, and behaves
 * differently on every platform. So the authority is a bounded reconciliation
 * sweep — at startup and every thirty seconds — and an event only makes the
 * next sweep happen sooner.
 *
 * A file is not imported the moment it appears. A camera or a network copy
 * writes a file over seconds or minutes, and importing it mid-write yields a
 * truncated source. A candidate becomes stable only after two identical
 * size/mtime observations at least two seconds apart *and* a successful probe;
 * the probe matters because a file can stop growing and still be unreadable.
 *
 * Duplicate suppression keys on canonical file identity *and* content
 * fingerprint together. Identity alone re-imports a file whose bytes were
 * replaced in place; fingerprint alone re-imports the same file after a rename.
 * Both together survive repeated events, renames, watcher overflow, and
 * restarts.
 *
 * Candidate tracking is bounded. A sweep over a folder holding a hundred
 * thousand files must not grow a hundred thousand pieces of stability state, so
 * a new candidate met at the ceiling is refused outright and met again on a
 * later sweep, once the candidates ahead of it have been imported and dropped.
 * Refusing the newcomer rather than evicting an incumbent keeps a file that is
 * nearly settled from restarting its count forever.
 *
 * Finally, main never mutates project state behind its controller. If the
 * target project is closed or read-only, the ingest waits as a pending record
 * instead of being written into a document nobody is holding.
 */

import type { WatchRuleV1 } from './native-watch-rule.ts';
import {
	createNativeValidators,
	NATIVE_SHA256_HEX_PATTERN,
} from './native-validation.ts';

/** The authoritative sweep interval; `fs.watch` only shortens the wait. */
export const NATIVE_WATCH_RECONCILE_INTERVAL_MS = 30_000;
export const NATIVE_WATCH_STABILITY_OBSERVATIONS = 2;
export const NATIVE_WATCH_STABILITY_INTERVAL_MS = 2_000;
export const NATIVE_WATCH_MAXIMUM_TRACKED_CANDIDATES = 10_000;

export const NATIVE_WATCH_DECISIONS = Object.freeze([
	'import',
	'skip-duplicate',
	'defer-unstable',
	'defer-probe',
	'pending-project-closed',
	'pending-project-read-only',
	'skip-rule-disabled',
] as const);

export type NativeWatchDecision = (typeof NATIVE_WATCH_DECISIONS)[number];

export const NATIVE_WATCH_TRACKING_OUTCOMES = Object.freeze([
	'tracked',
	'refused-tracking-ceiling',
] as const);

export type NativeWatchTrackingOutcome = (typeof NATIVE_WATCH_TRACKING_OUTCOMES)[number];

export interface WatchCandidateObservationV1 {
	readonly atMs: number;
	readonly sizeBytes: number;
	readonly modifiedAtMs: number;
}

export interface WatchCandidateStateV1 {
	readonly fileIdentity: string;
	readonly sizeBytes: number;
	readonly modifiedAtMs: number;
	/** Consecutive observations that agreed with the one before them. */
	readonly unchangedObservations: number;
	readonly firstUnchangedAtMs: number;
	readonly lastObservedAtMs: number;
}

export interface WatchCandidateTrackingV1 {
	readonly outcome: NativeWatchTrackingOutcome;
	/** The folded state, or null when the ceiling refused a new candidate. */
	readonly candidate: WatchCandidateStateV1 | null;
	readonly trackedCount: number;
}

export interface WatchImportDecisionRequestV1 {
	readonly rule: WatchRuleV1;
	readonly candidate: WatchCandidateStateV1;
	readonly probeSucceeded: boolean;
	readonly contentSha256: string | null;
	readonly importedKeys: ReadonlySet<string>;
	readonly projectOpen: boolean;
	readonly projectWritable: boolean;
	readonly nowMs: number;
}

export interface WatchImportDecisionV1 {
	readonly decision: NativeWatchDecision;
	/** The rule-scoped duplicate key, present once content is known. */
	readonly importKey: string | null;
}

export class NativeWatchReconciliationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NativeWatchReconciliationError';
	}
}

const { nonNegativeInteger } = createNativeValidators({
	subject: 'A watch observation',
	raise: (message: string): never => {
		throw new NativeWatchReconciliationError(message);
	},
});

/**
 * Fold one observation into a candidate's stability state. An observation that
 * differs from the last one restarts the count: a file that is still being
 * written has to go quiet again from scratch.
 */
export function observeWatchCandidate(
	previous: WatchCandidateStateV1 | null,
	fileIdentity: string,
	observation: WatchCandidateObservationV1,
): WatchCandidateStateV1 {
	const atMs = nonNegativeInteger(observation.atMs, 'atMs');
	const sizeBytes = nonNegativeInteger(observation.sizeBytes, 'sizeBytes');
	const modifiedAtMs = nonNegativeInteger(observation.modifiedAtMs, 'modifiedAtMs');
	identity(fileIdentity);
	if (previous === null || previous.fileIdentity !== fileIdentity) {
		return state(fileIdentity, sizeBytes, modifiedAtMs, 1, atMs, atMs);
	}
	if (atMs < previous.lastObservedAtMs) {
		throw new NativeWatchReconciliationError('A watch observation never precedes the one before it.');
	}
	const unchanged = previous.sizeBytes === sizeBytes && previous.modifiedAtMs === modifiedAtMs;
	return unchanged
		? state(
			fileIdentity, sizeBytes, modifiedAtMs,
			previous.unchangedObservations + 1, previous.firstUnchangedAtMs, atMs,
		)
		: state(fileIdentity, sizeBytes, modifiedAtMs, 1, atMs, atMs);
}

/**
 * Fold one observation into a sweep's tracked candidates, keeping the set
 * bounded. A candidate already tracked keeps settling however full the set is;
 * only an unfamiliar one is turned away at the ceiling. A caller drops a
 * candidate from the set — imported, gone, or given up on — with `delete`.
 */
export function trackWatchCandidate(
	tracked: Map<string, WatchCandidateStateV1>,
	fileIdentity: string,
	observation: WatchCandidateObservationV1,
): WatchCandidateTrackingV1 {
	const previous = tracked.get(identity(fileIdentity)) ?? null;
	if (previous === null && tracked.size >= NATIVE_WATCH_MAXIMUM_TRACKED_CANDIDATES) {
		return Object.freeze({
			outcome: 'refused-tracking-ceiling' as const,
			candidate: null,
			trackedCount: tracked.size,
		});
	}
	const candidate = observeWatchCandidate(previous, fileIdentity, observation);
	tracked.set(fileIdentity, candidate);
	return Object.freeze({ outcome: 'tracked' as const, candidate, trackedCount: tracked.size });
}

/**
 * A candidate has settled once it has agreed with itself twice, at least two
 * seconds apart. Both conditions are needed: two observations a millisecond
 * apart prove nothing about a slow copy.
 */
export function watchCandidateHasSettled(candidate: WatchCandidateStateV1): boolean {
	return candidate.unchangedObservations >= NATIVE_WATCH_STABILITY_OBSERVATIONS
		&& candidate.lastObservedAtMs - candidate.firstUnchangedAtMs >= NATIVE_WATCH_STABILITY_INTERVAL_MS;
}

/** The rule-scoped key that makes an import idempotent. */
export function watchImportKey(
	rule: WatchRuleV1,
	fileIdentity: string,
	contentSha256: string,
): string {
	if (!NATIVE_SHA256_HEX_PATTERN.test(contentSha256)) {
		throw new NativeWatchReconciliationError('A watch import key needs the file content digest.');
	}
	return `${rule.ruleId}|${identity(fileIdentity)}|${contentSha256}`;
}

/**
 * Decide what to do with one settled candidate.
 *
 * The order matters: stability and readability are established before the
 * project is consulted, so a file that is still being written never becomes a
 * pending ingest the user is asked about.
 */
export function decideWatchImport(
	request: WatchImportDecisionRequestV1,
): WatchImportDecisionV1 {
	if (!request.rule.enabled) return decision('skip-rule-disabled', null);
	if (!watchCandidateHasSettled(request.candidate)) return decision('defer-unstable', null);
	if (!request.probeSucceeded || request.contentSha256 === null) {
		return decision('defer-probe', null);
	}
	const importKey = watchImportKey(
		request.rule, request.candidate.fileIdentity, request.contentSha256,
	);
	if (request.importedKeys.has(importKey)) return decision('skip-duplicate', importKey);
	if (!request.projectOpen) return decision('pending-project-closed', importKey);
	if (!request.projectWritable) return decision('pending-project-read-only', importKey);
	return decision('import', importKey);
}

/** Whether a decision leaves work waiting for the user rather than discarding it. */
export function watchDecisionIsPending(value: NativeWatchDecision): boolean {
	return value === 'pending-project-closed' || value === 'pending-project-read-only';
}

/**
 * The next sweep is never later than the fixed interval, and an event only
 * pulls it earlier. A missed event therefore costs latency, never correctness.
 */
export function nextWatchReconcileAtMs(
	lastSweepAtMs: number,
	eventAtMs: number | null,
): number {
	const scheduled = nonNegativeInteger(lastSweepAtMs, 'lastSweepAtMs')
		+ NATIVE_WATCH_RECONCILE_INTERVAL_MS;
	if (eventAtMs === null) return scheduled;
	return Math.min(scheduled, nonNegativeInteger(eventAtMs, 'eventAtMs'));
}

function state(
	fileIdentity: string,
	sizeBytes: number,
	modifiedAtMs: number,
	unchangedObservations: number,
	firstUnchangedAtMs: number,
	lastObservedAtMs: number,
): WatchCandidateStateV1 {
	return Object.freeze({
		fileIdentity,
		sizeBytes,
		modifiedAtMs,
		unchangedObservations,
		firstUnchangedAtMs,
		lastObservedAtMs,
	});
}

function decision(
	value: NativeWatchDecision,
	importKey: string | null,
): WatchImportDecisionV1 {
	return Object.freeze({ decision: value, importKey });
}

function identity(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.includes('|')) {
		throw new NativeWatchReconciliationError('A watch candidate needs a bounded canonical file identity.');
	}
	return value;
}
