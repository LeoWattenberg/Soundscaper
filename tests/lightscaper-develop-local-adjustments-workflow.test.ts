/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryDevelopWorkflowV2 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { CURRENT_TIME, currentDevelopFixture } from './helpers/lightscaper-current-develop-session-fixture.ts';

async function fixture() {
	const f = await currentDevelopFixture(1);
	const owner = new PhotoLibraryDevelopWorkflowV2({ now: () => CURRENT_TIME,
		execute: async (run, signal) => { await run({ signal: signal!, acquire: async () => f.develop,
			isCurrent: () => true, refresh: async () => undefined }); } });
	await owner.open('photo-1');
	const draft = owner.snapshot().draft!;
	const recipe = { ...draft, effects: [createVideoEffectV2('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })],
		masks: [{ schemaVersion: 1, id: 'gradient', kind: 'mask', inputs: [], outputNodeId: 'ramp',
			nodes: [{ id: 'ramp', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] }],
		maskBindings: [{ effectId: 'tone', maskId: 'gradient' }] };
	return { ...f, owner, recipe };
}

function edit(owner: PhotoLibraryDevelopWorkflowV2, value: unknown): void {
	const method = (owner as PhotoLibraryDevelopWorkflowV2 & { edit?: (value: PhotoLibraryDevelopSettingsV2) => void }).edit;
	assert.equal(typeof method, 'function', 'Develop must admit a complete normalized local-adjustment draft');
	Reflect.apply(method!, owner, [value]);
}

test('Light local adjustment draft saves through existing history and survives reload without changing the original', async () => {
	const f = await fixture();
	try {
		const initial = f.owner.snapshot().document!;
		edit(f.owner, f.recipe); assert.equal(f.owner.snapshot().dirty, true);
		const accepted = structuredClone(f.owner.snapshot().draft);
		f.recipe.masks[0]!.nodes[0]!.end.x = .25;
		assert.deepEqual(f.owner.snapshot().draft, accepted);
		assert.ok(await f.owner.save('Gradient')); await f.owner.reload();
		assert.deepEqual(f.owner.snapshot().draft, accepted);
		assert.equal(f.owner.snapshot().document!.history.entries.at(-1)?.label, 'Gradient');
		await f.owner.apply({ type: 'select-develop-history', versionId: initial.versionId, cursor: initial.history.cursor });
		assert.deepEqual(f.owner.snapshot().draft, initial.develop);
		const stored = await f.repository.loadPhoto('catalog-1', 'photo-1');
		assert.deepEqual(stored?.original, f.photos[0]!.original);
	} finally { await f.owner.close(); await f.close(); }
});

test('Light removal prunes bindings of deleted effects while retaining reusable mask graphs', async () => {
	const f = await fixture();
	try {
		edit(f.owner, f.recipe); const masks = f.owner.snapshot().draft!.masks;
		f.owner.setEffects([]);
		assert.deepEqual(f.owner.snapshot().draft!.maskBindings, []);
		assert.deepEqual(f.owner.snapshot().draft!.masks, masks);
		assert.ok(await f.owner.save('Remove adjustment'));
	} finally { await f.owner.close(); await f.close(); }
});

test('Light retired local-adjustment callback cannot change a draft or write a photo', async () => {
	const f = await fixture();
	try {
		const draft = f.owner.snapshot().draft;
		await f.owner.retire(); edit(f.owner, f.recipe);
		assert.equal(f.owner.snapshot().draft, draft);
		assert.equal((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.revision, f.photos[0]!.revision);
	} finally { await f.owner.close(); await f.close(); }
});
