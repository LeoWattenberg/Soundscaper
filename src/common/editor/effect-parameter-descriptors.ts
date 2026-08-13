/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDACITY_EFFECT_DEFINITIONS,
} from './audacity-effects/manifest.js';
import {
	audacityLiveEffectCapability,
} from './audacity-effects/live.js';
import {
	AUDIO_EFFECT_DEFINITIONS,
	PARAMETRIC_EQ_BAND_TYPES,
	PARAMETRIC_EQ_SLOPES,
	audioEffectParamRange,
	effectTailFrames,
	isAudacityRackEffectType,
	normalizeEffect,
} from './effects.js';
import {
	canonicalParameterAddressKey,
	normalizeParameterAddress,
	normalizeStripRef,
	type ParameterAddress,
	type ParameterDescriptor,
	type ParameterTaper,
	type StripRef,
} from './parameter-address.ts';

const DEFAULT_SAMPLE_RATE = 48_000;

interface EffectLike {
	readonly id?: unknown;
	readonly type?: unknown;
	readonly params?: Readonly<Record<string, unknown>>;
}

interface NumericMetadata {
	readonly unit?: unknown;
	readonly step?: unknown;
	readonly taper?: unknown;
	readonly automatable?: unknown;
	readonly automationBlockReason?: unknown;
}

interface AudacityParameterDefinition extends NumericMetadata {
	readonly kind?: unknown;
	readonly default?: unknown;
	readonly minimum?: unknown;
	readonly maximum?: unknown;
	readonly options?: readonly Readonly<{ value?: unknown }>[];
	readonly frequencies?: readonly unknown[];
}

export interface ParameterRevisionInput {
	readonly effectId: string;
	readonly parameterId: string;
	readonly reason: string;
}

export interface EffectParameterInventory {
	readonly descriptors: readonly ParameterDescriptor[];
	readonly revisionInputs: readonly ParameterRevisionInput[];
}

export interface EffectParameterInventoryOptions {
	readonly sampleRate?: number;
}

/**
 * Build stable scalar descriptors from the definitions which already own each
 * effect's defaults and validation ranges. No descriptor range table exists.
 */
export function effectParameterInventory(
	stripValue: StripRef,
	effectValue: EffectLike,
	{ sampleRate = DEFAULT_SAMPLE_RATE }: EffectParameterInventoryOptions = {},
): EffectParameterInventory {
	const strip = normalizeStripRef(stripValue);
	const effect = normalizeEffect(effectValue) as Required<Pick<EffectLike, 'id' | 'type' | 'params'>>;
	const effectId = String(effect.id);
	const type = String(effect.type);
	const rate = positiveSampleRate(sampleRate);
	const latencyFrames = effectLatency(type, effect.params, rate);
	const tailFrames = effectTailFrames(effect, rate);
	const descriptors: ParameterDescriptor[] = [];
	const revisionInputs: ParameterRevisionInput[] = [];
	const add = (
		parameterId: string,
		definition: NumericMetadata,
		minimum: number,
		maximum: number,
		defaultValue: number,
		elementId?: string,
	): void => {
		const address = normalizeParameterAddress({
			kind: 'effect', strip, effectId, ...(elementId === undefined ? {} : { elementId }), parameterId,
		});
		const latencyChanging = elementId === undefined && parameterChangesLatency(
			type, effect.params, parameterId, minimum, maximum, rate,
		);
		const explicitlyBlocked = definition.automatable === false;
		const automationBlockReason = latencyChanging
			? 'This parameter changes effect latency and requires a graph rebuild.'
			: explicitlyBlocked && typeof definition.automationBlockReason === 'string'
				? definition.automationBlockReason
				: undefined;
		descriptors.push(Object.freeze({
			id: canonicalParameterAddressKey(address),
			address,
			unit: unitOf(definition),
			minimum,
			maximum,
			defaultValue,
			step: stepOf(definition),
			taper: taperOf(definition, minimum),
			automationTolerance: toleranceOf(definition, minimum, maximum),
			automatable: !latencyChanging && !explicitlyBlocked,
			...(automationBlockReason ? { automationBlockReason } : {}),
			latencyFrames,
			tailFrames,
		}));
	};

	if (type === 'eq') {
		const definition = AUDIO_EFFECT_DEFINITIONS.eq;
		const outputRange = numericRange(definition.ranges.outputGain);
		add('outputGain', outputRange.metadata, outputRange.minimum, outputRange.maximum, 0);
		for (const band of Array.isArray(effect.params.bands) ? effect.params.bands : []) {
			const value = band as Readonly<Record<string, unknown>>;
			const elementId = stableElementId(value.id, 'Parametric EQ band');
			add('enabled', discreteMetadata('boolean', false, 'Changing band topology is not sample-offset safe.'), 0, 1, 1, elementId);
			add('type', discreteMetadata('enum', false, 'Changing filter topology is not sample-offset safe.'), 0, PARAMETRIC_EQ_BAND_TYPES.length - 1, 0, elementId);
			for (const parameterId of ['frequency', 'gain', 'q'] as const) {
				const range = numericRange(definition.ranges[parameterId]);
				const fallback = parameterId === 'frequency' ? 1_000 : parameterId === 'q' ? 1 : 0;
				add(parameterId, range.metadata, range.minimum, range.maximum, fallback, elementId);
			}
			add('slope', discreteMetadata('dB/oct', false, 'Changing filter topology is not sample-offset safe.'), Math.min(...PARAMETRIC_EQ_SLOPES), Math.max(...PARAMETRIC_EQ_SLOPES), PARAMETRIC_EQ_SLOPES[0], elementId);
		}
		return frozenInventory(descriptors, revisionInputs);
	}

	if (isAudacityRackEffectType(type)) {
		const definition = AUDACITY_EFFECT_DEFINITIONS[type] as Readonly<{
			params: Readonly<Record<string, AudacityParameterDefinition>>;
		}>;
		for (const [parameterId, descriptor] of Object.entries(definition.params)) {
			if (descriptor.kind === 'number') {
				const liveRange = audioEffectParamRange(type, parameterId);
				const minimum = finiteNumber(liveRange?.[0] ?? descriptor.minimum, `${type}.${parameterId}.minimum`);
				const maximum = finiteNumber(liveRange?.[1] ?? descriptor.maximum, `${type}.${parameterId}.maximum`);
				add(parameterId, descriptor, minimum, maximum, finiteNumber(descriptor.default, `${type}.${parameterId}.default`));
			} else if (descriptor.kind === 'boolean') {
				add(parameterId, discreteMetadata('boolean'), 0, 1, descriptor.default ? 1 : 0);
			} else if (descriptor.kind === 'enum') {
				const options = descriptor.options || [];
				const index = Math.max(0, options.findIndex((option) => option.value === descriptor.default));
				add(parameterId, discreteMetadata('enum'), 0, Math.max(0, options.length - 1), index);
			} else if (descriptor.kind === 'bands') {
				const frequencies = descriptor.frequencies || [];
				for (let index = 0; index < frequencies.length; index += 1) {
					add(
						'gains',
						descriptor,
						finiteNumber(descriptor.minimum, `${type}.${parameterId}.minimum`),
						finiteNumber(descriptor.maximum, `${type}.${parameterId}.maximum`),
						0,
						`frequency:${String(frequencies[index])}`,
					);
				}
			} else {
				revisionInputs.push(Object.freeze({
					effectId,
					parameterId,
					reason: 'Curve points need persisted stable element IDs before they can be automated.',
				}));
			}
		}
		return frozenInventory(descriptors, revisionInputs);
	}

	const definition = AUDIO_EFFECT_DEFINITIONS[type as keyof typeof AUDIO_EFFECT_DEFINITIONS];
	if (!definition) return frozenInventory(descriptors, revisionInputs);
	for (const [parameterId, sourceRange] of Object.entries(definition.ranges)) {
		const range = numericRange(sourceRange);
		const defaultValue = finiteNumber(
			(definition.defaults as Readonly<Record<string, unknown>>)[parameterId],
			`${type}.${parameterId}.default`,
		);
		add(parameterId, range.metadata, range.minimum, range.maximum, defaultValue);
	}
	return frozenInventory(descriptors, revisionInputs);
}

export function stripParameterDescriptor(
	addressValue: ParameterAddress,
	latencyFrames = 0,
): ParameterDescriptor {
	const address = normalizeParameterAddress(addressValue);
	if (address.kind !== 'strip' && address.kind !== 'edge') {
		throw new TypeError('A strip or edge parameter address is required.');
	}
	const parameterId = address.parameterId;
	const settings = parameterId === 'pan'
		? { unit: 'pan', minimum: -1, maximum: 1, defaultValue: 0, step: 0.01, taper: 'linear' as const }
		: parameterId === 'mute'
			? { unit: 'boolean', minimum: 0, maximum: 1, defaultValue: 0, step: 1, taper: 'discrete' as const }
			: { unit: 'linear-gain', minimum: 0, maximum: 4, defaultValue: 1, step: 0.01, taper: 'decibel' as const };
	return Object.freeze({
		id: canonicalParameterAddressKey(address),
		address,
		...settings,
		automationTolerance: settings.taper === 'discrete' ? 0 : 1e-4,
		automatable: true,
		latencyFrames: nonNegativeFrames(latencyFrames),
		tailFrames: 0,
	});
}

function effectLatency(type: string, params: Readonly<Record<string, unknown>>, sampleRate: number): number {
	if (type === 'limiter') return Math.max(0, Math.ceil(Number(params.lookahead || 0) * sampleRate));
	if (!isAudacityRackEffectType(type)) return 0;
	return nonNegativeFrames(audacityLiveEffectCapability(type).latencyFrames(sampleRate, params));
}

function parameterChangesLatency(
	type: string,
	params: Readonly<Record<string, unknown>>,
	parameterId: string,
	minimum: number,
	maximum: number,
	sampleRate: number,
): boolean {
	const baseline = effectLatency(type, params, sampleRate);
	return [minimum, maximum].some((value) => {
		try {
			return effectLatency(type, { ...params, [parameterId]: value }, sampleRate) !== baseline;
		} catch {
			return true;
		}
	});
}

function numericRange(value: unknown): Readonly<{
	minimum: number;
	maximum: number;
	metadata: NumericMetadata;
}> {
	if (!Array.isArray(value) || value.length < 2) throw new TypeError('An effect parameter range is required.');
	return {
		minimum: finiteNumber(value[0], 'parameter minimum'),
		maximum: finiteNumber(value[1], 'parameter maximum'),
		metadata: value[2] && typeof value[2] === 'object' && !Array.isArray(value[2])
			? value[2] as NumericMetadata
			: {},
	};
}

function discreteMetadata(
	unit: string,
	automatable = true,
	automationBlockReason?: string,
): NumericMetadata {
	return { unit, step: 1, taper: 'discrete', automatable, automationBlockReason };
}

function unitOf(definition: NumericMetadata): string {
	return typeof definition.unit === 'string' && definition.unit ? definition.unit : 'unitless';
}

function stepOf(definition: NumericMetadata): number | null {
	if (definition.step == null) return null;
	const step = Number(definition.step);
	return Number.isFinite(step) && step > 0 ? step : null;
}

function taperOf(definition: NumericMetadata, minimum: number): ParameterTaper {
	if (definition.taper === 'linear' || definition.taper === 'logarithmic'
		|| definition.taper === 'decibel' || definition.taper === 'discrete') {
		return definition.taper;
	}
	const unit = unitOf(definition);
	if (unit === 'dB' || unit === 'dBFS' || unit === 'LUFS') return 'decibel';
	if (unit === 'Hz' && minimum > 0) return 'logarithmic';
	return 'linear';
}

function toleranceOf(definition: NumericMetadata, minimum: number, maximum: number): number {
	if (taperOf(definition, minimum) === 'discrete') return 0;
	const step = stepOf(definition);
	return step == null ? Math.max(1e-9, Math.abs(maximum - minimum) * 1e-6) : step / 100;
}

function stableElementId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} needs a stable ID.`);
	return value;
}

function finiteNumber(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite.`);
	return number;
}

function positiveSampleRate(value: unknown): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number <= 0) throw new RangeError('The descriptor sample rate must be positive.');
	return number;
}

function nonNegativeFrames(value: unknown): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) return 0;
	return Math.ceil(number);
}

function frozenInventory(
	descriptors: ParameterDescriptor[],
	revisionInputs: ParameterRevisionInput[],
): EffectParameterInventory {
	return Object.freeze({
		descriptors: Object.freeze(descriptors),
		revisionInputs: Object.freeze(revisionInputs),
	});
}
