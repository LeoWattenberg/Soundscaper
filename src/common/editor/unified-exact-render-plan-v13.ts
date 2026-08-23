/* SPDX-License-Identifier: AGPL-3.0-only */

/** Selected V13 finishing authority. This branch deliberately excludes M5 node families. */

import {
	assertAutomationLaneIdentitiesUniqueV21,
	normalizeAutomationLaneV21,
	type AutomationLaneV21,
} from './automation-lane-v21.ts';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from './closed-domain-value.ts';
import {
	normalizeMixerGraphV21,
	validateMixerGraphV21,
	type MixerGraphV21,
} from './mixer-graph-v21.ts';
import {
	normalizeVideoCaptionTrackV1,
	type VideoCaptionTrackV1,
} from './video-caption-track-v27.ts';
import {
	normalizeVideoColorContextV1,
	normalizeVideoSourceColorInterpretationV1,
	type VideoColorContextV1,
	type VideoSourceColorInterpretationV1,
} from './video-color-management-v27.ts';
import {
	normalizeVideoMotionAnalysisReferenceV1,
	normalizeVideoProcessorStackV1,
	type VideoMotionAnalysisReferenceV1,
	type VideoProcessorStackV1,
} from './video-motion-model-v27.ts';
import {
	normalizeVideoVisualPresentationV1,
	type VideoVisualPresentationV1,
} from './video-visual-presentation-v27.ts';
import {
	requireUnifiedExactRenderIdentity,
	type UnifiedExactRenderIdentityIndex,
	type UnifiedExactRenderIdentityKind,
} from './unified-exact-render-identity-authority.ts';
import type { UnifiedExactRenderPlanSource } from './unified-exact-render-plan-v9.ts';

export interface UnifiedExactRenderAudioTrackV1 {
	readonly id: string;
	readonly effectIds: readonly string[];
}

export interface UnifiedExactRenderAudioContextV1 {
	readonly audioTracks: readonly UnifiedExactRenderAudioTrackV1[];
	readonly masterEffectIds: readonly string[];
	readonly masterChannels: number;
	readonly automationLanes: readonly AutomationLaneV21[];
	readonly mixer: MixerGraphV21;
}

export interface UnifiedExactRenderFinishingNode {
	readonly kind: 'finishing';
	readonly nodeId: string;
	readonly sequenceId: string;
	readonly colorContext: VideoColorContextV1;
	readonly sourceInterpretations: readonly VideoSourceColorInterpretationV1[];
	readonly visualPresentations: readonly VideoVisualPresentationV1[];
	readonly processorStacks: readonly VideoProcessorStackV1[];
	readonly motionAnalyses: readonly VideoMotionAnalysisReferenceV1[];
	readonly captionTracks: readonly VideoCaptionTrackV1[];
	readonly captionDisposition: 'sidecar-only';
	readonly audioContext: UnifiedExactRenderAudioContextV1;
}

const NODE_FIELDS = Object.freeze([
	'kind', 'nodeId', 'sequenceId', 'colorContext', 'sourceInterpretations',
	'visualPresentations', 'processorStacks', 'motionAnalyses', 'captionTracks',
	'captionDisposition', 'audioContext',
]);
const AUDIO_FIELDS = Object.freeze([
	'audioTracks', 'masterEffectIds', 'masterChannels', 'automationLanes', 'mixer',
]);
const AUDIO_TRACK_FIELDS = Object.freeze(['id', 'effectIds']);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u;

export function normalizeUnifiedExactRenderFinishingNode(
	value: unknown,
	sequenceId: string,
	sourceById: ReadonlyMap<string, UnifiedExactRenderPlanSource>,
): UnifiedExactRenderFinishingNode {
	const name = 'unified V13 finishing node';
	const node = readClosedDomainRecord(value, name, NODE_FIELDS);
	exact(field(node, 'kind', name), 'finishing', `${name}.kind`);
	exact(field(node, 'sequenceId', name), sequenceId, `${name}.sequenceId`);
	const colorContext = normalizeVideoColorContextV1(field(node, 'colorContext', name));
	if (colorContext.sequenceId !== sequenceId) {
		throw new ReferenceError('V13 color context does not bind the rendered sequence.');
	}
	const sourceInterpretations = normalizedCollection(
		field(node, 'sourceInterpretations', name), 'V13 source interpretations',
		normalizeVideoSourceColorInterpretationV1, 100_000,
	);
	assertExactSourceInterpretations(sourceInterpretations, sourceById);
	const visualPresentations = uniqueSortedCollection(
		field(node, 'visualPresentations', name), 'V13 visual presentations',
		normalizeVideoVisualPresentationV1, 100_000,
	);
	const processorStacks = uniqueSortedCollection(
		field(node, 'processorStacks', name), 'V13 processor stacks',
		normalizeVideoProcessorStackV1, 100_000,
	);
	const motionAnalyses = uniqueSortedCollection(
		field(node, 'motionAnalyses', name), 'V13 motion analyses',
		normalizeVideoMotionAnalysisReferenceV1, 100_000,
	);
	const captionTracks = uniqueSortedCollection(
		field(node, 'captionTracks', name), 'V13 caption tracks',
		normalizeVideoCaptionTrackV1, 10_000,
	);
	if (captionTracks.some((track) => track.sequenceId !== sequenceId)) {
		throw new ReferenceError('Every V13 caption track must bind the rendered sequence.');
	}
	exact(field(node, 'captionDisposition', name), 'sidecar-only', 'V13 caption disposition');
	assertMotionClosure(processorStacks, motionAnalyses, sourceById);
	return Object.freeze({
		kind: 'finishing' as const,
		nodeId: stableId(field(node, 'nodeId', name), `${name}.nodeId`),
		sequenceId,
		colorContext,
		sourceInterpretations: Object.freeze(sourceInterpretations),
		visualPresentations: Object.freeze(visualPresentations),
		processorStacks: Object.freeze(processorStacks),
		motionAnalyses: Object.freeze(motionAnalyses),
		captionTracks: Object.freeze(captionTracks),
		captionDisposition: 'sidecar-only' as const,
		audioContext: normalizeAudioContext(field(node, 'audioContext', name)),
	});
}

export function assertUnifiedExactFinishingReferences(
	node: UnifiedExactRenderFinishingNode,
	identities: UnifiedExactRenderIdentityIndex,
): void {
	const stacks = new Map(node.processorStacks.map((stack) => [stack.id, stack]));
	const masks = new Set<string>();
	for (const presentation of node.visualPresentations) {
		const allowed = PRESENTATION_OWNER_KINDS[presentation.owner.kind];
		const claim = requireUnifiedExactRenderIdentity(
			identities, presentation.owner.id, allowed,
			`visual-presentation ${presentation.id} owner`,
		);
		if (presentation.owner.kind === 'adjustment-layer' && claim.role !== 'adjustment-layer') {
			throw new ReferenceError(`V13 presentation ${presentation.id} owner is not an adjustment layer.`);
		}
		if (presentation.owner.kind === 'mask-matte' && claim.role !== 'mask-matte') {
			throw new ReferenceError(`V13 presentation ${presentation.id} owner is not a mask/matte.`);
		}
		if (presentation.owner.kind === 'generator' && claim.kind !== 'generator-source') {
			throw new ReferenceError(`V13 presentation ${presentation.id} owner is not a generator source.`);
		}
		if (presentation.processorStackId !== null && !stacks.has(presentation.processorStackId)) {
			throw new ReferenceError(`V13 presentation ${presentation.id} references a missing processor stack.`);
		}
		for (const maskId of presentation.maskMatteIds) masks.add(maskId);
	}
	for (const maskId of masks) {
		const claim = requireUnifiedExactRenderIdentity(
			identities, maskId, new Set(['visual-model']), 'presentation mask/matte',
		);
		if (claim.role !== 'mask-matte') throw new ReferenceError(`V13 presentation mask ${maskId} is not a mask/matte.`);
	}
}

function normalizeAudioContext(value: unknown): UnifiedExactRenderAudioContextV1 {
	const name = 'unified V13 audio finishing context';
	const input = readClosedDomainRecord(value, name, AUDIO_FIELDS);
	const audioTracks = uniqueSortedCollection(
		field(input, 'audioTracks', name), 'V13 audio tracks', normalizeAudioTrack, 100_000,
	);
	const masterEffectIds = sortedIds(field(input, 'masterEffectIds', name), 'V13 master effect IDs');
	const masterChannels = positiveInteger(field(input, 'masterChannels', name), 'V13 master channels', 32);
	const automationLanes = uniqueSortedCollection(
		field(input, 'automationLanes', name), 'V13 automation lanes', normalizeAutomationLaneV21, 4_096,
	);
	assertAutomationLaneIdentitiesUniqueV21(automationLanes);
	const mixer = normalizeMixerGraphV21(field(input, 'mixer', name));
	validateMixerGraphV21(mixer, {
		audioTracks: audioTracks.map((track) => ({
			id: track.id, effects: track.effectIds.map((id) => ({ id })),
		})),
		masterEffects: masterEffectIds.map((id) => ({ id })),
		masterChannels,
		mixerNodeEffects: new Map(
			[...mixer.groups, ...mixer.sends, ...mixer.cues].map((strip) => [strip.id, strip.effects]),
		),
	});
	assertAutomationOwners(automationLanes, audioTracks, masterEffectIds, mixer);
	return Object.freeze({
		audioTracks: Object.freeze(audioTracks), masterEffectIds: Object.freeze(masterEffectIds),
		masterChannels, automationLanes: Object.freeze(automationLanes), mixer,
	});
}

function normalizeAudioTrack(value: unknown): UnifiedExactRenderAudioTrackV1 {
	const name = 'unified V13 audio track';
	const input = readClosedDomainRecord(value, name, AUDIO_TRACK_FIELDS);
	return Object.freeze({
		id: stableId(field(input, 'id', name), `${name}.id`),
		effectIds: Object.freeze(sortedIds(field(input, 'effectIds', name), `${name}.effectIds`)),
	});
}

function assertAutomationOwners(
	lanes: readonly AutomationLaneV21[],
	tracks: readonly UnifiedExactRenderAudioTrackV1[],
	masterEffectIds: readonly string[],
	mixer: MixerGraphV21,
): void {
	const trackEffects = new Map(tracks.map((track) => [track.id, new Set(track.effectIds)]));
	const mixerEffects = new Map(
		[...mixer.groups, ...mixer.sends, ...mixer.cues]
			.map((strip) => [strip.id, new Set(strip.effects.map(({ id }) => String(id)))]),
	);
	const edgeIds = new Set(mixer.edges.map(({ id }) => id));
	for (const lane of lanes) {
		if (lane.address.kind === 'edge') {
			if (!edgeIds.has(lane.address.edgeId)) throw new ReferenceError(`V13 automation lane ${lane.id} references a missing mixer edge.`);
			continue;
		}
		const strip = lane.address.strip;
		const effects = strip.kind === 'master' ? new Set(masterEffectIds)
			: strip.kind === 'track' ? trackEffects.get(strip.id) : mixerEffects.get(strip.id);
		if (!effects) throw new ReferenceError(`V13 automation lane ${lane.id} references a missing audio track or mixer owner.`);
		if (lane.address.kind === 'effect' && !effects.has(lane.address.effectId)) {
			throw new ReferenceError(`V13 automation lane ${lane.id} references a missing effect owner.`);
		}
	}
}

function assertExactSourceInterpretations(
	values: readonly VideoSourceColorInterpretationV1[],
	sources: ReadonlyMap<string, UnifiedExactRenderPlanSource>,
): void {
	const actual = new Set(values.map(({ sourceId }) => sourceId));
	if (actual.size !== values.length || actual.size !== sources.size
		|| [...sources.keys()].some((sourceId) => !actual.has(sourceId))) {
		throw new ReferenceError('V13 source interpretations must contain exactly every external picture source.');
	}
}

function assertMotionClosure(
	stacks: readonly VideoProcessorStackV1[],
	analyses: readonly VideoMotionAnalysisReferenceV1[],
	sources: ReadonlyMap<string, UnifiedExactRenderPlanSource>,
): void {
	const stackById = new Map(stacks.map((stack) => [stack.id, stack]));
	const analysisById = new Map(analyses.map((analysis) => [analysis.id, analysis]));
	for (const stack of stacks) {
		if (!sources.has(stack.sourceId)) throw new ReferenceError(`V13 processor stack ${stack.id} references a missing source.`);
		for (const processor of stack.processors) {
			if (!('analysisId' in processor)) continue;
			const analysis = analysisById.get(processor.analysisId);
			if (!analysis || analysis.sourceId !== stack.sourceId || analysis.processorStackId !== stack.id) {
				throw new ReferenceError(`V13 processor ${processor.id} references a missing or mismatched motion analysis.`);
			}
		}
	}
	for (const analysis of analyses) {
		const stack = stackById.get(analysis.processorStackId);
		if (!stack || stack.sourceId !== analysis.sourceId || !sources.has(analysis.sourceId)) {
			throw new ReferenceError(`V13 motion analysis ${analysis.id} has no matching processor stack and source.`);
		}
	}
}

function normalizedCollection<Item>(
	value: unknown,
	name: string,
	normalize: (item: unknown) => Item,
	maximum: number,
): Item[] {
	return readClosedDomainArray(value, name, 0, maximum).map(normalize);
}

function uniqueSortedCollection<Item extends Readonly<{ id: string }>>(
	value: unknown,
	name: string,
	normalize: (item: unknown) => Item,
	maximum: number,
): Item[] {
	const values = normalizedCollection(value, name, normalize, maximum);
	const ids = new Set<string>();
	for (const item of values) {
		if (ids.has(item.id)) throw new RangeError(`${name} contains duplicate identity ${item.id}.`);
		ids.add(item.id);
	}
	return values.sort((left, right) => left.id.localeCompare(right.id));
}

function sortedIds(value: unknown, name: string): string[] {
	const result = readClosedDomainArray(value, name, 0, 100_000)
		.map((item) => stableId(item, name)).sort((left, right) => left.localeCompare(right));
	if (new Set(result).size !== result.length) throw new RangeError(`${name} must be unique.`);
	return result;
}

function field(record: ClosedDomainRecord, key: string, name: string): unknown {
	return readClosedDomainField(record, key, name);
}

function exact<const Value extends string>(value: unknown, expected: Value, name: string): Value {
	if (value !== expected) throw new RangeError(`${name} must be ${expected}.`);
	return expected;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a canonical stable ID.`);
	return value;
}

function positiveInteger(value: unknown, name: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`${name} is outside its bounded positive domain.`);
	}
	return Number(value);
}

const PRESENTATION_OWNER_KINDS: Readonly<Record<
	VideoVisualPresentationV1['owner']['kind'], ReadonlySet<UnifiedExactRenderIdentityKind>
>> = Object.freeze({
	source: new Set<UnifiedExactRenderIdentityKind>(['source']),
	clip: new Set<UnifiedExactRenderIdentityKind>(['clip']),
	'adjustment-layer': new Set<UnifiedExactRenderIdentityKind>(['visual-model']),
	generator: new Set<UnifiedExactRenderIdentityKind>(['generator-source']),
	'mask-matte': new Set<UnifiedExactRenderIdentityKind>(['visual-model']),
});
