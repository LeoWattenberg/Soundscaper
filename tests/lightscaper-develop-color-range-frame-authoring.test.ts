/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVideoMaskMatteGraphV1 } from '../src/common/editor/video-mask-matte-v24.ts';
import { evaluateVideoMaskMatteRgbaV13 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { prepareFramescaperSelectedVisualAuthoringFinishing as prepare } from '../src/framescaper/editor-selected-finishing-visual-authoring-commands.ts';
import { createFramescaperSelectedVisualAuthoringFenceFinishing as createFence,
	createFramescaperSelectedVisualAuthoringModelFinishing as createModel } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';

function project() { return createFramescaperProjectFinishing(PROFILE, framescaperV20Options()); }
function request(value: unknown, overrides: Readonly<Record<string, unknown>> = {}) {
	return { fence: createFence({ project: value, selectedClipId: 'video-clip', playheadSample: 0 }), clipId: 'video-clip',
		operation: 'apply', maskId: null, shape: 'color-range', red: 1, green: 0, blue: 0, radius: 0, falloff: 1, ...overrides };
}
function graphs(value: unknown) {
	return (value as Readonly<{ videoMaskMattes: readonly unknown[] }>).videoMaskMattes.map(normalizeVideoMaskMatteGraphV1);
}
async function author(value: unknown, input: unknown) {
	const forbidden = new Proxy({} as AudioEditorProjectStore, { get() { throw Error('Scalar range authoring acquired storage'); } });
	return (await prepare({ surface: 'video-mask-matte', project: value, request: input, store: forbidden })).command;
}

test('actual Frame prepare/apply/clone retains a color-range node and complete scalar draft without raster storage', async () => {
	const initial = project(), next = applyFramescaperProjectCommandFinishing(PROFILE, initial, await author(initial, request(initial)));
	const saved = cloneFramescaperProjectFinishing(PROFILE, next), mask = graphs(saved)[0]!;
	assert.deepEqual(graphs(initial), []);
	assert.deepEqual(mask.nodes, [{ id: mask.outputNodeId, kind: 'color-range', color: { r: 1, g: 0, b: 0 }, radius: 0, falloff: 1 }]);
	const frame = rgbaFrame([255, 0, 0, 255, 0, 0, 255, 255]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(mask, 2, 1, new Map(), frame)], [255, 47]);
	const model = createModel({ surface: 'video-mask-matte', project: saved, selectedClipId: 'video-clip', playheadSample: 0 });
	assert.deepEqual(model.attachedMaskIds, [mask.id]); assert.equal(model.selectedMaskId, mask.id);
	assert.deepEqual(model.maskDrafts, [{ id: mask.id, shape: 'color-range', red: 1, green: 0, blue: 0, radius: 0, falloff: 1 }]);
});

test('color range update preserves retained matte identity and prior saved recipe, then removal clears the actual attachment', async () => {
	const initial = project(), first = applyFramescaperProjectCommandFinishing(PROFILE, initial, await author(initial, request(initial))), firstMask = graphs(first)[0]!;
	const matte = applyFramescaperProjectCommandFinishing(PROFILE, first, { type: 'video-mask-matte/set', maskMatteId: firstMask.id,
		expectedMaskMatte: firstMask, maskMatte: { ...firstMask, kind: 'matte' } });
	const before = graphs(matte)[0]!, wire = JSON.stringify(before);
	const updated = applyFramescaperProjectCommandFinishing(PROFILE, matte, await author(matte, request(matte, { maskId: before.id, red: 0, green: 0, blue: 0, radius: 1, falloff: 0 })));
	const mask = graphs(cloneFramescaperProjectFinishing(PROFILE, updated))[0]!;
	assert.equal(mask.kind, 'matte'); assert.equal(mask.id, before.id); assert.equal(mask.outputNodeId, before.outputNodeId);
	assert.deepEqual(mask.nodes, [{ id: before.outputNodeId, kind: 'color-range', color: { r: 0, g: 0, b: 0 }, radius: 1, falloff: 0 }]);
	assert.equal(JSON.stringify(graphs(matte)[0]), wire);
	const removed = applyFramescaperProjectCommandFinishing(PROFILE, updated, await author(updated, request(updated, { operation: 'remove', maskId: mask.id })));
	assert.deepEqual(graphs(removed), []);
	assert.deepEqual(createModel({ surface: 'video-mask-matte', project: removed, selectedClipId: 'video-clip', playheadSample: 0 }).attachedMaskIds, []);
});

test('Frame color scalar admission refuses invalid/accessor fractions and stale project revisions before authoring', async () => {
	const initial = project(); let getters = 0;
	for (const overrides of [{ red: -0 }, { red: NaN }, { green: Infinity }, { blue: -0.1 }, { red: 1.1 },
		{ radius: -0 }, { radius: -0.1 }, { radius: 1.1 }, { falloff: -0 }, { falloff: -0.1 }, { falloff: 1.1 }]) await assert.rejects(author(initial, request(initial, overrides)));
	for (const key of ['red', 'green', 'blue', 'radius', 'falloff']) {
		const accessor = Object.defineProperty(request(initial), key, { enumerable: true, get() { getters++; return 0.1; } });
		await assert.rejects(author(initial, accessor));
	}
	assert.equal(getters, 0);
	const stale = request(initial), next = applyFramescaperProjectCommandFinishing(PROFILE, initial, await author(initial, request(initial)));
	await assert.rejects(author(next, stale), /stale|changed|revision/iu);
});

test('updating a retained multi-node matte keeps its actual output ID rather than the first sorted internal node', async () => {
	const initial = project(), first = applyFramescaperProjectCommandFinishing(PROFILE, initial, await author(initial, request(initial))), firstMask = graphs(first)[0]!;
	const retained = normalizeVideoMaskMatteGraphV1({ ...firstMask, kind: 'matte', outputNodeId: 'z', nodes: [
		{ id: 'a', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 },
		{ id: 'z', kind: 'color-range', color: { r: 1, g: 0, b: 0 }, radius: 0, falloff: 1 },
	] });
	const matte = applyFramescaperProjectCommandFinishing(PROFILE, first, { type: 'video-mask-matte/set', maskMatteId: firstMask.id,
		expectedMaskMatte: firstMask, maskMatte: retained });
	const wire = JSON.stringify(graphs(matte));
	const updated = applyFramescaperProjectCommandFinishing(PROFILE, matte, await author(matte, request(matte, { maskId: retained.id, red: 0, green: 0, blue: 0, radius: 1, falloff: 0 })));
	const mask = graphs(updated)[0]!;
	assert.equal(mask.id, retained.id); assert.equal(mask.kind, 'matte'); assert.equal(mask.outputNodeId, 'z');
	assert.deepEqual(mask.nodes, [{ id: 'z', kind: 'color-range', color: { r: 0, g: 0, b: 0 }, radius: 1, falloff: 0 }]);
	assert.equal(JSON.stringify(graphs(matte)), wire);
});
