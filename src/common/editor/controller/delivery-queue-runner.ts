/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type DeliveryQueue,
	type DeliveryQueueEntry,
	cancelDeliveryJob,
	completeDeliveryJob,
	createDeliveryQueue,
	enqueueDeliveryJob,
	failDeliveryJob,
	nextDeliveryJob,
	pauseDeliveryQueue,
	recoverDeliveryQueueAfterRestart,
	reorderDeliveryJob,
	resumeDeliveryQueue,
	retryDeliveryJob,
	startDeliveryJob,
} from '../delivery-queue.ts';
import { type NativeQueueRecoveryClass, type NativeQueueTaskKind } from '../native-queue-record.ts';

/**
 * Drives the in-session delivery queue.
 *
 * The queue module owns what a legal transition is; this owns when one
 * happens. Keeping them apart is what lets the state machine be exhaustively
 * tested without a renderer and lets this be tested without a real encoder.
 *
 * The runner never publishes anything itself. It asks the executor to run one
 * job and records only what came back, so a failed or cancelled job leaves the
 * queue with no output attributed to it — the "publishes nothing partial"
 * invariant is a property of never having a success path that error handling
 * can fall into.
 */

export interface DeliveryQueueJobRequest {
	readonly jobId: string;
	readonly label: string;
	readonly taskKind: NativeQueueTaskKind;
	readonly recoveryClass: NativeQueueRecoveryClass;
}

export interface DeliveryQueueRunnerRuntime {
	/** Runs exactly one job. Rejecting with an abort error means cancelled, not failed. */
	readonly runJob: (
		entry: DeliveryQueueEntry,
		context: { readonly signal: AbortSignal },
	) => Promise<unknown>;
	readonly onChange?: (queue: DeliveryQueue) => void;
	readonly isAbortError?: (error: unknown) => boolean;
}

function defaultIsAbortError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError');
}

export function createDeliveryQueueRunner(runtime: DeliveryQueueRunnerRuntime) {
	if (typeof runtime?.runJob !== 'function') {
		throw new TypeError('A delivery queue runner requires a job executor.');
	}
	const isAbortError = runtime.isAbortError ?? defaultIsAbortError;
	let queue = createDeliveryQueue();
	let draining: Promise<void> | null = null;
	let activeJobId: string | null = null;
	let activeAbort: AbortController | null = null;

	function publish(next: DeliveryQueue): void {
		queue = next;
		runtime.onChange?.(queue);
	}

	async function drain(): Promise<void> {
		for (;;) {
			const entry = nextDeliveryJob(queue);
			if (!entry) break;
			const abort = new AbortController();
			activeJobId = entry.jobId;
			activeAbort = abort;
			publish(startDeliveryJob(queue, entry.jobId));
			try {
				await runtime.runJob(currentEntry(entry.jobId) ?? entry, { signal: abort.signal });
				// A job cancelled mid-flight is already terminal; completing it here
				// would overwrite the user's decision with a success they did not get.
				if (currentEntry(entry.jobId)?.state === 'running') {
					publish(completeDeliveryJob(queue, entry.jobId));
				}
			} catch (error) {
				if (currentEntry(entry.jobId)?.state === 'running') {
					publish(isAbortError(error)
						? cancelDeliveryJob(queue, entry.jobId)
						: failDeliveryJob(queue, entry.jobId, failureCode(error)));
				}
			} finally {
				activeJobId = null;
				activeAbort = null;
			}
		}
	}

	function currentEntry(jobId: string): DeliveryQueueEntry | null {
		return queue.entries.find((entry) => entry.jobId === jobId) ?? null;
	}

	/** Start draining if nothing is already draining. Resolves when the queue stalls or empties. */
	function run(): Promise<void> {
		if (draining) return draining;
		draining = drain().finally(() => { draining = null; });
		return draining;
	}

	return Object.freeze({
		getQueue: (): DeliveryQueue => queue,
		/**
		 * Admit a job and start draining. This deliberately does not return the
		 * drain promise: awaiting it would mean awaiting the whole queue, so a
		 * caller enqueueing two jobs in a row would block on the first. Await
		 * `settled()` when you want the queue to finish.
		 */
		enqueue(request: DeliveryQueueJobRequest): void {
			publish(enqueueDeliveryJob(queue, request));
			void run();
		},
		pause(): void {
			publish(pauseDeliveryQueue(queue));
		},
		resume(): void {
			publish(resumeDeliveryQueue(queue));
			void run();
		},
		cancel(jobId: string): void {
			publish(cancelDeliveryJob(queue, jobId));
			if (activeJobId === jobId) activeAbort?.abort();
		},
		retry(jobId: string): void {
			publish(retryDeliveryJob(queue, jobId));
			void run();
		},
		reorder(jobId: string, position: number): void {
			publish(reorderDeliveryJob(queue, jobId, position));
		},
		/** Rebuild as a fresh session would see it; an interrupted job returns whole. */
		recover(): void {
			publish(recoverDeliveryQueueAfterRestart(queue));
		},
		/** Resolves once the current drain settles, so callers need no polling. */
		settled: (): Promise<void> => draining ?? Promise.resolve(),
	});
}

function failureCode(error: unknown): string {
	const name = (error as { name?: unknown } | null)?.name;
	if (typeof name === 'string' && name) return name;
	return 'delivery-job-failed';
}
