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
const { createVideoSourceV10, createVideoTrackV10 } = await import('../src/common/editor/project-v10.ts');

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

test('product controller executes fenced multicamera menu commands with undo', async (context) => {
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
	const rate = { num: 30, den: 1 };
	const project = environment.runtime.createProject({
		id: 'multicamera-controller', title: 'Multicamera controller',
		now: '2026-08-13T12:00:00.000Z', sampleRate: 48_000,
		sources: ['a', 'b'].map((suffix) => createVideoSourceV10({
			id: `camera-${suffix}`, name: `Camera ${suffix.toUpperCase()}`,
			storageKey: `camera-${suffix}`, mimeType: 'video/mp4',
			contentSha256: (suffix === 'a' ? '12' : '34').repeat(32),
			sampleFrameCount: 480_000, sourceFrameCount: 300, frameRate: rate,
			width: 1920, height: 1080,
		})),
		clips: [{
			kind: 'video', id: 'output-clip', sourceId: 'camera-a', title: 'Output',
			sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30,
			sourceInFrame: 1, sourceFrameCount: 30, retimeMap: null,
		}],
		projectBin: { clips: [{
			kind: 'video', id: 'camera-b-bin', binItemId: 'camera-b-item', sourceId: 'camera-b',
			title: 'Camera B', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30,
			sourceInFrame: 0, sourceFrameCount: 30, retimeMap: null,
		}] },
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['output-clip'], locked: false,
		})],
		sequences: [{ id: 'main', rate, trackIds: ['video-track'] }],
		primarySequenceId: 'main',
	});
	await environment.createProjectIfAbsent(project);
	await controller.actions.project.open(project);
	const group = {
		id: 'group-a', projectId: project.id, sequenceId: 'main', outputClipId: 'output-clip',
		activeMemberId: 'member-a', members: [
			{ id: 'member-a', groupId: 'group-a', sourceId: 'camera-a', syncOffsetSamples: 0 },
			{ id: 'member-b', groupId: 'group-a', sourceId: 'camera-b', syncOffsetSamples: 0 },
		],
	};
	controller.actions.sequences.createMulticamera(project.id, project.revision, group);
	assert.equal((controller.project.multicameraGroups as readonly unknown[]).length, 1);
	controller.actions.sequences.switchMulticamera(
		project.id, Number(controller.project.revision), 'group-a', 'member-a', 'member-b',
	);
	assert.equal(
		(controller.project.multicameraGroups as readonly { activeMemberId: string }[])[0]?.activeMemberId,
		'member-b',
	);
	controller.actions.edit.undo();
	assert.equal(
		(controller.project.multicameraGroups as readonly { activeMemberId: string }[])[0]?.activeMemberId,
		'member-a',
	);
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
