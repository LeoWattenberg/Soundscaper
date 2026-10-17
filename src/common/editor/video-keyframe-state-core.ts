/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from './closed-domain-value.ts';
import { AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS, admitAudioEditorProjectValidationStructure } from './project-validation-budget.ts';
import { normalizeVideoClipComposition, type VideoClipComposition } from './video-clip-composition.ts';
import type { RationalInput } from './timeline-time.ts';
import type { VideoKeyframeCurves, VideoKeyframeNormalizationOptions, EvaluatedVideoKeyframeValue } from './video-keyframe-curves-types.ts';

export interface KeyframeStateEffect { readonly id: string; readonly type: string; readonly enabled: boolean; readonly params: Readonly<Record<string, unknown>>; }
export interface KeyframeStateRequest { readonly videoKeyframes: unknown; readonly sequenceFrameCount: RationalInput; readonly composition: unknown; readonly videoEffects: unknown; }
export interface KeyframeState<Effect extends KeyframeStateEffect> { readonly composition: VideoClipComposition; readonly videoEffects: readonly Effect[]; }
interface StateOwners<Effect extends KeyframeStateEffect> {
 readonly normalizeEffects: (value: unknown, name: string) => readonly Effect[];
 readonly normalizeCurves: (value: unknown, options: VideoKeyframeNormalizationOptions | unknown) => VideoKeyframeCurves;
 readonly evaluateCurves: (value: unknown, position: RationalInput) => readonly EvaluatedVideoKeyframeValue[];
}
/** Internal state evaluator; each named public wrapper pins closed effect and
 * curve admission and owns an independent compiled-state identity fence. */
export function createVideoKeyframeStateOwner<Effect extends KeyframeStateEffect>(owners: StateOwners<Effect>) {
 interface Compiled { readonly keyframes: VideoKeyframeCurves; readonly composition: VideoClipComposition; readonly videoEffects: readonly Effect[]; }
	const COMPILED = new WeakSet<object>();

	/** Snapshot and compile one clip's authored static and keyframed visual state. */
	function compile(
		request: KeyframeStateRequest,
	): Readonly<Compiled> {
		const candidate = readClosedDomainRecord(request, 'video keyframe state request', [
			'videoKeyframes', 'sequenceFrameCount', 'composition', 'videoEffects',
		]);
		admitAudioEditorProjectValidationStructure(
			candidate, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS,
		);
		const composition = normalizeVideoClipComposition(
			readClosedDomainField(candidate, 'composition', 'video keyframe state request'),
			'video keyframe base composition',
		);
		const videoEffects = owners.normalizeEffects(
			readClosedDomainField(candidate, 'videoEffects', 'video keyframe state request'),
			'video keyframe base effects',
		);
		const keyframes = owners.normalizeCurves(readClosedDomainField(
			candidate, 'videoKeyframes', 'video keyframe state request',
		), {
			duration: readClosedDomainField(candidate, 'sequenceFrameCount', 'video keyframe state request') as RationalInput,
			composition,
			videoEffects,
		});
		const compiled = Object.freeze({ keyframes, composition, videoEffects });
		COMPILED.add(compiled);
		return compiled;
	}

	/** Evaluate one renderer-neutral state without changing persisted base values. */
	function evaluate(
		compiledValue: unknown,
		position: RationalInput,
	): Readonly<KeyframeState<Effect>> {
		if (!compiledValue || typeof compiledValue !== 'object' || !COMPILED.has(compiledValue)) {
			throw new TypeError('A compiled video keyframe state is required.');
		}
		const compiled = compiledValue as Compiled;
		const composition = structuredClone(compiled.composition) as MutableComposition;
		const effects = compiled.videoEffects.map((effect) => ({
			id: effect.id,
			type: effect.type,
			enabled: effect.enabled,
			params: { ...effect.params } as Record<string, unknown>,
		}));
		const effectById = new Map(effects.map((effect) => [effect.id, effect]));
		for (const patch of owners.evaluateCurves(compiled.keyframes, position)) {
			if (patch.target.kind === 'composition') {
				applyCompositionPatch(composition, patch.target.parameterId, patch.value);
				continue;
			}
			const effect = effectById.get(patch.target.effectId);
			if (!effect) throw new ReferenceError(`Video effect ${patch.target.effectId} disappeared after compilation.`);
			effect.params[patch.target.parameterId] = patch.value;
		}
		return Object.freeze({
			composition: normalizeVideoClipComposition(composition, 'evaluated video composition'),
			videoEffects: owners.normalizeEffects(effects, 'evaluated video effects'),
		});
	}

	interface MutableComposition {
		schemaVersion: VideoClipComposition['schemaVersion'];
		crop: { left: number; top: number; right: number; bottom: number };
		transform: {
			anchorX: number;
			anchorY: number;
			positionX: number;
			positionY: number;
			scaleX: number;
			scaleY: number;
			rotationDegrees: number;
			flipHorizontal: boolean;
			flipVertical: boolean;
		};
		opacity: number;
		blendMode: VideoClipComposition['blendMode'];
		compositingOrder: number;
	}

	function applyCompositionPatch(
		composition: MutableComposition,
		parameterId: string,
		value: number,
	): void {
		const [section, field] = parameterId.split('.');
		if (section === 'crop' && isCropField(field)) {
			composition.crop[field] = value;
			return;
		}
		if (section === 'transform' && isNumericTransformField(field)) {
			composition.transform[field] = value;
			return;
		}
		if (parameterId === 'opacity') {
			composition.opacity = value;
			return;
		}
		throw new RangeError(`Unsupported evaluated composition parameter: ${parameterId}.`);
	}

	function isCropField(value: string | undefined): value is keyof VideoClipComposition['crop'] {
		return value === 'left' || value === 'top' || value === 'right' || value === 'bottom';
	}

	function isNumericTransformField(
		value: string | undefined,
	): value is Exclude<keyof VideoClipComposition['transform'], 'flipHorizontal' | 'flipVertical'> {
		return value === 'anchorX' || value === 'anchorY'
			|| value === 'positionX' || value === 'positionY'
			|| value === 'scaleX' || value === 'scaleY'
			|| value === 'rotationDegrees';
	}

	return Object.freeze({ compile, evaluate });
}
