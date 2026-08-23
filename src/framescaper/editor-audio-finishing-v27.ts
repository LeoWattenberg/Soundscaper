/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertAutomationLaneIdentitiesUniqueV21,
	normalizeAutomationLaneV21,
	type AutomationLaneV21,
} from '../common/editor/automation-lane-v21.ts';
import {
	effectParameterInventory,
	stripParameterDescriptor,
} from '../common/editor/effect-parameter-descriptors.ts';
import {
	createDefaultMixerGraphV21,
	normalizeMixerGraphV21,
	validateMixerGraphV21,
	type MixerGraphV21,
} from '../common/editor/mixer-graph-v21.ts';
import { canonicalParameterAddressKey, type ParameterDescriptor } from '../common/editor/parameter-address.ts';

export interface FramescaperAudioFinishingV27 {
	readonly automationLanes: readonly AutomationLaneV21[];
	readonly mixer: MixerGraphV21;
}

export function createDefaultFramescaperAudioFinishingV27(
	project: Readonly<Record<string, unknown>>,
): FramescaperAudioFinishingV27 {
	const masterChannels = positiveInteger(project.masterChannels, 'project.masterChannels');
	const audioTracks = records(project.tracks, 'project.tracks')
		.filter(({ type }) => type === 'audio')
		.map((track) => ({ id: id(track, 'audio track'), channelCount: masterChannels }));
	return Object.freeze({
		automationLanes: Object.freeze([]),
		mixer: createDefaultMixerGraphV21(audioTracks, masterChannels),
	});
}

export function normalizeFramescaperAudioFinishingV27(
	project: Readonly<Record<string, unknown>>,
	value: Readonly<{ readonly automationLanes: unknown; readonly mixer: unknown }>,
): FramescaperAudioFinishingV27 {
	if (!Array.isArray(value?.automationLanes) || value.automationLanes.length > 4_096) {
		throw new RangeError('Framescaper V27 automationLanes must contain at most 4096 lanes.');
	}
	const automationLanes = Object.freeze(value.automationLanes.map((lane) => normalizeAutomationLaneV21(lane)));
	assertAutomationLaneIdentitiesUniqueV21(automationLanes);
	const mixer = normalizeMixerGraphV21(value?.mixer);
	const audioTracks = records(project.tracks, 'project.tracks').filter(({ type }) => type === 'audio');
	validateMixerGraphV21(mixer, {
		audioTracks: audioTracks.map((track) => ({
			id: id(track, 'audio track'), effects: recordArray(track.effects, 'audio track effects'),
		})),
		masterEffects: recordArray(record(project.master, 'project.master').effects, 'master effects'),
		mixerNodeEffects: new Map(
			[...mixer.groups, ...mixer.sends, ...mixer.cues].map((node) => [node.id, node.effects]),
		),
		masterChannels: positiveInteger(project.masterChannels, 'project.masterChannels'),
	});
	validateAutomation(project, mixer, automationLanes);
	return Object.freeze({ automationLanes, mixer });
}

function validateAutomation(
	project: Readonly<Record<string, unknown>>,
	mixer: MixerGraphV21,
	lanes: readonly AutomationLaneV21[],
): void {
	const tracks = new Map(records(project.tracks, 'project.tracks').map((track) => [id(track, 'track'), track]));
	const nodes = new Map([...mixer.groups, ...mixer.sends, ...mixer.cues].map((node) => [node.id, node]));
	const edges = new Set(mixer.edges.map((edge) => edge.id));
	for (const lane of lanes) {
		const address = lane.address;
		if (address.kind === 'edge') {
			if (!edges.has(address.edgeId)) {
				throw new ReferenceError(`Automation lane ${lane.id} references a missing mixer edge.`);
			}
			validateLane(lane, stripParameterDescriptor(address));
			continue;
		}
		const strip = address.strip;
		const owner = strip.kind === 'master' ? record(project.master, 'project.master')
			: strip.kind === 'track' ? tracks.get(strip.id) : nodes.get(strip.id);
		if (!owner) throw new ReferenceError(`Automation lane ${lane.id} references a missing ${strip.kind}.`);
		if (address.kind === 'strip') {
			validateLane(lane, stripParameterDescriptor(address));
			continue;
		}
		const effects = recordArray(owner.effects, `automation owner ${lane.id} effects`);
		const effect = effects.find(({ id: effectId }) => effectId === address.effectId);
		if (!effect) throw new ReferenceError(`Automation lane ${lane.id} references a missing effect.`);
		const descriptorKey = canonicalParameterAddressKey(address);
		const descriptor = effectParameterInventory(strip, effect, {
			sampleRate: positiveInteger(project.sampleRate, 'project.sampleRate'),
		}).descriptors.find(({ id: descriptorId }) => descriptorId === descriptorKey);
		if (!descriptor) throw new ReferenceError(`Automation lane ${lane.id} references an unavailable effect parameter.`);
		validateLane(lane, descriptor);
	}
}

function validateLane(lane: AutomationLaneV21, descriptor: ParameterDescriptor): void {
	normalizeAutomationLaneV21(lane, { descriptor });
}

function id(value: Readonly<Record<string, unknown>>, name: string): string {
	if (typeof value.id !== 'string' || !value.id) throw new TypeError(`${name}.id must be non-empty.`);
	return value.id;
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function recordArray(value: unknown, name: string): readonly Readonly<Record<string, unknown>>[] {
	return records(value, name);
}
