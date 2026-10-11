/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareMotionAeHostImport } from '../src/common/editor/motion-ae-host-import-plan.ts';
function fixture() {
	return { format: 'org.motionscaper.ae-exchange', version: 1, transferId: 'transfer-one',
		color: { workingSpace: '', linearBlending: false, bitsPerChannel: 8 },
		footage: [], compositions: [{ id: 'comp', name: 'Composition', width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 1, displayStartTime: 0, background: [0, 0, 0],
			layers: [{ id: 'layer', name: 'Null', kind: 'null', sourceId: null as string | null, parentId: null as string | null, matte: null, startTime: 0, inPoint: 0, outPoint: 1, stretch: 100,
				enabled: true, threeD: false, adjustment: false, blendMode: 'normal', properties: [{ kind: 'group', name: 'Transform', matchName: 'ADBE Transform Group', children: [
					{ kind: 'numeric', matchName: 'ADBE Position', name: 'Position', value: [32, 32], spatial: true, keys: [], expression: { enabled: true, source: 'neverRun()', disposition: 'unsupported' } },
				] }] }] }], report: [] };
}
test('AE import preflight creates only whitelisted transform intent and leaves expressions inert', () => {
	const value = fixture(), plan = prepareMotionAeHostImport(JSON.stringify(value));
	assert.equal(plan.compositions[0]!.layers[0]!.properties[0]!.matchName, 'ADBE Position');
	assert.ok(plan.warnings.some((warning) => /expression/iu.test(warning))); assert.ok(!('expression' in plan.compositions[0]!.layers[0]!.properties[0]!));
	assert.throws(() => prepareMotionAeHostImport(JSON.stringify({ ...value, version: 2 })), /version/u);
	value.compositions[0]!.layers[0]!.parentId = 'layer';
	assert.throws(() => prepareMotionAeHostImport(JSON.stringify(value)), /cycle/u);
});
test('AE import preflight rejects media traversal and unresolved source authority before host mutation', () => {
	const value = fixture();
	assert.throws(() => prepareMotionAeHostImport(JSON.stringify({ ...value, footage: [{ id: 'asset', path: '../movie.mp4', name: 'Video', byteLength: 100 }] })), /path/u);
	value.compositions[0]!.layers[0]!.sourceId = 'missing'; value.compositions[0]!.layers[0]!.kind = 'footage';
	assert.throws(() => prepareMotionAeHostImport(JSON.stringify(value)), /source/u);
});
test('AE import preflight refuses unsupported layer kinds with a rendered-composition action', () => {
	const value = fixture(); value.compositions[0]!.layers[0]!.kind = 'text';
	assert.throws(() => prepareMotionAeHostImport(JSON.stringify(value)), /render.*composition/iu);
});
test('AE host plan refuses constructor and timing values that the documented host rejects or clamps', () => {
	for (const frameRate of [0.5, 100]) { const input = fixture(); input.compositions[0]!.frameRate = frameRate; assert.throws(() => prepareMotionAeHostImport(JSON.stringify(input)), /range/iu); }
	for (const width of [2, 30001]) { const input = fixture(); input.compositions[0]!.width = width; assert.throws(() => prepareMotionAeHostImport(JSON.stringify(input)), /range/iu); }
	for (const stretch of [0.5, -0.5]) { const input = fixture(); input.compositions[0]!.layers[0]!.stretch = stretch; assert.throws(() => prepareMotionAeHostImport(JSON.stringify(input)), /timing/iu); }
	const input = fixture(); input.compositions[0]!.layers[0]!.startTime = -10801; assert.throws(() => prepareMotionAeHostImport(JSON.stringify(input)), /range/iu);
});
