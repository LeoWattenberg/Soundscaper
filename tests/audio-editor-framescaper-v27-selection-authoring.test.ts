/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFramescaperProjectCommandV27 } from '../src/framescaper/editor-project-v27-commands.ts';
import { createFramescaperVideoRetimeReverseCommandV20 } from '../src/framescaper/editor-project-v20-retime-command.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import {
	createFramescaperProjectV27,
	reimportFramescaperProjectV27,
} from '../src/framescaper/editor-project-v27.ts';
import {
	createFramescaperSelectedVisualAuthoringModelV27,
} from '../src/framescaper/editor-selected-v27-visual-authoring-model.ts';
import {
	prepareFramescaperSelectedVisualAuthoringV27,
} from '../src/framescaper/editor-selected-v27-visual-authoring-commands.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';
import { visualProject } from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('dissolve authoring uses the explicit adjacent pair and moves both linked A/V occurrences', async () => {
	const project = linkedPairProject();
	const model = createFramescaperSelectedVisualAuthoringModelV27({
		surface: 'video-transition-dissolve', project,
		selectedClipId: 'incoming-video', playheadSample: 48_000,
	});
	assert.equal(model.transitionPairs.length, 1);
	assert.equal(model.transitionPairs[0]?.outgoingClipId, 'outgoing-video');
	assert.equal(model.transitionPairs[0]?.incomingClipId, 'incoming-video');
	assert.equal(model.transitionPairs[0]?.linkedAudio, true);
	const prepared = await prepareFramescaperSelectedVisualAuthoringV27({
		surface: 'video-transition-dissolve', project, store: {} as never,
		request: {
			fence: model.fence, operation: 'apply', pairId: model.transitionPairs[0]!.id,
			durationFrames: 3,
		},
	});
	const dissolved = apply(project, prepared.command);
	assert.equal(clip(dissolved, 'incoming-video').sequenceStartFrame, 7);
	assert.equal(clip(dissolved, 'incoming-audio').timelineStartFrame, 33_600);
	assert.equal(record(videoTrack(dissolved).videoTransitions[0]).durationFrames, 3);
	assert.equal(Number(dissolved.revision), Number(project.revision) + 1, 'the batch owns one history step');

	const removeModel = createFramescaperSelectedVisualAuthoringModelV27({
		surface: 'video-transition-dissolve', project: dissolved,
		selectedClipId: 'incoming-video', playheadSample: 36_000,
	});
	const removed = apply(dissolved, (await prepareFramescaperSelectedVisualAuthoringV27({
		surface: 'video-transition-dissolve', project: dissolved, store: {} as never,
		request: {
			fence: removeModel.fence, operation: 'remove', pairId: removeModel.transitionPairs[0]!.id,
			durationFrames: 3,
		},
	})).command);
	assert.equal(clip(removed, 'incoming-video').sequenceStartFrame, 10);
	assert.equal(clip(removed, 'incoming-audio').timelineStartFrame, 48_000);
	assert.deepEqual(videoTrack(removed).videoTransitions, []);
});

test('mask authoring creates or removes the selected clip attachment atomically', async () => {
	const project = reimportFramescaperProjectV27(PROFILE, visualProject());
	const model = createFramescaperSelectedVisualAuthoringModelV27({
		surface: 'video-mask-matte', project,
		selectedClipId: 'generator-clip', playheadSample: 96_000,
	});
	const attached = apply(project, (await prepareFramescaperSelectedVisualAuthoringV27({
		surface: 'video-mask-matte', project, store: {} as never,
		request: {
			fence: model.fence, operation: 'apply', clipId: 'generator-clip',
			maskId: null, shape: 'ellipse', width: 0.5, height: 0.75,
		},
	})).command);
	const presentation = records(attached.videoVisualPresentations).find(({ owner }) => (
		record(owner).kind === 'clip' && record(owner).id === 'generator-clip'
	));
	assert.equal(records(attached.videoMaskMattes).length, 2);
	const attachedId = Array.isArray(presentation?.maskMatteIds) ? presentation.maskMatteIds.at(-1) : null;
	assert.ok(attachedId);
	const attachedMask = records(attached.videoMaskMattes).find(({ id }) => id === attachedId);
	assert.equal(record(records(attachedMask?.nodes)[0]).shape, 'ellipse');

	const removeModel = createFramescaperSelectedVisualAuthoringModelV27({
		surface: 'video-mask-matte', project: attached,
		selectedClipId: 'generator-clip', playheadSample: 96_000,
	});
	const detached = apply(attached, (await prepareFramescaperSelectedVisualAuthoringV27({
		surface: 'video-mask-matte', project: attached, store: {} as never,
		request: {
			fence: removeModel.fence, operation: 'remove', clipId: 'generator-clip',
			maskId: attachedId, shape: 'ellipse', width: 0.5, height: 0.75,
		},
	})).command);
	assert.equal(records(detached.videoMaskMattes).some(({ id }) => id === attachedId), false);
	assert.deepEqual(records(detached.videoVisualPresentations).find(({ owner }) => (
		record(owner).kind === 'clip' && record(owner).id === 'generator-clip'
	))?.maskMatteIds, []);
});

test('adjustment authoring affects, edits, and removes only the selected video occurrence', async () => {
	const project = linkedPairProject();
	const model = createFramescaperSelectedVisualAuthoringModelV27({
		surface: 'video-adjustment-layer', project,
		selectedClipId: 'incoming-video', playheadSample: 48_000,
	});
	const authored = apply(project, (await prepareFramescaperSelectedVisualAuthoringV27({
		surface: 'video-adjustment-layer', project, store: {} as never,
		request: {
			fence: model.fence, operation: 'apply', clipId: 'incoming-video',
			adjustmentLayerId: null, brightness: 0.4,
		},
	})).command);
	const layer = records(authored.videoAdjustmentLayers)[0]!;
	assert.deepEqual(layer.targetTrackIds, ['video-track']);
	assert.equal(layer.sequenceStartFrame, 10);
	assert.equal(layer.sequenceFrameCount, 10);
	const effect = records(clip(authored, 'incoming-video').videoEffects)[0]!;
	assert.equal(record(effect.params).brightness, 0.4);
	assert.deepEqual(records(clip(authored, 'outgoing-video').videoEffects), []);

	const editModel = createFramescaperSelectedVisualAuthoringModelV27({
		surface: 'video-adjustment-layer', project: authored,
		selectedClipId: 'incoming-video', playheadSample: 48_000,
	});
	const edited = apply(authored, (await prepareFramescaperSelectedVisualAuthoringV27({
		surface: 'video-adjustment-layer', project: authored, store: {} as never,
		request: {
			fence: editModel.fence, operation: 'apply', clipId: 'incoming-video',
			adjustmentLayerId: layer.id, brightness: -0.2,
		},
	})).command);
	assert.equal(record(records(clip(edited, 'incoming-video').videoEffects)[0]!.params).brightness, -0.2);

	const removeModel = createFramescaperSelectedVisualAuthoringModelV27({
		surface: 'video-adjustment-layer', project: edited,
		selectedClipId: 'incoming-video', playheadSample: 48_000,
	});
	const removed = apply(edited, (await prepareFramescaperSelectedVisualAuthoringV27({
		surface: 'video-adjustment-layer', project: edited, store: {} as never,
		request: {
			fence: removeModel.fence, operation: 'remove', clipId: 'incoming-video',
			adjustmentLayerId: layer.id, brightness: -0.2,
		},
	})).command);
	assert.deepEqual(removed.videoAdjustmentLayers, []);
	assert.deepEqual(records(clip(removed, 'incoming-video').videoEffects), []);
});

test('visual and finishing presets materialize fresh selected presentation state', async () => {
	let project = reimportFramescaperProjectV27(PROFILE, visualProject());
	let model = createFramescaperSelectedVisualAuthoringModelV27({
		surface: 'video-visual-preset', project,
		selectedClipId: 'generator-clip', playheadSample: 96_000,
	});
	project = apply(project, (await prepareFramescaperSelectedVisualAuthoringV27({
		surface: 'video-visual-preset', project, store: {} as never,
		request: {
			fence: model.fence, operation: 'save-visual', clipId: 'generator-clip',
			presetId: null, name: 'Selected red title',
		},
	})).command);
	const visualPreset = records(project.videoVisualPresets).find(({ name }) => name === 'Selected red title')!;
	const source = records(project.sources).find(({ id }) => id === 'generator-source')!;
	project = apply(project, {
		type: 'video-visual-source/set', sourceId: 'generator-source', expectedSource: source,
		source: { ...source, generator: { ...record(source.generator), color: '#00ff00ff' } },
	});
	model = createFramescaperSelectedVisualAuthoringModelV27({
		surface: 'video-visual-preset', project,
		selectedClipId: 'generator-clip', playheadSample: 96_000,
	});
	project = apply(project, (await prepareFramescaperSelectedVisualAuthoringV27({
		surface: 'video-visual-preset', project, store: {} as never,
		request: {
			fence: model.fence, operation: 'apply-visual', clipId: 'generator-clip',
			presetId: visualPreset.id, name: visualPreset.name,
		},
	})).command);
	assert.equal(record(records(project.sources).find(({ id }) => id === 'generator-source')!.generator).color,
		'#ffffffff');

	project = apply(project, {
		type: 'video-finishing-preset/set', finishingPresetId: 'finish-warm',
		expectedFinishingPreset: null,
		finishingPreset: {
			schemaVersion: 1, kind: 'video-finishing-preset', id: 'finish-warm', name: 'Warm',
			template: { enabled: true, opacity: 0.6, blendMode: 'screen', grade: null },
		},
	});
	model = createFramescaperSelectedVisualAuthoringModelV27({
		surface: 'video-visual-preset', project,
		selectedClipId: 'generator-clip', playheadSample: 96_000,
	});
	const finished = apply(project, (await prepareFramescaperSelectedVisualAuthoringV27({
		surface: 'video-visual-preset', project, store: {} as never,
		request: {
			fence: model.fence, operation: 'apply-finishing', clipId: 'generator-clip',
			presetId: 'finish-warm', name: 'Warm',
		},
	})).command);
	const presentation = records(finished.videoVisualPresentations)
		.find(({ owner }) => record(owner).id === 'generator-clip');
	assert.equal(presentation?.opacity, 0.6);
	assert.equal(presentation?.blendMode, 'screen');
	assert.notEqual(presentation?.id, 'finish-warm', 'preset application owns a fresh presentation identity');
});

test('freeze captures the authenticated reverse-retime ordinal at the playhead and fences stale selection', async () => {
	let project = linkedPairProject();
	project = apply(project, createFramescaperVideoRetimeReverseCommandV20({
		clipId: 'outgoing-video', expectedRetimeMap: null,
	}));
	const playheadSample = 9_600;
	const model = createFramescaperSelectedVisualAuthoringModelV27({
		surface: 'video-freeze', project,
		selectedClipId: 'outgoing-video', playheadSample,
	});
	const captureRequests: unknown[] = [];
	const stored: Blob[] = [];
	const prepared = await prepareFramescaperSelectedVisualAuthoringV27({
		surface: 'video-freeze', project,
		store: {
			writeMediaAsset: (_id: string, blob: Blob) => { stored.push(blob); return Promise.resolve(); },
			deleteMediaAsset: () => Promise.resolve(),
		} as never,
		capture: {
			capture: (request: unknown) => {
				captureRequests.push(request);
				return Promise.resolve({ blob: new Blob(['exact'], { type: 'image/png' }), width: 4, height: 2 });
			},
		},
		request: {
			fence: model.fence, operation: 'create', clipId: 'outgoing-video',
			playheadSample, durationFrames: 2,
		},
	});
	const capture = record(captureRequests[0]);
	assert.equal(capture.timelineSample, playheadSample);
	assert.equal(capture.clipId, 'outgoing-video');
	assert.equal(capture.sourceOrdinal, 7, 'reverse retime selects the exact nonzero picture');
	assert.equal(stored.length, 1);
	const frozen = apply(project, prepared.command);
	const still = records(frozen.clips).find(({ kind }) => kind === 'still');
	assert.equal(still?.sequenceStartFrame, 2);
	assert.equal(still?.sequenceFrameCount, 2);
	assert.equal(records(frozen.videoFreezeFallbacks).length, 1);

	const stale = structuredClone(model.fence) as unknown as Record<string, unknown>;
	stale.selectedClipIds = ['incoming-video'];
	await assert.rejects(() => prepareFramescaperSelectedVisualAuthoringV27({
		surface: 'video-freeze', project, store: {} as never, capture: null,
		request: { fence: stale, operation: 'create', clipId: 'outgoing-video',
			playheadSample, durationFrames: 2 },
	}), /stale.*selection|selection.*changed/iu);
});

test('freeze places the still on the frame containing the playhead, to the clip end', async () => {
	// The captured picture is resolved at the playhead sample with
	// containing-frame semantics, so the still must land on that same frame:
	// nearest-frame rounding placed it one frame after the picture it froze in
	// the second half of every frame cell, and refused the clip's last frame.
	const project = linkedPairProject();
	const freeze = async (playheadSample: number, durationFrames: number) => {
		const model = createFramescaperSelectedVisualAuthoringModelV27({
			surface: 'video-freeze', project,
			selectedClipId: 'outgoing-video', playheadSample,
		});
		return prepareFramescaperSelectedVisualAuthoringV27({
			surface: 'video-freeze', project,
			store: {
				writeMediaAsset: () => Promise.resolve(),
				deleteMediaAsset: () => Promise.resolve(),
			} as never,
			capture: {
				capture: () => Promise.resolve({
					blob: new Blob(['exact'], { type: 'image/png' }), width: 4, height: 2,
				}),
			},
			request: {
				fence: model.fence, operation: 'create', clipId: 'outgoing-video',
				playheadSample, durationFrames,
			},
		});
	};

	// Sample 12600 sits inside frame 2 (9600..14400), past its midpoint.
	const midCell = apply(project, (await freeze(12_600, 2)).command);
	const still = records(midCell.clips).find(({ kind }) => kind === 'still');
	assert.equal(still?.sequenceStartFrame, 2, 'the still sits on the frame whose picture was captured');

	// Sample 47000 sits inside frame 9, the clip's last frame (43200..48000).
	const lastFrame = apply(project, (await freeze(47_000, 1)).command);
	const lastStill = records(lastFrame.clips).find(({ kind }) => kind === 'still');
	assert.equal(lastStill?.sequenceStartFrame, 9, 'the last frame of the clip accepts a freeze');
});

function linkedPairProject() {
	const options = framescaperV20Options();
	const clips = records(options.clips);
	const outgoingVideo = clips.find(({ id }) => id === 'video-clip')!;
	const outgoingAudio = clips.find(({ id }) => id === 'audio-clip')!;
	Object.assign(outgoingVideo, { id: 'outgoing-video', avLinkId: 'av-out' });
	Object.assign(outgoingAudio, { id: 'outgoing-audio', avLinkId: 'av-out' });
	clips.push({
		...structuredClone(outgoingVideo), id: 'incoming-video', avLinkId: 'av-in',
		sequenceStartFrame: 10,
	}, {
		...structuredClone(outgoingAudio), id: 'incoming-audio', avLinkId: 'av-in',
		timelineStartFrame: 48_000,
	});
	options.clips = clips;
	const tracks = records(options.tracks);
	Object.assign(tracks.find(({ id }) => id === 'video-track')!, {
		clipIds: ['outgoing-video', 'incoming-video'], laneGroupId: 'media-lane',
	});
	Object.assign(tracks.find(({ id }) => id === 'audio-track')!, {
		clipIds: ['outgoing-audio', 'incoming-audio'], laneGroupId: 'media-lane',
	});
	return createFramescaperProjectV27(PROFILE, options);
}

function apply(project: unknown, command: unknown) {
	return applyFramescaperProjectCommandV27(PROFILE, project, command, {
		now: '2026-08-23T12:00:00.000Z',
	});
}

function clip(project: unknown, id: string): Record<string, unknown> {
	const found = records(record(project).clips).find((candidate) => candidate.id === id);
	if (!found) throw new ReferenceError(`Missing test clip ${id}.`);
	return found;
}

function videoTrack(project: unknown): Record<string, unknown> & { videoTransitions: unknown[] } {
	const found = records(record(project).tracks).find(({ id }) => id === 'video-track');
	if (!found || !Array.isArray(found.videoTransitions)) throw new ReferenceError('Missing video track.');
	return found as Record<string, unknown> & { videoTransitions: unknown[] };
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected test record.');
	return value as Record<string, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError('Expected test records.');
	return value.map(record);
}
