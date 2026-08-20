/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperCaptureProjectFenceV1 } from '../framescaper-capture-session-manifest.ts';
import {
	planFramescaperCapturePublication,
	type FramescaperCapturePublicationBatchCommand,
	type FramescaperCapturePublicationPlan,
	type FramescaperCapturePublicationPlanRequest,
	type FramescaperFinalizedCaptureStream,
} from './framescaper-capture-publication-plan.ts';

export interface FramescaperOwnedCaptureAssetPublication {
	readonly source: Readonly<Record<string, unknown>>;
	discardIfCurrent(): PromiseLike<boolean> | boolean;
}

export interface FramescaperCaptureAtomicCommitSuccess {
	readonly status: 'committed';
	readonly value?: unknown;
}

export interface FramescaperCaptureAtomicCommitCasMismatch {
	readonly status: 'cas-mismatch';
	readonly value?: unknown;
}

export type FramescaperCaptureAtomicCommitResult =
	FramescaperCaptureAtomicCommitSuccess | FramescaperCaptureAtomicCommitCasMismatch;

export interface FramescaperCaptureRetryableRecoveryRecord {
	readonly sessionId: string;
	readonly projectFence: FramescaperCaptureProjectFenceV1;
	readonly sourceIds: readonly string[];
	readonly reason: 'commit-failed';
	readonly error: unknown;
}

export interface FramescaperCapturePublicationServiceDependencies {
	assertProjectFence(
		fence: FramescaperCaptureProjectFenceV1,
	): PromiseLike<void> | void;
	publishAsset(
		stream: FramescaperFinalizedCaptureStream,
		context: Readonly<{
			readonly sessionId: string;
			readonly projectFence: FramescaperCaptureProjectFenceV1;
			readonly signal: AbortSignal | null;
		}>,
	): PromiseLike<FramescaperOwnedCaptureAssetPublication> | FramescaperOwnedCaptureAssetPublication;
	commitAtomic(
		command: FramescaperCapturePublicationBatchCommand,
		fence: FramescaperCaptureProjectFenceV1,
	): PromiseLike<FramescaperCaptureAtomicCommitResult> | FramescaperCaptureAtomicCommitResult;
	recordRetryableRecovery(
		record: FramescaperCaptureRetryableRecoveryRecord,
	): PromiseLike<void> | void;
}

export interface FramescaperCapturePublicationRequest extends Omit<
	FramescaperCapturePublicationPlanRequest,
	'streams'
> {
	readonly projectFence: FramescaperCaptureProjectFenceV1;
	readonly streams: readonly FramescaperFinalizedCaptureStream[];
	readonly signal?: AbortSignal | null;
}

export interface FramescaperCapturePublicationResult {
	readonly plan: FramescaperCapturePublicationPlan;
	readonly commitValue: unknown;
}

export class FramescaperCapturePublicationCasError extends Error {
	readonly code = 'FRAMESCAPER_CAPTURE_PUBLICATION_CAS_MISMATCH';

	constructor() {
		super('The origin project changed before capture publication could commit.');
		this.name = 'FramescaperCapturePublicationCasError';
	}
}

export class FramescaperCapturePublicationRetryableError extends Error {
	readonly code = 'FRAMESCAPER_CAPTURE_PUBLICATION_RETRYABLE';

	constructor(cause: unknown) {
		super('Capture assets are durable, but their atomic project commit must be retried.', { cause });
		this.name = 'FramescaperCapturePublicationRetryableError';
	}
}

/**
 * Two-phase publication boundary: durable media first, then exactly one
 * document batch. A known CAS rejection removes owned media; an indeterminate
 * commit failure retains it under recovery authority so a retry cannot lose a
 * completed recording.
 */
export function createFramescaperCapturePublicationService(
	dependencies: FramescaperCapturePublicationServiceDependencies,
) {
	return Object.freeze({ publish });

	async function publish(
		request: FramescaperCapturePublicationRequest,
	): Promise<Readonly<FramescaperCapturePublicationResult>> {
		const fence = normalizeFence(request.projectFence);
		const signal = request.signal ?? null;
		const streams = boundedStreams(request.streams);
		const owned: FramescaperOwnedCaptureAssetPublication[] = [];
		let plan: FramescaperCapturePublicationPlan | null = null;
		try {
			throwIfAborted(signal);
			await dependencies.assertProjectFence(fence);
			for (const stream of streams) {
				throwIfAborted(signal);
				const publication = normalizePublication(await dependencies.publishAsset(stream, {
					sessionId: request.sessionId,
					projectFence: fence,
					signal,
				}));
				owned.push(publication);
			}
			throwIfAborted(signal);
			await dependencies.assertProjectFence(fence);
			plan = planFramescaperCapturePublication({
				...request,
				streams: streams.map((stream, index) => ({
					...stream,
					source: owned[index]!.source,
				})),
			});
		} catch (error) {
			await rollbackOwned(owned, error);
			throw error;
		}

		let committed: FramescaperCaptureAtomicCommitResult;
		try {
			throwIfAborted(signal);
			committed = normalizeCommitResult(await dependencies.commitAtomic(plan.command, fence));
		} catch (error) {
			throw await retainRetryable(dependencies, request.sessionId, fence, owned, error);
		}
		if (committed.status === 'cas-mismatch') {
			const error = new FramescaperCapturePublicationCasError();
			await rollbackOwned(owned, error);
			throw error;
		}
		return Object.freeze({ plan, commitValue: committed.value });
	}
}

async function retainRetryable(
	dependencies: FramescaperCapturePublicationServiceDependencies,
	sessionId: string,
	projectFence: FramescaperCaptureProjectFenceV1,
	owned: readonly FramescaperOwnedCaptureAssetPublication[],
	cause: unknown,
): Promise<Error> {
	const error = new FramescaperCapturePublicationRetryableError(cause);
	const sourceIds = Object.freeze(owned.map(({ source }) => sourceId(source)));
	try {
		await dependencies.recordRetryableRecovery({
			sessionId,
			projectFence,
			sourceIds,
			reason: 'commit-failed',
			error: cause,
		});
		return error;
	} catch (recoveryError) {
		return new AggregateError(
			[error, recoveryError],
			'Capture commit and retryable-recovery recording both failed; durable assets were retained.',
			{ cause: error },
		);
	}
}

async function rollbackOwned(
	owned: readonly FramescaperOwnedCaptureAssetPublication[],
	cause: unknown,
): Promise<void> {
	const failures: unknown[] = [];
	for (let index = owned.length - 1; index >= 0; index -= 1) {
		try {
			const discarded = await owned[index]!.discardIfCurrent();
			if (!discarded) failures.push(new Error(
				`Capture asset ${sourceId(owned[index]!.source)} is no longer owned by this publication.`,
			));
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length) {
		throw new AggregateError(
			[cause, ...failures],
			'Capture publication and owned-asset rollback both failed.',
			{ cause },
		);
	}
}

function normalizeFence(value: FramescaperCaptureProjectFenceV1): FramescaperCaptureProjectFenceV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Capture publication project fence must be a data record.');
	}
	const projectId = sourceId({ id: value.projectId });
	if (!Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0) {
		throw new RangeError('Capture publication base revision must be non-negative.');
	}
	if (typeof value.baseSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.baseSha256)) {
		throw new TypeError('Capture publication base SHA-256 is invalid.');
	}
	return Object.freeze({
		projectId,
		baseRevision: value.baseRevision,
		baseSha256: value.baseSha256,
	});
}

function boundedStreams(
	value: readonly FramescaperFinalizedCaptureStream[],
): readonly FramescaperFinalizedCaptureStream[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
		throw new RangeError('Capture publication requires one through four finalized streams.');
	}
	return Object.freeze([...value]);
}

function normalizePublication(value: FramescaperOwnedCaptureAssetPublication): FramescaperOwnedCaptureAssetPublication {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !value.source || typeof value.source !== 'object' || Array.isArray(value.source)
		|| typeof value.discardIfCurrent !== 'function') {
		throw new TypeError('Capture asset publication has an invalid ownership contract.');
	}
	sourceId(value.source);
	return value;
}

function normalizeCommitResult(value: FramescaperCaptureAtomicCommitResult): FramescaperCaptureAtomicCommitResult {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (value.status !== 'committed' && value.status !== 'cas-mismatch')) {
		throw new TypeError('Capture atomic commit returned an invalid status.');
	}
	return value;
}

function sourceId(value: Readonly<Record<string, unknown>>): string {
	if (typeof value.id !== 'string' || !value.id.length || value.id !== value.id.trim()
		|| value.id.length > 256 || /[\u0000-\u001f\u007f]/u.test(value.id)) {
		throw new TypeError('Capture publication source ID is invalid.');
	}
	return value.id;
}

function throwIfAborted(signal: AbortSignal | null): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('Capture publication was cancelled.', 'AbortError');
}
