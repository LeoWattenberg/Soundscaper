/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test, { type TestContext } from 'node:test';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return { url: 'data:text/javascript,export default "mock-ffmpeg-asset"', shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`;
register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const {
	createFramescaperAudioEditorControllerV18,
} = await import('../src/framescaper/editor-controller-v18.ts');
const {
	createFramescaperEditorProjectEnvironmentV18,
} = await import('../src/framescaper/editor-project-environment-v18.ts');
const { createInstrumentedIndexedDB } = await import('./helpers/instrumented-indexeddb.js');
const {
	archiveProject,
	createFramescaperV18ArchiveFixture,
	seedFramescaperV18ArchiveBodies,
} = await import('./helpers/framescaper-v18-archive-fixture.ts');
const { FramescaperScapeArchiveV18 } = await import('../src/framescaper/scape-project-preservation-v18.ts');
const { FramescaperScapeProjectFileV18 } = await import('../src/framescaper/scape-project-file-v18.ts');
const { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } = await import('../src/framescaper/editor-project-runtime-profile-v18.ts');

test('product-owned controller activates a fresh writable V18 project', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV18(environment, {
		locale: 'en',
	});
	context.after(async () => {
		await controller.dispose();
		await environment.close();
	});
	const ready = await controller.ready;
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status));
	assert.equal(ready.project.schemaVersion, 18);
	assert.equal(ready.readOnly, false);
	assert.equal(
		(ready.preferences.workspace as Readonly<{ activeId: string }>).activeId,
		'video-editor',
	);
	assert.equal((await environment.store.loadProject(ready.project.id))?.schemaVersion, 18);
	controller.actions.project.rename('Framescaper V18');
	assert.equal(controller.project.schemaVersion, 18);
	assert.equal(controller.project.title, 'Framescaper V18');
});

test('product controller executes nested-sequence menu commands with undo and redo', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV18(environment, { locale: 'en' });
	context.after(async () => {
		await controller.dispose();
		await environment.close();
	});
	await controller.ready;
	const nestedProject = environment.runtime.createProject({
		id: 'nested-controller', title: 'Nested controller', now: '2026-08-13T12:00:00.000Z',
		sequences: [
			{ id: 'main', rate: { num: 30, den: 1 }, trackIds: [] },
			{ id: 'shared', rate: { num: 24, den: 1 }, trackIds: [] },
		],
		primarySequenceId: 'main',
	});
	await environment.createProjectIfAbsent(nestedProject);
	await controller.actions.project.open(nestedProject);
	controller.actions.sequences.addNested({
		id: 'nested-shared', sequenceId: 'main', sourceSequenceId: 'shared',
		sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 24,
	});
	assert.equal((controller.project.subsequences as readonly unknown[]).length, 1);
	controller.actions.sequences.updateNested('nested-shared', { sequenceStartFrame: 60 });
	assert.equal((controller.project.subsequences as readonly { sequenceStartFrame: number }[])[0]?.sequenceStartFrame, 60);
	controller.actions.edit.undo();
	assert.equal((controller.project.subsequences as readonly { sequenceStartFrame: number }[])[0]?.sequenceStartFrame, 0);
	controller.actions.edit.redo();
	assert.equal((controller.project.subsequences as readonly { sequenceStartFrame: number }[])[0]?.sequenceStartFrame, 60);
	controller.actions.sequences.removeNested('nested-shared');
	assert.deepEqual(controller.project.subsequences, []);
});

test('product controller refuses cloned environments and authority options before effects', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	assert.throws(
		() => createFramescaperAudioEditorControllerV18({ ...environment }),
		/exact.*environment/iu,
	);
	for (const field of ['store', 'projectRuntime', 'sessionController', 'acquireProjectLock']) {
		let reads = 0;
		const options = Object.defineProperty({}, field, {
			enumerable: true,
			get() { reads += 1; throw new Error('authority getter'); },
		});
		assert.throws(
			() => createFramescaperAudioEditorControllerV18(environment, options),
			/unsupported|authority|presentation/iu,
		);
		assert.equal(reads, 0);
	}
});

test('product controller consumes the environment-owned lifecycle store', async (context) => {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controllerStore = environment.controllerStore as unknown as { loadProject: (...values: unknown[]) => unknown };
	assert.equal(controllerStore, environment.store);
	const controller = createFramescaperAudioEditorControllerV18(environment, { locale: 'en' });
	context.after(async () => {
		await controller.dispose();
		await environment.close();
	});
	await controller.ready;
	assert.equal(controller.project.schemaVersion, 18);
});

test('product controller reaches exact V18 Scape inspection and read-only format-2 import', async (context) => {
	const exported = await createFormat2Archive(context);
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV18(environment, { locale: 'en' });
	context.after(async () => {
		await controller.dispose();
		await environment.close();
	});
	await controller.ready;
	const inspected = await controller.actions.project.inspectScape(exported) as Readonly<{
		schemaVersion: number;
		readOnly: boolean;
		manifest: Readonly<{ formatVersion: number }>;
	}>;
	assert.equal(inspected.schemaVersion, 18);
	assert.equal(inspected.readOnly, true);
	assert.equal(inspected.manifest.formatVersion, 2);
	const opened = await controller.actions.project.openScapeFile(
		exported,
		() => 'open-read-only',
	) as Readonly<{ project: Readonly<{ schemaVersion: number }> }>;
	assert.equal(opened.project.schemaVersion, 18);
	assert.equal(controller.project.schemaVersion, 18);
	assert.equal(controller.getSnapshot().readOnly, true);
	assert.equal(environment.runtime.migrateProject(controller.project).intrinsicReadOnly, true);
	assert.deepEqual(await environment.store.loadProject(String(controller.project.id)), controller.project);
});

async function createFormat2Archive(context: TestContext): Promise<Blob> {
	const fixture = await createFramescaperV18ArchiveFixture(context);
	await seedFramescaperV18ArchiveBodies(fixture);
	const archive = new FramescaperScapeArchiveV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		store: fixture.store,
		port: fixture.port,
		opfs: fixture.opfs,
	});
	const file = new FramescaperScapeProjectFileV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		archive,
		store: fixture.store,
	});
	const exported = await file.exportProject(archiveProject());
	assert.ok(exported.blob);
	return new File([exported.blob], 'V18 proxy workflow.scape', {
		type: exported.blob.type,
	});
}
