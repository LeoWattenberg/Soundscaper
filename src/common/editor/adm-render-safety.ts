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

const STEREO_ONLY_EFFECT_TYPES: ReadonlySet<string> = new Set([
	'compressor',
	'convolver',
	'reverb',
]);

/** Find effect nodes that would collapse a declared multichannel ADM path to stereo. */
export function findUnsafeAdmRenderEffects(
	project: EngineProject | null | undefined,
	authoredChannelCount: number,
): readonly UnsafeAdmRenderEffect[] {
	if (authoredChannelCount <= 2) return Object.freeze([]);
	const widths = resolveTerminalChannelWidths(project);
	const issues: UnsafeAdmRenderEffect[] = [];
	for (const rack of projectEffectRacks(project)) {
		const channelCount = rack.scope === 'master'
			? authoredChannelCount
			: rack.scope === 'track'
				? widths.tracks.get(rack.targetId ?? '') ?? 2
				: (rack.scope === 'group' ? widths.groups : widths.sends).get(rack.targetId ?? '') ?? 2;
		if (channelCount <= 2) continue;
		for (const effect of rack.effects) {
			if (!isActiveStereoOnlyEffect(effect)) continue;
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

function isActiveStereoOnlyEffect(effect: EngineEffect | null | undefined): effect is EngineEffect {
	if (!effect || effect.enabled === false || effect.bypassed === true) return false;
	const type = normalizedEffectType(effect);
	return STEREO_ONLY_EFFECT_TYPES.has(type);
}

function normalizedEffectType(effect: EngineEffect): string {
	return String(effect.type || effect.kind || '').toLowerCase();
}
