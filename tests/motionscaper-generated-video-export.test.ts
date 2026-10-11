/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planVideoKeyframeOfflineVideoSources } from '../src/common/editor/ui/video-keyframe-offline-video-export-sources.ts';
import { snapshotVideoExportGeneratedSources } from '../src/common/editor/video-export-generated-sources.ts';
import { loadProductVideoExportStrategyOptions } from '../src/common/editor/controller/export/product-video-export-strategy.ts';
import { exportFixture, SOURCE_ID, CLIP_ID } from './helpers/video-keyframe-offline-export-harness.ts';

test('Motion generated video admission keeps encoded-body authority for every ordinary source', async () => {
	const f = await exportFixture();
	const generatedSources = { sourceIds: [SOURCE_ID], resolveSource() { throw new Error('Not acquired during inventory authentication'); } };
	const plan = planVideoKeyframeOfflineVideoSources({ project: f.project, timingBySourceId: f.timing, generatedSources });
	assert.deepEqual(await plan.authenticate([], () => { throw new Error('No encoded timing'); }, { signal: new AbortController().signal, assertCurrent() {} }), []);
	const ordinary = planVideoKeyframeOfflineVideoSources({ project: f.project, timingBySourceId: f.timing });
	await assert.rejects(ordinary.authenticate([], () => { throw new Error('No timing'); }, { signal: new AbortController().signal, assertCurrent() {} }), /every|Blob/u);
	assert.throws(() => planVideoKeyframeOfflineVideoSources({ project: f.project, timingBySourceId: f.timing, generatedSources: { ...generatedSources, sourceIds: ['unowned'] } }), /canonical|visible|source/iu);
});
test('Motion product video strategy loading preserves options and refuses competing or malformed authorities', async () => {
	const ordinary = { title: 'unchanged' }; assert.equal(await loadProductVideoExportStrategyOptions(ordinary), ordinary);
	let loaded = 0;
	const strategy = { createExportProject() { return {}; }, createPlan() { return null; }, async encode() { throw new Error('Not encoded'); }, async encodeToSink() { throw new Error('Not encoded'); } };
	const options = { title: 'retained', async loadProductVideoExportStrategy() { loaded++; return strategy; } };
	assert.equal(loaded, 0); const resolved = await loadProductVideoExportStrategyOptions(options) as Readonly<Record<string, unknown>>;
	assert.equal(loaded, 1); assert.equal(resolved.title, 'retained'); assert.equal(resolved.productVideoExportStrategy, strategy);
	await assert.rejects(loadProductVideoExportStrategyOptions({ ...options, productVideoExportStrategy: strategy }), /one.*authority/iu);
	await assert.rejects(loadProductVideoExportStrategyOptions({ async loadProductVideoExportStrategy() { return {}; } }), /strategy|function/iu);
});
test('Motion generated presentations are checked against canonical identity and geometry and closed on refusal', async () => {
	const f = await exportFixture(); let disposed = 0; let invalid = true;
	const presentation = { sourceId: SOURCE_ID, identity: f.digest, drawable: {} as HTMLCanvasElement, decodedWidth: 64, decodedHeight: 32, displayWidth: 80, displayHeight: 32,
		present() {}, dispose() { disposed++; } };
	const plan = planVideoKeyframeOfflineVideoSources({ project: f.project, timingBySourceId: f.timing,
		generatedSources: { sourceIds: [SOURCE_ID], resolveSource: () => invalid ? { ...presentation, identity: 'a'.repeat(64) } : presentation } });
	const resolver = plan.resolveSource(() => { throw new Error('Encoded resolver must not see a linked picture'); });
	await assert.rejects(async () => await resolver({ sourceId: SOURCE_ID, clipId: CLIP_ID }, { signal: new AbortController().signal }), /identity|canonical/iu); assert.equal(disposed, 1);
	invalid = false; assert.equal(await resolver({ sourceId: SOURCE_ID, clipId: CLIP_ID }, { signal: new AbortController().signal }), presentation);
	await assert.rejects(async () => await resolver({ sourceId: SOURCE_ID, clipId: 'unowned' }, { signal: new AbortController().signal }), /clip|canonical/iu);
	assert.equal(disposed, 1);
});
test('Motion generated export capabilities are closed data and do not silently widen source ownership', () => {
	const resolveSource = () => { throw new Error('Not acquired'); };
	assert.deepEqual(snapshotVideoExportGeneratedSources({ sourceIds: ['one'], resolveSource })?.sourceIds, ['one']);
	assert.throws(() => snapshotVideoExportGeneratedSources({ sourceIds: ['one', 'one'], resolveSource }), /duplicate/iu);
	assert.throws(() => snapshotVideoExportGeneratedSources({ sourceIds: ['one'], resolveSource, ignored: true }), /closed/iu);
	assert.throws(() => snapshotVideoExportGeneratedSources({ get sourceIds() { throw new Error('Getter must not execute'); }, resolveSource }), /data/iu);
});
