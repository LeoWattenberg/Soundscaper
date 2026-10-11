/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { COPY } from './helpers/audio-editor-controller-harness.js';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { createFramescaperSuccessorController } from '../src/framescaper/editor-successor-controller.ts';
import { createFramescaperSuccessorScapeNativeRuntime } from '../src/framescaper/editor-scape-successor-native.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createMotionscaperOpaqueArchive as archive } from './helpers/motionscaper-opaque-archive.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';



for (const [family, version] of [['framescaper', 3], ['motionscaper', 1], ['soundscaper', 1]] as const) {
	test(`M10 successor File Open retains ${family}/${String(version)} opaquely and Save Copy preserves exact bytes`, async () => {
		const factory = createInstrumentedIndexedDB(); const environment = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: factory as unknown as IDBFactory, preferOpfs: false } });
		let saved: Blob | undefined;
		const controller = createFramescaperSuccessorController(environment, { locale: 'en', copy: COPY, fileService: {
			...createAudioEditorFileService({ bridge: null, document: null }),
			prepareSave: async () => ({ mode: 'blob' as const, target: {}, fileName: 'opaque.fscape' }),
			saveFile: async (request: unknown) => { assert.ok(request && typeof request === 'object'); const blob: unknown = Reflect.get(request, 'blob'); assert.ok(blob instanceof Blob); saved = blob; return { method: 'blob', fileName: 'opaque.fscape', size: blob.size }; },
		} });
		try {
			await controller.ready; await controller.actions.project.flush();
			const owners = await environment.owners.listOwners(); const ownerRows = factory.records('kw-media-framescaper-editor-v2', 'owners'); const original = await archive(family, version);
			const inspection = await controller.actions.project.inspectScape(original);
			assert.equal(inspection.readOnly, true); assert.equal(inspection.schemaFamily, family); assert.equal(inspection.schemaVersion, version); assert.equal(inspection.exists, false);
			await controller.actions.project.openScape(original);
			assert.equal(controller.getSnapshot().readOnly, true); assert.equal(controller.project?.schemaFamily, family); assert.equal(controller.project?.schemaVersion, version);
			assert.deepEqual(controller.project?.sources, []); assert.deepEqual(controller.project?.clips, []);
			await assert.rejects(controller.actions.project.saveScape(), /read.only/iu);
			await controller.actions.project.saveScape({ saveCopy: true }); assert.ok(saved);
			assert.deepEqual(await saved.arrayBuffer(), await original.arrayBuffer());
			assert.deepEqual(await environment.owners.listOwners(), owners); assert.equal(await environment.store.loadMediaAsset('future'), null);
			assert.deepEqual(factory.records('kw-media-framescaper-editor-v2', 'owners'), ownerRows);
			assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'assets'), 0); assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'chunks'), 0);
			assert.equal(factory.recordCount('kw-media-framescaper-editor-v2', 'portableArchives'), 0);
		} finally { await controller.dispose(); await environment.close(); }
	});
}

test('M10 successor opaque copy refuses current schema2 and legacy schema1 before writing', async () => {
	const environment = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
	try {
		const runtime = createFramescaperSuccessorScapeNativeRuntime(environment); assert.ok(runtime.copyScapeArchive);
		for (const version of [1, 2]) { let writes = 0; await assert.rejects(runtime.copyScapeArchive(await archive('framescaper', version, 'current', 'audio'), () => { writes++; }, { signal: new AbortController().signal }), /Only an opaque/u); assert.equal(writes, 0); }
	} finally { await environment.close(); }
});

test('M10 successor opaque session consumes only scalar envelope fields and forbids editing', () => {
	const runtime = createFramescaperSuccessorRuntime({ line: 'successor' });
	const value = { schemaFamily: 'framescaper', schemaVersion: 3, id: 'future', title: 'Future', get sources(): never { throw new Error('foreign graph traversed'); }, get clips(): never { throw new Error('foreign graph traversed'); } };
	const opened = runtime.loadProject(value); const history = runtime.createHistory(opened.project); const session = runtime.createSessionController();
	try {
		session.openProject(opened.project, { history, readOnly: false });
		assert.deepEqual(runtime.projectForRuntimeConsumers(value).sources, []); assert.deepEqual(runtime.projectForCommandConsumers(value).clips, []);
		assert.equal(session.getSnapshot().tabs[0]?.readOnly, true);
		assert.throws(() => runtime.executeCommand(history, { type: 'project/rename', title: 'Changed' }));
		assert.throws(() => session.updateProject(opened.project.id, { ...opened.project, title: 'Changed' }), /read.only/iu);
	} finally { session.dispose(); }
});

test('M10 byte-source opaque import detaches custody before the selected read capability closes', async () => {
	const environment = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
	let saved: Blob | undefined;
	const controller = createFramescaperSuccessorController(environment, { locale: 'en', copy: COPY, fileService: {
		...createAudioEditorFileService({ bridge: null, document: null }), prepareSave: async () => ({ mode: 'blob' as const, target: {}, fileName: 'retained.fscape' }),
		saveFile: async (request: unknown) => { assert.ok(request && typeof request === 'object'); const blob: unknown = Reflect.get(request, 'blob'); assert.ok(blob instanceof Blob); saved = blob; return { method: 'blob', fileName: 'retained.fscape', size: blob.size }; },
	} });
	try {
		await controller.ready; const original = await archive('framescaper', 3); let released = false;
		const input = createScapeArchiveByteSource({ size: original.size, maximumReadBytes: 256, read: async ({ offset, length }) => { assert.equal(released, false); return new Uint8Array(await original.slice(offset, offset + length).arrayBuffer()); } });
		await controller.actions.project.openScape(input); released = true;
		await controller.actions.project.saveScape({ saveCopy: true }); assert.ok(saved); assert.deepEqual(await saved.arrayBuffer(), await original.arrayBuffer());
	} finally { await controller.dispose(); await environment.close(); }
});

test('M10 foreign archive identity collision cannot activate an editable successor owner', async () => {
	const factory = createInstrumentedIndexedDB(); const environment = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: factory as unknown as IDBFactory, preferOpfs: false } });
	const controller = createFramescaperSuccessorController(environment, { locale: 'en', copy: COPY });
	try {
		await controller.ready; const current = controller.project!; const owners = factory.records('kw-media-framescaper-editor-v2', 'owners');
		await controller.actions.project.openScape(await archive('motionscaper', 1, current.id));
		assert.equal(controller.getSnapshot().readOnly, true); assert.equal(controller.project?.schemaFamily, 'motionscaper');
		assert.deepEqual(factory.records('kw-media-framescaper-editor-v2', 'owners'), owners);
	} finally { await controller.dispose(); await environment.close(); }
});
