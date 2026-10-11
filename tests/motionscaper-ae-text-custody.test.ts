/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareMotionscaperAeImport, commitMotionscaperAeImport } from '../src/motionscaper/editor-ae-import.ts';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { normalizeMotionscaperProject } from '../src/motionscaper/editor-project-validation.ts';
import { exportMotionscaperArchive, importMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { motionAeTextFixture, motionAeTextFont, motionAeTextOptions } from './helpers/motionscaper-ae-text-fixture.ts';
const bytes = new Uint8Array([1, 2, 3, 4]), sha256 = digestScapeBytes(bytes);
const selected = { postScriptName: motionAeTextFont.postScriptName, file: new Blob([bytes]), name: 'Original selected face.otf', style: 'Regular' };
function options() { let serial = 0; return { projectId: 'retained-text', allocateId: () => `font-${String(++serial)}`, text: motionAeTextOptions, fonts: [selected],
	prepareFont: async (file: Blob, metadata: { id: string; name: string; style: string }) => ({ body: file, asset: { ...motionAeTextFont.asset, ...metadata, sha256, storageKey: `motion-sha256:${sha256}` } }),
}; }
const manifest = () => new Blob([JSON.stringify(motionAeTextFixture())]);
test('Motion AE selected font association and exact body survive publication, reopen and full .mscape transfer', async () => {
	const database = createInstrumentedIndexedDB(), store = createMotionscaperProjectStore({ indexedDB: database as unknown as IDBFactory });
	const destination = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory });
	try {
		const prepared = await prepareMotionscaperAeImport(manifest(), [], options());
		assert.equal(database.recordCount('kw-media-motionscaper-editor-v1', 'chunks'), 0);
		assert.equal(prepared.project.compositions[0]!.layers[0]!.kind, 'text');
		assert.deepEqual(prepared.project.interchangeCustody?.fonts, [{ postScriptName: selected.postScriptName, assetId: 'font-1', sha256, byteLength: 4 }]);
		await commitMotionscaperAeImport(prepared, { acknowledgeUnsupported: true }, project => store.beginImport(project));
		const saved = (await store.load(prepared.project.id))!.project, font = saved.assets[0]!;
		assert.equal(font.name, selected.name); assert.deepEqual(new Uint8Array(await (await store.loadAsset(font))!.arrayBuffer()), bytes);
		const archive = await exportMotionscaperArchive(saved, asset => store.readAsset(asset)); assert.ok(archive);
		await importMotionscaperArchive(archive, project => destination.beginImport(project));
		const reopened = (await destination.load(saved.id))!.project;
		assert.deepEqual(reopened.interchangeCustody, saved.interchangeCustody); assert.deepEqual(new Uint8Array(await (await destination.loadAsset(font))!.arrayBuffer()), bytes);
		assert.throws(() => normalizeMotionscaperProject({ ...saved, assets: [{ ...font, sha256: 'b'.repeat(64), storageKey: `motion-sha256:${'b'.repeat(64)}` }] }), /custody.*font/iu);
		assert.throws(() => normalizeMotionscaperProject({ ...saved, interchangeCustody: { ...saved.interchangeCustody, fonts: [...saved.interchangeCustody!.fonts!, ...saved.interchangeCustody!.fonts!] } }), /custody.*font/iu);
	} finally { await store.close(); await destination.close(); }
});
test('Motion AE font preparation refuses ambiguous names, unreferenced faces and oversized bodies before decoding', async () => {
	let decoded = 0; const prepareFont = async () => { decoded++; throw new Error('Unexpected decoder'); };
	for (const fonts of [[selected, selected], [{ ...selected, postScriptName: 'unreferenced' }], [{ ...selected, file: new Blob([new Uint8Array(16 * 1024 * 1024 + 1)]) }]]) {
		await assert.rejects(prepareMotionscaperAeImport(manifest(), [], { ...options(), fonts, prepareFont }), /font/iu);
	}
	assert.equal(decoded, 0);
});
test('Motion AE font publication verifies retained bytes and rolls private chunks back on corruption', async () => {
	const store = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory });
	try {
		const prepared = await prepareMotionscaperAeImport(manifest(), [], { ...options(), prepareFont: async (file, metadata) => ({ body: file, asset: { ...motionAeTextFont.asset, ...metadata } }) });
		await assert.rejects(commitMotionscaperAeImport(prepared, { acknowledgeUnsupported: true }, project => store.beginImport(project)), /digest/iu);
		assert.equal(await store.load(prepared.project.id), null);
	} finally { await store.close(); }
});
