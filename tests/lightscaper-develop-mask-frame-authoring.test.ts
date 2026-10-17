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

function project() { return createFramescaperProjectFinishing(PROFILE, framescaperV20Options()); }
function request(value: unknown, overrides: Readonly<Record<string, unknown>> = {}) {
	return { fence: createFence({ project: value, selectedClipId: 'video-clip', playheadSample: 0 }), clipId: 'video-clip',
		operation: 'apply', maskId: null, shape: 'linear-gradient', startX: 0, startY: 0, endX: 1, endY: 0, ...overrides };
}
function graphs(value: unknown) {
	// The real finishing model validates this extensible field before it reaches this test projection.
	return (value as Readonly<{ videoMaskMattes: readonly unknown[] }>).videoMaskMattes.map(normalizeVideoMaskMatteGraphV1);
}
async function author(value: unknown, input: unknown) {
	const forbidden = new Proxy({} as AudioEditorProjectStore, { get() { throw Error('Scalar mask authoring acquired asset storage'); } });
	return (await prepare({ surface: 'video-mask-matte', project: value, request: input, store: forbidden })).command;
}

test('real Frame selected authoring commits and clones the shared gradient graph with its attached presentation', async () => {
	const initial = project(), command = await author(initial, request(initial));
	const next = applyFramescaperProjectCommandFinishing(PROFILE, initial, command), persisted = cloneFramescaperProjectFinishing(PROFILE, next);
	assert.equal(graphs(initial).length, 0); assert.equal(graphs(persisted).length, 1);
	const mask = graphs(persisted)[0]!;
	assert.deepEqual(mask.nodes, [{ id: mask.outputNodeId, kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(mask, 4, 1)], [32, 96, 159, 223]);
	const model = createModel({ surface: 'video-mask-matte', project: persisted, selectedClipId: 'video-clip', playheadSample: 0 });
	assert.deepEqual(model.attachedMaskIds, [mask.id]); assert.equal(model.selectedMaskId, mask.id);
	assert.deepEqual(model.maskDrafts, [{ id: mask.id, shape: 'linear-gradient', startX: 0, startY: 0, endX: 1, endY: 0 }]);
});

test('updating an attached gradient keeps graph/node identity and leaves the prior saved graph unchanged', async () => {
	const initial = project(), first = applyFramescaperProjectCommandFinishing(PROFILE, initial, await author(initial, request(initial)));
	const before = graphs(first)[0]!, wire = JSON.stringify(before);
	const updated = applyFramescaperProjectCommandFinishing(PROFILE, first, await author(first,
		request(first, { maskId: before.id, startX: 1, endX: 0 })));
	const mask = graphs(cloneFramescaperProjectFinishing(PROFILE, updated))[0]!;
	assert.equal(mask.id, before.id); assert.equal(mask.outputNodeId, before.outputNodeId);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(mask, 4, 1)], [223, 159, 96, 32]);
	assert.equal(JSON.stringify(graphs(first)[0]), wire);
	const removed = applyFramescaperProjectCommandFinishing(PROFILE, updated,
		await author(updated, request(updated, { operation: 'remove', maskId: mask.id })));
	assert.equal(graphs(removed).length, 0);
	assert.deepEqual(createModel({ surface: 'video-mask-matte', project: removed, selectedClipId: 'video-clip', playheadSample: 0 }).attachedMaskIds, []);
});

test('existing rectangle authoring and its centered scalar draft remain unchanged', async () => {
	const initial = project(), next = applyFramescaperProjectCommandFinishing(PROFILE, initial,
		await author(initial, request(initial, { shape: 'rectangle', width: 0.5, height: 0.5 })));
	const mask = graphs(next)[0]!;
	assert.deepEqual(mask.nodes, [{ id: mask.outputNodeId, kind: 'vector-shape', shape: 'rectangle', x: 0.25, y: 0.25, width: 0.5, height: 0.5 }]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(mask, 4, 1)], [0, 255, 255, 0]);
	assert.deepEqual(createModel({ surface: 'video-mask-matte', project: next, selectedClipId: 'video-clip', playheadSample: 0 }).maskDrafts,
		[{ id: mask.id, shape: 'rectangle', width: 0.5, height: 0.5 }]);
});

test('Frame gradient authoring refuses coincident/noncanonical endpoints, accessor fields and a stale project fence', async () => {
	const initial = project(); let getters = 0;
	for (const overrides of [{ endX: 0, endY: 0 }, { startX: NaN }, { endY: Infinity }, { startX: -0 }, { endX: 1_000_001 }]) {
		await assert.rejects(author(initial, request(initial, overrides)));
	}
	const accessor = Object.defineProperty(request(initial), 'startX', { enumerable: true, get() { getters++; return 0; } });
	await assert.rejects(author(initial, accessor)); assert.equal(getters, 0);
	const stale = request(initial), next = applyFramescaperProjectCommandFinishing(PROFILE, initial,
		await author(initial, request(initial, { shape: 'rectangle', width: 0.5, height: 0.5 })));
	await assert.rejects(author(next, stale), /stale|changed|revision/iu);
});
