/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectEffectRacks } from './engine/project-effects.ts';
import type {
	EngineEffect,
	EngineProject,
} from './engine/types.ts';
import { resolveTerminalChannelWidths } from './terminal-channel-widths.ts';

export interface UnsafeAdmRenderEffect {
	readonly scope: 'track' | 'group' | 'send' | 'master';
	readonly targetId: string | null;
	readonly effectId: string | null;
	readonly effectType: string;
	readonly channelCount: number;
}

export interface RenderEffectChannelSafetyOptions {
	readonly includeMaster?: boolean;
}

/** Find active browser effects that cannot preserve a signal wider than stereo. */
export function findStereoLimitedMultichannelRenderEffects(
	project: EngineProject | null | undefined,
	masterChannelCount: number,
	options: RenderEffectChannelSafetyOptions = {},
): readonly UnsafeAdmRenderEffect[] {
	return findUnsafeRenderEffects(project, masterChannelCount, options, (effect, _scope, channelCount) => (
		channelCount > 2 && STEREO_LIMITED_EFFECT_TYPES.has(normalizedEffectType(effect))
	));
}

const STEREO_LIMITED_EFFECT_TYPES: ReadonlySet<string> = new Set([
	'compressor',
	'convolver',
	'reverb',
]);

const STEREO_EXPANDING_EFFECT_TYPES: ReadonlySet<string> = new Set([
	'convolver',
	'reverb',
]);

/** Find effect nodes that would change a declared ADM terminal's channel width. */
export function findUnsafeAdmRenderEffects(
	project: EngineProject | null | undefined,
	authoredChannelCount: number,
): readonly UnsafeAdmRenderEffect[] {
	return findUnsafeRenderEffects(project, authoredChannelCount, {}, isUnsafeWidthTransform);
}

function findUnsafeRenderEffects(
	project: EngineProject | null | undefined,
	masterChannelCount: number,
	options: RenderEffectChannelSafetyOptions,
	predicate: (
		effect: EngineEffect,
		scope: UnsafeAdmRenderEffect['scope'],
		channelCount: number,
	) => boolean,
): readonly UnsafeAdmRenderEffect[] {
	const widths = resolveTerminalChannelWidths(project);
	const issues: UnsafeAdmRenderEffect[] = [];
	for (const rack of projectEffectRacks(project)) {
		if (rack.scope === 'master' && options.includeMaster === false) continue;
		const channelCount = rack.scope === 'master'
			? masterChannelCount
			: rack.scope === 'track'
				? widths.tracks.get(rack.targetId ?? '') ?? 2
				: (rack.scope === 'group' ? widths.groups : widths.sends).get(rack.targetId ?? '') ?? 2;
		for (const effect of rack.effects) {
			if (!effect || effect.enabled === false || effect.bypassed === true
				|| !predicate(effect, rack.scope, channelCount)) continue;
			issues.push(Object.freeze({
				scope: rack.scope,
				targetId: rack.targetId,
				effectId: typeof effect.id === 'string' && effect.id ? effect.id : null,
				effectType: normalizedEffectType(effect),
				channelCount,
			}));
		}
	}
	return Object.freeze(issues);
}

function isUnsafeWidthTransform(
	effect: EngineEffect,
	scope: 'track' | 'group' | 'send' | 'master',
	channelCount: number,
): boolean {
	const type = normalizedEffectType(effect);
	if (channelCount > 2) return STEREO_LIMITED_EFFECT_TYPES.has(type);
	return scope !== 'master' && channelCount === 1 && STEREO_EXPANDING_EFFECT_TYPES.has(type);
}

function normalizedEffectType(effect: EngineEffect): string {
	return String(effect.type || effect.kind || '').toLowerCase();
}
