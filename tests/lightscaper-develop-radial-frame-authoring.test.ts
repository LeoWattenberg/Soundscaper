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
		operation: 'apply', maskId: null, shape: 'radial-gradient', centerX: 0.5, centerY: 0.5, radiusX: 0.5, radiusY: 0.5, innerFraction: 0, ...overrides };
}
function graphs(value: unknown) {
	return (value as Readonly<{ videoMaskMattes: readonly unknown[] }>).videoMaskMattes.map(normalizeVideoMaskMatteGraphV1);
}
async function author(value: unknown, input: unknown) {
	const forbidden = new Proxy({} as AudioEditorProjectStore, { get() { throw Error('Scalar radial authoring acquired asset storage'); } });
	return (await prepare({ surface: 'video-mask-matte', project: value, request: input, store: forbidden })).command;
}

test('actual Frame authoring persists a radial graph and exposes its complete scalar draft', async () => {
	const initial = project(), command = await author(initial, request(initial));
	const next = applyFramescaperProjectCommandFinishing(PROFILE, initial, command), saved = cloneFramescaperProjectFinishing(PROFILE, next);
	assert.equal(graphs(initial).length, 0); assert.equal(graphs(saved).length, 1);
	const mask = graphs(saved)[0]!;
	assert.deepEqual(mask.nodes, [{ id: mask.outputNodeId, kind: 'radial-gradient', center: { x: 0.5, y: 0.5 }, radius: { x: 0.5, y: 0.5 }, innerFraction: 0 }]);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(mask, 5, 1)], [51, 153, 255, 153, 51]);
	const model = createModel({ surface: 'video-mask-matte', project: saved, selectedClipId: 'video-clip', playheadSample: 0 });
	assert.deepEqual(model.attachedMaskIds, [mask.id]); assert.equal(model.selectedMaskId, mask.id);
	assert.deepEqual(model.maskDrafts, [{ id: mask.id, shape: 'radial-gradient', centerX: 0.5, centerY: 0.5, radiusX: 0.5, radiusY: 0.5, innerFraction: 0 }]);
});

test('radial updates preserve identities and the prior graph, and removal clears the actual attachment', async () => {
	const initial = project(), first = applyFramescaperProjectCommandFinishing(PROFILE, initial, await author(initial, request(initial)));
	const before = graphs(first)[0]!, wire = JSON.stringify(before);
	const next = applyFramescaperProjectCommandFinishing(PROFILE, first, await author(first, request(first, { maskId: before.id, innerFraction: 0.5 })));
	const mask = graphs(cloneFramescaperProjectFinishing(PROFILE, next))[0]!;
	assert.equal(mask.id, before.id); assert.equal(mask.outputNodeId, before.outputNodeId);
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(mask, 5, 1)], [102, 255, 255, 255, 102]);
	assert.equal(JSON.stringify(graphs(first)[0]), wire);
	const removed = applyFramescaperProjectCommandFinishing(PROFILE, next, await author(next, request(next, { operation: 'remove', maskId: mask.id })));
	assert.deepEqual(graphs(removed), []);
	assert.deepEqual(createModel({ surface: 'video-mask-matte', project: removed, selectedClipId: 'video-clip', playheadSample: 0 }).attachedMaskIds, []);
});

test('radial Frame commands refuse noncanonical placement, accessors and stale project authority', async () => {
	const initial = project(); let getters = 0;
	for (const overrides of [{ centerX: -0 }, { centerY: NaN }, { centerX: 1_000_001 }, { radiusX: 0 }, { radiusY: -0 },
		{ radiusX: -1 }, { radiusY: Infinity }, { radiusX: 1_000_001 }, { innerFraction: -0 }, { innerFraction: -0.1 }, { innerFraction: 1 }]) {
		await assert.rejects(author(initial, request(initial, overrides)));
	}
	for (const key of ['centerX', 'radiusY', 'innerFraction']) {
		const accessor = Object.defineProperty(request(initial), key, { enumerable: true, get() { getters++; return 0.5; } });
		await assert.rejects(author(initial, accessor));
	}
	assert.equal(getters, 0);
	const stale = request(initial), next = applyFramescaperProjectCommandFinishing(PROFILE, initial, await author(initial, request(initial)));
	await assert.rejects(author(next, stale), /stale|changed|revision/iu);
});

test('existing linear Frame drafts remain unchanged beside a newly authored radial attachment', async () => {
	const initial = project(), linearRequest = { fence: request(initial).fence, clipId: 'video-clip', operation: 'apply', maskId: null,
		shape: 'linear-gradient', startX: 0, startY: 0, endX: 1, endY: 0 };
	const linear = applyFramescaperProjectCommandFinishing(PROFILE, initial, await author(initial, linearRequest));
	const prior = graphs(linear)[0]!, next = applyFramescaperProjectCommandFinishing(PROFILE, linear, await author(linear, request(linear)));
	assert.equal(graphs(next).length, 2); assert.deepEqual(graphs(next).find(mask => mask.id === prior.id), prior);
	const model = createModel({ surface: 'video-mask-matte', project: next, selectedClipId: 'video-clip', playheadSample: 0 });
	assert.ok(model.maskDrafts.some(draft => draft.id === prior.id && draft.shape === 'linear-gradient'));
	assert.ok(model.maskDrafts.some(draft => draft.shape === 'radial-gradient'));
});
