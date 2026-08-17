/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	NATIVE_QUEUE_CHECKPOINTABLE_TASK_KINDS,
	NATIVE_QUEUE_RECOVERY_CLASSES,
	type NativeQueueRecoveryClass,
	type NativeQueueTaskKind,
} from './native-queue-record.ts';

/**
 * The bounded in-session delivery queue.
 *
 * This is the web tier's queue: ordered jobs, pause between jobs, cancel, and
 * retry-from-failure over the editor's existing task and cancellation
 * discipline. It deliberately reuses the recovery-class and task-kind
 * vocabulary the durable native queue already defines, because two queues that
 * disagree about what "resumable" means is exactly the drift the milestone-6
 * exit gate forbids.
 *
 * Three properties hold by construction:
 *
 * - **Nothing partial publishes.** A job that is cancelled, failed, or killed
 *   leaves no output; a restart re-runs the whole plan.
 * - **A record never stores media bytes.** Entries carry a plan reference and
 *   status, so a queue of thousands of jobs stays a small object.
 * - **Pause is between jobs, not inside one.** A tier that cannot checkpoint
 *   must not offer mid-job suspension it would have to fake.
 */

export const DELIVERY_QUEUE_STATES = Object.freeze([
	'queued', 'running', 'completed', 'failed', 'cancelled',
] as const);

export type DeliveryQueueState = (typeof DELIVERY_QUEUE_STATES)[number];

const TERMINAL_STATES: readonly DeliveryQueueState[] = Object.freeze([
	'completed', 'failed', 'cancelled',
]);

export interface DeliveryQueueEntry {
	readonly jobId: string;
	readonly label: string;
	readonly taskKind: NativeQueueTaskKind;
	readonly recoveryClass: NativeQueueRecoveryClass;
	readonly state: DeliveryQueueState;
	readonly attempt: number;
	readonly lastFailureCode: string | null;
}

export interface DeliveryQueue {
	/** Queue order. The running job, when there is one, is the first non-terminal entry. */
	readonly entries: readonly DeliveryQueueEntry[];
	/** Paused queues start no further jobs; a job already running is left to finish. */
	readonly paused: boolean;
}

export class DeliveryQueueError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DeliveryQueueError';
	}
}

export function createDeliveryQueue(): DeliveryQueue {
	return Object.freeze({ entries: Object.freeze([]), paused: false });
}

/**
 * Admit one job. A job that can neither restart atomically nor prove a
 * checkpointed resume stays out of the queue rather than being labeled with a
 * recovery it does not have.
 */
export function enqueueDeliveryJob(queue: DeliveryQueue, request: {
	jobId: string;
	label: string;
	taskKind: NativeQueueTaskKind;
	recoveryClass: NativeQueueRecoveryClass;
}): DeliveryQueue {
	assertQueue(queue);
	if (typeof request?.jobId !== 'string' || !request.jobId) {
		throw new DeliveryQueueError('A delivery job requires an id.');
	}
	if (queue.entries.some((entry) => entry.jobId === request.jobId)) {
		throw new DeliveryQueueError(`Delivery job ${request.jobId} is already queued.`);
	}
	if (!NATIVE_QUEUE_RECOVERY_CLASSES.includes(request.recoveryClass)) {
		throw new DeliveryQueueError(
			`Delivery job ${request.jobId} declares no supported recovery class; it stays out of the queue.`,
		);
	}
	if (request.recoveryClass === 'verified-frame-checkpoint'
		&& !NATIVE_QUEUE_CHECKPOINTABLE_TASK_KINDS.includes(request.taskKind)) {
		throw new DeliveryQueueError(
			`Task kind ${request.taskKind} cannot checkpoint, so it may not claim verified-frame-checkpoint recovery.`,
		);
	}
	return freezeQueue({
		paused: queue.paused,
		entries: [...queue.entries, {
			jobId: request.jobId,
			label: typeof request.label === 'string' ? request.label : request.jobId,
			taskKind: request.taskKind,
			recoveryClass: request.recoveryClass,
			state: 'queued' as const,
			attempt: 0,
			lastFailureCode: null,
		}],
	});
}

/** The job a runner should start next, or null when the queue is paused, busy, or drained. */
export function nextDeliveryJob(queue: DeliveryQueue): DeliveryQueueEntry | null {
	assertQueue(queue);
	if (queue.paused) return null;
	if (queue.entries.some((entry) => entry.state === 'running')) return null;
	return queue.entries.find((entry) => entry.state === 'queued') ?? null;
}

export function startDeliveryJob(queue: DeliveryQueue, jobId: string): DeliveryQueue {
	const entry = requireEntry(queue, jobId);
	if (entry.state !== 'queued') {
		throw new DeliveryQueueError(`Delivery job ${jobId} is ${entry.state} and cannot start.`);
	}
	if (queue.paused) throw new DeliveryQueueError('A paused delivery queue starts no jobs.');
	if (queue.entries.some((other) => other.state === 'running')) {
		throw new DeliveryQueueError('One delivery job runs at a time.');
	}
	return replaceEntry(queue, jobId, (current) => ({
		...current,
		state: 'running',
		attempt: current.attempt + 1,
	}));
}

export function completeDeliveryJob(queue: DeliveryQueue, jobId: string): DeliveryQueue {
	const entry = requireEntry(queue, jobId);
	if (entry.state !== 'running') {
		throw new DeliveryQueueError(`Delivery job ${jobId} is ${entry.state} and cannot complete.`);
	}
	return replaceEntry(queue, jobId, (current) => ({
		...current, state: 'completed', lastFailureCode: null,
	}));
}

export function failDeliveryJob(
	queue: DeliveryQueue,
	jobId: string,
	failureCode: string,
): DeliveryQueue {
	const entry = requireEntry(queue, jobId);
	if (entry.state !== 'running') {
		throw new DeliveryQueueError(`Delivery job ${jobId} is ${entry.state} and cannot fail.`);
	}
	if (typeof failureCode !== 'string' || !failureCode) {
		throw new DeliveryQueueError('A failed delivery job requires a failure code.');
	}
	return replaceEntry(queue, jobId, (current) => ({
		...current, state: 'failed', lastFailureCode: failureCode,
	}));
}

/** Cancellation is valid from any non-terminal state and publishes nothing. */
export function cancelDeliveryJob(queue: DeliveryQueue, jobId: string): DeliveryQueue {
	const entry = requireEntry(queue, jobId);
	if (TERMINAL_STATES.includes(entry.state)) {
		throw new DeliveryQueueError(`Delivery job ${jobId} is already ${entry.state}.`);
	}
	return replaceEntry(queue, jobId, (current) => ({ ...current, state: 'cancelled' }));
}

/** Retry re-queues a failed or cancelled job; its next start counts a fresh attempt. */
export function retryDeliveryJob(queue: DeliveryQueue, jobId: string): DeliveryQueue {
	const entry = requireEntry(queue, jobId);
	if (entry.state !== 'failed' && entry.state !== 'cancelled') {
		throw new DeliveryQueueError(`Delivery job ${jobId} is ${entry.state} and has nothing to retry.`);
	}
	return replaceEntry(queue, jobId, (current) => ({ ...current, state: 'queued' }));
}

/** Explicit reordering of a job that has not started. FIFO otherwise. */
export function reorderDeliveryJob(
	queue: DeliveryQueue,
	jobId: string,
	position: number,
): DeliveryQueue {
	const entry = requireEntry(queue, jobId);
	if (entry.state !== 'queued') {
		throw new DeliveryQueueError(`Delivery job ${jobId} is ${entry.state} and cannot be reordered.`);
	}
	if (!Number.isSafeInteger(position) || position < 0 || position >= queue.entries.length) {
		throw new DeliveryQueueError(`Position ${position} is outside the delivery queue.`);
	}
	const remaining = queue.entries.filter((other) => other.jobId !== jobId);
	remaining.splice(position, 0, entry);
	return freezeQueue({ paused: queue.paused, entries: remaining });
}

/** Pause takes effect between jobs; a running job is never suspended mid-flight. */
export function pauseDeliveryQueue(queue: DeliveryQueue): DeliveryQueue {
	assertQueue(queue);
	return freezeQueue({ paused: true, entries: [...queue.entries] });
}

export function resumeDeliveryQueue(queue: DeliveryQueue): DeliveryQueue {
	assertQueue(queue);
	return freezeQueue({ paused: false, entries: [...queue.entries] });
}

/**
 * Rebuild the queue as a fresh session would see it after a kill or reload.
 *
 * Nothing in this tier is durable, so a job that was running did not publish
 * and returns to `queued` under its atomic restart. This is the honest answer
 * for a queue with no checkpoint, and it is why the web tier never claims
 * resume.
 */
export function recoverDeliveryQueueAfterRestart(queue: DeliveryQueue): DeliveryQueue {
	assertQueue(queue);
	return freezeQueue({
		paused: queue.paused,
		entries: queue.entries.map((entry) => (entry.state === 'running'
			? { ...entry, state: 'queued' as const, lastFailureCode: null }
			: entry)),
	});
}

function requireEntry(queue: DeliveryQueue, jobId: string): DeliveryQueueEntry {
	assertQueue(queue);
	const entry = queue.entries.find((candidate) => candidate.jobId === jobId);
	if (!entry) throw new DeliveryQueueError(`Delivery job ${jobId} is not queued.`);
	return entry;
}

function replaceEntry(
	queue: DeliveryQueue,
	jobId: string,
	update: (entry: DeliveryQueueEntry) => DeliveryQueueEntry,
): DeliveryQueue {
	return freezeQueue({
		paused: queue.paused,
		entries: queue.entries.map((entry) => (entry.jobId === jobId ? update(entry) : entry)),
	});
}

function freezeQueue(value: { paused: boolean; entries: DeliveryQueueEntry[] }): DeliveryQueue {
	return Object.freeze({
		paused: value.paused,
		entries: Object.freeze(value.entries.map((entry) => Object.freeze({ ...entry }))),
	});
}

function assertQueue(queue: DeliveryQueue): void {
	if (!queue || !Array.isArray(queue.entries)) {
		throw new DeliveryQueueError('A delivery queue is required.');
	}
}
