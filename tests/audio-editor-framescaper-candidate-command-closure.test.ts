/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoFreezeFallbackV1 } from '../src/common/editor/video-freeze-v24.ts';
import {
	applyFramescaperProjectCommandV24,
} from '../src/framescaper/editor-project-v24-commands.ts';
import {
	createFramescaperProjectHistoryV24,
	executeFramescaperProjectCommandV24,
	redoFramescaperProjectCommandV24,
	undoFramescaperProjectCommandV24,
} from '../src/framescaper/editor-project-v24-history.ts';
import {
	createFramescaperImageSequenceSourceAdmissionCommandV25,
} from '../src/framescaper/editor-project-v25-commands.ts';
import {
	createFramescaperProjectHistoryV25,
	executeFramescaperProfessionalMediaClipboardPasteV25,
	executeFramescaperProjectCommandV25,
	undoFramescaperProjectCommandV25,
} from '../src/framescaper/editor-project-v25-history.ts';
import {
	createFramescaperProjectHistoryV26,
	executeFramescaperProjectCommandV26,
	undoFramescaperProjectCommandV26,
} from '../src/framescaper/editor-project-v26-history.ts';
import { FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v24.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v25.ts';
import { FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v26.ts';
import { createFramescaperProjectV24 } from '../src/framescaper/editor-project-v24.ts';
import { createFramescaperProjectV25 } from '../src/framescaper/editor-project-v25.ts';
import { createFramescaperProjectV26 } from '../src/framescaper/editor-project-v26.ts';
import { createFramescaperProfessionalMediaClipboardV9 } from '../src/framescaper/editor-session-clipboard-v9.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const V24 = FRAMESCAPER_V24_PROJECT_CANDIDATE_PROFILE;
const V25 = FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE;
const V26 = FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE;
const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const SHA_C = 'cc'.repeat(32);
const SHA_D = 'dd'.repeat(32);

test('V24 history atomically adds, removes, undoes, and redoes every owned visual model', () => {
	const project = createFramescaperProjectV24(V24, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
	});
	const add = visualAddBatch();
	const executed = executeFramescaperProjectCommandV24(
		V24, createFramescaperProjectHistoryV24(V24, project), add,
	);
	assert.deepEqual(executed.present.sources.filter(({ kind }) => kind === 'still' || kind === 'generator')
		.map(({ id }) => id), ['still-added', 'generator-added']);
	assert.deepEqual(executed.present.clips.filter(({ kind }) => kind === 'still' || kind === 'generator')
		.map(({ id }) => id), ['still-clip-added', 'generator-clip-added']);
	assert.equal(executed.present.videoAdjustmentLayers.length, 1);
	assert.equal(executed.present.videoMaskMattes.length, 1);
	assert.equal(executed.present.videoFreezeFallbacks.length, 1);
	assert.equal(Number(executed.present.revision), Number(project.revision) + 1);
	const undone = undoFramescaperProjectCommandV24(V24, executed);
	assert.equal(undone.present.videoAdjustmentLayers.length, 0);
	const redone = redoFramescaperProjectCommandV24(V24, undone);
	assert.equal(redone.present.videoMaskMattes.length, 1);

	const removed = applyFramescaperProjectCommandV24(V24, redone.present, visualRemoveBatch(redone.present));
	assert.equal(removed.sources.some(({ id }) => id === 'still-added'), false);
	assert.equal(removed.clips.some(({ id }) => id === 'generator-clip-added'), false);
	assert.equal(removed.videoFreezeFallbacks.length, 0);
	assert.throws(() => applyFramescaperProjectCommandV24(V24, removed, visualRemoveBatch(redone.present)), /stale/iu);
});

test('V24, V25, and V26 histories dispatch inherited commands without dropping cumulative state', () => {
	const v24 = applyFramescaperProjectCommandV24(V24, createFramescaperProjectV24(V24, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
	}), visualAddBatch());
	const renamed24 = executeFramescaperProjectCommandV24(
		V24, createFramescaperProjectHistoryV24(V24, v24),
		{ type: 'project/rename', title: 'Inherited V22 rename' },
	);
	assert.equal(renamed24.present.title, 'Inherited V22 rename');
	assert.equal(renamed24.present.videoMaskMattes.length, 1);
	const topology24 = executeFramescaperProjectCommandV24(
		V24, createFramescaperProjectHistoryV24(V24, v24),
		{ type: 'clip/remove', clipId: 'video-clip', videoTransitionAllocations: [] },
	);
	assert.equal(topology24.present.clips.some(({ id }) => id === 'video-clip'), false);
	assert.equal(topology24.present.clips.some(({ id }) => id === 'still-clip-added'), true);

	const v25 = createFramescaperProjectV25(V25, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
	});
	const preset = visualPreset('inherited-preset');
	const professionalSources = structuredClone(v25.sources);
	const changed25 = executeFramescaperProjectCommandV25(
		V25, createFramescaperProjectHistoryV25(V25, v25), {
			type: 'video-visual-preset/set', presetId: preset.id,
			expectedPreset: null, preset,
		},
	);
	assert.deepEqual(changed25.present.videoVisualPresets, [preset]);
	assert.deepEqual(changed25.present.sources, professionalSources);
	const undonePresets = undoFramescaperProjectCommandV25(V25, changed25)
		.present.videoVisualPresets;
	assert.equal(Array.isArray(undonePresets) ? undonePresets.length : -1, 0);

	const v26 = createFramescaperProjectV26(V26, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
	});
	const renamed26 = executeFramescaperProjectCommandV26(
		V26, createFramescaperProjectHistoryV26(V26, v26),
		{ type: 'project/rename', title: 'Inherited through V25' },
	);
	assert.equal(renamed26.present.title, 'Inherited through V25');
	assert.equal(undoFramescaperProjectCommandV26(V26, renamed26).present.title, v26.title);
});

test('V25 admits and removes exact image-sequence sources and owns clipboard paste history', () => {
	const project = createFramescaperProjectV25(V25, {
		...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] },
	});
	const source = imageSequenceSource(project);
	const admission = createFramescaperImageSequenceSourceAdmissionCommandV25(source);
	const admitted = executeFramescaperProjectCommandV25(
		V25, createFramescaperProjectHistoryV25(V25, project), admission,
	);
	assert.equal(admitted.present.sources.some(({ id }) => id === 'sequence-source'), true);
	assert.equal(undoFramescaperProjectCommandV25(V25, admitted).present.sources.some(
		({ id }) => id === 'sequence-source',
	), false);
	assert.throws(
		() => executeFramescaperProjectCommandV25(V25, admitted, admission),
		/stale|exists|identity/iu,
	);

	const clipboard = createFramescaperProfessionalMediaClipboardV9(V25, admitted.present, ['sequence-source']);
	const pasted = executeFramescaperProfessionalMediaClipboardPasteV25(
		V25, createFramescaperProjectHistoryV25(V25, project), clipboard,
		{ sourceIdMap: new Map([['sequence-source', 'sequence-copy']]) },
	);
	const copy = pasted.present.sources.find(({ id }) => id === 'sequence-copy');
	assert.equal(copy?.kind, 'video');
	assert.equal((copy as Readonly<{
		readonly imageSequence?: Readonly<{ readonly id?: unknown }>;
	}> | undefined)?.imageSequence?.id, 'sequence-copy');
	assert.equal(undoFramescaperProjectCommandV25(V25, pasted).present.sources.some(
		({ id }) => id === 'sequence-copy',
	), false);

	const removed = executeFramescaperProjectCommandV25(V25, admitted, {
		type: 'video-source/professional-remove', sourceId: source.id, expectedSource: source,
	});
	assert.equal(removed.present.sources.some(({ id }) => id === source.id), false);
});

function visualAddBatch() {
	const still = stillSource();
	const generator = generatorSource();
	return {
		type: 'batch' as const,
		commands: [
			{ type: 'video-visual-source/set', sourceId: still.id, expectedSource: null, source: still },
			{ type: 'video-visual-source/set', sourceId: generator.id, expectedSource: null, source: generator },
			{ type: 'video-visual-clip/set', clipId: 'still-clip-added', expectedClip: null,
				expectedPlacement: null, clip: stillClip(), placement: timelinePlacement() },
			{ type: 'video-visual-clip/set', clipId: 'generator-clip-added', expectedClip: null,
				expectedPlacement: null, clip: generatorClip(), placement: timelinePlacement() },
			{ type: 'video-adjustment-layer/set', adjustmentLayerId: 'adjustment-added',
				expectedAdjustmentLayer: null, adjustmentLayer: adjustmentLayer() },
			{ type: 'video-mask-matte/set', maskMatteId: 'mask-added',
				expectedMaskMatte: null, maskMatte: maskMatte() },
			{ type: 'video-freeze-fallback/set', renderedSourceId: still.id,
				expectedFreezeFallback: null, freezeFallback: freezeFallback() },
		],
	};
}

function visualRemoveBatch(project: ReturnType<typeof createFramescaperProjectV24>) {
	const find = (id: string) => project.clips.find((item) => item.id === id)!;
	return {
		type: 'batch' as const,
		commands: [
			{ type: 'video-visual-clip/set', clipId: 'still-clip-added', expectedClip: find('still-clip-added'),
				expectedPlacement: timelinePlacement(), clip: null, placement: null },
			{ type: 'video-visual-clip/set', clipId: 'generator-clip-added', expectedClip: find('generator-clip-added'),
				expectedPlacement: timelinePlacement(), clip: null, placement: null },
			{ type: 'video-adjustment-layer/set', adjustmentLayerId: 'adjustment-added',
				expectedAdjustmentLayer: project.videoAdjustmentLayers[0], adjustmentLayer: null },
			{ type: 'video-mask-matte/set', maskMatteId: 'mask-added',
				expectedMaskMatte: project.videoMaskMattes[0], maskMatte: null },
			{ type: 'video-freeze-fallback/set', renderedSourceId: 'still-added',
				expectedFreezeFallback: project.videoFreezeFallbacks[0], freezeFallback: null },
			{ type: 'video-visual-source/set', sourceId: 'still-added',
				expectedSource: stillSource(), source: null },
			{ type: 'video-visual-source/set', sourceId: 'generator-added',
				expectedSource: generatorSource(), source: null },
		],
	};
}

function stillSource() {
	return { schemaVersion: 1 as const, kind: 'still' as const, id: 'still-added', name: 'Still',
		mimeType: 'image/png', storageKey: 'still-storage', contentSha256: SHA_A,
		width: 1_920, height: 1_080, hasAlpha: true };
}

function generatorSource() {
	return { schemaVersion: 1 as const, kind: 'generator' as const, id: 'generator-added', name: 'Generator',
		width: 1_920, height: 1_080, frameRate: { num: 10, den: 1 }, frameCount: 10,
		generator: { kind: 'solid' as const, color: '#ffffffff' } };
}

function stillClip() {
	return { schemaVersion: 1 as const, kind: 'still' as const, id: 'still-clip-added',
		sourceId: 'still-added', sequenceId: 'main-sequence', sequenceStartFrame: 20,
		sequenceFrameCount: 10 };
}

function generatorClip() {
	return { schemaVersion: 1 as const, kind: 'generator' as const, id: 'generator-clip-added',
		sourceId: 'generator-added', sequenceId: 'main-sequence', sequenceStartFrame: 30,
		sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10 };
}

function timelinePlacement() { return { scope: 'timeline' as const, trackId: 'video-track' }; }

function adjustmentLayer() {
	return { schemaVersion: 1 as const, kind: 'adjustment-layer' as const, id: 'adjustment-added',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		targetTrackIds: ['video-track'], effectIds: [] };
}

function maskMatte() {
	return { schemaVersion: 1 as const, id: 'mask-added', kind: 'mask' as const,
		inputs: [{ name: 'Source', sourceRef: 'still-added', kind: 'alpha' as const }],
		nodes: [{ id: 'shape', kind: 'vector-shape' as const, shape: 'rectangle' as const,
			x: 0, y: 0, width: 100, height: 100 }], outputNodeId: 'shape' };
}

function freezeFallback() {
	return createVideoFreezeFallbackV1({ renderedSourceId: 'still-added', renderedAssetSha256: SHA_A,
		authoredStateSha256: SHA_A, inputIdentitiesSha256: SHA_B,
		renderPlanFingerprintSha256: SHA_C, nativeEffectFingerprintSha256: SHA_D });
}

function visualPreset(id: string) {
	return { schemaVersion: 1 as const, kind: 'video-preset' as const, id, name: 'Inherited',
		modelKind: 'generator' as const, authoredStateSha256: SHA_A };
}

function imageSequenceSource(project: ReturnType<typeof createFramescaperProjectV25>) {
	const original = structuredClone(project.sources.find(({ id }) => id === 'video-source')!);
	const characteristics = original.characteristics;
	return {
		...original, id: 'sequence-source', name: 'Sequence source',
		storageKey: `image-sequence-pack-sha256:${SHA_A}`, contentSha256: SHA_A,
		imageSequence: {
			kind: 'video' as const, sourceType: 'image-sequence' as const, version: 1 as const,
			id: 'sequence-source', name: 'Sequence source', stem: 'shot_', extension: 'png',
			frameNumberWidth: 4, firstFrameNumber: 1, lastFrameNumber: 10, frameCount: 10,
			frameRate: { num: 10, den: 1 },
			inventory: { kind: 'image-sequence-inventory' as const, version: 1 as const,
				storageKey: `image-sequence-inventory-sha256:${SHA_B}`, sha256: SHA_B,
				byteLength: 512, frameCount: 10, firstFrameNumber: 1, lastFrameNumber: 10 },
			sourcePack: { kind: 'image-sequence-source-pack' as const,
				storageKey: `image-sequence-pack-sha256:${SHA_A}`, sha256: SHA_A, byteLength: 8_192 },
			characteristics,
		},
	};
}
