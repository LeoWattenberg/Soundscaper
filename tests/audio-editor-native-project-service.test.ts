/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeProjectService } from '../src/common/editor/controller/native-project-service.ts';
import type {
	NativeAup4Client,
	NativeProjectDocument,
	ScapeImportResult,
} from '../src/common/editor/controller/native-project-types.ts';
import {
	createFixture,
	nativeFile,
	project,
} from './helpers/native-project-service-fixture.ts';

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	resolve(value: Value): void;
	reject(error: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		signal.addEventListener('abort', () => { reject(signal.reason); }, { once: true });
	});
}


test('late Scape import completion cannot activate over a newer project', async () => {
	const imported = deferred<ScapeImportResult>();
	const fixture = createFixture({ importScapeProject: () => imported.promise });
	const service = createNativeProjectService(fixture.runtime);
	const opening = service.openScape(nativeFile('old.scape', 10));
	fixture.replaceProject('project-b');
	imported.resolve({ project: project('imported'), readOnly: false, manifest: {} });

	await assert.rejects(opening, (error: unknown) => (
		error instanceof Error && error.name === 'AbortError'
	));
	assert.deepEqual(fixture.switched, []);
	assert.equal(fixture.state.importing, false);
	assert.equal(fixture.statuses.some(({ message }) => message === 'Project saved.'), false);
});

test('Scape open and save pass their task AbortSignal through archive work', async () => {
	const importStarted = deferred<void>();
	let importSignal: AbortSignal | undefined;
	const openingFixture = createFixture({
		importScapeProject: async (_file, _store, options) => {
			importSignal = options.signal;
			importStarted.resolve();
			return rejectWhenAborted(options.signal);
		},
	});
	const openingService = createNativeProjectService(openingFixture.runtime);
	const opening = openingService.openScape(nativeFile('cancel.scape', 10));
	await importStarted.promise;
	assert.ok(importSignal instanceof AbortSignal);
	openingFixture.lifetime.cancelTask('native-project-open');
	await assert.rejects(opening, (error: unknown) => error instanceof Error && error.name === 'AbortError');
	assert.equal(openingFixture.state.importing, false);

	const exportStarted = deferred<void>();
	let exportSignal: AbortSignal | undefined;
	const savingFixture = createFixture({
		exportScapeProject: async (_project, _store, options) => {
			exportSignal = options.signal;
			exportStarted.resolve();
			return rejectWhenAborted(options.signal);
		},
	});
	const savingService = createNativeProjectService(savingFixture.runtime);
	const saving = savingService.saveScape({ useFileSystemAccess: false });
	await exportStarted.promise;
	assert.ok(exportSignal instanceof AbortSignal);
	savingFixture.lifetime.cancelTask('native-project-save');
	await assert.rejects(saving, (error: unknown) => error instanceof Error && error.name === 'AbortError');
	assert.equal(savingFixture.state.saveState, 'dirty');
});

test('Scape save passes the same task AbortSignal into file publication', async () => {
	const savingStarted = deferred<void>();
	let archiveSignal: AbortSignal | undefined;
	let fileSignal: AbortSignal | undefined;
	const fixture = createFixture({
		exportScapeProject: async (_project, _store, options) => {
			archiveSignal = options.signal;
			return { blob: new Blob(['scape']), manifest: {} };
		},
		fileService: {
			isDesktop: false,
			chooseSaveTarget: async () => ({ browserDownload: true }),
			prepareSave: async (request) => ({ mode: 'blob', fileName: request.suggestedName, target: { browserDownload: true } }),
			saveFile: async (request) => {
				fileSignal = request.signal;
				savingStarted.resolve();
				return rejectWhenAborted(request.signal);
			},
		},
	});
	const service = createNativeProjectService(fixture.runtime);
	const saving = service.saveScape({ useFileSystemAccess: false });
	await savingStarted.promise;
	assert.ok(archiveSignal instanceof AbortSignal);
	assert.equal(fileSignal, archiveSignal);
	fixture.lifetime.cancelTask('native-project-save');
	await assert.rejects(saving, (error: unknown) => error instanceof Error && error.name === 'AbortError');
	assert.equal(fixture.state.saveState, 'dirty');
});

test('a project switch during AUP4 snapshot writing suppresses commit and save publication', async () => {
	const writing = deferred<Readonly<Record<string, unknown>>>();
	let commitCalls = 0;
	let exportCalls = 0;
	let saveCalls = 0;
	const deletedNativeIds: string[] = [];
	const saveProject: NativeProjectDocument = {
		...project(),
		sources: [{
			kind: 'audio', id: 'source-a', storageKey: 'source-a', name: 'Voice', mimeType: 'audio/wav',
			frameCount: 1, channelCount: 1, sampleRate: 48_000,
		}],
		clips: [{ id: 'clip-a', kind: 'audio', sourceId: 'source-a' }],
	};
	const fixture = createFixture({
		getProject: () => saveProject,
		createAup4Client: () => ({
			initialize: async () => ({ opfs: false }),
			create: async () => undefined,
			openFile: async () => ({ readOnly: false }),
			decode: async () => ({ project: saveProject, sources: [] }),
			writeSnapshot: () => writing.promise,
			commit: async () => { commitCalls += 1; },
			export: async () => { exportCalls += 1; return { bytes: Uint8Array.of(1) }; },
			inspect: async () => ({}),
			delete: async (nativeId) => { deletedNativeIds.push(nativeId); },
		}),
		saveAup4Result: async () => { saveCalls += 1; return {}; },
	});
	const service = createNativeProjectService(fixture.runtime);
	const saving = service.saveAup4({ useFileSystemAccess: false });
	await new Promise<void>((resolve) => setImmediate(resolve));
	fixture.replaceProject('project-b');
	writing.resolve({});

	await assert.rejects(saving, (error: unknown) => (
		error instanceof Error && error.name === 'AbortError'
	));
	assert.equal(commitCalls, 0);
	assert.equal(exportCalls, 0);
	assert.equal(saveCalls, 0);
	assert.deepEqual(deletedNativeIds, ['aup4-export-native']);
	assert.equal(fixture.state.saveState, 'saved');
});

test('failed AUP4 source staging rolls back committed PCM and closes the native database', async () => {
	const deletedNativeIds: string[] = [];
	const deletedSources: string[] = [];
	let writerIndex = 0;
	const imported: NativeProjectDocument = {
		...project('imported'),
		sources: [
			{ kind: 'audio', id: 'source-a', storageKey: 'source-a', name: 'A', mimeType: 'audio/wav', frameCount: 1, channelCount: 1, sampleRate: 48_000 },
			{ kind: 'audio', id: 'source-b', storageKey: 'source-b', name: 'B', mimeType: 'audio/wav', frameCount: 1, channelCount: 1, sampleRate: 48_000 },
		],
	};
	const fixture = createFixture({
		store: {
			estimateStorage: async () => ({ usage: 0, quota: 1_000_000 }),
			beginSourceWrite: async () => {
				const index = writerIndex++;
				return {
					write: async () => { if (index === 1) throw new Error('disk failed'); },
					commit: async () => undefined,
					abort: async () => undefined,
				};
			},
			deleteSource: async (sourceId) => { deletedSources.push(sourceId); },
		},
		createAup4Client: () => ({
			initialize: async () => ({ opfs: true }),
			create: async () => undefined,
			openFile: async () => ({ readOnly: false, validation: { issues: [] } }),
			decode: async () => ({
				project: imported,
				sources: [
					{ sourceId: 'source-a', channels: [Float32Array.of(1)] },
					{ sourceId: 'source-b', channels: [Float32Array.of(2)] },
				],
			}),
			writeSnapshot: async () => ({}),
			commit: async () => undefined,
			export: async () => ({ bytes: Uint8Array.of(1) }),
			inspect: async () => ({}),
			delete: async (nativeId) => { deletedNativeIds.push(nativeId); },
		}),
		loadProject: () => ({ project: imported }),
	});
	const service = createNativeProjectService(fixture.runtime);

	await assert.rejects(service.openAup4(nativeFile('broken.aup4', 20)), /disk failed/u);
	assert.deepEqual(deletedSources, ['source-a']);
	assert.deepEqual(deletedNativeIds, ['audacity-project-native']);
	assert.equal(fixture.state.importing, false);
});

test('failed AUP4 activation retains PCM when the imported project is already current', async () => {
	const imported: NativeProjectDocument = {
		...project('imported'),
		sources: [{ kind: 'audio', id: 'source-a', storageKey: 'source-a', name: 'A', mimeType: 'audio/wav',
			frameCount: 1, channelCount: 1, sampleRate: 48_000 }],
	};
	let activeProject = project();
	let activateProject = (_projectId: string) => undefined;
	const fixture = createFixture({
		getProject: () => activeProject,
		switchProject: async (nextProject) => {
			activeProject = nextProject; activateProject(nextProject.id);
			throw new Error('late activation failed');
		},
		createAup4Client: () => ({
			initialize: async () => ({ opfs: false }),
			create: async () => undefined,
			openFile: async () => ({ readOnly: false, validation: { issues: [] } }),
			decode: async () => ({
				project: imported,
				sources: [{ sourceId: 'source-a', channels: [Float32Array.of(1)] }],
			}),
			writeSnapshot: async () => ({}),
			commit: async () => undefined,
			export: async () => ({ bytes: Uint8Array.of(1) }),
			inspect: async () => ({}),
			delete: async () => undefined,
		}),
		loadProject: () => ({ project: imported }),
	});
	activateProject = (projectId) => { fixture.projectGeneration.activate(projectId); };
	const service = createNativeProjectService(fixture.runtime);
	await assert.rejects(service.openAup4(nativeFile('late-failure.aup4', 20)), /late activation failed/u);
	assert.equal(activeProject.id, imported.id);
	assert.deepEqual(fixture.deletedSources, []);
});

test('disposing during AUP4 initialization is terminal and cannot resurrect the client', async () => {
	const initialization = deferred<Readonly<{ opfs: boolean }>>();
	let createCalls = 0;
	let disposeCalls = 0;
	const fixture = createFixture({
		createAup4Client: () => {
			createCalls += 1;
			return {
				initialize: () => initialization.promise,
				create: async () => undefined,
				openFile: async () => ({ readOnly: false }),
				decode: async () => ({ project: project(), sources: [] }),
				writeSnapshot: async () => ({}),
				commit: async () => undefined,
				export: async () => ({ bytes: Uint8Array.of(1) }),
				inspect: async () => ({}),
				dispose: () => { disposeCalls += 1; },
			};
		},
	});
	const service = createNativeProjectService(fixture.runtime);
	const client = service.getAup4Client();
	await service.dispose();
	initialization.resolve({ opfs: true });

	await assert.rejects(client, (error: unknown) => (
		typeof error === 'object' && error !== null && 'code' in error && error.code === 'DISPOSED'
	));
	await assert.rejects(service.getAup4Client(), (error: unknown) => (
		typeof error === 'object' && error !== null && 'code' in error && error.code === 'DISPOSED'
	));
	assert.equal(createCalls, 1);
	assert.equal(disposeCalls, 1);
});

test('compatibility reports are attached to and dismissed from only the active tab', () => {
	const fixture = createFixture();
	const service = createNativeProjectService(fixture.runtime);
	const report = service.rememberAup4CompatibilityReport({ items: [] }, 'save');

	assert.equal(report.direction, 'save');
	assert.deepEqual(fixture.metadata.get('project-a'), {
		aup4CompatibilityReport: report,
		aup4CompatibilityReportDismissed: false,
	});
	assert.equal(service.dismissAup4CompatibilitySummary(), true);
	assert.equal(service.dismissAup4CompatibilitySummary(), false);
	fixture.replaceProject('project-b');
	assert.equal(service.dismissAup4CompatibilitySummary(), false);
});

test('Scape open and save preserve the archive manifest and file contract', async () => {
	const importedProject = project('scape-imported');
	const fixture = createFixture({
		importScapeProject: async () => ({
			project: importedProject,
			readOnly: false,
			manifest: { format: 'scape-project' },
		}),
		exportScapeProject: async (snapshot) => ({
			blob: new Blob([snapshot.id]),
			manifest: { projectId: snapshot.id },
		}),
	});
	const service = createNativeProjectService(fixture.runtime);
	fixture.state.readOnly = true;
	const opened = await service.openScape(nativeFile('session.SCAPE', 20), { collision: 'copy' });
	assert.equal(opened?.project.id, 'scape-imported');
	assert.deepEqual(fixture.switched, ['scape-imported']);
	assert.deepEqual(fixture.statuses.at(-1), { message: 'Project is read-only.', state: 'error' });
	fixture.state.readOnly = false;
	const saved = await service.saveScape({ fileName: 'session', useFileSystemAccess: false });
	assert.ok('manifest' in saved);
	assert.deepEqual(saved.manifest, { projectId: 'scape-imported' });
	assert.equal(fixture.state.saveState, 'saved');
	assert.equal(fixture.statuses.filter(({ message }) => message === 'Project saved.').length, 1);
});

test('a future-schema scape saves only as an exact unchanged archive copy', async () => {
	const archive = new File([Uint8Array.of(80, 75, 3, 4, 42)], 'future.scape', {
		type: 'application/vnd.soundscaper.scape+zip',
	});
	const savedBlobs: Blob[] = [];
	const fixture = createFixture({
		importScapeProject: async () => ({
			project: { ...project('future-project'), schemaVersion: 16 },
			readOnly: true,
			reason: 'newer-schema',
			manifest: { format: 'scape-project' },
			collision: null,
		}),
		hasMissingTimelineSources: () => {
			throw new Error('An unchanged archive copy must not inspect timeline sources.');
		},
		fileService: {
			isDesktop: false,
			chooseSaveTarget: async () => ({ browserDownload: true }),
			prepareSave: async (request) => ({ mode: 'blob', fileName: request.suggestedName, target: { browserDownload: true } }),
			saveFile: async (request) => {
				savedBlobs.push(request.blob);
				return { fileName: request.suggestedName, size: request.blob.size };
			},
		},
	});
	const service = createNativeProjectService(fixture.runtime);
	const opened = await service.openScape(archive);
	assert.equal(opened?.readOnly, true);
	fixture.state.readOnly = true;

	await assert.rejects(service.saveScape(), /read-only/u);
	const saved = await service.saveScape({ saveCopy: true, useFileSystemAccess: false });
	assert.ok('manifest' in saved);
	assert.deepEqual(saved.manifest, { format: 'scape-project' });
	assert.equal(savedBlobs.length, 1);
	assert.equal(savedBlobs[0], archive,
		'the copy save must hand the exact retained archive to the destination');
	assert.deepEqual(fixture.statuses.at(-1), { message: 'Project saved.', state: 'success' });
});

test('native project validation and editing gates reject before starting work', async () => {
	const blocked = createFixture({ editingBlocked: () => true });
	const service = createNativeProjectService(blocked.runtime);
	await assert.rejects(service.openScape(nativeFile('audio.wav')), /Choose a Scape project file/u);
	await assert.rejects(service.openScape(nativeFile('disguised.sscape.zip')), /Choose a Scape project file/u);
	await assert.rejects(service.openAudacityProject(nativeFile('audio.wav')), /Choose an Audacity project/u);
	assert.equal(await service.openScape(nativeFile('blocked.scape')), null);
	assert.equal(await service.openAudacityProject(nativeFile('blocked.aup3')), undefined);
	assert.equal(await service.openAudacityProject(nativeFile('blocked.AUP4')), undefined);
	assert.equal(await service.openAup4(nativeFile('blocked.aup4')), undefined);
	assert.equal(blocked.publishes(), 0);
});

test('failed Scape saves restore dirty state while preconditions leave state untouched', async () => {
	const fixture = createFixture({
		exportScapeProject: async () => { throw new Error('archive failed'); },
	});
	const service = createNativeProjectService(fixture.runtime);
	await assert.rejects(service.saveScape(), /archive failed/u);
	assert.equal(fixture.state.saveState, 'dirty');

	fixture.state.readOnly = true;
	fixture.state.saveState = 'saved';
	await assert.rejects(service.saveScape(), /read-only/u);
	await assert.rejects(service.saveAup4(), /read-only/u);
	assert.equal(fixture.state.saveState, 'saved');
});

test('AUP4 save streams cached and stored PCM, publishes compatibility, and deletes staging', async () => {
	const snapshot: NativeProjectDocument = {
		...project(),
		sources: [
			{ id: 'cached', storageKey: 'cached', name: 'Cached', mimeType: 'audio/wav', frameCount: 2, channelCount: 1, sampleRate: 48_000 },
			{ id: 'stored', storageKey: 'stored', name: 'Stored', mimeType: 'audio/wav', frameCount: 1, channelCount: 1, sampleRate: 48_000 },
			{ kind: 'video', id: 'video', storageKey: 'video', name: 'Video', mimeType: 'video/mp4', frameCount: 1, sampleRate: 48_000 },
		],
		clips: [
			{ id: 'cached-clip', sourceId: 'cached' },
			{ id: 'stored-clip', sourceId: 'stored' },
			{ id: 'video-clip', kind: 'video', sourceId: 'video' },
		],
	};
	const staged: string[] = [];
	const streamed: string[] = [];
	let initializeCalls = 0;
	const client: NativeAup4Client = {
		initialize: async () => { initializeCalls += 1; return { opfs: true }; },
		create: async (id) => { staged.push(`create:${id}`); },
		openFile: async () => ({ readOnly: false }),
		decode: async () => ({ project: snapshot, sources: [] }),
		async writeSnapshot(_id, _project, sources, options) {
			assert.equal(options.opfs, true);
			for await (const source of sources) {
				streamed.push(source.sourceId);
				assert.ok(source.channels[0].length > 0);
			}
			return { compatibilityReport: { items: [] } };
		},
		commit: async (id) => { staged.push(`commit:${id}`); },
		export: async (_id, options) => {
			options.onProgress({ value: 1.5 });
			return { bytes: Uint8Array.of(1, 2), validation: { valid: true } };
		},
		inspect: async () => { throw new Error('inline validation should be reused'); },
		delete: async (id) => { staged.push(`delete:${id}`); },
	};
	const fixture = createFixture({
		getProject: () => snapshot,
		initialAup4Client: client,
		createAup4Client: () => { throw new Error('initial client should be reused'); },
		sourceBuffers: new Map([['cached', {
			numberOfChannels: 1,
			getChannelData: () => Float32Array.of(0.25, -0.25),
		}]]),
		loadStoredSourceChannels: async (_store, source) => (
			source.id === 'stored' ? [Float32Array.of(0.5)] : null
		),
	});
	const service = createNativeProjectService(fixture.runtime);
	const result = await service.saveAup4({ fileName: 'mix', useFileSystemAccess: false });

	assert.deepEqual(streamed, ['cached', 'stored']);
	assert.deepEqual(staged, [
		'create:aup4-export-native',
		'commit:aup4-export-native',
		'delete:aup4-export-native',
	]);
	assert.equal(initializeCalls, 1);
	assert.equal(result.cancelled, undefined);
	assert.equal(fixture.state.saveState, 'saved');
	assert.equal(fixture.metadata.get('project-a')?.aup4CompatibilityReportDismissed, false);
	assert.ok(fixture.statuses.some(({ message }) => message === 'Saving 100%'));
});

test('AUP3 open uses the shared lifecycle, diagnostics, and close cleanup', async () => {
	const importedProject = project('aup4-read-only');
	const closed: string[] = [];
	const fixture = createFixture({
		createAup4Client: () => ({
			initialize: async () => ({ opfs: false }),
			create: async () => undefined,
			openFile: async (_id, _file, options) => {
				options.onProgress({ value: -1 });
				return {
					readOnly: true,
					validation: { issues: [{ code: 'EDITABLE_LIMIT_EXCEEDED', level: 'warning', message: 'Too large.' }] },
				};
			},
			decode: async (_id, options) => {
				options.onProgress({ value: 0.5 });
				return { project: importedProject, sources: [], warnings: ['Converted.'] };
			},
			writeSnapshot: async () => ({}),
			commit: async () => undefined,
			export: async () => ({ bytes: Uint8Array.of(1) }),
			inspect: async () => ({}),
			close: async (id) => { closed.push(id); },
		}),
		loadProject: () => ({ project: importedProject }),
	});
	const service = createNativeProjectService(fixture.runtime);
	const result = await service.openAudacityProject(nativeFile('large.AUP3', 10));

	assert.equal((result?.project as NativeProjectDocument).id, 'aup4-read-only');
	assert.equal((result?.compatibilityReport as { sourceGeneration: string }).sourceGeneration, 'aup3');
	assert.deepEqual(closed, ['audacity-project-native']);
	assert.ok(fixture.statuses.some(({ message, state }) => message === 'Oversized.' && state === 'error'));
	assert.ok(fixture.statuses.some(({ message }) => message === 'Importing 0%'));
	assert.ok(fixture.statuses.some(({ message }) => message === 'Importing 50%'));
});

test('Audacity open uses its dedicated project adapter instead of general native admission', async () => {
	const decodedProject = { ...project('decoded-v17'), schemaVersion: 17 };
	const importedProject = { ...project('imported-v21'), schemaVersion: 21 };
	let adapterCalls = 0;
	let migrationCalls = 0;
	const fixture = createFixture({
		createAup4Client: () => ({
			initialize: async () => ({ opfs: false }),
			create: async () => undefined,
			openFile: async () => ({ readOnly: false, validation: { issues: [] } }),
			decode: async () => ({ project: decodedProject, sources: [] }),
			writeSnapshot: async () => ({}),
			commit: async () => undefined,
			export: async () => ({ bytes: Uint8Array.of(1) }),
			inspect: async () => ({}),
			delete: async () => undefined,
		}),
		adaptAudacityProject: async (value) => {
			adapterCalls += 1;
			assert.strictEqual(value, decodedProject);
			return importedProject;
		},
		loadProject: () => {
			migrationCalls += 1;
			throw new Error('general native admission must remain fenced');
		},
	});
	const service = createNativeProjectService(fixture.runtime);

	const result = await service.openAudacityProject(nativeFile('interchange.AUP3', 10));

	assert.equal((result?.project as NativeProjectDocument).schemaVersion, 21);
	assert.equal(adapterCalls, 1);
	assert.equal(migrationCalls, 0);
});

test('AUP4 save awaits the optional product-owned export preparation hook', async () => {
	const snapshot = project();
	let writtenTitle: string | null = null;
	const fixture = createFixture({
		getProject: () => snapshot,
		prepareAudacityProjectExport: async (value) => ({ ...value, title: 'Portable native state' }),
		createAup4Client: () => ({
			initialize: async () => ({ opfs: false }),
			create: async () => undefined,
			openFile: async () => ({ readOnly: false }),
			decode: async () => ({ project: snapshot, sources: [] }),
			writeSnapshot: async (_id, value) => { writtenTitle = String(value.title); return {}; },
			commit: async () => undefined,
			export: async () => ({ bytes: Uint8Array.of(1) }),
			inspect: async () => ({}),
			delete: async () => undefined,
		}),
	});
	const service = createNativeProjectService(fixture.runtime);
	await service.saveAup4({ useFileSystemAccess: false });
	assert.equal(writtenTitle, 'Portable native state');
});

test('cancelled desktop targets and retryable initialization do not mutate save state', async () => {
	let initializeCalls = 0;
	const fixture = createFixture({
		fileService: {
			isDesktop: true,
			chooseSaveTarget: async () => { throw new DOMException('cancelled', 'AbortError'); },
			prepareSave: async () => ({ mode: 'cancelled', cancelled: true, fileName: 'cancelled.scape' }),
			saveFile: async () => ({}),
		},
		createAup4Client: () => ({
			initialize: async () => {
				initializeCalls += 1;
				if (initializeCalls === 1) throw new Error('worker unavailable');
				return { opfs: false };
			},
			create: async () => undefined,
			openFile: async () => ({ readOnly: false }),
			decode: async () => ({ project: project(), sources: [] }),
			writeSnapshot: async () => ({}),
			commit: async () => undefined,
			export: async () => ({ bytes: Uint8Array.of(1) }),
			inspect: async () => ({}),
		}),
	});
	const service = createNativeProjectService(fixture.runtime);
	assert.deepEqual(await service.saveAup4(), { cancelled: true });
	assert.equal(fixture.state.saveState, 'saved');
	await assert.rejects(service.getAup4Client(), /worker unavailable/u);
	await service.getAup4Client();
	assert.equal(initializeCalls, 2);
	assert.equal(service.nativeProjectProgressMessage({ value: Number.NaN }, 'Work'), 'Work 0%');
});
