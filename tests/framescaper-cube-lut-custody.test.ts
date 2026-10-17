/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { collectFramescaperProjectAssetStorageKeys } from '../src/common/editor/retention.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import {
	collectFramescaperScapeAssetReferencesFinishing as collect,
	planFramescaperScapeExportAssetsFinishing as plan,
	validateFramescaperScapeAssetReferenceBytesFinishing as verify,
	validateFramescaperScapeImportAssetsFinishing as imports,
} from '../src/framescaper/editor-scape-asset-plan-finishing.ts';
import type { ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';

const TEXT = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1';
const BYTES = new TextEncoder().encode(TEXT);
const LUT = parseCubeLutV1(TEXT);
const REF = { storageKey: `lut-sha256:${LUT.sha256}`, sha256: LUT.sha256, byteLength: LUT.byteLength,
	size: LUT.size, domainMin: LUT.domainMin, domainMax: LUT.domainMax };
const cube = (lut: unknown = REF, enabled = false) => ({ id: 'cube', type: 'cube-lut-profile-v1', enabled, params: { lut } });

function project(lut: unknown = REF) {
	const options = framescaperV20Options();
	return createFramescaperProjectFinishing(PROFILE, { ...options,
		clips: (options.clips as readonly Readonly<Record<string, unknown>>[]).map(row => row.id === 'video-clip'
			? { ...row, videoEffects: [cube(lut)] } : row) });
}
function inBin(value = project()) {
	return applyFramescaperProjectCommandFinishing(PROFILE, value, { type: 'project-bin/move-from-timeline', clipIds: ['video-clip'] });
}

test('disabled timeline and bin cube references are permanent roots and Scape bodies, while null adds none', async () => {
	for (const value of [project(), inBin()]) {
		assert.deepEqual([...collectFramescaperProjectAssetStorageKeys(value)], [REF.storageKey]);
		const references = collect(value);
		assert.equal(references.length, 1); const reference = references[0]!;
		assert.equal(reference.kind, 'framescaper-cube-lut');
		assert.deepEqual(reference.lutReference, REF);
		assert.doesNotThrow(() => verify(reference, BYTES));
		assert.throws(() => verify(reference, new TextEncoder().encode(TEXT.replace('1 1 1', '0 1 1'))), /conflict/iu);
		assert.throws(() => imports(value, { assets: [] } as unknown as ScapeManifest), /incomplete durable/iu);
		await assert.rejects(plan(value, { getMediaAssetMetadata: async () => null }), /missing/iu);
		const planned = await plan(value, { getMediaAssetMetadata: async key => {
			assert.equal(key, REF.storageKey); return { size: BYTES.byteLength, sha256: REF.sha256, mimeType: 'text/plain' };
		} });
		assert.equal(planned.length, 1); assert.equal(planned[0]!.storageKey, REF.storageKey);
	}
	assert.deepEqual([...collectFramescaperProjectAssetStorageKeys(project(null))], []);
	assert.deepEqual(collect(inBin(project(null))), []);
});

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`saved and unsaved bin/history cube roots protect immutable media in ${backend}`, async () => {
		const store = createProjectStore({ indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
			memoryFallback: backend === 'memory', preferOpfs: false, databaseName: `cube-custody-${backend}-${crypto.randomUUID()}` });
		try {
			await store.writeMediaAsset(REF.storageKey, new Blob([BYTES]));
			const saved = inBin(); await store.saveProject(saved);
			await assert.rejects(store.deleteMediaAsset(REF.storageKey), /saved project or revision/iu);
			const loaded = await store.loadMediaAsset(REF.storageKey); assert.ok(loaded);
			assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), BYTES);
			await store.deleteProject(String(saved.id));
			const retained = await store.pruneUnreferencedSources({ protectedProjects: [project(), inBin()], minimumAgeMs: 0, now: Date.now() + 3 * 86_400_000 });
			assert.deepEqual(retained.deletedSourceIds, []); assert.ok(await store.getMediaAssetMetadata(REF.storageKey));
			await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: Date.now() + 3 * 86_400_000 });
			assert.equal(await store.getMediaAssetMetadata(REF.storageKey), null);
		} finally { await store.close(); }
	});
}

test('a same-key reference geometry conflict refuses atomically before adding any new retention root', () => {
	const value = inBin();
	const bin = value.projectBin as { clips: readonly Readonly<Record<string, unknown>>[] };
	const drifted = { ...value, clips: [{ id: 'other', videoEffects: [cube({ ...REF, size: 3 })] }], projectBin: bin };
	const target = new Set(['prior']);
	assert.throws(() => collectFramescaperProjectAssetStorageKeys(drifted, target), /conflict/iu);
	assert.deepEqual([...target], ['prior']);
	assert.throws(() => collect(drifted), /conflict/iu);
});
