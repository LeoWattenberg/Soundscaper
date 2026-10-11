/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { normalizeMotionscaperProject } from '../src/motionscaper/editor-project-validation.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { exportMotionscaperArchive, importMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { prepareMotionscaperAeImport, commitMotionscaperAeImport } from '../src/motionscaper/editor-ae-import.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import type { MotionImportedMedia } from '../src/common/editor/motion-media-import.ts';
const bytes = new Uint8Array([12, 34, 56, 78]), digest = digestScapeBytes(bytes);
async function preparation() {
	const exchange = { format: 'org.motionscaper.ae-exchange', version: 1, transferId: 'original-transfer', producer: { application: 'after-effects', version: 'unqualified', bridgeVersion: '0.1.0' },
		source: { name: 'Original.aep', revisionDigest: null }, color: { workingSpace: '', linearBlending: false, bitsPerChannel: 8 },
		footage: [{ id: 'original-footage', name: 'Original unused picture.png', path: 'media/original.png', sha256: null, byteLength: bytes.byteLength, width: 64, height: 64, pixelAspect: 1, frameRate: 1, duration: 0, hasVideo: true, hasAudio: false, still: true }],
		compositions: [{ id: 'source-comp', name: 'Original comp', width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 1, displayStartTime: 0, background: [0, 0, 0],
			layers: [{ id: 'original-text', name: 'Unsupported text', kind: 'text', sourceId: null, parentId: null, matte: null, startTime: 0, inPoint: 0, outPoint: 1, stretch: 100, enabled: true,
				threeD: false, adjustment: false, blendMode: 'normal', properties: [{ kind: 'unsupported', name: 'Foreign plugin', matchName: 'unmapped.plugin', reason: 'Preserve this original plugin intent' }] }] }],
		report: [{ scopeId: 'original-text', propertyPath: '0:unmapped.plugin', code: 'property', status: 'unsupported', message: 'Preserve this original plugin intent' }] };
	let serial = 0;
	return prepareMotionscaperAeImport(new Blob([JSON.stringify(exchange)]), [{ path: 'media/original.png', file: new Blob([bytes]) }], {
		projectId: 'imported-project', allocateId: () => `imported-${String(++serial)}`,
		prepareMedia: async (file, options): Promise<MotionImportedMedia> => ({ body: file, asset: { id: options.id, name: options.name, kind: 'image', width: 64, height: 64, hasAlpha: true,
			mimeType: 'image/png', byteLength: bytes.byteLength, sha256: digest, storageKey: `motion-sha256:${digest}` } }),
	});
}
test('AE original names, unsupported intent and unused original media survive save, reopen and .mscape roundtrip', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory, store = createMotionscaperProjectStore({ indexedDB });
	const destination = createMotionscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory });
	try {
		const prepared = await preparation();
		await commitMotionscaperAeImport(prepared, { acknowledgeUnsupported: true }, (project) => store.beginImport(project));
		const reopened = createMotionscaperProjectStore({ indexedDB });
		const saved = (await reopened.load(prepared.project.id))!;
		assert.equal(saved.project.compositions[0]!.layers[0]!.kind, 'null');
		assert.deepEqual(saved.project.interchangeCustody, prepared.project.interchangeCustody);
		assert.equal(saved.project.interchangeCustody?.exchange.footage[0]?.name, 'Original unused picture.png');
		assert.equal(saved.project.assets[0]!.name, 'Original unused picture.png');
		assert.deepEqual(new Uint8Array(await (await reopened.loadAsset(saved.project.assets[0]!))!.arrayBuffer()), bytes);
		const archive = await exportMotionscaperArchive(saved.project, (asset) => reopened.readAsset(asset)); assert.ok(archive);
		const imported = await importMotionscaperArchive(archive, (project) => destination.beginImport(project)); assert.equal(imported.kind, 'current');
		assert.deepEqual((await destination.load(saved.project.id))?.project.interchangeCustody, saved.project.interchangeCustody);
		assert.deepEqual(new Uint8Array(await (await destination.loadAsset(saved.project.assets[0]!))!.arrayBuffer()), bytes);
		await reopened.close();
	} finally { await store.close(); await destination.close(); }
});
test('custody is absent from prior projects and binds original byte descriptors against later asset edits/removal', async () => {
	const baseline = createMotionscaperProject({ id: 'prior', compositionId: 'comp', title: 'Prior' });
	assert.equal(Object.hasOwn(baseline, 'interchangeCustody'), false);
	assert.equal(createMotionscaperRevision(baseline).digest, createMotionscaperRevision(normalizeMotionscaperProject(baseline)).digest);
	const prepared = await preparation(), project = prepared.project;
	assert.throws(() => normalizeMotionscaperProject({ ...project, assets: [] }), /custody.*media/iu);
	assert.throws(() => normalizeMotionscaperProject({ ...project, assets: [{ ...project.assets[0]!, sha256: 'b'.repeat(64), storageKey: `motion-sha256:${'b'.repeat(64)}` }] }), /custody.*media/iu);
	assert.throws(() => normalizeMotionscaperProject({ ...project, interchangeCustody: { ...project.interchangeCustody, executableScript: 'run()' } }), /unknown|unsupported/u);
	assert.throws(() => normalizeMotionscaperProject({ ...project, interchangeCustody: { ...project.interchangeCustody, report: [{ scopeId: 'absent', propertyPath: '', code: 'forged', status: 'editable', message: 'No' }] } }), /report|scope/u);
	assert.throws(() => normalizeMotionscaperProject({ ...project, interchangeCustody: { ...project.interchangeCustody, oversized: 'a'.repeat(16_777_217) } }), /budget/u);
});
test('AE import cancellation and destination identity conflicts leave existing saved projects and private chunks unchanged', async () => {
	const database = createInstrumentedIndexedDB(), store = createMotionscaperProjectStore({ indexedDB: database as unknown as IDBFactory });
	try {
		const prepared = await preparation(), controller = new AbortController();
		await assert.rejects(commitMotionscaperAeImport(prepared, { acknowledgeUnsupported: true }, async (project) => {
			const transaction = await store.beginImport(project);
			return { ...transaction, writeAssetChunk: async (asset, bytes) => { await transaction.writeAssetChunk(asset, bytes); controller.abort(); } };
		}, controller.signal), { name: 'AbortError' });
		assert.equal(await store.load(prepared.project.id), null);
		assert.equal(database.recordCount('kw-media-motionscaper-editor-v1', 'chunks'), 0);
		const prior = createMotionscaperProject({ id: prepared.project.id, compositionId: 'prior-comp', title: 'Existing project' });
		const original = await store.save(prior, null);
		await assert.rejects(commitMotionscaperAeImport(prepared, { acknowledgeUnsupported: true }, (project) => store.beginImport(project)), /changed in another session/u);
		assert.equal((await store.load(prior.id))?.digest, original.digest);
		assert.equal(database.recordCount('kw-media-motionscaper-editor-v1', 'chunks'), 0);
	} finally { await store.close(); }
});
