/* SPDX-License-Identifier: AGPL-3.0-only */

import { type DeliveryQueue, type DeliveryQueueState } from '../delivery-queue.ts';
import {
	createDeliveryBatchReport,
	deliveryBatchRetryMemberIds,
	type DeliveryBatchMemberOutcome,
	type DeliveryBatchMemberState,
} from '../delivery-batch-report.ts';
import type { DeliveryBatch } from '../delivery-batch.ts';
import type { DeliveryReport } from '../delivery-report.ts';
import { createDeliveryQueueRunner } from './delivery-queue-runner.ts';

/**
 * Binds the delivery queue to the export path that actually renders.
 *
 * The queue module owns legal transitions, the runner owns when one happens,
 * and this owns what a job *is*: one ordinary export with its own settings.
 * Every member goes through `handleExportAction` exactly as a single delivery
 * does, which is what keeps a batch from becoming a second render path.
 *
 * Settings live in a side map rather than on the queue entry. A queue record
 * stays a small status row, so listing a long queue never drags delivery
 * settings — let alone media — through it. What each member produced is kept
 * the same way: a file name and its own sealed report, never bytes.
 */

export interface DeliveryQueueServiceRuntime {
	readonly handleExportAction: (action: string, settings?: unknown) => Promise<unknown> | unknown;
	readonly publishDocumentSnapshot?: () => void;
	readonly createId?: (prefix: string) => string;
	readonly state?: { deliveryQueue?: DeliveryQueue; deliveryReport?: unknown };
}

/** Raised when an export resolved without publishing anything. */
class DeliveryNotPublishedError extends Error {
	override readonly name = 'DeliveryNotPublished';
}

/**
 * Reads what an export published, or refuses to call it a delivery.
 *
 * `handleExportAction` does not reject when a render fails: it catches, reports
 * through the status surface, and resolves — and it resolves just the same when
 * settings are refused, when the project is empty, or when the operator dismisses
 * the save dialog. So a resolved call is not evidence that anything was written,
 * and taking it for one is what let a member that delivered nothing be sealed
 * into the manifest as delivered. A publication is the record the export path
 * returns for what it wrote; a dismissed dialog reports itself as cancelled and
 * settles the member that way rather than as a failure.
 */
function publishedDelivery(outcome: unknown): string | null {
	if (outcome && typeof outcome === 'object') {
		const record = outcome as Readonly<{ cancelled?: unknown; fileName?: unknown }>;
		if (record.cancelled) {
			throw new DOMException('The delivery was cancelled before it published.', 'AbortError');
		}
		if (typeof record.fileName === 'string') return record.fileName;
	}
	throw new DeliveryNotPublishedError('The delivery published no output.');
}

/** Queue states, read as what the batch report says about a member. */
const MEMBER_STATES: Readonly<Record<DeliveryQueueState, DeliveryBatchMemberState>> = Object.freeze({
	completed: 'delivered',
	failed: 'failed',
	cancelled: 'cancelled',
	queued: 'not-started',
	running: 'not-started',
});

export function createDeliveryQueueService(runtime: DeliveryQueueServiceRuntime) {
	if (typeof runtime?.handleExportAction !== 'function') {
		throw new TypeError('A delivery queue service requires the export action.');
	}
	const settingsByJob = new Map<string, unknown>();
	const batches = new Map<string, DeliveryBatch>();
	const batchIdByJob = new Map<string, string>();
	const results = new Map<string, { fileName: string | null; report: DeliveryReport | null }>();

	const runner = createDeliveryQueueRunner({
		runJob: async (entry) => {
			const settings = settingsByJob.get(entry.jobId);
			const output = await runtime.handleExportAction('start', settings ?? {});
			const fileName = publishedDelivery(output);
			// Recorded per member so the batch report can say which artifact each
			// conversion belongs to. Both are small: a name and a sealed report.
			// Reached only once the delivery published, so a member never carries
			// the report of a render that did not produce it.
			results.set(entry.jobId, {
				fileName,
				report: (runtime.state?.deliveryReport as DeliveryReport | undefined) ?? null,
			});
		},
		onChange: (queue) => {
			if (runtime.state) runtime.state.deliveryQueue = queue;
			runtime.publishDocumentSnapshot?.();
		},
	});

	function nextJobId(): string {
		return runtime.createId?.('delivery-job') ?? `delivery-job-${settingsByJob.size + 1}`;
	}

	function enqueueJob(jobId: string, label: string, settings: unknown): void {
		settingsByJob.set(jobId, settings ?? {});
		results.delete(jobId);
		runner.enqueue({
			jobId,
			label: label || jobId,
			taskKind: 'encoded-export',
			recoveryClass: 'atomic-restart',
		});
	}

	function memberOutcomes(batch: DeliveryBatch): readonly DeliveryBatchMemberOutcome[] {
		const byJob = new Map(runner.getQueue().entries.map((entry) => [entry.jobId, entry]));
		return batch.members.map((member) => {
			const entry = byJob.get(member.memberId);
			const result = results.get(member.memberId);
			const state = entry ? MEMBER_STATES[entry.state] : 'not-started';
			return Object.freeze({
				memberId: member.memberId,
				state,
				fileName: state === 'delivered' ? result?.fileName ?? null : null,
				...(entry?.lastFailureCode && state === 'failed'
					? { failureMessage: entry.lastFailureCode }
					: {}),
				...(state === 'delivered' && result?.report ? { report: result.report } : {}),
			});
		});
	}

	function requireBatch(batchId: string): DeliveryBatch {
		const batch = batches.get(batchId);
		if (!batch) throw new Error(`Delivery batch ${batchId} is not queued.`);
		return batch;
	}

	return Object.freeze({
		list: (): DeliveryQueue => runner.getQueue(),
		/**
		 * Queue one delivery. Every web-tier job declares atomic restart, because
		 * nothing here checkpoints and claiming resume would be a label the tier
		 * cannot honour.
		 */
		enqueue(request: { label: string; settings?: unknown }): string {
			const jobId = nextJobId();
			enqueueJob(jobId, request?.label ?? '', request?.settings);
			return jobId;
		},
		/**
		 * Queue a batch as its members, in batch order. Each one is an ordinary
		 * delivery, so a batch is exactly a list of jobs and a manifest — there is
		 * no batch job that could fail as a unit and leave half an artifact.
		 */
		enqueueBatch(batch: DeliveryBatch): readonly string[] {
			if (!batch || !Array.isArray(batch.members) || batch.members.length === 0) {
				throw new TypeError('A delivery batch with at least one member is required.');
			}
			batches.set(batch.batchId, batch);
			for (const member of batch.members) {
				batchIdByJob.set(member.memberId, batch.batchId);
				enqueueJob(member.memberId, member.label, member.settings);
			}
			return Object.freeze(batch.members.map(({ memberId }) => memberId));
		},
		/** The manifest: what happened to every member, whether or not it ran. */
		batchReport: (batchId: string): DeliveryReport => createDeliveryBatchReport(
			requireBatch(batchId), memberOutcomes(requireBatch(batchId)),
		),
		/**
		 * Re-run only what did not deliver. Read from the batch report rather than
		 * from a caller's memory, so a member that already published is never
		 * delivered twice.
		 */
		retryBatchFailures(batchId: string): readonly string[] {
			const batch = requireBatch(batchId);
			const retryable = new Set(deliveryBatchRetryMemberIds(
				createDeliveryBatchReport(batch, memberOutcomes(batch)),
			));
			const queued = runner.getQueue().entries;
			for (const member of batch.members) {
				if (!retryable.has(member.memberId)) continue;
				const entry = queued.find(({ jobId }) => jobId === member.memberId);
				if (entry?.state === 'failed') runner.retry(member.memberId);
				else if (!entry) enqueueJob(member.memberId, member.label, member.settings);
			}
			return Object.freeze([...retryable]);
		},
		batchIdForJob: (jobId: string): string | null => batchIdByJob.get(jobId) ?? null,
		pause: () => runner.pause(),
		resume: () => runner.resume(),
		cancel: (jobId: string) => {
			// Only the running delivery may be aborted. Cancelling a queued member
			// used to abort whichever member happened to be rendering, which is a
			// different job than the one the operator pointed at.
			const running = runner.activeJobId() === jobId;
			runner.cancel(jobId);
			if (running) runtime.handleExportAction('cancel');
		},
		retry: (jobId: string) => runner.retry(jobId),
		reorder: (jobId: string, position: number) => runner.reorder(jobId, position),
		recover: () => runner.recover(),
		settled: () => runner.settled(),
	});
}
