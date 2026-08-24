/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAddTrackCommand,
	createAddVideoEffectCommand,
	createRemoveVideoEffectCommand,
	createUpdateVideoEffectCommand,
} from '../common/editor/commands/factories.ts';
import { fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import { createStableId } from '../common/editor/stable-id.js';
import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { videoFrameToSampleFrame } from '../common/editor/timeline-time.ts';
import { sequenceFrameAtSample } from '../common/editor/sequence-frame-navigation.ts';
import { createVideoFreezeFallbackV1 } from '../common/editor/video-freeze-v24.ts';
import { resolveVideoRetimeExactPictureOrdinal } from '../common/editor/video-retime-exact-ordinal-authority.ts';
import { createRegisteredVideoRetimeWebCorePreviewResolver } from '../common/editor/video-retime-web-core-preview.ts';
import { normalizeVideoMaskMatteGraphV1 } from '../common/editor/video-mask-matte-v24.ts';
import { normalizeVideoVisualPresetV1 } from '../common/editor/video-visual-preset-v24.ts';
import {
	instantiateVideoFinishingPresetV1,
	normalizeVideoFinishingPresetV1,
	normalizeVideoVisualPresentationV1,
} from '../common/editor/video-visual-presentation-v27.ts';
import {
	assertFramescaperSelectedVisualAuthoringFenceV27,
	createFramescaperSelectedVisualAuthoringModelV27,
	type FramescaperSelectedVisualAuthoringFenceV27,
	type FramescaperSelectedVisualAuthoringSurfaceV27,
} from './editor-selected-v27-visual-authoring-model.ts';

type Data = Readonly<Record<string, unknown>>;

export interface FramescaperSelectedFreezeCaptureRequestV27 {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly timelineSample: number;
	readonly clipId: string;
	readonly sourceId: string;
	readonly sourceOrdinal: number;
}

export interface FramescaperSelectedFreezeCaptureV27 {
	readonly capture: (request: FramescaperSelectedFreezeCaptureRequestV27) => Promise<Readonly<{
		readonly blob: Blob; readonly width: number; readonly height: number;
	}>>;
}

export interface FramescaperSelectedPreparedVisualAuthoringV27 {
	readonly command: unknown;
	readonly rollback?: () => Promise<void>;
}

export interface FramescaperSelectedVisualAuthoringRequestV27 {
	readonly fence: FramescaperSelectedVisualAuthoringFenceV27;
	readonly operation: string;
	readonly clipId?: string;
	readonly pairId?: string;
	readonly durationFrames?: number;
	readonly adjustmentLayerId?: string | null;
	readonly brightness?: number;
	readonly maskId?: string | null;
	readonly shape?: string;
	readonly width?: number;
	readonly height?: number;
	readonly presetId?: string | null;
	readonly name?: string;
	readonly playheadSample?: number;
}

/** Prepare one exact selected-state mutation; the caller must recheck the fence before commit. */
export async function prepareFramescaperSelectedVisualAuthoringV27(input: Readonly<{
	readonly surface: FramescaperSelectedVisualAuthoringSurfaceV27;
	readonly project: unknown;
	readonly store: AudioEditorProjectStore;
	readonly request: FramescaperSelectedVisualAuthoringRequestV27 | unknown;
	readonly capture?: FramescaperSelectedFreezeCaptureV27 | null;
}>): Promise<Readonly<FramescaperSelectedPreparedVisualAuthoringV27>> {
	const project = record(input.project, 'selected visual authoring project');
	if (project.schemaVersion !== 27) throw new RangeError('Selected visual authoring requires Framescaper V27.');
	const request = record(input.request, 'selected visual authoring request');
	const clipId = optionalId(request.clipId, 'selected visual authoring clip ID');
	assertFramescaperSelectedVisualAuthoringFenceV27(project, request.fence, clipId);
	if (input.surface === 'video-transition' || input.surface === 'video-transition-dissolve') {
		return prepared(dissolveCommand(project, request));
	}
	if (input.surface === 'video-mask-matte') return prepared(maskCommand(project, request));
	if (input.surface === 'video-adjustment-layer') return prepared(adjustmentCommand(project, request));
	if (input.surface === 'video-visual-preset') return prepared(visualPresetCommand(project, request));
	if (input.surface === 'video-freeze') {
		return prepareFreeze(project, input.store, request, input.capture ?? null);
	}
	throw new RangeError(`Selected visual authoring does not support ${input.surface}.`);
}

function dissolveCommand(project: Data, request: Data): unknown {
	const operation = oneOf(request.operation, ['apply', 'remove'] as const, 'dissolve operation');
	const pairId = stableId(request.pairId, 'dissolve pair ID');
	const playhead = fencePlayhead(request);
	const model = createFramescaperSelectedVisualAuthoringModelV27({
		surface: 'video-transition-dissolve', project,
		selectedClipId: selectedFenceId(request), playheadSample: playhead,
	});
	const pair = model.transitionPairs.find(({ id }) => id === pairId);
	if (!pair) throw new Error('The selected dissolve pair is stale. Reopen the dialog.');
	const duration = positiveInteger(request.durationFrames, 'dissolve duration');
	if (duration > pair.maximumDurationFrames) throw new RangeError('The dissolve duration exceeds the selected pair.');
	if (operation === 'remove' && pair.transitionId === null) throw new Error('The selected pair has no dissolve to remove.');
	const clips = records(project.clips, 'project clips');
	const outgoing = requireById(clips, pair.outgoingClipId, 'outgoing video clip');
	const incoming = requireById(clips, pair.incomingClipId, 'incoming video clip');
	const sequence = requireById(records(project.sequences, 'project sequences'),
		stableId(incoming.sequenceId, 'incoming sequence ID'), 'incoming sequence');
	const rate = rational(sequence.rate, 'sequence rate');
	const sampleRate = positiveInteger(project.sampleRate, 'project sample rate');
	const outgoingEnd = nonNegativeInteger(outgoing.sequenceStartFrame, 'outgoing start')
		+ positiveInteger(outgoing.sequenceFrameCount, 'outgoing duration');
	const targetFrame = operation === 'remove' ? outgoingEnd : outgoingEnd - duration;
	const oldFrame = nonNegativeInteger(incoming.sequenceStartFrame, 'incoming start');
	if (targetFrame === oldFrame) throw new Error('The selected dissolve already has that duration.');
	const videoMove: Record<string, unknown> = {
		type: 'clip/move', clipId: pair.incomingClipId, trackId: pair.trackId,
		timelineStartFrame: videoFrameToSampleFrame(targetFrame, rate, sampleRate),
	};
	if (operation === 'apply' && pair.transitionId === null) videoMove.videoTransitionAllocations = [{
		trackId: pair.trackId, outgoingClipId: pair.outgoingClipId,
		incomingClipId: pair.incomingClipId, transitionId: createStableId('transition'),
	}];
	const commands: unknown[] = [videoMove];
	const audio = linkedAudioPeer(project, incoming);
	if (audio) {
		const owner = clipOwner(project, stableId(audio.id, 'linked audio clip ID'));
		const oldVideoSample = videoFrameToSampleFrame(oldFrame, rate, sampleRate);
		const targetVideoSample = videoFrameToSampleFrame(targetFrame, rate, sampleRate);
		commands.push({
			type: 'clip/move', clipId: audio.id, trackId: owner.id,
			timelineStartFrame: nonNegativeInteger(audio.timelineStartFrame, 'linked audio start')
				+ targetVideoSample - oldVideoSample,
		});
	}
	return batch(commands);
}

function maskCommand(project: Data, request: Data): unknown {
	const operation = oneOf(request.operation, ['apply', 'remove'] as const, 'mask operation');
	const clip = selectedVisualClip(project, request);
	const currentPresentation = clipPresentation(project, stableId(clip.id, 'selected clip ID'));
	const requestedMaskId = optionalId(request.maskId, 'mask ID');
	if (operation === 'remove') {
		if (!requestedMaskId || !currentPresentation?.maskMatteIds.includes(requestedMaskId)) {
			throw new Error('The selected mask attachment is stale. Reopen the dialog.');
		}
		const mask = requireById(records(project.videoMaskMattes, 'video masks'), requestedMaskId, 'selected mask');
		const presentation = normalizeVideoVisualPresentationV1({
			...currentPresentation,
			maskMatteIds: currentPresentation.maskMatteIds.filter((id) => id !== requestedMaskId),
		});
		const referencedElsewhere = records(project.videoVisualPresentations, 'visual presentations')
			.some((value) => value.id !== currentPresentation.id && Array.isArray(value.maskMatteIds)
				&& value.maskMatteIds.includes(requestedMaskId));
		return batch([
			presentationSet(currentPresentation, presentation),
			...(referencedElsewhere ? [] : [{
				type: 'video-mask-matte/set', maskMatteId: requestedMaskId,
				expectedMaskMatte: mask, maskMatte: null,
			}]),
		]);
	}
	const maskId = requestedMaskId ?? createStableId('mask-matte');
	const currentMask = requestedMaskId === null ? null
		: requireById(records(project.videoMaskMattes, 'video masks'), maskId, 'selected mask');
	const shape = oneOf(request.shape, ['rectangle', 'ellipse', 'line'] as const, 'mask shape');
	const width = bounded(request.width, 0.01, 1, 'mask width');
	const height = bounded(request.height, 0.01, 1, 'mask height');
	const nodeId = currentMask && Array.isArray(currentMask.nodes)
		? stableId(record(currentMask.nodes[0], 'mask node').id, 'mask node ID')
		: createStableId('mask-node');
	const mask = normalizeVideoMaskMatteGraphV1({
		schemaVersion: 1, id: maskId, kind: 'mask', inputs: [],
		nodes: [{ id: nodeId, kind: 'vector-shape', shape,
			x: (1 - width) / 2, y: (1 - height) / 2, width, height }],
		outputNodeId: nodeId,
	});
	const presentation = currentPresentation
		? normalizeVideoVisualPresentationV1({ ...currentPresentation,
			maskMatteIds: [...new Set([...currentPresentation.maskMatteIds, maskId])] })
		: defaultPresentation(stableId(clip.id, 'selected clip ID'), [maskId]);
	return batch([
		{ type: 'video-mask-matte/set', maskMatteId: maskId,
			expectedMaskMatte: currentMask, maskMatte: mask },
		presentationSet(currentPresentation, presentation),
	]);
}

function adjustmentCommand(project: Data, request: Data): unknown {
	const operation = oneOf(request.operation, ['apply', 'remove'] as const, 'adjustment operation');
	const clip = selectedVideoClip(project, request);
	const track = clipOwner(project, stableId(clip.id, 'selected video clip ID'));
	const requestedId = optionalId(request.adjustmentLayerId, 'adjustment layer ID');
	const current = requestedId === null ? null
		: requireById(records(project.videoAdjustmentLayers, 'adjustment layers'), requestedId, 'adjustment layer');
	if (operation === 'remove') {
		if (!current) throw new Error('The selected adjustment layer is stale. Reopen the dialog.');
		const effectId = onlyEffectId(current);
		return batch([{
			type: 'video-adjustment-layer/set', adjustmentLayerId: requestedId,
			expectedAdjustmentLayer: current, adjustmentLayer: null,
		}, createRemoveVideoEffectCommand(stableId(clip.id, 'selected video clip ID'), effectId)]);
	}
	const brightness = bounded(request.brightness, -1, 1, 'adjustment brightness');
	if (current) {
		const effectId = onlyEffectId(current);
		return createUpdateVideoEffectCommand(stableId(clip.id, 'selected video clip ID'),
			effectId, { params: { brightness } });
	}
	const id = createStableId('adjustment-layer');
	const effectId = createStableId('adjustment-effect');
	return batch([createAddVideoEffectCommand(stableId(clip.id, 'selected video clip ID'), 'color-adjust', {
		id: effectId, params: { brightness, contrast: 1, saturation: 1, gamma: 1, hueDegrees: 0 },
	}), {
		type: 'video-adjustment-layer/set', adjustmentLayerId: id,
		expectedAdjustmentLayer: null,
		adjustmentLayer: {
			schemaVersion: 1, kind: 'adjustment-layer', id,
			sequenceId: clip.sequenceId,
			sequenceStartFrame: clip.sequenceStartFrame,
			sequenceFrameCount: clip.sequenceFrameCount,
			targetTrackIds: [track.id], effectIds: [effectId],
		},
	}]);
}

function visualPresetCommand(project: Data, request: Data): unknown {
	const operation = oneOf(request.operation, [
		'save-visual', 'apply-visual', 'remove-visual', 'apply-finishing', 'remove-finishing',
	] as const, 'visual preset operation');
	if (operation === 'remove-visual') {
		const preset = visualPreset(project, stableId(request.presetId, 'visual preset ID'));
		return { type: 'video-visual-preset/set', presetId: preset.id,
			expectedPreset: preset, preset: null };
	}
	if (operation === 'remove-finishing') {
		const preset = finishingPreset(project, stableId(request.presetId, 'finishing preset ID'));
		return { type: 'video-finishing-preset/set', finishingPresetId: preset.id,
			expectedFinishingPreset: preset, finishingPreset: null };
	}
	const clip = selectedVisualClip(project, request);
	if (operation === 'save-visual') return saveGeneratorPreset(project, clip, request);
	if (operation === 'apply-visual') return applyGeneratorPreset(project, clip, request);
	const preset = finishingPreset(project, stableId(request.presetId, 'finishing preset ID'));
	const current = clipPresentation(project, stableId(clip.id, 'selected clip ID'));
	const next = instantiateVideoFinishingPresetV1(preset, {
		presentationId: createStableId('visual-presentation'),
		owner: { kind: 'clip', id: stableId(clip.id, 'selected clip ID') },
	});
	return batch([
		...(current ? [presentationSet(current, null)] : []),
		presentationSet(null, next),
	]);
}

function saveGeneratorPreset(project: Data, clip: Data, request: Data): unknown {
	if (clip.kind !== 'generator') throw new Error('Select a generator before saving a visual preset.');
	const source = selectedSource(project, clip, 'generator');
	const donorId = createStableId('visual-preset-model');
	const donorClipId = createStableId('visual-preset-model-clip');
	const donor = { ...structuredClone(source), id: donorId,
		name: `${safeName(request.name, 'visual preset name')} Model` };
	const donorClip = { ...structuredClone(clip), id: donorClipId, sourceId: donorId };
	const presetId = createStableId('visual-preset');
	const preset = normalizeVideoVisualPresetV1({
		schemaVersion: 1, kind: 'video-preset', id: presetId,
		name: safeName(request.name, 'visual preset name'), modelKind: 'generator',
		authoredStateSha256: fingerprintNativeMediaPlan(donor).sha256,
	});
	return batch([
		{ type: 'video-visual-source/set', sourceId: donorId, expectedSource: null, source: donor },
		{ type: 'video-visual-clip/set', clipId: donorClipId,
			expectedClip: null, expectedPlacement: null, clip: donorClip,
			placement: { scope: 'project-bin' } },
		{ type: 'video-visual-preset/set', presetId, expectedPreset: null, preset },
	]);
}

function applyGeneratorPreset(project: Data, clip: Data, request: Data): unknown {
	if (clip.kind !== 'generator') throw new Error('Select a generator before applying a generator preset.');
	const preset = visualPreset(project, stableId(request.presetId, 'visual preset ID'));
	if (preset.modelKind !== 'generator') throw new Error('The selected preset does not target generators.');
	const donor = records(project.sources, 'project sources').find((source) => (
		source.kind === 'generator'
		&& fingerprintNativeMediaPlan(source).sha256 === preset.authoredStateSha256
	));
	if (!donor) throw new ReferenceError('The visual preset model is unavailable.');
	const current = selectedSource(project, clip, 'generator');
	const source = { ...structuredClone(current), generator: structuredClone(donor.generator) };
	return { type: 'video-visual-source/set', sourceId: current.id,
		expectedSource: current, source };
}

async function prepareFreeze(
	project: Data,
	store: AudioEditorProjectStore,
	request: Data,
	capture: FramescaperSelectedFreezeCaptureV27 | null,
): Promise<Readonly<FramescaperSelectedPreparedVisualAuthoringV27>> {
	oneOf(request.operation, ['create'] as const, 'freeze operation');
	const clip = selectedVideoClip(project, request);
	const playhead = nonNegativeInteger(request.playheadSample, 'freeze playhead sample');
	if (playhead !== fencePlayhead(request)) throw new Error('The freeze playhead is stale. Reopen the dialog.');
	const source = selectedSource(project, clip, 'video');
	const sequence = requireById(records(project.sequences, 'project sequences'),
		stableId(clip.sequenceId, 'selected sequence ID'), 'selected sequence');
	const rate = rational(sequence.rate, 'selected sequence rate');
	const sampleRate = positiveInteger(project.sampleRate, 'project sample rate');
	// The frozen picture resolves at the playhead sample with containing-frame
	// semantics, so the still lands on that same frame: nearest rounding would
	// place it one frame after the picture it freezes in the second half of a
	// cell and refuse the clip's own last frame.
	const sequenceFrame = sequenceFrameAtSample(playhead, rate, sampleRate);
	const start = nonNegativeInteger(clip.sequenceStartFrame, 'selected video start');
	const end = start + positiveInteger(clip.sequenceFrameCount, 'selected video duration');
	if (sequenceFrame < start || sequenceFrame >= end) throw new RangeError('The playhead is outside the selected video.');
	if (!capture) throw new Error('Exact freeze capture is unavailable for the selected preview.');
	const resolver = createRegisteredVideoRetimeWebCorePreviewResolver(project);
	const picture = resolveVideoRetimeExactPictureOrdinal(resolver.authority, {
		outputOrdinal: playhead, clipId: stableId(clip.id, 'selected video clip ID'),
		sourceId: stableId(source.id, 'selected video source ID'),
	});
	const body = await capture.capture({
		projectId: stableId(project.id, 'project ID'),
		projectRevision: nonNegativeInteger(project.revision, 'project revision'),
		timelineSample: playhead,
		clipId: stableId(clip.id, 'selected video clip ID'),
		sourceId: stableId(source.id, 'selected video source ID'),
		sourceOrdinal: picture.sourceOrdinal,
	});
	if (!(body.blob instanceof Blob) || body.blob.type !== 'image/png') {
		throw new TypeError('Exact freeze capture must return a PNG Blob.');
	}
	const width = positiveInteger(body.width, 'freeze width');
	const height = positiveInteger(body.height, 'freeze height');
	const sourceId = createStableId('freeze-source');
	const clipId = createStableId('freeze-clip');
	const trackId = createStableId('freeze-track');
	const duration = positiveInteger(request.durationFrames, 'freeze duration');
	const contentSha256 = await digestMediaContent(body.blob);
	await store.writeMediaAsset(sourceId, body.blob, {
		name: `${safeName(source.name ?? 'Video', 'video source name')} Freeze`,
		mimeType: 'image/png', width, height,
	});
	const stillSource = {
		schemaVersion: 1, kind: 'still', id: sourceId,
		name: `${safeName(source.name ?? 'Video', 'video source name')} Freeze`,
		mimeType: 'image/png', storageKey: sourceId, contentSha256,
		width, height, hasAlpha: true,
	};
	const stillClip = {
		schemaVersion: 1, kind: 'still', id: clipId, sourceId,
		sequenceId: clip.sequenceId, sequenceStartFrame: sequenceFrame,
		sequenceFrameCount: duration,
	};
	const fallback = createVideoFreezeFallbackV1({
		renderedSourceId: sourceId, renderedAssetSha256: contentSha256,
		authoredStateSha256: digest({ schemaVersion: 1, kind: 'video-freeze',
			renderedSourceId: sourceId }),
		inputIdentitiesSha256: digest({ sourceId: source.id,
			contentSha256: source.contentSha256, sourceOrdinal: picture.sourceOrdinal }),
		renderPlanFingerprintSha256: digest({ schemaVersion: 13, sequenceId: clip.sequenceId,
			sequenceFrame, playhead }),
		nativeEffectFingerprintSha256: digest({ nativeEffects: false }),
	});
	return prepared(batch([
		{ ...createAddTrackCommand({ type: 'video', id: trackId,
			name: 'Freeze', laneGroupId: null }), index: 0 },
		{ type: 'video-visual-source/set', sourceId, expectedSource: null, source: stillSource },
		{ type: 'video-visual-clip/set', clipId, expectedClip: null, expectedPlacement: null,
			clip: stillClip, placement: { scope: 'timeline', trackId } },
		{ type: 'video-freeze-fallback/set', renderedSourceId: sourceId,
			expectedFreezeFallback: null, freezeFallback: fallback },
	]), async () => { await store.deleteMediaAsset(sourceId); });
}

function selectedVisualClip(project: Data, request: Data): Data {
	const clipId = stableId(request.clipId, 'selected clip ID');
	const clip = requireById(records(project.clips, 'project clips'), clipId, 'selected clip');
	if (clip.kind !== 'video' && clip.kind !== 'still' && clip.kind !== 'generator') {
		throw new Error('Select a timeline visual clip.');
	}
	return clip;
}

function selectedVideoClip(project: Data, request: Data): Data {
	const clip = selectedVisualClip(project, request);
	if (clip.kind !== 'video') throw new Error('Select a timeline video clip.');
	return clip;
}

function selectedSource(project: Data, clip: Data, kind: string): Data {
	const source = requireById(records(project.sources, 'project sources'),
		stableId(clip.sourceId, 'selected source ID'), 'selected source');
	if (source.kind !== kind) throw new Error(`The selected ${kind} source is unavailable.`);
	return source;
}

function linkedAudioPeer(project: Data, video: Data): Data | null {
	if (typeof video.avLinkId !== 'string') return null;
	const matches = records(project.clips, 'project clips').filter((clip) => (
		clip.kind === 'audio' && clip.avLinkId === video.avLinkId
	));
	if (matches.length > 1) throw new Error('The selected video has ambiguous linked audio.');
	const audio = matches[0] ?? null;
	if (!audio) return null;
	const videoOwner = clipOwner(project, stableId(video.id, 'video clip ID'));
	const audioOwner = clipOwner(project, stableId(audio.id, 'audio clip ID'));
	if (videoOwner.laneGroupId !== audioOwner.laneGroupId) return null;
	return audio;
}

function clipOwner(project: Data, clipId: string): Data {
	const matches = records(project.tracks, 'project tracks').filter((track) => (
		Array.isArray(track.clipIds) && track.clipIds.includes(clipId)
	));
	if (matches.length !== 1 || matches[0]?.locked === true) {
		throw new Error('The selected clip requires one unlocked track owner.');
	}
	return matches[0]!;
}

function clipPresentation(project: Data, clipId: string) {
	const matches = records(project.videoVisualPresentations, 'visual presentations')
		.map(normalizeVideoVisualPresentationV1)
		.filter(({ owner }) => owner.kind === 'clip' && owner.id === clipId);
	if (matches.length > 1) throw new Error('The selected clip has ambiguous visual presentations.');
	return matches[0] ?? null;
}

function defaultPresentation(clipId: string, maskMatteIds: readonly string[]) {
	return normalizeVideoVisualPresentationV1({
		schemaVersion: 1, id: createStableId('visual-presentation'),
		owner: { kind: 'clip', id: clipId }, enabled: true,
		opacity: 1, blendMode: 'normal', grade: null,
		processorStackId: null, maskMatteIds,
	});
}

function presentationSet(expected: ReturnType<typeof normalizeVideoVisualPresentationV1> | null,
	presentation: ReturnType<typeof normalizeVideoVisualPresentationV1> | null) {
	const id = presentation?.id ?? expected?.id;
	if (!id) throw new Error('A presentation set requires an identity.');
	return { type: 'video-visual-presentation/set', presentationId: id,
		expectedPresentation: expected, presentation };
}

function visualPreset(project: Data, id: string) {
	return normalizeVideoVisualPresetV1(requireById(records(project.videoVisualPresets,
		'visual presets'), id, 'visual preset'));
}

function finishingPreset(project: Data, id: string) {
	return normalizeVideoFinishingPresetV1(requireById(records(project.videoFinishingPresets,
		'finishing presets'), id, 'finishing preset'));
}

function onlyEffectId(layer: Data): string {
	if (!Array.isArray(layer.effectIds) || layer.effectIds.length !== 1) {
		throw new Error('The selected adjustment layer requires one owned effect.');
	}
	return stableId(layer.effectIds[0], 'adjustment effect ID');
}

function selectedFenceId(request: Data): string | undefined {
	const fence = record(request.fence, 'selected visual authoring fence');
	return Array.isArray(fence.selectedClipIds) && fence.selectedClipIds.length === 1
		? stableId(fence.selectedClipIds[0], 'fenced selected clip ID') : undefined;
}

function fencePlayhead(request: Data): number {
	return nonNegativeInteger(record(request.fence, 'selected visual authoring fence').playheadSample,
		'fenced authoring playhead sample');
}

function batch(commands: readonly unknown[]): unknown {
	if (commands.length < 1) throw new Error('Selected authoring cannot create an empty history step.');
	return commands.length === 1 ? commands[0] : { type: 'batch', commands };
}

function prepared(command: unknown, rollback?: () => Promise<void>) {
	return Object.freeze({ command, ...(rollback ? { rollback } : {}) });
}

function digest(value: unknown): string {
	return fingerprintNativeMediaPlan(value).sha256;
}

function rational(value: unknown, name: string) {
	const data = record(value, name);
	return Object.freeze({ num: positiveInteger(data.num, `${name} numerator`),
		den: positiveInteger(data.den, `${name} denominator`) });
}

function requireById(values: readonly Data[], id: string, name: string): Data {
	const matches = values.filter((value) => value.id === id);
	if (matches.length !== 1) throw new ReferenceError(`${name} ${id} is missing or ambiguous.`);
	return matches[0]!;
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}

function records(value: unknown, name: string): Data[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((entry, index) => record(entry, `${name}[${String(index)}]`));
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function optionalId(value: unknown, name: string): string | null {
	return value === null || value === undefined ? null : stableId(value, name);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function bounded(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} is outside its finite bound.`);
	}
	return Object.is(value, -0) ? 0 : value;
}

function safeName(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 512
		|| value.normalize('NFC') !== value || /[\r\n\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) {
		throw new TypeError(`${name} must be canonical safe text.`);
	}
	return value;
}

function oneOf<const Values extends readonly string[]>(value: unknown, values: Values, name: string): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new RangeError(`${name} is unsupported.`);
	return value as Values[number];
}
