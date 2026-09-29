/* SPDX-License-Identifier: AGPL-3.0-only */
import { createParallelStackEffect } from './parallel-stack-effects.ts';
import { readParallelStackEffectUpdate, validateParallelStackEffectMailbox,
	type SharedParallelStackEffectMailbox } from './parallel-stack-effect-mailbox.ts';
import { ParallelStackDelay, parallelStripControls } from './parallel-stack-routing.ts';
import { validateParallelStackPlan } from './parallel-stack-plan-validation.ts';
import type { ParallelStackPlan, ParallelStackTask, ParallelStackRuntimeModules } from './parallel-stack-types.ts';

export type ParallelStackExecutor = (taskIndex: number, planes: readonly Float32Array[], sequence: number) => void;
const channels = (width: number, frames: number): Float32Array[] => Array.from({ length: width }, () => new Float32Array(frames));

/** Construct once on the assigned worker; all buffers and DSP histories stay there. */
export function createParallelStackExecutor(plan: ParallelStackPlan, workerIndex: number, modules: ParallelStackRuntimeModules = {},
	effectMailbox?: SharedParallelStackEffectMailbox): ParallelStackExecutor {
	validateParallelStackPlan(plan);
	if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= plan.workerCount) throw new Error('Invalid parallel worker assignment.');
	if (effectMailbox) validateParallelStackEffectMailbox(effectMailbox,
		plan.tasks.reduce((count, task) => count + task.effects.length, 0));
	let effectOffset = 0;
	const runtimes = plan.tasks.map((task) => {
		const offset = effectOffset;
		effectOffset += task.effects.length;
		return task.worker === workerIndex ? prepareTask(task, plan, modules, effectMailbox, offset) : null;
	});
	return (taskIndex, planes, sequence) => {
		const runtime = runtimes[taskIndex];
		if (!runtime) throw new Error('A parallel task ran on the wrong worker.');
		runtime(planes, sequence);
	};
}

function prepareTask(task: ParallelStackTask, plan: ParallelStackPlan, modules: ParallelStackRuntimeModules,
	effectMailbox: SharedParallelStackEffectMailbox | undefined, effectOffset: number): (planes: readonly Float32Array[], sequence: number) => void {
	const frames = plan.blockFrames;
	const input = channels(task.channels, frames);
	const scratch = channels(task.channels, frames);
	const inputDelay = new ParallelStackDelay(task.inputDelayFrames, task.channels);
	const outputDelay = new ParallelStackDelay(task.outputDelayFrames, task.channels);
	const pre = channels(task.prePlanes.length, 0);
	const post = channels(task.postPlanes.length, 0);
	const sidechains = new Map<string, Float32Array[]>();
	for (const edge of task.edges) if (edge.sidechainEffectId && !sidechains.has(edge.sidechainEffectId)) {
		sidechains.set(edge.sidechainEffectId, channels(task.channels, frames));
	}
	const edges = task.edges.map((edge) => ({ edge, scratch: channels(task.channels, frames),
		delay: new ParallelStackDelay(edge.delayFrames, task.channels),
		target: edge.sidechainEffectId ? sidechains.get(edge.sidechainEffectId)! : input }));
	const effects = task.effects.map((effect, index) => ({
		processor: createParallelStackEffect(effect, plan.sampleRate, task.channels, modules),
		sidechain: sidechains.get(effect.id),
		mailboxIndex: effectOffset + index,
		lastVersion: 0,
	}));
	// Warm the actual pinned instances on this worker, before its ready acknowledgement.
	// Every admitted kernel restores its exact cold state, including random generators.
	for (const effect of effects) {
		for (let block = 0; block < 4; block++) effect.processor.processBlock(input, scratch, frames, effect.sidechain);
		effect.processor.reset();
	}
	for (const channel of scratch) channel.fill(0);
	let nextSequence = 0;
	return (planes, sequence) => {
		if (!Number.isSafeInteger(sequence) || sequence !== nextSequence) throw new Error('Parallel DSP blocks must advance consecutively.');
		if (effectMailbox) for (const effect of effects) {
			const update = readParallelStackEffectUpdate(effectMailbox, effect.mailboxIndex, effect.lastVersion);
			if (!update) continue;
			if (!effect.processor.updateParams) throw new Error('Parallel effect does not accept live parameters.');
			effect.processor.updateParams(update.params, { transitionFrames: update.transitionFrames });
			effect.lastVersion = update.version;
		}
		for (let c = 0; c < input.length; c++) {
			if (task.inputPlanes.length) input[c]!.set(planes[task.inputPlanes[c]!]!);
			else input[c]!.fill(0);
		}
		inputDelay.process(input, frames);
		for (const detector of sidechains.values()) for (const channel of detector) channel.fill(0);
		for (const route of edges) {
			const { edge } = route;
			for (let destination = 0; destination < task.channels; destination++) {
				const channel = route.scratch[destination]!;
				channel.fill(0);
				for (let source = 0; source < edge.sourcePlanes.length; source++) {
					const coefficient = edge.matrix[destination]![source]!;
					if (coefficient === 0) continue;
					const samples = planes[edge.sourcePlanes[source]!]!;
					for (let frame = 0; frame < frames; frame++) channel[frame] = channel[frame]! + samples[frame]! * coefficient;
				}
			}
			route.delay.process(route.scratch, frames);
			for (let c = 0; c < task.channels; c++) for (let f = 0; f < frames; f++) {
				route.target[c]![f] = route.target[c]![f]! + Math.fround(route.scratch[c]![f]! * edge.level);
			}
		}
		let current = input;
		let destination = scratch;
		for (const effect of effects) {
			effect.processor.processBlock(current, destination, frames, effect.sidechain);
			const previous = current; current = destination; destination = previous;
		}
		for (let c = 0; c < post.length; c++) post[c] = planes[task.postPlanes[c]!]!;
		if (task.kind === 'output') {
			outputDelay.process(current, frames);
			for (let c = 0; c < post.length; c++) post[c]!.set(current[c]!);
		} else {
			for (let c = 0; c < pre.length; c++) {
				pre[c] = planes[task.prePlanes[c]!]!;
				pre[c]!.set(current[c]!);
			}
			parallelStripControls(current, post, frames, task.gain, task.pan, task.gate, task.vca);
		}
		nextSequence++;
	};
}
