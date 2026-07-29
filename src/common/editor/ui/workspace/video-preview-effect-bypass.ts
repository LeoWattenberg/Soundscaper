/* SPDX-License-Identifier: AGPL-3.0-only */

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../../project-feature-capabilities.ts';
import type { ProjectFeatureVideoEffectBypassMetadata } from '../../project-feature-video-effect-bypass.ts';

interface PreviewVideoEffect extends Readonly<Record<string, unknown>> {
	readonly id?: unknown;
	readonly type?: unknown;
	readonly enabled?: unknown;
}

export interface VideoPreviewEffectBypass {
	effectsFor(
		clipId: string,
		effects: readonly PreviewVideoEffect[],
	): readonly PreviewVideoEffect[];
	activeEffectCount(clipId: string, effects: readonly PreviewVideoEffect[]): number;
}

type AffectedEffectsByClip = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** Build one per-snapshot cached selector for the compositor's effect stacks. */
export function createVideoPreviewEffectBypass(
	metadata: ProjectFeatureVideoEffectBypassMetadata | null | undefined,
): VideoPreviewEffectBypass {
	const affectedByClip = timelineAffectedEffects(metadata);
	const cache = new WeakMap<readonly PreviewVideoEffect[], Map<string, readonly PreviewVideoEffect[]>>();

	function effectsFor(
		clipId: string,
		effects: readonly PreviewVideoEffect[],
	): readonly PreviewVideoEffect[] {
		const affected = affectedByClip.get(clipId);
		if (!affected || affected.size === 0 || effects.length === 0) return effects;
		let clipCache = cache.get(effects);
		const cached = clipCache?.get(clipId);
		if (cached) return cached;
		let changed = false;
		const projected = effects.filter((effect) => {
			const effectId = dataString(effect, 'id');
			const effectType = dataString(effect, 'type');
			const bypassed = effectId !== null && effectType !== null
				&& affected.get(effectId) === effectType;
			changed ||= bypassed;
			return !bypassed;
		});
		const result = changed ? Object.freeze(projected) : effects;
		clipCache ??= new Map();
		clipCache.set(clipId, result);
		cache.set(effects, clipCache);
		return result;
	}

	return Object.freeze({
		effectsFor,
		activeEffectCount(clipId: string, effects: readonly PreviewVideoEffect[]): number {
			let count = 0;
			for (const effect of effectsFor(clipId, effects)) {
				if (dataValue(effect, 'enabled') !== false) count += 1;
			}
			return count;
		},
	});
}

function timelineAffectedEffects(
	metadata: ProjectFeatureVideoEffectBypassMetadata | null | undefined,
): AffectedEffectsByClip {
	if (
		metadata?.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.videoEffects
		|| !Array.isArray(metadata.placeholders)
	) return new Map();
	const output = new Map<string, Map<string, string>>();
	for (const placeholder of metadata.placeholders) {
		if (
			placeholder.location !== 'timeline'
			|| typeof placeholder.clipId !== 'string'
			|| typeof placeholder.effectId !== 'string'
			|| typeof placeholder.effectType !== 'string'
		) continue;
		let effects = output.get(placeholder.clipId);
		if (!effects) {
			effects = new Map();
			output.set(placeholder.clipId, effects);
		}
		effects.set(placeholder.effectId, placeholder.effectType);
	}
	return output;
}

function dataString(value: PreviewVideoEffect, key: string): string | null {
	const candidate = dataValue(value, key);
	return typeof candidate === 'string' && candidate ? candidate : null;
}

function dataValue(value: PreviewVideoEffect, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}
