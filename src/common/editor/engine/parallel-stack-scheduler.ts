/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createParallelStackViews, faultParallelStackViews, wakeParallelStackWorkers,
	ParallelStackBankState, ParallelStackStatus, ParallelStackFault,
	type SharedParallelStackBuffers, type ParallelStackTaskSchedule,
} from './parallel-stack-protocol.ts';

export type ParallelStackExecute = (task: number, planes: readonly Float32Array[], sequence: number) => void;

/** Stateful tasks have permanent ownership and a private monotonic next sequence. */
export function createParallelStackScheduler(
	shared: SharedParallelStackBuffers,
	tasks: readonly ParallelStackTaskSchedule[],
	workerIndex: number,
	execute: ParallelStackExecute,
) {
	const views = createParallelStackViews(shared);
	if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= views.geometry.workerCount
		|| tasks.length !== views.geometry.taskCount) throw new RangeError('Invalid parallel stack scheduler assignment.');
	const assigned: number[] = [];
	const next = new Float64Array(tasks.length);
	for (let task = 0; task < tasks.length; task += 1) {
		const schedule = tasks[task];
		if (!Number.isInteger(schedule.worker) || schedule.worker < 0 || schedule.worker >= views.geometry.workerCount
			|| schedule.dependencies.length > tasks.length
			|| schedule.dependencies.some((dependency) => !Number.isInteger(dependency) || dependency < 0 || dependency >= task)) {
			throw new RangeError('Parallel stack tasks must form a bounded topological schedule.');
		}
		if (schedule.worker === workerIndex) assigned.push(task);
	}
	function runReady(): number {
		let completed = 0;
		while (views.status() === ParallelStackStatus.Running) {
			let selected = -1;
			let earliest = Number.POSITIVE_INFINITY;
			for (let index = 0; index < assigned.length; index += 1) {
				const task = assigned[index];
				const sequence = next[task];
				if (sequence >= earliest) continue;
				const bank = views.banks[sequence % views.geometry.bankCount];
				if (bank.state() !== ParallelStackBankState.Ready || bank.sequence() !== sequence) continue;
				let ready = true;
				const dependencies = tasks[task].dependencies;
				for (let dependency = 0; dependency < dependencies.length; dependency += 1) {
					if (Atomics.load(views.control, views.taskIndex(bank, dependencies[dependency])) !== 2) { ready = false; break; }
				}
				if (ready) { selected = task; earliest = sequence; }
			}
			if (selected < 0) break;
			if (views.status() !== ParallelStackStatus.Running) break;
			const bank = views.banks[earliest % views.geometry.bankCount];
			const completion = views.taskIndex(bank, selected);
			if (Atomics.compareExchange(views.control, completion, 0, 1) !== 0) {
				faultParallelStackViews(views, ParallelStackFault.Worker);
				break;
			}
			try { execute(selected, bank.planes, earliest); }
			catch { faultParallelStackViews(views, ParallelStackFault.Worker); break; }
			Atomics.store(views.control, completion, 2);
			next[selected] = earliest + 1;
			if (Atomics.sub(views.control, bank.offset + 3, 1) === 1) Atomics.store(views.control, bank.offset, ParallelStackBankState.Complete);
			completed += 1;
			wakeParallelStackWorkers(views);
		}
		return completed;
	}
	return {
		runReady,
		/** Call only on a dedicated Worker: control is entirely shared after entry. */
		loop(onStarted?: () => void): void {
			const wakeIndex = views.workerWakeIndex(workerIndex);
			Atomics.store(views.control, views.workerStateIndex(workerIndex), 1);
			onStarted?.();
			for (;;) {
				const observedWake = Atomics.load(views.control, wakeIndex);
				if (views.status() >= ParallelStackStatus.Stopped) break;
				if (runReady() === 0) Atomics.wait(views.control, wakeIndex, observedWake);
			}
			Atomics.store(views.control, views.workerStateIndex(workerIndex), 2);
		},
	};
}
