/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectVisual } from '../src/framescaper/editor-project-visual.ts';
import {
	createFramescaperUnifiedRenderFoundation,
	finalizeFramescaperUnifiedRenderPlan,
} from '../src/framescaper/editor-project-unified-render-core.ts';
import { createFramescaperUnifiedVisualRenderNodes } from '../src/framescaper/editor-project-unified-render-visual.ts';
import {
	renderAuthority,
	visualFreshness,
	visualProjectOptions,
} from './helpers/framescaper-unified-render-project-fixture.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

const generator = {
	kind: 'sound-visualizer',
	mode: 'waveform',
	sourceIds: ['audio-b', 'audio-a'],
	windowSeconds: 0.5,
	backgroundColor: '#00000000',
	foregroundColor: '#ffffffff',
} as const;

function source(document: unknown = generator): Record<string, unknown> {
	return {
		schemaVersion: 1, kind: 'generator', id: 'sound-source', name: 'Sound visualizer',
		width: 1_920, height: 1_080, frameRate: { num: 30, den: 1 },
		frameCount: 300, generator: document,
	};
}

test('sound visualizer generator accepts nearest and chosen audio sources with bounded windows', () => {
	const normalized = normalizeVideoGeneratorSourceV1(source());
	assert.deepEqual(normalized.generator, { ...generator, sourceIds: ['audio-a', 'audio-b'] });
	assert.equal(Object.isFrozen(normalized.generator), true);
	if (normalized.generator.kind !== 'sound-visualizer') throw new Error('Expected a sound visualizer.');
	assert.equal(Object.isFrozen(normalized.generator.sourceIds), true);
	assert.deepEqual(normalizeVideoGeneratorSourceV1(source({
		...generator, mode: 'spectrum', sourceIds: [], windowSeconds: 0.01,
	})).generator, { ...generator, mode: 'spectrum', sourceIds: [], windowSeconds: 0.01 });
	const maximum = normalizeVideoGeneratorSourceV1(source({
		...generator, windowSeconds: 10,
	})).generator;
	if (maximum.kind !== 'sound-visualizer') throw new Error('Expected a sound visualizer.');
	assert.equal(maximum.windowSeconds, 10);
});

test('sound visualizer generator rejects unsupported fields and invalid selection', () => {
	for (const document of [
		{ ...generator, mode: 'spectrogram' },
		{ ...generator, sourceIds: ['audio-a', 'audio-a'] },
		{ ...generator, sourceIds: ['audio-a', ''] },
		{ ...generator, sourceIds: 'audio-a' },
		{ ...generator, windowSeconds: 0 },
		{ ...generator, windowSeconds: 10.001 },
		{ ...generator, foregroundColor: '#FFFFFFff' },
		{ ...generator, staticFrame: true },
	]) assert.throws(() => normalizeVideoGeneratorSourceV1(source(document)));
});

test('a sound visualizer survives exact visual plan normalization with its canonical source selection', () => {
	const plan = structuredClone(unifiedExactPlanFixture(10)) as unknown as Record<string, unknown>;
	const visual = (plan.nodes as Record<string, unknown>[]).find((node) => node.kind === 'visual');
	assert.ok(visual);
	visual.modelKind = 'sound-visualizer';
	const authoredState = visual.authoredState as Record<string, unknown>;
	const visualSource = authoredState.source as Record<string, unknown>;
	visualSource.generator = { ...generator, sourceIds: ['audio-a', 'audio-b'] };
	visual.freshness = {
		...(visual.freshness as Record<string, unknown>),
		authoredStateSha256: fingerprintNativeMediaPlan(authoredState).sha256,
	};
	visual.authoredFallback = null;
	visual.fallbackDisposition = null;
	visual.frozenFallback = null;
	const normalized = createUnifiedExactRenderPlan(plan);
	const visualNode = normalized.nodes.find((node) => node.kind === 'visual');
	assert.equal(visualNode?.modelKind, 'sound-visualizer');
	assert.deepEqual(visualNode?.authoredState, authoredState);
});

test('Framescaper projects project placed sound visualizers into exact visual nodes', () => {
	const options = visualProjectOptions();
	const visualModel = options.visualModel as Record<string, unknown>;
	const generatorSource = (visualModel.generatorSources as Record<string, unknown>[])[0]!;
	generatorSource.generator = { ...generator, sourceIds: ['audio-source'] };
	const project = createFramescaperProjectVisual(
		FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE, options,
	);
	const authority = {
		...renderAuthority(project as unknown as Readonly<Record<string, unknown>>, 30),
		visualFreshnessByModelId: visualFreshness(project),
	};
	const foundation = createFramescaperUnifiedRenderFoundation(project, authority, 10);
	const visual = createFramescaperUnifiedVisualRenderNodes(foundation, authority);
	const node = visual.nodes.find((candidate) => candidate.modelId === 'generator-clip');
	assert.equal(node?.modelKind, 'sound-visualizer');
	assert.deepEqual(
		node?.authoredState && 'source' in node.authoredState
			? node.authoredState.source.kind === 'generator'
				? node.authoredState.source.generator : null
			: null,
		{ ...generator, sourceIds: ['audio-source'] },
	);
	const plan = finalizeFramescaperUnifiedRenderPlan(foundation, 10, visual.nodes);
	const visualNode = plan.nodes.find((candidate) => candidate.kind === 'visual'
		&& candidate.modelId === 'generator-clip');
	assert.ok(visualNode?.kind === 'visual');
	assert.equal(visualNode.modelKind, 'sound-visualizer');
});
