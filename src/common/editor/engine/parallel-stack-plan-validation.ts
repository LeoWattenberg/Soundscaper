/* SPDX-License-Identifier: AGPL-3.0-only */
import { compileParallelStackEffect } from './parallel-stack-effects.ts';
import type { ParallelStackPlan, ParallelStackTask } from './parallel-stack-types.ts';

export const PARALLEL_STACK_MEMORY_LIMIT = 128 * 1024 ** 2;
function bounded(value: number, minimum: number, maximum: number): boolean {
	return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

/** Includes private DSP/PDC and all immutable-plan copies in UI and workers. */
export function parallelStackMemoryBytes(tasks: readonly ParallelStackTask[], planeCount: number,
	blockFrames: number, bankCount: number, workerCount: number): number {
	let state = 0;
	let descriptors = 65536;
	for (const task of tasks) {
		state += task.channels * (blockFrames * 3 + task.inputDelayFrames + task.outputDelayFrames) * 4;
		state += task.effects.reduce((sum, effect) => sum + effect.stateBytes, 0);
		descriptors += 4096 + task.effects.length * 32768;
		for (const edge of task.edges) {
			state += task.channels * (blockFrames + edge.delayFrames) * 4;
			descriptors += 2048 + edge.matrix.length * edge.sourcePlanes.length * 8;
		}
		state += new Set(task.edges.map(({ sidechainEffectId }) => sidechainEffectId).filter(Boolean)).size * task.channels * blockFrames * 4;
	}
	return planeCount * blockFrames * bankCount * 4 + state + tasks.length * bankCount * 64 + descriptors * (workerCount + 1);
}

/** Worker-side validation happens before any variable-sized DSP allocation. */
export function validateParallelStackPlan(plan: ParallelStackPlan): void {
	if (plan.version !== 1 || plan.blockFrames !== 256 || plan.bankCount !== 8
		|| !bounded(plan.sampleRate, 8000, 384000) || !bounded(plan.workerCount, 1, 8)
		|| !bounded(plan.planeCount, 1, 4096) || !bounded(plan.tasks.length, 1, 256)) throw new Error('Invalid parallel graph geometry.');
	const owned = new Set<number>();
	let edgeCount = 0;
	let effectCount = 0;
	const checkPlanes = (planes: readonly number[], claim: boolean): void => {
		if (planes.length > 32) throw new Error('Invalid parallel plane width.');
		for (const index of planes) {
			if (!bounded(index, 0, plan.planeCount - 1) || (claim && owned.has(index))) throw new Error('Invalid parallel plane ownership.');
			if (claim) owned.add(index);
		}
	};
	for (let index = 0; index < plan.tasks.length; index++) {
		const task = plan.tasks[index]!;
		if (!['stack', 'output'].includes(task.kind) || !bounded(task.channels, 1, 32)
			|| !bounded(task.worker, 0, plan.workerCount - 1)
			|| !bounded(task.inputDelayFrames, 0, plan.sampleRate * 60)
			|| !bounded(task.outputDelayFrames, 0, plan.sampleRate * 60)
			|| ![task.gain, task.pan, task.gate, task.vca].every(Number.isFinite)
			|| task.pan < -1 || task.pan > 1) throw new Error('Invalid parallel task geometry.');
		if (task.inputPlanes.length !== 0 && task.inputPlanes.length !== task.channels) throw new Error('Invalid parallel ingress width.');
		if (task.prePlanes.length !== (task.kind === 'stack' ? task.channels : 0)
			|| task.postPlanes.length !== (task.kind === 'stack' ? Math.max(2, task.channels) : task.channels)) throw new Error('Invalid parallel tap width.');
		checkPlanes(task.inputPlanes, true); checkPlanes(task.prePlanes, true); checkPlanes(task.postPlanes, true);
		if (task.dependencies.length > 256 || task.dependencies.some((dependency) => !bounded(dependency, 0, index - 1))) throw new Error('Invalid parallel dependency order.');
		edgeCount += task.edges.length; effectCount += task.effects.length;
		if (edgeCount > 4096 || effectCount > 4096 || task.effects.length > 256) throw new Error('Parallel graph exceeds descriptor bounds.');
		for (const effect of task.effects) {
			const checked = compileParallelStackEffect(effect, plan.sampleRate, task.channels);
			if (checked.stateBytes !== effect.stateBytes || checked.latencyFrames !== effect.latencyFrames) throw new Error('Invalid parallel effect memory estimate.');
		}
		for (const edge of task.edges) {
			if (!task.dependencies.includes(edge.sourceTask) || !Number.isFinite(edge.level)
				|| !bounded(edge.delayFrames, 0, plan.sampleRate * 60)) throw new Error('Invalid parallel edge dependency.');
			checkPlanes(edge.sourcePlanes, false);
			const source = plan.tasks[edge.sourceTask]!;
			if (![source.prePlanes, source.postPlanes].some((planes) => planes.length === edge.sourcePlanes.length
				&& planes.every((plane, channel) => plane === edge.sourcePlanes[channel]))) throw new Error('Invalid parallel edge source.');
			if (edge.matrix.length !== task.channels || edge.matrix.some((row) => row.length !== edge.sourcePlanes.length
				|| row.some((coefficient) => !Number.isFinite(coefficient)))) throw new Error('Invalid parallel channel matrix.');
		}
	}
	if (owned.size !== plan.planeCount) throw new Error('Parallel plan has unowned PCM planes.');
	const bytes = parallelStackMemoryBytes(plan.tasks, plan.planeCount, plan.blockFrames, plan.bankCount, plan.workerCount);
	if (!bounded(bytes, 1, PARALLEL_STACK_MEMORY_LIMIT) || bytes !== plan.memoryBytes) throw new Error('Invalid parallel total memory estimate.');
}
