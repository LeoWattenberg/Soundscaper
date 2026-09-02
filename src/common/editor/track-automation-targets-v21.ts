/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	effectParameterInventory,
	stripParameterDescriptor,
} from './effect-parameter-descriptors.ts';
import { AUDACITY_EFFECT_DEFINITIONS } from './audacity-effects/manifest.js';
import { normalizeAutomationLaneV21, type AutomationLaneV21 } from './automation-lane-v21.ts';
import {
	canonicalParameterAddressKey,
	type ParameterAddress,
	type ParameterDescriptor,
} from './parameter-address.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export interface TrackAutomationTargetV21 {
	readonly key: string;
	readonly address: ParameterAddress;
	readonly descriptor: ParameterDescriptor;
	readonly label: string;
	readonly groupLabel: string;
	readonly effectId: string | null;
	readonly edgeId: string | null;
	readonly currentValue: number;
	readonly lane: AutomationLaneV21 | null;
	readonly disabledReason: string | null;
}

/** Build the complete stable parameter selector inventory for one audio track. */
export function createTrackAutomationTargetInventoryV21(
	projectValue: unknown,
	trackId: string,
): readonly TrackAutomationTargetV21[] {
	const project = record(projectValue);
	const tracks = records(own(project, 'tracks'));
	const track = tracks.find((candidate) => own(candidate, 'id') === trackId);
	if (!track || own(track, 'type') !== 'audio') return Object.freeze([]);
	const strip = Object.freeze({ kind: 'track' as const, id: trackId });
	const lanesByAddress = new Map<string, unknown>();
	for (const laneValue of array(own(project, 'automationLanes'))) {
		const lane = record(laneValue);
		try {
			lanesByAddress.set(canonicalParameterAddressKey(own(lane, 'address')), laneValue);
		} catch {
			// Project validation owns malformed persisted lanes. The selector remains inert.
		}
	}
	const result: TrackAutomationTargetV21[] = [];
	for (const [parameterId, label] of [
		['gain', 'Volume'], ['pan', 'Pan'], ['mute', 'Mute'],
	] as const) {
		const descriptor = stripParameterDescriptor({ kind: 'strip', strip, parameterId });
		result.push(target({
			descriptor,
			label,
			groupLabel: 'Track',
			effectId: null,
			edgeId: null,
			currentValue: nativeValue(own(track, parameterId), descriptor),
			lanesByAddress,
		}));
	}
	const mixer = record(own(project, 'mixer'));
	for (const edgeValue of array(own(mixer, 'edges'))) {
		const edge = record(edgeValue);
		const source = record(own(edge, 'source'));
		const edgeId = text(own(edge, 'id'));
		const kind = own(edge, 'kind');
		if (!edgeId || (kind !== 'assignment' && kind !== 'send')
			|| own(source, 'kind') !== 'track' || own(source, 'id') !== trackId) continue;
		const descriptor = stripParameterDescriptor({ kind: 'edge', edgeId, parameterId: 'level' });
		result.push(target({
			descriptor,
			label: `${edgeDestinationLabel(mixer, record(own(edge, 'destination')))} ${kind}`,
			groupLabel: 'Routing',
			effectId: null,
			edgeId,
			currentValue: nativeValue(own(edge, 'level'), descriptor),
			lanesByAddress,
		}));
	}
	for (const effectValue of array(own(track, 'effects'))) {
		const effect = record(effectValue);
		const effectId = text(own(effect, 'id'));
		if (!effect || !effectId) continue;
		let inventory: ReturnType<typeof effectParameterInventory>;
		try {
			inventory = effectParameterInventory(strip, effect, {
				sampleRate: positiveInteger(own(project, 'sampleRate'), 48_000),
			});
		} catch {
			continue;
		}
		const groupLabel = effectLabel(effect);
		for (const descriptor of inventory.descriptors) result.push(target({
			descriptor,
			label: effectParameterLabel(descriptor.address),
			groupLabel,
			effectId,
			edgeId: null,
			currentValue: effectValueForDescriptor(effect, descriptor),
			lanesByAddress,
		}));
		for (const revisionInput of inventory.revisionInputs) {
			const descriptor = unsupportedEffectParameterDescriptor(
				strip, effectId, revisionInput.parameterId, revisionInput.reason,
			);
			result.push(target({
				descriptor,
				label: effectParameterLabel(descriptor.address),
				groupLabel,
				effectId,
				edgeId: null,
				currentValue: descriptor.defaultValue,
				lanesByAddress,
			}));
		}
	}
	return Object.freeze(result);
}

function unsupportedEffectParameterDescriptor(
	strip: Readonly<{ kind: 'track'; id: string }>,
	effectId: string,
	parameterId: string,
	reason: string,
): ParameterDescriptor {
	const address = Object.freeze({
		kind: 'effect' as const,
		strip,
		effectId,
		parameterId,
	});
	return Object.freeze({
		id: canonicalParameterAddressKey(address),
		address,
		unit: 'unsupported',
		minimum: 0,
		maximum: 1,
		defaultValue: 0,
		step: null,
		taper: 'linear',
		automationTolerance: 0,
		automatable: false,
		automationBlockReason: reason,
		latencyFrames: 0,
		tailFrames: 0,
	});
}

export function quantizeAutomationValueV21(
	descriptor: ParameterDescriptor,
	value: number,
): number {
	const finite = Number.isFinite(value) ? value : descriptor.defaultValue;
	const clamped = Math.max(descriptor.minimum, Math.min(descriptor.maximum, finite));
	const stepped = descriptor.step === null ? clamped : descriptor.minimum
		+ Math.round((clamped - descriptor.minimum) / descriptor.step) * descriptor.step;
	const bounded = Math.max(descriptor.minimum, Math.min(descriptor.maximum, stepped));
	const canonical = Number.parseFloat(bounded.toPrecision(15));
	return Object.is(canonical, -0) ? 0 : canonical;
}

/** Map a native parameter value to bottom=0/top=1 display coordinates. */
export function automationValueToNormalizedV21(
	descriptor: ParameterDescriptor,
	value: number,
): number {
	const bounded = quantizeAutomationValueV21({ ...descriptor, step: null }, value);
	if (descriptor.maximum === descriptor.minimum) return 0;
	if (descriptor.taper === 'logarithmic') {
		return unit(Math.log(bounded / descriptor.minimum)
			/ Math.log(descriptor.maximum / descriptor.minimum));
	}
	if (descriptor.taper === 'decibel' && descriptor.unit === 'linear-gain') {
		if (bounded <= 0) return 0;
		const top = 20 * Math.log10(descriptor.maximum);
		return unit((Math.max(-60, 20 * Math.log10(bounded)) + 60) / (top + 60));
	}
	return unit((bounded - descriptor.minimum) / (descriptor.maximum - descriptor.minimum));
}

/** Inverse of automationValueToNormalizedV21, including descriptor quantization. */
export function automationNormalizedToValueV21(
	descriptor: ParameterDescriptor,
	normalized: number,
): number {
	const amount = unit(normalized);
	let value: number;
	if (descriptor.maximum === descriptor.minimum) value = descriptor.minimum;
	else if (descriptor.taper === 'logarithmic') {
		value = descriptor.minimum * (descriptor.maximum / descriptor.minimum) ** amount;
	} else if (descriptor.taper === 'decibel' && descriptor.unit === 'linear-gain') {
		if (amount === 0) return 0;
		const top = 20 * Math.log10(descriptor.maximum);
		value = 10 ** ((-60 + amount * (top + 60)) / 20);
	} else value = descriptor.minimum + amount * (descriptor.maximum - descriptor.minimum);
	return quantizeAutomationValueV21(descriptor, value);
}

function target(input: Readonly<{
	descriptor: ParameterDescriptor;
	label: string;
	groupLabel: string;
	effectId: string | null;
	edgeId: string | null;
	currentValue: number;
	lanesByAddress: ReadonlyMap<string, unknown>;
}>): TrackAutomationTargetV21 {
	const key = canonicalParameterAddressKey(input.descriptor.address);
	const laneValue = input.lanesByAddress.get(key);
	let lane: AutomationLaneV21 | null = null;
	if (laneValue !== undefined && input.descriptor.automatable) {
		try { lane = normalizeAutomationLaneV21(laneValue, { descriptor: input.descriptor }); } catch { lane = null; }
	}
	return Object.freeze({
		key,
		address: input.descriptor.address,
		descriptor: input.descriptor,
		label: input.label,
		groupLabel: input.groupLabel,
		effectId: input.effectId,
		edgeId: input.edgeId,
		currentValue: quantizeAutomationValueV21(input.descriptor, input.currentValue),
		lane,
		disabledReason: input.descriptor.automatable
			? null
			: input.descriptor.automationBlockReason ?? 'This parameter cannot be automated.',
	});
}

function edgeDestinationLabel(mixer: DataRecord | null, destination: DataRecord | null): string {
	if (own(destination, 'kind') === 'master') return 'Master';
	const destinationId = text(own(destination, 'id'));
	if (own(destination, 'kind') === 'output') return destinationId
		? namedMixerItem(mixer, 'outputs', destinationId) ?? humanize(destinationId)
		: 'Output';
	if (own(destination, 'kind') === 'mixer-node' && destinationId) {
		for (const collection of ['groups', 'sends', 'cues']) {
			const label = namedMixerItem(mixer, collection, destinationId);
			if (label) return label;
		}
		return humanize(destinationId);
	}
	return 'Route';
}

function namedMixerItem(mixer: DataRecord | null, collection: string, id: string): string | null {
	const item = records(own(mixer, collection)).find((candidate) => own(candidate, 'id') === id);
	return text(own(item ?? null, 'name'));
}

function effectValueForDescriptor(effect: DataRecord, descriptor: ParameterDescriptor): number {
	if (descriptor.address.kind !== 'effect') return descriptor.defaultValue;
	const address = descriptor.address;
	const params = record(own(effect, 'params'));
	if (!address.elementId) return nativeValue(
		own(params, address.parameterId), descriptor,
	);
	const scalarArrayValue = scalarArrayElementValue(effect, params, address);
	if (scalarArrayValue !== null) return nativeValue(scalarArrayValue, descriptor);
	for (const collection of Object.values(params ?? {})) {
		if (!Array.isArray(collection)) continue;
		const element = collection.map(record).find((candidate) => (
			own(candidate, 'id') === address.elementId
		));
		if (element) return nativeValue(own(element, address.parameterId), descriptor);
	}
	return descriptor.defaultValue;
}

function scalarArrayElementValue(
	effect: DataRecord,
	params: DataRecord | null,
	address: Extract<ParameterAddress, Readonly<{ readonly kind: 'effect' }>>,
): unknown | null {
	const frequency = /^frequency:(.+)$/u.exec(address.elementId ?? '')?.[1];
	const type = text(own(effect, 'type'));
	if (!frequency || !type) return null;
	const definition = record(own(record(AUDACITY_EFFECT_DEFINITIONS), type));
	const parameter = record(own(record(own(definition, 'params')), address.parameterId));
	const frequencies = array(own(parameter, 'frequencies'));
	const values = array(own(params, address.parameterId));
	const index = frequencies.findIndex((candidate) => String(candidate) === frequency);
	return index >= 0 && index < values.length ? values[index] : null;
}

function nativeValue(value: unknown, descriptor: ParameterDescriptor): number {
	if (typeof value === 'boolean') return value ? 1 : 0;
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: descriptor.defaultValue;
}

function effectLabel(effect: DataRecord): string {
	return text(own(effect, 'name')) ?? text(own(effect, 'title'))
		?? humanize(text(own(effect, 'type')) ?? 'Effect');
}

function effectParameterLabel(address: ParameterAddress): string {
	const label = humanize(address.parameterId);
	return address.kind === 'effect' && address.elementId
		? `${humanize(address.elementId)} · ${label}`
		: label;
}

function humanize(value: string): string {
	return value.replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
		.replace(/[-_:]+/gu, ' ')
		.replace(/^./u, (character) => character.toUpperCase());
}

function unit(value: number): number {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function record(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as DataRecord
		: null;
}

function records(value: unknown): readonly DataRecord[] {
	return array(value).map(record).filter((item): item is DataRecord => item !== null);
}

function array(value: unknown): readonly unknown[] {
	return Array.isArray(value) ? value : [];
}

function own(value: DataRecord | null, key: string): unknown {
	return value && Object.hasOwn(value, key) ? value[key] : undefined;
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

function positiveInteger(value: unknown, fallback: number): number {
	return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}
