/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from '../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { createFramescaperSelectedExactFrameExecutionFinishing } from '../src/framescaper/selected-finishing-exact-frame-execution.ts';
import { materializeFramescaperSelectedOpenFxVisualsNativeMedia } from '../src/framescaper/selected-native-media-openfx-visual-inputs.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { renderAuthority, visualFreshness } from './helpers/framescaper-unified-render-project-fixture.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

const entry: UnifiedExactRenderVisualFrameEntryV13 = {
	nodeId: 'visual:noise', modelId: 'noise-clip', modelKind: 'noise',
	trackId: 'video-track', opacity: 1, blendMode: 'normal', masks: [],
	authoredState: {
		source: {
			schemaVersion: 1, kind: 'generator', id: 'noise-source', name: 'Noise',
			width: 16, height: 12, frameRate: { num: 30, den: 1 }, frameCount: 60,
			generator: { kind: 'noise', mode: 'monochrome', grainSize: 1, seed: 17 },
		},
		clip: {
			schemaVersion: 1, kind: 'generator', id: 'noise-clip', sourceId: 'noise-source',
			sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 60,
			sourceInFrame: 0, sourceFrameCount: 60,
		},
	},
};

test('exact visual plans admit test images and noise as source-backed generator clips', () => {
	for (const generator of [
		{ kind: 'test-image', pattern: 'color-bars' },
		{ kind: 'noise', mode: 'monochrome', grainSize: 1, seed: 17 },
	]) {
		const plan = structuredClone(unifiedExactPlanFixture(10)) as unknown as Record<string, unknown>;
		const visual = (plan.nodes as Record<string, unknown>[]).find((node) => node.kind === 'visual');
		assert.ok(visual);
		visual.modelKind = generator.kind;
		const authoredState = visual.authoredState as Record<string, unknown>;
		const source = authoredState.source as Record<string, unknown>;
		source.generator = generator;
		visual.freshness = {
			...(visual.freshness as Record<string, unknown>),
			authoredStateSha256: fingerprintNativeMediaPlan(authoredState).sha256,
		};
		visual.authoredFallback = null;
		visual.fallbackDisposition = null;
		visual.frozenFallback = null;
		const admitted = createUnifiedExactRenderPlan(plan);
		const node = admitted.nodes.find((candidate) => candidate.kind === 'visual');
		assert.equal(node?.modelKind, generator.kind);
	}
});

test('exact visual inputs pass the selected output ordinal into animated noise', async () => {
	const signal = new AbortController().signal;
	const render = async (outputOrdinal: number) => {
		const result = await materializeFramescaperSelectedOpenFxVisualsNativeMedia(
			[entry], new Map(), 16, 12, 'contain', signal, null, outputOrdinal,
		);
		return result.get('noise-clip')?.pixels;
	};
	const first = await render(10);
	const next = await render(11);
	const same = await render(10);
	assert.ok(first);
	assert.ok(next);
	assert.ok(same);
	assert.deepEqual([...first.subarray(0, 4)], [10, 10, 10, 255],
		'ordinal ten owns the opaque reference grain');
	assert.deepEqual([...next.subarray(0, 4)], [11, 11, 11, 255],
		'ordinal eleven advances the reference grain');
	assert.deepEqual(first, same, 'the same frame ordinal remains deterministic');
});

test('exact picture execution uses delivery ordinals to animate noise', async () => {
	const authored = entry.authoredState;
	if (!('source' in authored)) throw new Error('A generator source is required.');
	const options = framescaperV20Options();
	options.videoTransitionsByTrackId = { 'video-track': [] };
	options.clips = [authored.clip];
	options.tracks = (options.tracks as Record<string, unknown>[]).map((track) => track.id === 'video-track'
		? { ...track, clipIds: ['noise-clip'] } : { ...track, clipIds: [] });
	options.visualModel = {
		stillSources: [], adjustmentLayers: [], presets: [], maskMattes: [], freezeFallbacks: [],
		generatorSources: [authored.source],
	};
	const project = createFramescaperProjectFinishing(PROFILE, options as never);
	const authority = renderAuthority(project, 10);
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, {
		...authority,
		canvas: { ...authority.canvas, width: 16, height: 12 },
		visualFreshnessByModelId: visualFreshness(project as never),
	});
	const signal = new AbortController().signal;
	const exact = await createFramescaperSelectedExactFrameExecutionFinishing({
		project, plan,
		timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsFinishing(project, authority.timingViews),
		signal, assertCurrent() {},
	});
	try {
		const render = async (outputOrdinal: number) => {
			const target = new Uint8Array(16 * 12 * 4);
			await exact.render({
				sequencePosition: { num: 0, den: 1 }, timelineSample: 0, outputOrdinal,
				layers: [], width: 16, height: 12, target, signal,
			});
			return target;
		};
		assert.notDeepEqual(await render(10), await render(11));
		assert.deepEqual(await render(10), await render(10));
	} finally {
		await exact.dispose();
	}
});
