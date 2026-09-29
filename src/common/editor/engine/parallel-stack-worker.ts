/* SPDX-License-Identifier: AGPL-3.0-only */

import { createParallelStackExecutor } from './parallel-stack-dsp.ts';
import type { ParallelStackPlan } from './parallel-stack-types.ts';
import { createParallelStackScheduler } from './parallel-stack-scheduler.ts';
import type { SharedParallelStackEffectMailbox } from './parallel-stack-effect-mailbox.ts';
import {
	createParallelStackViews, faultParallelStackViews, ParallelStackFault,
	type SharedParallelStackBuffers, type ParallelStackViews,
} from './parallel-stack-protocol.ts';

interface PrepareMessage {
	readonly type: 'prepare';
	readonly shared: SharedParallelStackBuffers;
	readonly plan: ParallelStackPlan;
	readonly workerIndex: number;
	readonly parametricEqWasmModule?: WebAssembly.Module;
	readonly effectMailbox?: SharedParallelStackEffectMailbox;
}

let scheduler: ReturnType<typeof createParallelStackScheduler> | null = null;
let views: ParallelStackViews | null = null;
let workerIndex = -1;
let started = false;

globalThis.addEventListener('message', (event: MessageEvent<unknown>) => {
	try {
		if (!event.data || typeof event.data !== 'object') throw new TypeError('Invalid parallel worker message.');
		const envelope = event.data as { type?: string };
		if (envelope.type === 'prepare') {
			if (scheduler) throw new Error('A parallel worker can prepare only one generation.');
			const request = event.data as PrepareMessage;
			views = createParallelStackViews(request.shared);
			workerIndex = request.workerIndex;
			if (request.plan.planeCount !== views.geometry.planeCount || request.plan.workerCount !== views.geometry.workerCount
				|| request.plan.tasks.length !== views.geometry.taskCount) throw new RangeError('Parallel worker plan geometry mismatch.');
			const execute = createParallelStackExecutor(request.plan, workerIndex, {
				parametricEqWasmModule: request.parametricEqWasmModule,
			}, request.effectMailbox);
			scheduler = createParallelStackScheduler(request.shared, request.plan.tasks, workerIndex, execute);
			globalThis.postMessage({ type: 'ready', generation: views.geometry.generation, workerIndex });
		} else if (envelope.type === 'start') {
			if (!scheduler || !views || started) throw new Error('The parallel worker is not ready to start.');
			started = true;
			const generation = views.geometry.generation;
			scheduler.loop(() => globalThis.postMessage({ type: 'started', generation, workerIndex }));
			globalThis.postMessage({ type: 'stopped', generation, workerIndex });
		} else throw new TypeError('Unknown parallel worker message.');
	} catch (error) {
		if (views) faultParallelStackViews(views, ParallelStackFault.Worker);
		globalThis.postMessage({ type: 'error', workerIndex, message: error instanceof Error ? error.message.slice(0, 1024) : 'Parallel worker failed.' });
	}
});
