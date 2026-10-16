/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EffectTarget } from '../../effect-selection-service.ts';
import type { SelectionEffectResult } from '../effect-result-service.ts';

type Channels = readonly Float32Array[];
interface MacroEffect extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly enabled?: boolean;
}
interface TargetPlan {
	readonly target: EffectTarget;
	readonly effects: readonly MacroEffect[];
}

/** Linked silence detection is a barrier shared by aligned dialogue tracks. */
export async function runMacroTargetPlans<Plan extends TargetPlan>(
	plans: readonly Plan[],
	runtime: Readonly<{
		runEffects: (plan: Plan, effects: readonly MacroEffect[], initial?: Channels) => Promise<Channels>;
		runLinked: (effect: MacroEffect, channels: Channels) => Promise<Channels>;
		invalidChannels: () => Error;
	}>,
): Promise<SelectionEffectResult[]> {
	const barriers = plans[0]?.effects.flatMap((effect, index) =>
		effect.type === 'audacity-truncate-silence' && effect.params.independent === false ? [index] : []) ?? [];
	if (plans.length < 2 || !barriers.length) {
		const results: SelectionEffectResult[] = [];
		for (const plan of plans) results.push({ target: plan.target, channels: await runtime.runEffects(plan, plan.effects) });
		return results;
	}
	const channels: Array<Channels | undefined> = plans.map(() => undefined);
	let start = 0;
	for (const barrier of barriers) {
		const groups = new Map<string, number[]>();
		for (const [index, plan] of plans.entries()) {
			const current = await runtime.runEffects(plan, plan.effects.slice(start, barrier), channels[index]);
			channels[index] = current;
			const key = JSON.stringify([plan.target.startFrame, plan.target.endFrame,
				plan.target.sourceSampleRate ?? null, current[0]?.length]);
			const group = groups.get(key) ?? [];
			group.push(index);
			groups.set(key, group);
		}
		for (const group of groups.values()) {
			const first = group[0]!;
			const effect = plans[first]!.effects[barrier]!;
			if (group.length === 1) {
				channels[first] = await runtime.runEffects(plans[first]!, [effect], channels[first]);
				continue;
			}
			const linked = group.flatMap(index => [...channels[index]!]);
			const processed = await runtime.runLinked(effect, linked);
			if (processed.length !== linked.length) throw runtime.invalidChannels();
			let offset = 0;
			for (const index of group) {
				const width = channels[index]!.length;
				channels[index] = processed.slice(offset, offset + width);
				offset += width;
			}
		}
		start = barrier + 1;
	}
	const results: SelectionEffectResult[] = [];
	for (const [index, plan] of plans.entries()) {
		results.push({ target: plan.target,
			channels: await runtime.runEffects(plan, plan.effects.slice(start), channels[index]) });
	}
	return results;
}
