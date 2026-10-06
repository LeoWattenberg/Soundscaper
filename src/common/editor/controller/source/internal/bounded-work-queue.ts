/* SPDX-License-Identifier: AGPL-3.0-only */

interface WorkOptions { readonly priority?: number; readonly signal?: AbortSignal; }
interface WorkItem { readonly priority: number; start(): void; cancel(): void; }

/** Share a bounded admission queue; callers retain ownership of running cancellation. */
export function createBoundedWorkQueue(concurrency: number, maximumPending: number) {
	if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !Number.isSafeInteger(maximumPending) || maximumPending < 1) {
		throw new RangeError('Invalid work queue limits.');
	}
	let active = 0;
	const pending: WorkItem[] = [];
	const pump = () => {
		while (active < concurrency && pending.length) {
			const item = pending.shift()!;
			active += 1;
			item.start();
		}
	};
	return {
		snapshot: () => ({ active, pending: pending.length }),
		run<Result>(operation: () => Promise<Result>, options: WorkOptions = {}): Promise<Result> {
			if (options.signal?.aborted) return Promise.reject(options.signal.reason);
			if (pending.length >= maximumPending) return Promise.reject(new RangeError('The work queue is full.'));
			return new Promise((resolve, reject) => {
				const cleanup = () => options.signal?.removeEventListener('abort', abort);
				const item: WorkItem = {
					priority: options.priority ?? 0,
					cancel() { cleanup(); reject(options.signal?.reason); },
					start() {
						cleanup();
						void Promise.resolve().then(() => { options.signal?.throwIfAborted(); return operation(); }).then(resolve, reject).finally(() => { active -= 1; pump(); });
					},
				};
				const abort = () => {
					const index = pending.indexOf(item);
					if (index < 0) return;
					pending.splice(index, 1); item.cancel();
				};
				options.signal?.addEventListener('abort', abort, { once: true });
				pending.push(item);
				pending.sort((left, right) => left.priority - right.priority);
				pump();
			});
		},
	};
}
