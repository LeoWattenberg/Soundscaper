/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { detachPhotoDevelopSettingsSourceV2 } from '../src/common/editor/controller/shared/photo-library-develop-settings-intent-v2.ts';
import { currentRecipe } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { detachPhotoLibraryDevelopSettingsV2 } from '../src/common/editor/controller/shared/photo-library-develop-command-v2.ts';
import { PhotoLibraryDevelopSettingsWorkflowV2 } from '../src/common/editor/controller/shared/photo-library-develop-settings-workflow-v2.ts';

test('the current settings source closes schema2 identity and full refs before acquisition', () => {
	const recipe = JSON.parse(JSON.stringify(currentRecipe())) as ReturnType<typeof currentRecipe>;
	const input = { schemaVersion: 2, catalogId: 'catalog', photoId: 'photo', versionId: 'master', revision: 7, develop: recipe };
	const detached = detachPhotoDevelopSettingsSourceV2(input);
	input.catalogId = 'changed'; Reflect.set(recipe.effects[0]!.params.lut as object, 'storageKey', 'changed');
	assert.equal(detached.schemaVersion, 2); assert.equal(detached.catalogId, 'catalog'); assert.deepEqual(detached.develop, currentRecipe());
	assert.throws(() => detachPhotoDevelopSettingsSourceV2({ ...input, schemaVersion: 1 }));
	assert.throws(() => detachPhotoDevelopSettingsSourceV2({ ...input, schemaVersion: 3 }));
});

test('current source refuses callback/coercion/raw-body authority and preserves explicit null', () => {
	const input = { schemaVersion: 2, catalogId: 'catalog', photoId: 'photo', versionId: 'master', revision: 0, develop: currentRecipe(null) };
	assert.deepEqual(detachPhotoDevelopSettingsSourceV2(input).develop, input.develop);
	let traps = 0;
	assert.throws(() => detachPhotoDevelopSettingsSourceV2({ ...input, get photoId() { traps++; return 'photo'; } }));
	assert.throws(() => detachPhotoDevelopSettingsSourceV2({ ...input, catalogId: { toString() { traps++; return 'catalog'; } } }));
	assert.throws(() => detachPhotoDevelopSettingsSourceV2({ ...input, revision: -0 }));
	assert.throws(() => detachPhotoDevelopSettingsSourceV2({ ...input, source: () => undefined }));
	assert.equal(traps, 0);
});

test('complete compound masks preserve the 2MiB transport ceiling before any host execution', async () => {
	const graph = { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'path', nodes: [{ id: 'path', kind: 'vector-path', fillRule: 'nonzero',
		paths: [{ id: 'outline', closed: true, points: Array.from({ length: 16_384 }, () => ({ position: { x: 0.5, y: 0.5 }, inHandle: null, outHandle: null })) }] }] };
	const develop = normalizeImageDevelopStateV2({ ...currentRecipe(null), masks: [graph, { ...graph, id: 'other' }] });
	assert.ok(new TextEncoder().encode(JSON.stringify(develop)).byteLength > 2_097_152);
	const source = { schemaVersion: 2 as const, catalogId: 'catalog', photoId: 'photo', versionId: 'master', revision: 0, develop };
	assert.throws(() => detachPhotoLibraryDevelopSettingsV2(develop)); assert.throws(() => detachPhotoDevelopSettingsSourceV2(source));
	let executions = 0;
	const owner = new PhotoLibraryDevelopSettingsWorkflowV2({ execute: async () => { executions++; } });
	try { await owner.copy(source, { effectTypes: 'all', geometry: true, localAdjustments: true }); assert.equal(executions, 0); assert.ok(owner.snapshot().error); }
	finally { await owner.close(); }
});
