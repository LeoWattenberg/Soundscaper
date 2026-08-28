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
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createVideoFreezeFallbackV1 } from '../src/common/editor/video-freeze-v24.ts';
import type { VideoGeneratorDocumentV1 } from '../src/common/editor/video-visual-model-v24.ts';
import {
	createFramescaperProjectUnifiedExactRenderPlanFinishing,
} from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { framescaperProjectVisualFoundationFinishing } from '../src/framescaper/editor-project-finishing-validation.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	createFramescaperProjectFinishing,
} from '../src/framescaper/editor-project-finishing.ts';
import {
	renderAuthority,
	freshness,
	transitionProjectOptions,
	videoFreezeState,
	visualFreshness,
	visualProjectOptions,
} from './helpers/framescaper-unified-render-project-fixture.ts';

const PROFILE = FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE;

test('preview and export share exact dissolve weights and a zero-omission visual ledger', () => {
	const transitionProject = createFramescaperProjectFinishing(PROFILE, transitionProjectOptions());
	const transitionPlan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, transitionProject, {
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

	const importedOptions = visualProjectOptions();
	const visualModel = importedOptions.visualModel as Record<string, unknown>;
	const adjustmentLayers = visualModel.adjustmentLayers as readonly unknown[];
	visualModel.presets = (visualModel.presets as readonly Record<string, unknown>[])
		.map((preset, index) => index === 0 ? {
			...preset,
			authoredStateSha256: fingerprintNativeMediaPlan(adjustmentLayers[0]).sha256,
		} : preset);
	const importedVisualProject = createFramescaperProjectFinishing(PROFILE, importedOptions as never);
	const visualProject = applyFramescaperProjectCommandFinishing(PROFILE, importedVisualProject, {
		type: 'video-visual-presentation/set', presentationId: 'still-presentation',
		expectedPresentation: null,
		presentation: {
			schemaVersion: 1, id: 'still-presentation', owner: { kind: 'clip', id: 'still-clip' },
			enabled: true, opacity: 0.5, blendMode: 'screen', grade: null,
			processorStackId: null, maskMatteIds: [],
		},
	});
	const visualPlan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, visualProject, {
		...renderAuthority(visualProject as unknown as Readonly<Record<string, unknown>>, 30),
		visualFreshnessByModelId: visualFreshness(
			framescaperProjectVisualFoundationFinishing(PROFILE, visualProject),
		),
	});
	const frame = createUnifiedExactRenderVisualPreviewConsumerV13(visualPlan)
		.resolveFrame({ sequencePosition: { num: 12, den: 1 } });
	const exportFrame = createUnifiedExactRenderVisualExportConsumerV13(visualPlan)
		.resolveFrame({ sequencePosition: { num: 12, den: 1 } });
	assert.deepEqual(frame, exportFrame, 'every maintained consumer receives one exact frame authority');
	assert.deepEqual(frame.layers.flatMap(({ entries }) => entries.map(({ modelId }) => modelId)), ['still-clip']);
	assert.equal(frame.layers[0]?.entries[0]?.opacity, 0.5);
	assert.equal(frame.layers[0]?.entries[0]?.blendMode, 'screen');
	assert.deepEqual(frame.activeAdjustmentLayers.map(({ modelId }) => modelId), ['adjustment']);
	assert.deepEqual(frame.availablePresetIds, ['preset']);
	assert.deepEqual(frame.ledger.omittedNodeIds, []);
	assert.deepEqual(frame.ledger.requestedNodeIds, frame.ledger.consumedNodeIds);
});

test('visual execution honors exact track visibility and fresh video freeze authority', () => {
	const hiddenOptions = transitionProjectOptions();
	(hiddenOptions.tracks as Record<string, unknown>[])[0]!.hidden = true;
	const hiddenProject = createFramescaperProjectFinishing(PROFILE, hiddenOptions);
	const hiddenPlan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, hiddenProject, {
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
	const frozenOptions = visualProjectOptions(createVideoFreezeFallbackV1({
		renderedSourceId: 'video-source', renderedAssetSha256: '12'.repeat(32), ...bound,
	}));
	const frozenProject = createFramescaperProjectFinishing(PROFILE, frozenOptions as never);
	const frozenPlan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, frozenProject, {
		...renderAuthority(frozenProject as unknown as Readonly<Record<string, unknown>>, 30),
		visualFreshnessByModelId: visualFreshness(
			framescaperProjectVisualFoundationFinishing(PROFILE, frozenProject),
		),
	});
	const frozenFrame = createUnifiedExactRenderVisualPreviewConsumerV13(frozenPlan)
		.resolveFrame({ sequencePosition: 2 });
	assert.deepEqual(frozenFrame.activeFreezeNodeIds, ['render:visual:video-freeze:video-source']);
	assert.ok(frozenFrame.ledger.consumedNodeIds.includes('render:visual:video-freeze:video-source'));
});

test('all built-in generator families and still decode materialize deterministic pixels', async () => {
	const generators: readonly Exclude<VideoGeneratorDocumentV1, Readonly<{ kind: 'external-generator' }>>[] = [
		{ kind: 'title', text: 'Title', fontFamily: 'soundscaper-sans', fontSize: 72,
			color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle' },
		{ kind: 'text', text: 'Text', fontFamily: 'soundscaper-mono', fontSize: 72,
			color: '#00ff00ff', horizontalAlign: 'start', verticalAlign: 'start' },
		{ kind: 'shape', shape: 'ellipse', fillColor: '#0000ffff', strokeColor: '#ffffffff', strokeWidth: 4 },
		{ kind: 'solid', color: '#ff0000ff' },
	];
	for (const generator of generators) {
		const first = await materializeBuiltIn(generator);
		const second = await materializeBuiltIn(generator);
		assert.equal(first.pixels.some((value, index) => index % 4 === 3 && value > 0), true, generator.kind);
		assert.deepEqual(first, second, `${generator.kind} materialization must be deterministic`);
	}
	const still = await materializeUnifiedExactRenderVisualEntryV13({
		nodeId: 'visual:still', modelId: 'still-clip', modelKind: 'still', trackId: 'video-track',
		authoredState: {
			source: { schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Still',
				mimeType: 'image/png', storageKey: 'still-storage', contentSha256: 'aa'.repeat(32),
				width: 2, height: 1, hasAlpha: true },
			clip: { schemaVersion: 1, kind: 'still', id: 'still-clip', sourceId: 'still-source',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10 },
		},
		opacity: 1, blendMode: 'normal', masks: [],
	}, { targetWidth: 4, targetHeight: 2, decodeStill: () => Promise.resolve({
		width: 2, height: 1, pixels: Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255]),
	}) });
	assert.deepEqual([...still.pixels.slice(0, 16)], [
		255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255,
	]);
});

test('built-in visual materialization is mask-linked', async () => {
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

async function materializeBuiltIn(
	generator: Exclude<VideoGeneratorDocumentV1, Readonly<{ kind: 'external-generator' }>>,
) {
	return materializeUnifiedExactRenderVisualEntryV13({
		nodeId: `visual:${generator.kind}`, modelId: 'generator-clip',
		modelKind: generator.kind, trackId: 'video-track',
		authoredState: {
			source: { schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Generator',
				width: 64, height: 36, frameRate: { num: 25, den: 1 }, frameCount: 10, generator },
			clip: { schemaVersion: 1, kind: 'generator', id: 'generator-clip', sourceId: 'generator-source',
				sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
				sourceInFrame: 0, sourceFrameCount: 10 },
		},
		opacity: 1, blendMode: 'normal', masks: [],
	}, { targetWidth: 64, targetHeight: 36 });
}
