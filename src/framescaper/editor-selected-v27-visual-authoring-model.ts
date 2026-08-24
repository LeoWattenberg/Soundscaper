/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoVisualPresetV1 } from '../common/editor/video-visual-preset-v24.ts';
import {
	normalizeVideoFinishingPresetV1,
	normalizeVideoVisualPresentationV1,
} from '../common/editor/video-visual-presentation-v27.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';

type Data = Readonly<Record<string, unknown>>;

export const FRAMESCAPER_SELECTED_V27_DIALOG_AUTHORING_SURFACES = Object.freeze([
	'video-transition', 'video-transition-dissolve', 'video-adjustment-layer',
	'video-visual-preset', 'video-mask-matte', 'video-freeze',
] as const);

export type FramescaperSelectedVisualAuthoringSurfaceV27 =
	(typeof FRAMESCAPER_SELECTED_V27_DIALOG_AUTHORING_SURFACES)[number];

export interface FramescaperSelectedVisualAuthoringFenceV27 {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly selectedClipIds: readonly string[];
	readonly projectSelection: string;
	readonly playheadSample: number;
}

export interface FramescaperSelectedTransitionPairV27 {
	readonly id: string;
	readonly trackId: string;
	readonly outgoingClipId: string;
	readonly incomingClipId: string;
	readonly label: string;
	readonly maximumDurationFrames: number;
	readonly durationFrames: number;
	readonly transitionId: string | null;
	readonly linkedAudio: boolean;
}

export interface FramescaperSelectedVisualAuthoringModelV27 {
	readonly surface: FramescaperSelectedVisualAuthoringSurfaceV27;
	readonly title: string;
	readonly description: string;
	readonly fence: FramescaperSelectedVisualAuthoringFenceV27;
	readonly selectedClipId: string | null;
	readonly selectedClipKind: string | null;
	readonly transitionPairs: readonly FramescaperSelectedTransitionPairV27[];
	readonly selectedPairId: string | null;
	readonly adjustmentLayerId: string | null;
	readonly adjustmentBrightness: number;
	readonly attachedMaskIds: readonly string[];
	readonly selectedMaskId: string | null;
	readonly visualPresets: readonly Readonly<{
		readonly id: string; readonly name: string; readonly modelKind: string;
	}>[];
	readonly finishingPresets: readonly Readonly<{ readonly id: string; readonly name: string }>[];
	readonly selectedFreezeSourceId: string | null;
}

const COPY = Object.freeze({
	'video-transition': Object.freeze({ title: 'Video Transition',
		description: 'Choose one exact adjacent picture pair and author or remove its dissolve.' }),
	'video-transition-dissolve': Object.freeze({ title: 'Dissolve Transition',
		description: 'Choose one exact adjacent picture pair and set its dissolve duration.' }),
	'video-adjustment-layer': Object.freeze({ title: 'Selected Video Adjustment Layer',
		description: 'Apply, edit, or remove the adjustment that targets the selected video occurrence.' }),
	'video-visual-preset': Object.freeze({ title: 'Selected Visual Presets',
		description: 'Save, apply, or remove visual and finishing presets through fresh selected state.' }),
	'video-mask-matte': Object.freeze({ title: 'Selected Mask / Matte',
		description: 'Create, edit, attach, or remove a mask on the selected visual presentation.' }),
	'video-freeze': Object.freeze({ title: 'Freeze Selected Video',
		description: 'Capture the exact authenticated picture at the current playhead.' }),
});

export function createFramescaperSelectedVisualAuthoringModelV27(input: Readonly<{
	readonly surface: FramescaperSelectedVisualAuthoringSurfaceV27;
	readonly project: unknown;
	readonly selectedClipId?: unknown;
	readonly playheadSample: unknown;
}>): FramescaperSelectedVisualAuthoringModelV27 {
	const surface = authoringSurface(input?.surface);
	const inputProject = record(input?.project, 'selected V27 authoring project');
	if (inputProject.schemaVersion !== 27 && inputProject.schemaVersion !== 28) {
		throw new RangeError('Selected visual authoring requires Framescaper V27 or V28.');
	}
	const project = record(inputProject.schemaVersion === 28
		? framescaperProjectV27FoundationShapeV28(inputProject) : inputProject,
	'selected V27 authoring foundation');
	const clips = records(project.clips, 'project clips');
	const selectedClipId = selectedId(input.selectedClipId, project, clips);
	const selectedClip = clips.find(({ id }) => id === selectedClipId) ?? null;
	const playheadSample = nonNegativeInteger(input.playheadSample, 'authoring playhead sample');
	const transitionPairs = createTransitionPairs(project, clips);
	const selectedPair = transitionPairs.find((pair) => (
		pair.outgoingClipId === selectedClipId || pair.incomingClipId === selectedClipId
	)) ?? transitionPairs[0] ?? null;
	const presentation = selectedClipId === null ? null : clipPresentation(project, selectedClipId);
	const attachedMaskIds = presentation?.maskMatteIds ?? Object.freeze([]);
	const adjustment = selectedClip?.kind === 'video'
		? selectedAdjustment(project, selectedClip) : null;
	const sourceId = selectedClip?.kind === 'still' ? stableId(selectedClip.sourceId, 'still source ID') : null;
	const freeze = sourceId === null ? null : records(project.videoFreezeFallbacks, 'freeze fallbacks')
		.find(({ renderedSourceId }) => renderedSourceId === sourceId) ?? null;
	return Object.freeze({
		surface,
		title: COPY[surface].title,
		description: COPY[surface].description,
		fence: createFramescaperSelectedVisualAuthoringFenceV27({
			project, selectedClipId, playheadSample,
		}),
		selectedClipId,
		selectedClipKind: typeof selectedClip?.kind === 'string' ? selectedClip.kind : null,
		transitionPairs,
		selectedPairId: selectedPair?.id ?? null,
		adjustmentLayerId: typeof adjustment?.id === 'string' ? adjustment.id : null,
		adjustmentBrightness: adjustmentBrightness(project, selectedClip, adjustment),
		attachedMaskIds,
		selectedMaskId: attachedMaskIds[0] ?? null,
		visualPresets: Object.freeze(records(project.videoVisualPresets, 'visual presets')
			.map(normalizeVideoVisualPresetV1)
			.map(({ id, name, modelKind }) => Object.freeze({ id, name, modelKind }))),
		finishingPresets: Object.freeze(records(project.videoFinishingPresets, 'finishing presets')
			.map(normalizeVideoFinishingPresetV1)
			.map(({ id, name }) => Object.freeze({ id, name }))),
		selectedFreezeSourceId: typeof freeze?.renderedSourceId === 'string'
			? freeze.renderedSourceId : null,
	});
}

export function createFramescaperSelectedVisualAuthoringFenceV27(input: Readonly<{
	readonly project: unknown;
	readonly selectedClipId: string | null;
	readonly playheadSample: number;
}>): FramescaperSelectedVisualAuthoringFenceV27 {
	const project = record(input.project, 'selected V27 authoring project');
	const selectedClipIds = input.selectedClipId === null ? [] : [stableId(
		input.selectedClipId, 'selected clip ID',
	)];
	return Object.freeze({
		projectId: stableId(project.id, 'project ID'),
		projectRevision: nonNegativeInteger(project.revision, 'project revision'),
		selectedClipIds: Object.freeze(selectedClipIds),
		projectSelection: JSON.stringify(project.selection ?? null),
		playheadSample: nonNegativeInteger(input.playheadSample, 'authoring playhead sample'),
	});
}

export function assertFramescaperSelectedVisualAuthoringFenceV27(
	projectValue: unknown,
	fenceValue: unknown,
	selectedClipId?: string | null,
): asserts fenceValue is FramescaperSelectedVisualAuthoringFenceV27 {
	const project = record(projectValue, 'selected V27 authoring project');
	const fence = record(fenceValue, 'selected V27 authoring fence');
	if (fence.projectId !== project.id || fence.projectRevision !== project.revision) {
		throw new Error('The selected visual authoring project is stale. Reopen the dialog.');
	}
	if (fence.projectSelection !== JSON.stringify(project.selection ?? null)) {
		throw new Error('The selected visual authoring selection changed. Reopen the dialog.');
	}
	if (!Array.isArray(fence.selectedClipIds) || fence.selectedClipIds.some((id) => typeof id !== 'string')
		|| (selectedClipId !== undefined && selectedClipId !== null
			&& !fence.selectedClipIds.includes(selectedClipId))) {
		throw new Error('The selected visual authoring has a stale selection. Reopen the dialog.');
	}
	nonNegativeInteger(fence.playheadSample, 'fenced authoring playhead sample');
}

export function assertFramescaperSelectedVisualAuthoringRuntimeFenceV27(input: Readonly<{
	readonly project: unknown;
	readonly fence: unknown;
	readonly selectedClipId: unknown;
	readonly playheadSample: unknown;
}>): void {
	const selectedClipId = input.selectedClipId === null ? null
		: stableId(input.selectedClipId, 'runtime selected clip ID');
	assertFramescaperSelectedVisualAuthoringFenceV27(input.project, input.fence, selectedClipId);
	const fence = input.fence as FramescaperSelectedVisualAuthoringFenceV27;
	const expected = selectedClipId === null ? [] : [selectedClipId];
	if (JSON.stringify(fence.selectedClipIds) !== JSON.stringify(expected)) {
		throw new Error('The selected visual authoring has a stale selection. Reopen the dialog.');
	}
	if (fence.playheadSample !== nonNegativeInteger(input.playheadSample, 'runtime playhead sample')) {
		throw new Error('The selected visual authoring playhead is stale. Reopen the dialog.');
	}
}

function createTransitionPairs(project: Data, clips: readonly Data[]): readonly FramescaperSelectedTransitionPairV27[] {
	const sequences = records(project.sequences, 'project sequences');
	const clipById = new Map(clips.map((clip) => [String(clip.id), clip]));
	const linked = linkedAudioIds(project, clips);
	const result: FramescaperSelectedTransitionPairV27[] = [];
	for (const track of records(project.tracks, 'project tracks')) {
		if (track.type !== 'video' || track.locked === true || !Array.isArray(track.clipIds)) continue;
		const ordered = track.clipIds.map(String).map((id) => clipById.get(id))
			.filter((clip): clip is Data => clip?.kind === 'video')
			.sort((left, right) => Number(left.sequenceStartFrame) - Number(right.sequenceStartFrame));
		const transitions = Array.isArray(track.videoTransitions)
			? records(track.videoTransitions, 'track transitions') : [];
		for (let index = 1; index < ordered.length; index += 1) {
			const outgoing = ordered[index - 1]!;
			const incoming = ordered[index]!;
			if (outgoing.sequenceId !== incoming.sequenceId) continue;
			const sequence = sequences.find(({ id }) => id === outgoing.sequenceId);
			if (!sequence) continue;
			const outgoingCount = positiveInteger(outgoing.sequenceFrameCount, 'outgoing duration');
			const incomingCount = positiveInteger(incoming.sequenceFrameCount, 'incoming duration');
			nonNegativeInteger(outgoing.sequenceStartFrame, 'outgoing start');
			nonNegativeInteger(incoming.sequenceStartFrame, 'incoming start');
			const maximumDurationFrames = Math.max(1, Math.min(
				Math.floor(outgoingCount / 2), Math.floor(incomingCount / 2), 10_000,
			));
			const existing = transitions.find((transition) => transition.outgoingClipId === outgoing.id
				&& transition.incomingClipId === incoming.id);
			const durationFrames = existing
				? positiveInteger(existing.durationFrames, 'transition duration')
				: Math.min(12, maximumDurationFrames);
			result.push(Object.freeze({
				id: `${String(track.id)}:${String(outgoing.id)}:${String(incoming.id)}`,
				trackId: stableId(track.id, 'transition track ID'),
				outgoingClipId: stableId(outgoing.id, 'outgoing clip ID'),
				incomingClipId: stableId(incoming.id, 'incoming clip ID'),
				label: `${String(outgoing.title ?? outgoing.id)} → ${String(incoming.title ?? incoming.id)}`,
				maximumDurationFrames,
				durationFrames: Math.min(durationFrames, maximumDurationFrames),
				transitionId: typeof existing?.id === 'string' ? existing.id : null,
				linkedAudio: linked.has(String(outgoing.id)) && linked.has(String(incoming.id)),
			}));
		}
	}
	return Object.freeze(result);
}

function linkedAudioIds(project: Data, clips: readonly Data[]): ReadonlySet<string> {
	const tracks = records(project.tracks, 'project tracks');
	const ownerByClipId = new Map<string, Data>();
	for (const track of tracks) if (Array.isArray(track.clipIds)) {
		for (const clipId of track.clipIds) ownerByClipId.set(String(clipId), track);
	}
	const audioLinks = new Map(clips.filter(({ kind, avLinkId }) => kind === 'audio'
		&& typeof avLinkId === 'string').map((clip) => [String(clip.avLinkId), clip]));
	return new Set(clips.filter(({ kind, avLinkId }) => kind === 'video' && typeof avLinkId === 'string')
		.filter((clip) => {
			const audio = audioLinks.get(String(clip.avLinkId));
			return Boolean(audio && ownerByClipId.get(String(audio.id))?.laneGroupId
				=== ownerByClipId.get(String(clip.id))?.laneGroupId);
		}).map(({ id }) => String(id)));
}

function selectedAdjustment(project: Data, clip: Data): Data | null {
	const track = records(project.tracks, 'project tracks').find((candidate) => (
		candidate.type === 'video' && Array.isArray(candidate.clipIds)
		&& candidate.clipIds.includes(clip.id)
	));
	if (!track) return null;
	const start = nonNegativeInteger(clip.sequenceStartFrame, 'selected video start');
	const end = start + positiveInteger(clip.sequenceFrameCount, 'selected video duration');
	return records(project.videoAdjustmentLayers, 'adjustment layers').find((layer) => (
		Array.isArray(layer.targetTrackIds) && layer.targetTrackIds.includes(track.id)
		&& Number(layer.sequenceStartFrame) <= start
		&& Number(layer.sequenceStartFrame) + Number(layer.sequenceFrameCount) >= end
	)) ?? null;
}

function adjustmentBrightness(project: Data, clip: Data | null, adjustment: Data | null): number {
	if (clip?.kind !== 'video' || !adjustment || !Array.isArray(adjustment.effectIds)) return 0.25;
	const effects = Array.isArray(clip.videoEffects) ? records(clip.videoEffects, 'selected video effects') : [];
	const effectIds = adjustment.effectIds as readonly unknown[];
	const effect = effects.find(({ id }) => effectIds.includes(id));
	const params = data(effect?.params);
	return typeof params.brightness === 'number' ? params.brightness : 0.25;
}

function clipPresentation(project: Data, clipId: string) {
	const values = records(project.videoVisualPresentations, 'visual presentations')
		.map(normalizeVideoVisualPresentationV1)
		.filter(({ owner }) => owner.kind === 'clip' && owner.id === clipId);
	if (values.length > 1) throw new RangeError('The selected clip has ambiguous visual presentations.');
	return values[0] ?? null;
}

function selectedId(value: unknown, project: Data, clips: readonly Data[]): string | null {
	if (typeof value === 'string' && clips.some(({ id }) => id === value)) return value;
	const selection = data(project.selection);
	const selected = Array.isArray(selection.clipIds) ? selection.clipIds[0] : undefined;
	return Array.isArray(selection.clipIds) && selection.clipIds.length === 1
		&& typeof selected === 'string' && clips.some(({ id }) => id === selected)
		? selected : null;
}

function authoringSurface(value: unknown): FramescaperSelectedVisualAuthoringSurfaceV27 {
	if (!FRAMESCAPER_SELECTED_V27_DIALOG_AUTHORING_SURFACES.includes(value as never)) {
		throw new RangeError('The selected V27 visual authoring surface is unsupported.');
	}
	return value as FramescaperSelectedVisualAuthoringSurfaceV27;
}

function data(value: unknown): Data {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Data : Object.freeze({});
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}

function records(value: unknown, name: string): Data[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}
