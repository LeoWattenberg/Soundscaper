/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertUnifiedExactRenderPlanV13, createUnifiedExactRenderPlan, canonicalizeUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { createUnifiedExactRenderPlanV16, assertUnifiedExactRenderPlanV16, canonicalizeUnifiedExactRenderPlanV16 } from '../src/common/editor/unified-exact-render-plan-v16.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV16 } from '../src/framescaper/editor-project-unified-render-plan-v16.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';
import { createUnifiedExactRenderFinishingPreviewConsumerV16, createUnifiedExactRenderFinishingExportConsumerV16 } from '../src/common/editor/unified-exact-render-finishing-consumers-v16.ts';
import { createUnifiedExactRenderVisualPreviewConsumerV16 } from '../src/common/editor/unified-exact-render-visual-consumers-v16.ts';
import { createUnifiedExactRenderFinishingPreviewConsumerV13 } from '../src/common/editor/unified-exact-render-finishing-consumers-v13.ts';

function reference() { return { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 73,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }; }
function base() {
	const project = createFramescaperProjectFinishing(PROFILE, { ...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] } });
	return createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project,
		{ ...renderAuthority(project, 10), visualFreshnessByModelId: new Map() });
}
function candidate() {
	const source = base();
	return { ...source, version: 16, nodes: source.nodes.map(node => node.kind === 'clip' ? { ...node,
		pictureState: { ...node.pictureState, videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: reference() } }] } } : node) };
}

test('current Frame generation16 adapts the real resource project while named legacy finishing retains its strict picture vocabulary', () => {
	const options = framescaperV20Options();
	const project = createFramescaperProjectFinishing(PROFILE, { ...options, videoTransitionsByTrackId: { 'video-track': [] },
		clips: (options.clips as readonly Readonly<Record<string, unknown>>[]).map(clip => clip.id === 'video-clip' ? { ...clip,
			videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: reference() } }] } : clip) });
	const authority = { ...renderAuthority(project, 10), visualFreshnessByModelId: new Map<string, never>() };
	const plan = createFramescaperProjectUnifiedExactRenderPlanV16(PROFILE, project, authority);
	assert.equal(plan.version, 16); assert.doesNotThrow(() => assertUnifiedExactRenderPlanV16(plan));
	assert.deepEqual(plan.nodes.find(node => node.kind === 'clip')?.pictureState.videoEffects[0]?.params.lut, reference());
	assert.throws(() => createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, authority), /unsupported/iu);
});

test('named generation16 admits canonical discrete LUT picture state without broadening selected13 or dormant owners', () => {
	const old = base(), oldBytes = canonicalizeUnifiedExactRenderPlan(old), raw = candidate();
	const current = createUnifiedExactRenderPlanV16(raw);
	assert.equal(current.version, 16); assert.doesNotThrow(() => assertUnifiedExactRenderPlanV16(current));
	const clip = current.nodes.find(node => node.kind === 'clip');
	assert.deepEqual(clip?.pictureState.videoEffects[0]?.params.lut, reference());
	assert.equal(Object.isFrozen(clip?.pictureState.videoEffects[0]?.params.lut), true);
	assert.equal(canonicalizeUnifiedExactRenderPlanV16(current), JSON.stringify(current));
	assert.throws(() => createUnifiedExactRenderPlanV16(old), /16/u);
	assert.throws(() => assertUnifiedExactRenderPlanV13(current));
	assert.throws(() => createUnifiedExactRenderPlan({ ...raw, version: 13 }));
	assert.equal(canonicalizeUnifiedExactRenderPlan(createUnifiedExactRenderPlan(old)), oldBytes);
});

test('generation16 retains selected finishing fences, closed bodies and exact contextual resource refusal', () => {
	const raw = candidate();
	assert.throws(() => createUnifiedExactRenderPlanV16({ ...raw, deliveryProfile: 'new-profile' }));
	assert.throws(() => createUnifiedExactRenderPlanV16({ ...raw, nodes: raw.nodes.filter(node => node.kind !== 'finishing') }), /finishing/u);
	const resources = raw.nodes.map(node => node.kind === 'clip' ? { ...node, pictureState: { ...node.pictureState,
		videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut: { ...reference(), body: 'hidden' } } }] } } : node);
	assert.throws(() => createUnifiedExactRenderPlanV16({ ...raw, nodes: resources }));
	const interpolated = raw.nodes.map(node => node.kind === 'clip' ? { ...node, pictureState: { ...node.pictureState,
		videoKeyframes: { ...node.pictureState.videoKeyframes, curves: [{ target: { kind: 'video-effect', effectId: 'cube', parameterId: 'lut' },
			curve: { anchors: [{ position: { num: 0, den: 1 }, value: 0 }, { position: { num: node.sequenceFrameCount, den: 1 }, value: 1 }], segments: [{ kind: 'linear' }] } }] } } } : node);
	assert.throws(() => createUnifiedExactRenderPlanV16({ ...raw, nodes: interpolated }), /numeric/u);
});

test('named16 finishing and visual consumers preserve the plan and old managed-color pixels without accepting a legacy plan', async () => {
	const old = base(), plan = createUnifiedExactRenderPlanV16(candidate());
	const preview = createUnifiedExactRenderFinishingPreviewConsumerV16(plan), exported = createUnifiedExactRenderFinishingExportConsumerV16(plan);
	const visual = createUnifiedExactRenderVisualPreviewConsumerV16(plan);
	assert.equal(preview.plan, plan); assert.equal(exported.plan, plan); assert.equal(visual.plan, plan);
	assert.throws(() => createUnifiedExactRenderFinishingPreviewConsumerV16(old as never), /16/u);
	assert.throws(() => createUnifiedExactRenderVisualPreviewConsumerV16(old as never), /16/u);
	assert.throws(() => createUnifiedExactRenderFinishingPreviewConsumerV13(plan as never));
	const request = { clipId: 'video-clip', sourceFrame: 0, sequenceFrame: 0,
		frame: { width: 1, height: 1, pixels: new Uint8Array([64, 91, 128, 127]) }, frameEncoding: 'canvas-srgb' as const,
		outputEncoding: 'linear-rec709-d65' as const };
	const expected = await createUnifiedExactRenderFinishingPreviewConsumerV13(old).resolveFrame(request);
	assert.deepEqual(Array.from(expected.pixels), [13, 27, 55, 127]);
	assert.deepEqual(await preview.resolveFrame(request), expected); assert.deepEqual(await exported.resolveFrame(request), expected);
	assert.deepEqual(visual.resolveFrame({ sequencePosition: { num: 0, den: 1 } }),
		createUnifiedExactRenderVisualPreviewConsumerV16(plan).resolveFrame({ sequencePosition: { num: 0, den: 1 } }));
});
