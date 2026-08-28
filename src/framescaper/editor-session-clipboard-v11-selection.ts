/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectAudioEditorClipboardSourceIds } from '../common/editor/commands/clipboard-codec.ts';
import type { AudioEditorClipboard } from '../common/editor/commands/protocol.ts';
import type { VideoCaptionTrackV1 } from '../common/editor/video-caption-track-v27.ts';
import type {
	VideoColorContextV1,
	VideoSourceColorInterpretationV1,
} from '../common/editor/video-color-management-v27.ts';
import type {
	VideoMotionAnalysisReferenceV1,
	VideoProcessorStackV1,
} from '../common/editor/video-motion-model-v27.ts';
import type { VideoFreezeFallbackV1 } from '../common/editor/video-freeze-v24.ts';
import type { VideoMaskMatteGraphV1 } from '../common/editor/video-mask-matte-v24.ts';
import type { VideoVisualPresetV1 } from '../common/editor/video-visual-preset-v24.ts';
import type {
	VideoAdjustmentLayerV1,
	VideoGeneratorClipV1,
	VideoGeneratorSourceV1,
	VideoStillClipV1,
	VideoStillSourceV1,
} from '../common/editor/video-visual-model-v24.ts';
import type {
	VideoFinishingPresetV1,
	VideoVisualPresentationV1,
} from '../common/editor/video-visual-presentation-v27.ts';
import type { FramescaperProjectFinishing } from './editor-project-finishing.ts';

type DataRecord = Record<string, unknown>;
type VisualSource = VideoStillSourceV1 | VideoGeneratorSourceV1;
type VisualClip = VideoStillClipV1 | VideoGeneratorClipV1;

export interface FramescaperClipboardClipBindingV11 {
	readonly clipId: string;
	readonly descriptorKey: string;
}

export interface FramescaperClipboardSelectionV11 {
	readonly clipBindings: readonly FramescaperClipboardClipBindingV11[];
	readonly visual: Readonly<{
		readonly sources: readonly VisualSource[];
		readonly clips: readonly VisualClip[];
		readonly adjustmentLayers: readonly VideoAdjustmentLayerV1[];
		readonly presets: readonly VideoVisualPresetV1[];
		readonly maskMattes: readonly VideoMaskMatteGraphV1[];
		readonly freezeFallbacks: readonly VideoFreezeFallbackV1[];
	}>;
	readonly colorContexts: readonly VideoColorContextV1[];
	readonly sourceColorInterpretations: readonly VideoSourceColorInterpretationV1[];
	readonly visualPresentations: readonly VideoVisualPresentationV1[];
	readonly processorStacks: readonly VideoProcessorStackV1[];
	readonly motionAnalyses: readonly VideoMotionAnalysisReferenceV1[];
	readonly finishingPresets: readonly VideoFinishingPresetV1[];
	readonly captionTracks: readonly VideoCaptionTrackV1[];
}

/** Walk only the selected descriptor graph; project-global presets/captions never hitchhike. */
export function selectFramescaperClipboardGraphV11(
	project: FramescaperProjectFinishing,
	descriptor: AudioEditorClipboard,
): FramescaperClipboardSelectionV11 {
	const clipBindings = bindDescriptorClips(project, descriptor);
	const selectedClipIds = new Set(clipBindings.map(({ clipId }) => clipId));
	const selectedSourceIds = new Set(collectAudioEditorClipboardSourceIds(descriptor));
	const selectedSequenceIds = new Set(descriptor.tracks.flatMap((track) => (
		typeof track.sourceSequenceId === 'string' ? [track.sourceSequenceId] : []
	)));
	const sources = records(project.sources, 'finishing clipboard sources');
	const sourceById = new Map(sources.map((source) => [id(source, 'source'), source]));
	const clips = records(project.clips, 'finishing clipboard clips');
	for (const clip of clips) {
		if (selectedClipIds.has(id(clip, 'clip'))) selectedSourceIds.add(idRef(clip.sourceId, 'clip source'));
	}
	const presentations = selectPresentations(project.videoVisualPresentations, selectedClipIds, selectedSourceIds);
	const maskIds = new Set(presentations.flatMap(({ maskMatteIds }) => maskMatteIds));
	const masks = (project.videoMaskMattes as readonly VideoMaskMatteGraphV1[])
		.filter(({ id: maskId }) => maskIds.has(maskId));
	for (const mask of masks) for (const input of mask.inputs) selectedSourceIds.add(input.sourceRef);
	const stackIds = new Set(presentations.flatMap(({ processorStackId }) => (
		processorStackId === null ? [] : [processorStackId]
	)));
	const stacks = project.videoProcessorStacks.filter(({ id: stackId }) => stackIds.has(stackId));
	for (const stack of stacks) selectedSourceIds.add(stack.sourceId);
	closeVisualGeneratorSources(sourceById, selectedSourceIds);
	assertTransportableSourceClosure(sourceById, selectedSourceIds, descriptor);
	const analyses = project.videoMotionAnalyses.filter(({ processorStackId }) => stackIds.has(processorStackId));
	const visualSources = sources.filter((source): source is DataRecord & VisualSource => (
		selectedSourceIds.has(id(source, 'source')) && isVisual(source)
	));
	const visualClips = clips.filter((clip): clip is DataRecord & VisualClip => (
		selectedClipIds.has(id(clip, 'clip')) && isVisual(clip)
	));
	return Object.freeze({
		clipBindings,
		visual: Object.freeze({
			sources: Object.freeze([...visualSources]),
			clips: Object.freeze([...visualClips]),
			adjustmentLayers: Object.freeze([]),
			presets: Object.freeze([]),
			maskMattes: Object.freeze([...masks]),
			freezeFallbacks: Object.freeze((project.videoFreezeFallbacks as readonly VideoFreezeFallbackV1[]).filter(
				({ renderedSourceId }) => selectedSourceIds.has(renderedSourceId),
			)),
		}),
		colorContexts: Object.freeze(project.videoColorContexts.filter(
			({ sequenceId }) => selectedSequenceIds.has(sequenceId),
		)),
		sourceColorInterpretations: Object.freeze(project.videoSourceColorInterpretations.filter(
			({ sourceId }) => selectedSourceIds.has(sourceId),
		)),
		visualPresentations: Object.freeze([...presentations]),
		processorStacks: Object.freeze([...stacks]),
		motionAnalyses: Object.freeze([...analyses]),
		finishingPresets: Object.freeze([]),
		captionTracks: Object.freeze([]),
	});
}

/** Validate the exact descriptor-key-to-authored-clip binding carried by V11. */
export function normalizeFramescaperClipboardClipBindingsV11(
	value: unknown,
	descriptor: AudioEditorClipboard,
): readonly FramescaperClipboardClipBindingV11[] {
	if (!Array.isArray(value) || value.length > 100_000) {
		throw new RangeError('V11 clip bindings must be a bounded array.');
	}
	const descriptorKeys = descriptor.tracks.flatMap((track) => track.clips.map((clip) => (
		idRef(clip.key, 'descriptor clip key')
	)));
	const expected = new Set(descriptorKeys);
	const clipIds = new Set<string>();
	const keys = new Set<string>();
	const result = value.map((candidate, index) => {
		const record = exact(candidate, ['clipId', 'descriptorKey'], `V11 clip bindings[${String(index)}]`);
		const clipId = idRef(record.clipId, 'V11 bound clip ID');
		const descriptorKey = idRef(record.descriptorKey, 'V11 bound descriptor key');
		if (!expected.has(descriptorKey)) throw new ReferenceError(`V11 clip binding names unknown key ${descriptorKey}.`);
		if (clipIds.has(clipId) || keys.has(descriptorKey)) throw new RangeError('V11 clip bindings must be one-to-one.');
		clipIds.add(clipId);
		keys.add(descriptorKey);
		return Object.freeze({ clipId, descriptorKey });
	});
	if (keys.size !== expected.size) throw new ReferenceError('V11 clip bindings must cover every descriptor clip exactly.');
	return Object.freeze(result);
}

function bindDescriptorClips(
	project: FramescaperProjectFinishing,
	descriptor: AudioEditorClipboard,
): readonly FramescaperClipboardClipBindingV11[] {
	const tracks = new Map(records(project.tracks, 'finishing clipboard tracks').map((track) => [id(track, 'track'), track]));
	const result: FramescaperClipboardClipBindingV11[] = [];
	for (const descriptorTrack of descriptor.tracks) {
		const track = tracks.get(descriptorTrack.sourceTrackId);
		if (!track || !Array.isArray(track.clipIds)) {
			throw new ReferenceError(`V11 descriptor track ${descriptorTrack.sourceTrackId} is missing.`);
		}
		const candidates = track.clipIds.map((clipId) => idRef(clipId, 'track clip ID'))
			.sort((left, right) => right.length - left.length);
		for (const clip of descriptorTrack.clips) {
			const key = idRef(clip.key, 'descriptor clip key');
			const clipId = candidates.find((candidate) => key.startsWith(`${candidate}:`));
			if (clipId === undefined) throw new ReferenceError(`V11 descriptor key ${key} has no authored clip.`);
			result.push(Object.freeze({ clipId, descriptorKey: key }));
		}
	}
	return normalizeFramescaperClipboardClipBindingsV11(result, descriptor);
}

function selectPresentations(
	values: readonly VideoVisualPresentationV1[],
	clipIds: ReadonlySet<string>,
	sourceIds: ReadonlySet<string>,
): readonly VideoVisualPresentationV1[] {
	const selected = new Map<string, VideoVisualPresentationV1>();
	let changed = true;
	while (changed) {
		changed = false;
		const selectedMaskIds = new Set([...selected.values()].flatMap(({ maskMatteIds }) => maskMatteIds));
		for (const presentation of values) {
			const owner = presentation.owner;
			const reachable = owner.kind === 'clip' ? clipIds.has(owner.id)
				: owner.kind === 'source' || owner.kind === 'generator' ? sourceIds.has(owner.id)
					: owner.kind === 'mask-matte' && selectedMaskIds.has(owner.id);
			if (reachable && !selected.has(presentation.id)) {
				selected.set(presentation.id, presentation);
				changed = true;
			}
		}
	}
	return Object.freeze([...selected.values()]);
}

function closeVisualGeneratorSources(
	sourceById: ReadonlyMap<string, DataRecord>,
	selected: Set<string>,
): void {
	const pending = [...selected];
	const visited = new Set<string>();
	while (pending.length > 0) {
		const sourceId = pending.pop()!;
		if (visited.has(sourceId)) continue;
		visited.add(sourceId);
		const source = sourceById.get(sourceId);
		if (source?.kind !== 'generator') continue;
		const generator = record(source.generator, 'V11 generator document');
		if (generator.kind !== 'external-generator') continue;
		for (const input of records(generator.inputs, 'V11 external generator inputs')) {
			const reference = idRef(input.sourceRef, 'external generator source');
			if (!selected.has(reference)) {
				selected.add(reference);
				pending.push(reference);
			}
		}
	}
}

function assertTransportableSourceClosure(
	sourceById: ReadonlyMap<string, DataRecord>,
	selected: ReadonlySet<string>,
	descriptor: AudioEditorClipboard,
): void {
	const descriptorSources = new Set(collectAudioEditorClipboardSourceIds(descriptor));
	for (const sourceId of selected) {
		const source = sourceById.get(sourceId);
		if (!source) throw new ReferenceError(`V11 selected graph references missing source ${sourceId}.`);
		if (!isVisual(source) && !descriptorSources.has(sourceId)) {
			throw new RangeError(
				`V11 selected graph cannot transport unselected source ${sourceId}; use Scape preservation.`,
			);
		}
	}
}

function isVisual(value: DataRecord): boolean { return value.kind === 'still' || value.kind === 'generator'; }

function exact(value: unknown, fields: readonly string[], name: string): DataRecord {
	const result = record(value, name);
	const keys = Reflect.ownKeys(result);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must carry exactly its schema keys.`);
	}
	return result;
}

function id(value: DataRecord, name: string): string { return idRef(value.id, `${name} ID`); }

function idRef(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable identity.`);
	}
	return value;
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function records(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
