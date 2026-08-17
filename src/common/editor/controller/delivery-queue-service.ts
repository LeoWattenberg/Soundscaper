/* SPDX-License-Identifier: AGPL-3.0-only */

import { type DeliveryQueue } from '../delivery-queue.ts';
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
 * settings — let alone media — through it.
 */

export interface DeliveryQueueServiceRuntime {
	readonly handleExportAction: (action: string, settings?: unknown) => Promise<unknown> | unknown;
	readonly publishDocumentSnapshot?: () => void;
	readonly createId?: (prefix: string) => string;
	readonly state?: { deliveryQueue?: DeliveryQueue };
}

export function createDeliveryQueueService(runtime: DeliveryQueueServiceRuntime) {
	if (typeof runtime?.handleExportAction !== 'function') {
		throw new TypeError('A delivery queue service requires the export action.');
	}
	const settingsByJob = new Map<string, unknown>();

	const runner = createDeliveryQueueRunner({
		runJob: async (entry) => {
			const settings = settingsByJob.get(entry.jobId);
			await runtime.handleExportAction('start', settings ?? {});
		},
		onChange: (queue) => {
			if (runtime.state) runtime.state.deliveryQueue = queue;
			runtime.publishDocumentSnapshot?.();
		},
	});

	function nextJobId(): string {
		return runtime.createId?.('delivery-job') ?? `delivery-job-${settingsByJob.size + 1}`;
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
			settingsByJob.set(jobId, request?.settings ?? {});
			runner.enqueue({
				jobId,
				label: request?.label || jobId,
				taskKind: 'encoded-export',
				recoveryClass: 'atomic-restart',
			});
			return jobId;
		},
		pause: () => runner.pause(),
		resume: () => runner.resume(),
		cancel: (jobId: string) => {
			runner.cancel(jobId);
			runtime.handleExportAction('cancel');
		},
		retry: (jobId: string) => runner.retry(jobId),
		reorder: (jobId: string, position: number) => runner.reorder(jobId, position),
		recover: () => runner.recover(),
		settled: () => runner.settled(),
	});
}
