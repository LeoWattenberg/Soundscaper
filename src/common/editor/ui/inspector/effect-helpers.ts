import { normalizeBcp47Locale } from '../../../i18n/locale.js';
import {
	AUDIO_EFFECT_DEFINITIONS,
	audioSelectionEffectLabel,
	audioEffectTypes,
} from '../../effects.js';
import { AUDACITY_EFFECT_DEFINITIONS } from '../../audacity-effects/manifest.js';
import {
	canonicalCopyValue, effectOptionCopyKey, effectParameterCopyKey,
} from '../../../i18n/canonical-extras.js';
import { formatLocalizedTemplate } from '../localization-template.ts';

type Copy = Readonly<Record<string, string>>;
type CopyOrLocale = Copy | string | undefined;
const resolveAudioEffectLabel = audioSelectionEffectLabel as unknown as (
	type: string | null | undefined,
	copyOrLocale: CopyOrLocale,
) => string;
const resolveCanonicalCopy = canonicalCopyValue as unknown as (
	key: string,
	copyOrLocale: CopyOrLocale,
) => string;

interface EffectPreset {
	readonly id: string;
	readonly name: string;
	readonly labelKey?: string;
	readonly custom?: boolean;
	readonly params?: Readonly<Record<string, unknown>>;
}

interface EffectLike {
	readonly type?: string;
	readonly params?: Readonly<Record<string, unknown>>;
	readonly missing?: Readonly<{ name?: unknown }>;
}

interface NumberDescriptor {
	readonly minimum?: number;
	readonly maximum?: number;
}

interface CurvePoint {
	readonly frequency: number;
	readonly gain: number;
}

/**
 * Presets as the preset bar wants them: a label to show and whether the entry
 * is one this project saved. A factory preset names its catalog key instead of
 * carrying translated text, so its label is resolved here, where the copy is.
 */
export function effectPresetChoices<T extends EffectPreset>(
	presets: readonly T[] | null | undefined,
	emptyLabel: string,
	copyOrLocale?: CopyOrLocale,
): ReadonlyArray<Readonly<{ id: string; label: string; custom: boolean; preset: T }>> {
	const labels = new Set([emptyLabel]);
	return (presets || []).map((preset) => {
		const name = preset.labelKey ? resolveCanonicalCopy(preset.labelKey, copyOrLocale) : preset.name;
		let label = name;
		let suffix = 2;
		while (labels.has(label)) {
			label = `${name} (${suffix})`;
			suffix += 1;
		}
		labels.add(label);
		return { id: preset.id, label, custom: preset.custom !== false, preset };
	});
}

/**
 * Whether an effect's live parameters still match the preset they came from.
 *
 * Audacity arms Reset preset and marks the dropdown entry from exactly this
 * comparison, so an edited preset reads as unsaved until it is stored again.
 */
export function samePresetParams(
	current: Readonly<Record<string, unknown>> | null | undefined,
	preset: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
	const left = current || {};
	const right = preset || {};
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		if (JSON.stringify(left[key] ?? null) !== JSON.stringify(right[key] ?? null)) return false;
	}
	return true;
}

export function effectHasEditableSettings(type: string): boolean {
	const nativeDefinition = AUDIO_EFFECT_DEFINITIONS[type as keyof typeof AUDIO_EFFECT_DEFINITIONS];
	if (nativeDefinition) return Object.keys(nativeDefinition.defaults || {}).length > 0;
	const definition = AUDACITY_EFFECT_DEFINITIONS[type as keyof typeof AUDACITY_EFFECT_DEFINITIONS];
	return Boolean(definition && (
		Object.keys(definition.params || {}).length
		|| definition.requiresControlTrack
		|| definition.requiresNoiseProfile
	));
}

export function resolveSupportedEffectType(
	candidate: unknown,
	locale: string | undefined,
	copy: Copy,
	types: readonly string[] = audioEffectTypes() as readonly string[],
): string | null {
	const normalizedLocale = normalizeBcp47Locale(locale);
	const normalized = String(candidate || '').trim().toLocaleLowerCase(normalizedLocale);
	return types.find((type) => {
		const labels = [type, safeEffectLabel(type, copy), safeEffectLabel(type, 'en'), safeEffectLabel(type, 'de')];
		return labels.some((label) => label.trim().toLocaleLowerCase(normalizedLocale) === normalized);
	}) || null;
}

export function safeEffectLabel(effectOrType: EffectLike | string | null | undefined, copyOrLocale: CopyOrLocale): string {
	if (effectOrType && typeof effectOrType === 'object' && effectOrType.type === 'missing') {
		const copy = typeof copyOrLocale === 'object' ? copyOrLocale : undefined;
		const name = String(effectOrType.missing?.name || '').trim()
			|| copy?.missingEffectUnknown
			|| 'Unknown effect';
		return formatLocalizedTemplate(copy?.missingEffectLabel || 'Missing: {name}', { name });
	}
	const type = typeof effectOrType === 'object' ? effectOrType?.type : effectOrType;
	try {
		return resolveAudioEffectLabel(type, copyOrLocale);
	} catch {
		return String(type || '');
	}
}

export function isAudacityDefinition(type: string): boolean {
	return Boolean(AUDACITY_EFFECT_DEFINITIONS[type as keyof typeof AUDACITY_EFFECT_DEFINITIONS]);
}

export function audioEffectParamRangeFromDescriptor(
	descriptor: NumberDescriptor,
): readonly [number, number] | null {
	return Number.isFinite(descriptor.minimum) && Number.isFinite(descriptor.maximum)
		? [descriptor.minimum as number, descriptor.maximum as number]
		: null;
}

export function audacityCurvePolyline(
	points: readonly CurvePoint[] | null | undefined,
	linearFrequencyScale = false,
): string {
	const values = Array.isArray(points) && points.length
		? points
		: [{ frequency: 20, gain: 0 }, { frequency: 20_000, gain: 0 }];
	return values.map((point) => {
		const frequency = Math.max(20, Math.min(20_000, Number(point.frequency) || 20));
		const gain = Math.max(-30, Math.min(30, Number(point.gain) || 0));
		const x = linearFrequencyScale
			? 16 + (frequency - 20) / (20_000 - 20) * 608
			: 16 + Math.log10(frequency / 20) / 3 * 608;
		const y = 110 - gain / 30 * 94;
		return `${x.toFixed(2)},${y.toFixed(2)}`;
	}).join(' ');
}

export function audacityParameterVisible(effect: EffectLike, name: string): boolean {
	if (effect.type === 'audacity-loudness-normalization') {
		if (name === 'targetLufs') return effect.params?.mode === 'lufs';
		if (name === 'targetRmsDb') return effect.params?.mode === 'rms';
	}
	if (effect.type === 'audacity-normalize' && name === 'peakDb') return Boolean(effect.params?.applyGain);
	if (effect.type === 'audacity-truncate-silence') {
		if (name === 'truncateTo') return effect.params?.action === 'truncate';
		if (name === 'compressPercent') return effect.params?.action === 'compress';
	}
	if (effect.type === 'audacity-classic-filters') {
		if (name === 'passbandRippleDb') return effect.params?.family === 'chebyshev-i';
		if (name === 'stopbandAttenuationDb') return effect.params?.family === 'chebyshev-ii';
	}
	return true;
}

export type AudacityParameterPresentation = 'knob' | 'slider' | 'number';

export function audacityParameterPresentation(effectType: string, name: string): AudacityParameterPresentation {
	const sliderParameters: Readonly<Record<string, readonly string[]>> = {
		'audacity-amplify': ['gainDb'],
		'audacity-click-removal': ['threshold', 'maximumWidth'],
		'audacity-change-pitch': ['semitones'],
		'audacity-change-tempo': ['tempoPercent'],
		'audacity-change-speed-pitch': ['speedPercent'],
		'audacity-sliding-stretch': ['startTempoPercent', 'endTempoPercent', 'startPitchSemitones', 'endPitchSemitones'],
		'audacity-noise-reduction': ['reductionDb', 'sensitivity', 'frequencySmoothingBands'],
		'audacity-normalize': ['peakDb'],
	};
	if (sliderParameters[effectType]?.includes(name)) return 'slider';
	if ([
		'bitcrusher',
		'audacity-bass-treble',
		'audacity-compressor',
		'audacity-legacy-compressor',
		'audacity-distortion',
		'audacity-limiter',
		'audacity-phaser',
		'audacity-reverb',
		'audacity-wahwah',
	].includes(effectType)) return 'knob';
	return 'number';
}

export function effectParameterLabel(value: string, copy: Copy): string {
	const labels: Readonly<Record<string, string>> = {
		frequency: copy.effectParamFrequency,
		threshold: copy.effectParamThreshold,
		knee: copy.effectParamKnee,
		ratio: copy.effectParamRatio,
		attack: copy.effectParamAttack,
		release: copy.effectParamRelease,
		makeupGain: copy.effectParamMakeupGain,
		ceiling: copy.effectParamCeiling,
		lookahead: copy.effectParamLookahead,
		hold: copy.effectParamHold,
		rangeDb: copy.effectParamRange,
		mix: copy.effectParamMix,
		decay: copy.effectParamDecay,
		preDelay: copy.effectParamPreDelay,
		time: copy.effectParamTime,
		feedback: copy.effectParamFeedback,
	};
	return labels[value]
		|| value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (character) => character.toUpperCase());
}

/**
 * Label a native effect parameter, preferring copy registered against that
 * effect type so two effects may name the same parameter differently, and
 * falling back to the vocabulary shared across the original rack effects.
 */
export function nativeEffectParameterLabel(type: string, name: string, copy: CopyOrLocale): string {
	const key = effectParameterCopyKey(type, name);
	const canonical = resolveCanonicalCopy(key, copy);
	if (canonical !== key) return canonical;
	return effectParameterLabel(name, (copy ?? {}) as Copy);
}

/** Label one selectable value of a native effect parameter. */
export function nativeEffectOptionLabel(
	type: string, name: string, value: string, copy: CopyOrLocale,
): string {
	return resolveCanonicalCopy(effectOptionCopyKey(type, name, value), copy);
}
