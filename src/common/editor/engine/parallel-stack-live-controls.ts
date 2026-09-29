/* SPDX-License-Identifier: AGPL-3.0-only */

import { isStandardEffect } from '../first-party-effects/standard/definition.ts';
import { effectGraphKey } from './effect-rack-node-registry.ts';
import { registerEffectMessageHandler } from './effect-message-dispatch.ts';
import { compileParallelStackEffect } from './parallel-stack-effects.ts';
import { publishParallelStackEffectUpdate, type SharedParallelStackEffectMailbox } from './parallel-stack-effect-mailbox.ts';
import { PARALLEL_STACK_MEMORY_LIMIT } from './parallel-stack-plan-validation.ts';
import type { ParallelStackPlan, ParallelStackTap } from './parallel-stack-types.ts';
import type { ProjectGraph } from './project-graph.ts';
import type { UnknownRecord } from './types.ts';

const LIVE_TYPES = new Set(['bitcrusher', 'deesser', 'multiband-compressor', 'parametric-eq']);

/** Route revisioned rack gestures into the effect's owning worker without waking its message loop. */
export function registerParallelStackLiveControls(
	graph: ProjectGraph,
	plan: ParallelStackPlan,
	mailbox: SharedParallelStackEffectMailbox,
): void {
	const taps = new Map(plan.stripTaps.map((tap) => [tap.key, tap]));
	const budget = { used: plan.memoryBytes };
	let effectIndex = 0;
	for (const task of plan.tasks) {
		const tap = taps.get(task.key);
		for (const effect of task.effects) {
			const index = effectIndex++;
			if (!tap || tap.scope === 'cue' || (!LIVE_TYPES.has(effect.type) && !isStandardEffect(effect.type))) continue;
			const key = effectKey(tap, effect.id);
			let retainedStateBytes = effect.stateBytes;
			registerEffectMessageHandler(graph, key, {
				channelCount: task.channels,
				post(message: UnknownRecord): boolean {
					if (graph.abortController.signal.aborted || message.type !== 'configure'
						|| !message.params || typeof message.params !== 'object' || Array.isArray(message.params)) return false;
					try {
						const candidate = compileParallelStackEffect({ id: effect.id, type: effect.type,
							params: message.params as UnknownRecord }, plan.sampleRate, task.channels);
						if (candidate.latencyFrames !== effect.latencyFrames) return false;
						const growth = Math.max(0, candidate.stateBytes - retainedStateBytes);
						// A growing delay allocates its replacement ring before releasing the
						// old one. Account for that transient peak, not just retained growth.
						const transient = effect.type === 'multi-tap-delay' && growth > 0 ? candidate.stateBytes : growth;
						if (budget.used + transient > PARALLEL_STACK_MEMORY_LIMIT) return false;
						const transitionFrames = message.transitionFrames;
						if (transitionFrames !== undefined && (!Number.isSafeInteger(transitionFrames)
							|| (transitionFrames as number) < 0)) return false;
						if (!publishParallelStackEffectUpdate(mailbox, index, {
							params: candidate.params,
							...(transitionFrames === undefined ? {} : { transitionFrames: transitionFrames as number }),
						})) return false;
						budget.used += growth;
						retainedStateBytes = Math.max(retainedStateBytes, candidate.stateBytes);
						return true;
					} catch { return false; }
				},
			});
		}
	}
	if (effectIndex !== mailbox.effectCount) throw new Error('Parallel effect mailbox does not match the graph.');
}

function effectKey(tap: ParallelStackTap, effectId: string): string {
	return effectGraphKey(tap.scope, tap.ref.kind === 'master' ? null : tap.ref.id, effectId);
}
