/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { DesktopSharedProjectLibraryService } from '../desktop/project-library-editor-service.ts';
import {
	type DesktopLibraryOwner,
} from '../desktop/project-library-contract.ts';
import { DesktopProjectLibraryHost } from '../desktop/project-library-host.ts';
import { createEditorController } from '../src/common/editor/facade.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	validateAudioEditorProjectV9,
	type AudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../src/common/editor/scape-project-document.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import {
	type DesktopSharedProjectBridge,
} from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import type { EditorController } from '../src/common/editor/types.ts';

type ExactProjectV9 = AudioEditorProjectV9 & Readonly<{
	id: string;
	title: string;
	revision: number;
	updatedAt: string;
	sources: readonly Readonly<Record<string, unknown>>[];
	clips: readonly Readonly<Record<string, unknown>>[];
	projectBin: Readonly<{ clips: readonly Readonly<Record<string, unknown>>[] }>;
}>;

interface HandoffProjectActions {
	readonly rename: (title: string) => unknown;
	readonly save: () => Promise<unknown>;
	readonly flush: () => Promise<unknown>;
	readonly list: () => Promise<unknown>;
}

const SOUND_OWNER = Object.freeze({
	product: 'soundscaper' as const,
	processId: 301,
	instanceId: 'editor-handoff-soundscaper',
});
const FRAME_OWNER = Object.freeze({
	product: 'framescaper' as const,
	processId: 302,
	instanceId: 'editor-handoff-framescaper',
});

test('source-bearing exact-V9 handoff refuses activation without recipient-local PCM', async (context) => {
	const fixture = await createFixture();
	const resources = trackResources(context, fixture);
	const soundHost = await resources.startHost(SOUND_OWNER);
	const soundService = new DesktopSharedProjectLibraryService(soundHost, {
		now: () => 30_000,
		createEntryId: () => 'handoff-entry-0002',
	});
	const sourceId = 'handoff-audio-source';
	const source = createAudioSourceV9({
		id: sourceId,
		name: 'Soundscaper-only.wav',
		mimeType: 'audio/wav',
		storageKey: sourceId,
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 4,
	});
	const clip = createAudioClipV9({
		id: 'handoff-audio-clip',
		sourceId,
		title: 'Soundscaper-only clip',
		durationFrames: 4,
		sourceDurationFrames: 4,
	});
	const track = createAudioTrackV9({
		id: 'handoff-audio-track',
		name: 'Soundscaper audio',
		clipIds: [clip.id],
	});
	const project = exactV9(createAudioEditorProjectV9({
		id: 'handoff-project-with-audio',
		title: 'Source-bearing handoff',
		revision: 3,
		now: '2026-07-30T12:00:00.000Z',
		sampleRate: 48_000,
		sources: [source],
		clips: [clip],
		tracks: [track],
	}));

	const soundLocalStore = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `editor-handoff-sound-local-${Date.now()}-${Math.random()}`,
	});
	context.after(async () => { await soundLocalStore.close(); });
	const writer = await soundLocalStore.beginSourceWrite(sourceId, {
		name: source.name,
		mimeType: source.mimeType,
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 4,
	});
	await writer.write([Float32Array.of(0.125, -0.25, 0.5, -1)]);
	await writer.commit({ sampleRate: 48_000, channelCount: 1, chunkFrames: 4 });
	assert.ok(await soundLocalStore.getSourceMetadata(sourceId));

	const sharedDocument = await soundService.commitSharedProject(serializeScapeProjectDocument(project));
	assert.deepEqual(exactV9(sharedDocument), project);
	const sharedCatalog = soundHost.readCatalog();
	const soundToken = soundHost.snapshot().fencingToken;
	await soundLocalStore.close();
	await resources.closeHost(soundHost);

	const frameHost = await resources.startHost(FRAME_OWNER);
	assert.ok(frameHost.snapshot().fencingToken > soundToken);
	const frameService = new DesktopSharedProjectLibraryService(frameHost, {
		now: () => 40_000,
		createEntryId: () => { throw new Error('failed handoff must not create a shared entry'); },
	});
	const frameCommits: string[] = [];
	const frameDatabaseName = `editor-handoff-framescaper-bound-${Date.now()}-${Math.random()}`;
	const frameSeed = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: frameDatabaseName,
	});
	context.after(async () => { await frameSeed.close(); });
	const priorFrameProject = structuredClone({
		...project,
		revision: project.revision - 1,
		updatedAt: '2026-07-30T11:00:00.000Z',
	});
	await frameSeed.saveProject(priorFrameProject);
	await frameSeed.close();
	const frameStore = sharedStore(
		'framescaper-missing-audio',
		serviceBridge(frameService, frameCommits),
		frameDatabaseName,
	);
	assert.equal(await frameStore.store.getSourceMetadata(sourceId), null);
	assert.deepEqual(
		(await frameStore.store.listProjectRevisions(project.id)).map(({ revision }) => revision),
		[priorFrameProject.revision],
	);
	await frameStore.store.saveSetting('framescaper:last-project-id', project.id);
	const framescaper = resources.trackController(createEditorController(null, {
		headless: true,
		productId: 'framescaper',
		store: frameStore.store,
	}));

	const failed = await framescaper.ready;
	assert.equal(failed.phase, 'error');
	assert.equal(failed.project, null);
	assert.equal(framescaper.project, null);
	assert.deepEqual(
		(await frameStore.store.listProjectRevisions(project.id)).map(({ revision }) => revision),
		[priorFrameProject.revision],
	);
	assert.deepEqual(frameCommits, []);
	assert.deepEqual(frameHost.readCatalog(), sharedCatalog);
	assert.equal(await frameService.readSharedProject(project.id), sharedDocument);
	assert.equal(failed.status.state, 'error');
	assert.match(failed.status.message, /recipient-local/iu);
	assert.match(failed.status.message, /audio source/iu);
	assert.match(failed.status.message, /(?:unavailable|not available|missing)/iu);
	assert.ok(failed.status.message.includes(sourceId));
});

test('source-free exact-V9 composed editor autosave hands off from Soundscaper to Framescaper', async (context) => {
	const fixture = await createFixture();
	const resources = trackResources(context, fixture);
	const soundHost = await resources.startHost(SOUND_OWNER);
	const soundClock = { value: 10_000 };
	const soundService = new DesktopSharedProjectLibraryService(soundHost, {
		now: () => soundClock.value,
		createEntryId: () => 'handoff-entry-0001',
	});
	const soundCommits: string[] = [];
	const soundTimers = manualTimers();
	const soundBridge = serviceBridge(soundService, soundCommits);
	const soundscaper = resources.trackController(createEditorController(null, {
		headless: true,
		productId: 'soundscaper',
		fileService: createAudioEditorFileService({ bridge: soundBridge }),
		setTimeout: soundTimers.setTimeout,
		clearTimeout: soundTimers.clearTimeout,
	}));
	const soundProjectActions = soundscaper.actions.project as unknown as HandoffProjectActions;

	await soundscaper.ready;
	const created = exactV9(soundscaper.getSnapshot().project);
	assertSourceFree(created);
	assert.ok(created.revision > 0);
	assert.ok(soundCommits.length > 0, 'controller creation must save through the shared repository');
	assert.equal(soundHost.readCatalog().revision, 1);
	assert.equal(exactV9(await soundService.readSharedProject(created.id)).revision, created.revision);

	soundClock.value = 11_000;
	soundProjectActions.rename('Soundscaper autosave');
	const dirty = exactV9(soundscaper.getSnapshot().project);
	assert.equal(dirty.revision, created.revision + 1);
	assert.equal(soundTimers.run(500), 1, 'rename must schedule one controller autosave');
	const autosaved = await waitForProject(soundService, created.id, (project) => (
		project.revision === dirty.revision && project.title === 'Soundscaper autosave'
	));
	assertSourceFree(autosaved);
	const catalogAfterAutosave = soundHost.readCatalog();
	assert.equal(catalogAfterAutosave.revision, 2);
	assert.equal(catalogAfterAutosave.projects[0]?.preferredProduct, 'soundscaper');

	await soundProjectActions.save();
	assert.deepEqual(soundHost.readCatalog(), catalogAfterAutosave, 'identical explicit save must be a catalog no-op');
	const soundToken = soundHost.snapshot().fencingToken;
	await resources.disposeController(soundscaper);
	await resources.closeHost(soundHost);

	const frameHost = await resources.startHost(FRAME_OWNER);
	assert.ok(frameHost.snapshot().fencingToken > soundToken);
	assert.equal(frameHost.snapshot().tookOverStaleLease, false);
	const frameClock = { value: 20_000 };
	const frameService = new DesktopSharedProjectLibraryService(frameHost, {
		now: () => frameClock.value,
		createEntryId: () => { throw new Error('handoff must retain the shared entry identity'); },
	});
	const frameStore = sharedStore('framescaper', serviceBridge(frameService));
	const sharedSummary = {
		id: created.id,
		title: autosaved.title,
		revision: autosaved.revision,
		updatedAt: new Date(soundClock.value).toISOString(),
	};
	assert.deepEqual(await frameStore.store.listProjects(), [sharedSummary], 'a fresh product-local store must discover the shared project');
	await frameStore.store.saveSetting('framescaper:last-project-id', created.id);
	const frameTimers = manualTimers();
	const framescaper = resources.trackController(createEditorController(null, {
		headless: true,
		productId: 'framescaper',
		store: frameStore.store,
		setTimeout: frameTimers.setTimeout,
		clearTimeout: frameTimers.clearTimeout,
	}));
	const frameProjectActions = framescaper.actions.project as unknown as HandoffProjectActions;

	await framescaper.ready;
	const reopened = exactV9(framescaper.getSnapshot().project);
	assert.equal(framescaper.getSnapshot().productId, 'framescaper');
	assert.equal(reopened.id, created.id);
	assert.equal(reopened.title, autosaved.title);
	assert.equal(reopened.revision, autosaved.revision);
	assertSourceFree(reopened);
	assert.deepEqual(await frameProjectActions.list(), [sharedSummary]);

	frameClock.value = 21_000;
	frameProjectActions.rename('Finished in Framescaper');
	const frameEdit = exactV9(framescaper.getSnapshot().project);
	assert.equal(frameEdit.revision, reopened.revision + 1);
	await frameProjectActions.flush();
	const handedOff = exactV9(await frameService.readSharedProject(created.id));
	assert.equal(handedOff.title, 'Finished in Framescaper');
	assert.equal(handedOff.revision, frameEdit.revision);
	assertSourceFree(handedOff);
	assert.equal(frameHost.readCatalog().revision, catalogAfterAutosave.revision + 1);
	assert.equal(frameHost.readCatalog().projects[0]?.preferredProduct, 'framescaper');
	assert.deepEqual(frameHost.readCatalog().media, []);
	assert.deepEqual(frameStore.cleanupErrors, []);
});

function sharedStore(
	product: string,
	bridge: DesktopSharedProjectBridge,
	databaseName = `editor-handoff-${product}-${Date.now()}-${Math.random()}`,
): Readonly<{
	store: AudioEditorProjectStore;
	cleanupErrors: Error[];
}> {
	const cleanupErrors: Error[] = [];
	return Object.freeze({
		cleanupErrors,
		store: createProjectStore({
			indexedDB: null,
			preferOpfs: false,
			databaseName,
			desktopProjectBridge: bridge,
			onDesktopSharedProjectLocalCleanupError: (error: Error) => { cleanupErrors.push(error); },
		}),
	});
}

function serviceBridge(
	service: DesktopSharedProjectLibraryService,
	commits: string[] = [],
): DesktopSharedProjectBridge {
	return Object.freeze({
		listSharedProjects: async () => service.listSharedProjects(),
		readSharedProject: (projectId: string) => service.readSharedProject(projectId),
		commitSharedProject: async (document: string) => {
			commits.push(document);
			return service.commitSharedProject(document);
		},
		deleteSharedProject: (projectId: string) => service.deleteSharedProject(projectId),
	});
}

function exactV9(value: unknown): ExactProjectV9 {
	const project = typeof value === 'string' ? parseScapeProjectDocument(value) : value;
	if (!validateAudioEditorProjectV9(project)) throw new TypeError('Expected an exact-V9 project.');
	if (typeof value === 'string') assert.equal(serializeScapeProjectDocument(project), value);
	return project as ExactProjectV9;
}

function assertSourceFree(project: ExactProjectV9): void {
	assert.equal(project.schemaVersion, 9);
	assert.deepEqual(project.sources, []);
	assert.deepEqual(project.clips, []);
	assert.deepEqual(project.projectBin.clips, []);
}

function manualTimers() {
	let nextHandle = 1;
	const pending = new Map<number, Readonly<{ callback: () => void; delayMs: number }>>();
	return Object.freeze({
		setTimeout: (callback: () => void, delayMs: number): number => {
			const handle = nextHandle;
			nextHandle += 1;
			pending.set(handle, { callback, delayMs });
			return handle;
		},
		clearTimeout: (handle: number): void => { pending.delete(handle); },
		run: (delayMs: number): number => {
			const ready = [...pending].filter(([, timer]) => timer.delayMs === delayMs);
			for (const [handle, timer] of ready) {
				pending.delete(handle);
				timer.callback();
			}
			return ready.length;
		},
	});
}

async function waitForProject(
	service: DesktopSharedProjectLibraryService,
	projectId: string,
	accept: (project: ExactProjectV9) => boolean,
): Promise<ExactProjectV9> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const document = await service.readSharedProject(projectId);
		if (document) {
			const project = exactV9(document);
			if (accept(project)) return project;
		}
		await new Promise<void>((resolve) => { setImmediate(resolve); });
	}
	throw new Error('Timed out waiting for the shared editor autosave.');
}

function createFixture(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'scape-editor-handoff-'));
}

function trackResources(context: TestContext, appDataPath: string) {
	const controllers = new Set<EditorController>();
	const hosts = new Set<DesktopProjectLibraryHost>();
	context.after(async () => {
		const errors: unknown[] = [];
		for (const controller of [...controllers].reverse()) {
			try { await controller.dispose(); } catch (error) { errors.push(error); }
		}
		for (const host of [...hosts].reverse()) {
			try { await host.close(); } catch (error) { errors.push(error); }
		}
		try { await rm(appDataPath, { recursive: true, force: true }); } catch (error) { errors.push(error); }
		if (errors.length) throw new AggregateError(errors, 'Editor handoff fixture cleanup failed');
	});
	return Object.freeze({
		trackController: (controller: EditorController): EditorController => {
			controllers.add(controller);
			return controller;
		},
		disposeController: async (controller: EditorController): Promise<void> => {
			await controller.dispose();
			controllers.delete(controller);
		},
		startHost: async (owner: DesktopLibraryOwner): Promise<DesktopProjectLibraryHost> => {
			const host = await DesktopProjectLibraryHost.start({
				appDataPath,
				owner,
				leaseTtlMs: 5_000,
				renewIntervalMs: 1_000,
			});
			hosts.add(host);
			return host;
		},
		closeHost: async (host: DesktopProjectLibraryHost): Promise<void> => {
			await host.close();
			hosts.delete(host);
		},
	});
}
