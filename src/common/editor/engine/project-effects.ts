/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	EngineEffect,
	EngineEffectRackLocation,
	EngineProject,
	UnknownRecord,
} from './types.ts';

const PARAMETRIC_EQ_TYPES: ReadonlySet<string> = new Set(['eq', 'parametric-eq', 'parametric_eq']);

export function isParametricEqType(type: unknown): boolean {
	return PARAMETRIC_EQ_TYPES.has(String(type || '').toLowerCase());
}

export function activeRackEffects(owner: Readonly<{
	effectsActive?: boolean;
	effects?: readonly EngineEffect[];
}> | null | undefined): readonly EngineEffect[] {
	if (!owner || owner.effectsActive === false || !Array.isArray(owner.effects)) return [];
	return owner.effects;
}

/** Iterate every rack location that the project graph can process. */
export function* projectEffectRacks(
	project: EngineProject | null | undefined,
): Generator<EngineEffectRackLocation> {
	for (const [index, track] of (project?.tracks || []).entries()) {
		if (track?.type === 'label' || track?.type === 'video') continue;
		yield {
			scope: 'track',
			targetId: String(track?.id ?? index),
			effectsActive: track?.effectsActive !== false,
			effects: activeRackEffects(track),
		};
	}
	for (const [scope, buses] of [
		['group', project?.mixer?.groups],
		['send', project?.mixer?.sends],
	] as const) {
		for (const bus of Array.isArray(buses) ? buses : []) {
			yield {
				scope,
				targetId: String(bus.id),
				effectsActive: bus?.effectsActive !== false,
				effects: activeRackEffects(bus),
			};
		}
	}
	yield {
		scope: 'master',
		targetId: null,
		effectsActive: project?.master?.effectsActive !== false,
		effects: activeRackEffects(project?.master),
	};
}

export function projectWithParametricEqParams(
	project: EngineProject | null | undefined,
	scope: unknown,
	targetId: unknown,
	effectId: unknown,
	params: unknown,
): EngineProject | null {
	return projectWithEffectParams(
		project,
		scope,
		targetId,
		effectId,
		params,
		(effect) => isParametricEqType(effect?.type),
	);
}

export function projectWithEffectParams(
	project: EngineProject | null | undefined,
	scope: unknown,
	targetId: unknown,
	effectId: unknown,
	params: unknown,
	predicate: (effect: EngineEffect) => boolean = () => true,
): EngineProject | null {
	if (!project) return null;
	const normalizedScope = String(scope || '');
	const replaceEffects = (effects: readonly EngineEffect[] | undefined): EngineEffect[] | null => {
		if (!Array.isArray(effects)) return null;
		const index = effects.findIndex((effect) => effect?.id === effectId && predicate(effect));
		if (index < 0) return null;
		const output = effects.slice();
		output[index] = {
			...effects[index],
			params: cloneMessageValue(params) as UnknownRecord,
		};
		return output;
	};
	if (normalizedScope === 'master') {
		const effects = replaceEffects(project.master?.effects);
		return effects ? { ...project, master: { ...project.master, effects } } : null;
	}
	if (normalizedScope === 'track') {
		const index = (project.tracks || []).findIndex((track) => String(track?.id) === String(targetId));
		if (index < 0) return null;
		const effects = replaceEffects(project.tracks?.[index]?.effects);
		if (!effects || !project.tracks) return null;
		const tracks = project.tracks.slice();
		tracks[index] = { ...tracks[index], effects };
		return { ...project, tracks };
	}
	if (normalizedScope === 'group' || normalizedScope === 'send') {
		const key = normalizedScope === 'group' ? 'groups' : 'sends';
		const buses = project.mixer?.[key] || [];
		const index = buses.findIndex((bus) => String(bus?.id) === String(targetId));
		if (index < 0) return null;
		const effects = replaceEffects(buses[index]?.effects);
		if (!effects) return null;
		const nextBuses = buses.slice();
		nextBuses[index] = { ...nextBuses[index], effects };
		return { ...project, mixer: { ...project.mixer, [key]: nextBuses } };
	}
	return null;
}

export function projectRackEffect(
	project: EngineProject | null | undefined,
	scope: unknown,
	targetId: unknown,
	effectId: unknown,
): EngineEffect | null {
	const normalizedScope = String(scope || '');
	const normalizedTargetId = normalizedScope === 'master' ? null : String(targetId);
	for (const rack of projectEffectRacks(project)) {
		if (rack.scope !== normalizedScope) continue;
		if (rack.scope !== 'master' && rack.targetId !== normalizedTargetId) continue;
		return rack.effects.find((effect) => effect?.id === effectId) || null;
	}
	return null;
}

export function cloneMessageValue<Value>(value: Value): Value {
	return typeof globalThis.structuredClone === 'function'
		? globalThis.structuredClone(value)
		: JSON.parse(JSON.stringify(value)) as Value;
}
