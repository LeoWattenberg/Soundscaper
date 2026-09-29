/* SPDX-License-Identifier: AGPL-3.0-only */

import { parentPort, workerData } from 'node:worker_threads';
import { createParallelStackScheduler } from '../../src/common/editor/engine/parallel-stack-scheduler.ts';
import type { ParallelStackTaskSchedule, SharedParallelStackBuffers } from '../../src/common/editor/engine/parallel-stack-protocol.ts';

export interface SchedulerWorkerData {
	shared: SharedParallelStackBuffers;
	tasks: ParallelStackTaskSchedule[];
	workerIndex: number;
	barrier: SharedArrayBuffer;
}
const { shared, tasks, workerIndex, barrier: barrierBuffer } = workerData as SchedulerWorkerData;
const barrier = new Int32Array(barrierBuffer);
const scheduler = createParallelStackScheduler(shared, tasks, workerIndex, (task, planes, sequence) => {
	if (task < 2) {
		// A producer must observe the other worker inside its callback before proceeding.
		// This would time out if the supposed worker pool executed serially.
		if (sequence === 0) {
			Atomics.add(barrier, 0, 1);
			Atomics.notify(barrier, 0);
			while (Atomics.load(barrier, 0) < 2) {
				if (Atomics.wait(barrier, 0, 1, 2_000) === 'timed-out') throw new Error('No concurrent producer.');
			}
		}
		for (let frame = 0; frame < 256; frame += 1) planes[task + 1][frame] = planes[0][frame] * (task + 2);
	} else {
		for (let frame = 0; frame < 256; frame += 1) planes[3][frame] = planes[1][frame] + planes[2][frame];
	}
});
parentPort?.postMessage('ready');
scheduler.loop();
parentPort?.postMessage('stopped');
