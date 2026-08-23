/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createUnifiedExactRenderVisualExportConsumerV13,
	createUnifiedExactRenderVisualPreviewConsumerV13,
} from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import {
	materializeUnifiedExactRenderVisualEntryV13,
} from '../src/common/editor/unified-exact-render-visual-materializer-v13.ts';
import { createVideoFreezeFallbackV1 } from '../src/common/editor/video-freeze-v24.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanV27,
} from '../src/framescaper/editor-project-unified-render-plan-v27.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import {
	createFramescaperProjectV27,
	reimportFramescaperProjectV27,
} from '../src/framescaper/editor-project-v27.ts';
import {
	renderAuthority,
	freshness,
	transitionProjectOptions,
	videoFreezeState,
	visualFreshness,
	visualProject,
} from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('preview and export share exact dissolve weights and a zero-omission visual ledger', () => {
	const transitionProject = createFramescaperProjectV27(PROFILE, transitionProjectOptions());
	const transitionPlan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, transitionProject, {
		...renderAuthority(transitionProject as unknown as Readonly<Record<string, unknown>>, 16),
		visualFreshnessByModelId: new Map(),
	});
	const previewTransition = createUnifiedExactRenderVisualPreviewConsumerV13(transitionPlan)
		.resolveFrame({ sequencePosition: { num: 8, den: 1 } });
	const exportTransition = createUnifiedExactRenderVisualExportConsumerV13(transitionPlan)
		.resolveFrame({ sequencePosition: { num: 8, den: 1 } });
	assert.deepEqual(previewTransition.transitionWeights, exportTransition.transitionWeights);
	assert.deepEqual(previewTransition.transitionWeights, Object.freeze([
		Object.freeze({ clipId: 'incoming-clip', transitionId: 'transition', weight: 0.5 }),
		Object.freeze({ clipId: 'outgoing-clip', transitionId: 'transition', weight: 0.5 }),
	]));

	const foundation = visualProject();
	const visualProjectV27 = reimportFramescaperProjectV27(PROFILE, foundation);
	const visualPlan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, visualProjectV27, {
		...renderAuthority(visualProjectV27 as unknown as Readonly<Record<string, unknown>>, 30),
		visualFreshnessByModelId: visualFreshness(visualProjectV27),
	});
	const frame = createUnifiedExactRenderVisualPreviewConsumerV13(visualPlan)
		.resolveFrame({ sequencePosition: { num: 12, den: 1 } });
	assert.deepEqual(frame.layers.flatMap(({ entries }) => entries.map(({ modelId }) => modelId)), ['still-clip']);
	assert.deepEqual(frame.activeAdjustmentLayers.map(({ modelId }) => modelId), ['adjustment']);
	assert.deepEqual(frame.availablePresetIds, ['preset']);
	assert.deepEqual(frame.ledger.omittedNodeIds, []);
	assert.deepEqual(frame.ledger.requestedNodeIds, frame.ledger.consumedNodeIds);
});

test('visual execution honors exact track visibility and fresh video freeze authority', () => {
	const hiddenOptions = transitionProjectOptions();
	(hiddenOptions.tracks as Record<string, unknown>[])[0]!.hidden = true;
	const hiddenProject = createFramescaperProjectV27(PROFILE, hiddenOptions);
	const hiddenPlan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, hiddenProject, {
		...renderAuthority(hiddenProject as unknown as Readonly<Record<string, unknown>>, 16),
		visualFreshnessByModelId: new Map(),
	});
	const hiddenFrame = createUnifiedExactRenderVisualPreviewConsumerV13(hiddenPlan)
		.resolveFrame({ sequencePosition: 8 });
	assert.deepEqual(hiddenFrame.transitionWeights, []);
	assert.deepEqual(hiddenFrame.ledger, {
		requestedNodeIds: [], consumedNodeIds: [], omittedNodeIds: [],
	});

	const freezeState = videoFreezeState('video-source');
	const bound = freshness(freezeState);
	const frozenFoundation = visualProject(createVideoFreezeFallbackV1({
		renderedSourceId: 'video-source', renderedAssetSha256: '12'.repeat(32), ...bound,
	}));
	const frozenProject = reimportFramescaperProjectV27(PROFILE, frozenFoundation);
	const frozenPlan = createFramescaperProjectUnifiedExactRenderPlanV27(PROFILE, frozenProject, {
		...renderAuthority(frozenProject as unknown as Readonly<Record<string, unknown>>, 30),
		visualFreshnessByModelId: visualFreshness(frozenProject),
	});
	const frozenFrame = createUnifiedExactRenderVisualPreviewConsumerV13(frozenPlan)
		.resolveFrame({ sequencePosition: 2 });
	assert.deepEqual(frozenFrame.activeFreezeNodeIds, ['render:visual:video-freeze:video-source']);
	assert.ok(frozenFrame.ledger.consumedNodeIds.includes('render:visual:video-freeze:video-source'));
});

test('built-in visual materialization is deterministic and mask-linked', async () => {
	const solid = await materializeUnifiedExactRenderVisualEntryV13({
		nodeId: 'visual:solid', modelId: 'solid-clip', modelKind: 'solid', trackId: 'video-track',
		authoredState: {
			source: {
				schemaVersion: 1, kind: 'generator', id: 'solid-source', name: 'Solid',
				width: 4, height: 2, frameRate: { num: 25, den: 1 }, frameCount: 10,
				generator: { kind: 'solid', color: '#ff0000ff' },
			},
			clip: {
				schemaVersion: 1, kind: 'generator', id: 'solid-clip', sourceId: 'solid-source',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
				sourceInFrame: 0, sourceFrameCount: 10,
			},
		},
		opacity: 1, blendMode: 'normal', masks: [{
			schemaVersion: 1, id: 'half-mask', kind: 'mask', inputs: [],
			nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 0.5, height: 1 }],
			outputNodeId: 'shape',
		}],
	}, { targetWidth: 4, targetHeight: 2 });
	assert.equal(solid.width, 4);
	assert.equal(solid.height, 2);
	assert.deepEqual([...solid.pixels.slice(0, 4)], [255, 0, 0, 255]);
	assert.deepEqual([...solid.pixels.slice(3 * 4, 4 * 4)], [255, 0, 0, 0]);

	const again = await materializeUnifiedExactRenderVisualEntryV13({
		nodeId: 'visual:solid', modelId: 'solid-clip', modelKind: 'solid', trackId: 'video-track',
		authoredState: {
			source: {
				schemaVersion: 1, kind: 'generator', id: 'solid-source', name: 'Solid',
				width: 4, height: 2, frameRate: { num: 25, den: 1 }, frameCount: 10,
				generator: { kind: 'solid', color: '#ff0000ff' },
			},
			clip: {
				schemaVersion: 1, kind: 'generator', id: 'solid-clip', sourceId: 'solid-source',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
				sourceInFrame: 0, sourceFrameCount: 10,
			},
		},
		opacity: 1, blendMode: 'normal', masks: [],
	}, { targetWidth: 4, targetHeight: 2 });
	assert.deepEqual([...again.pixels.slice(0, 4)], [255, 0, 0, 255]);
});
