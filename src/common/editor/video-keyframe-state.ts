/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	readClosedDomainField,
	readClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
	admitAudioEditorProjectV9ValidationStructure,
} from './project-v9-validation-budget.ts';
import {
	evaluateVideoKeyframeCurves,
	normalizeVideoKeyframeCurves,
	type VideoKeyframeCurves,
} from './video-keyframe-curves.ts';
import {
	normalizeVideoClipComposition,
	type VideoClipComposition,
} from './video-clip-composition.ts';
import {
	normalizeVideoEffects,
} from './video-effects.js';
import type { RationalInput } from './timeline-time.ts';

export interface VideoKeyframedClipStateRequest {
	readonly videoKeyframes: unknown;
	readonly sequenceFrameCount: RationalInput;
	readonly composition: unknown;
	readonly videoEffects: unknown;
}

export interface VideoKeyframedClipState {
	readonly composition: VideoClipComposition;
	readonly videoEffects: readonly Readonly<{
		readonly id: string;
		readonly type: string;
		readonly enabled: boolean;
		readonly params: Readonly<Record<string, number>>;
	}>[];
}

interface CompiledVideoKeyframedClipState {
	readonly keyframes: VideoKeyframeCurves;
	readonly composition: VideoClipComposition;
	readonly videoEffects: VideoKeyframedClipState['videoEffects'];
}

const COMPILED = new WeakSet<object>();

/** Snapshot and compile one clip's authored static and keyframed visual state. */
export function compileVideoKeyframedClipState(
	request: VideoKeyframedClipStateRequest,
): Readonly<CompiledVideoKeyframedClipState> {
	const candidate = readClosedDomainRecord(request, 'video keyframe state request', [
		'videoKeyframes', 'sequenceFrameCount', 'composition', 'videoEffects',
	]);
	admitAudioEditorProjectV9ValidationStructure(
		candidate, AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
	);
	const composition = normalizeVideoClipComposition(
		readClosedDomainField(candidate, 'composition', 'video keyframe state request'),
		'video keyframe base composition',
	);
	const videoEffects = freezeVideoEffects(normalizeVideoEffects(
		readClosedDomainField(candidate, 'videoEffects', 'video keyframe state request'),
		'video keyframe base effects',
	));
	const keyframes = normalizeVideoKeyframeCurves(readClosedDomainField(
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
export function evaluateVideoKeyframedClipState(
	compiledValue: unknown,
	position: RationalInput,
): Readonly<VideoKeyframedClipState> {
	if (!compiledValue || typeof compiledValue !== 'object' || !COMPILED.has(compiledValue)) {
		throw new TypeError('A compiled video keyframe state is required.');
	}
	const compiled = compiledValue as CompiledVideoKeyframedClipState;
	const composition = structuredClone(compiled.composition) as MutableComposition;
	const effects = compiled.videoEffects.map((effect) => ({
		id: effect.id,
		type: effect.type,
		enabled: effect.enabled,
		params: { ...effect.params },
	}));
	const effectById = new Map(effects.map((effect) => [effect.id, effect]));
	for (const patch of evaluateVideoKeyframeCurves(compiled.keyframes, position)) {
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
		videoEffects: freezeVideoEffects(normalizeVideoEffects(effects, 'evaluated video effects')),
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

function freezeVideoEffects(
	effects: readonly Readonly<Record<string, unknown>>[],
): VideoKeyframedClipState['videoEffects'] {
	return Object.freeze(effects.map((effect) => Object.freeze({
		id: String(effect.id),
		type: String(effect.type),
		enabled: effect.enabled === true,
		params: Object.freeze({ ...(effect.params as Readonly<Record<string, number>>) }),
	})));
}
