/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNativeProjectService,
	type NativeProjectServiceRuntime,
} from '../src/common/editor/controller/native-project-service.ts';
import type {
	NativeProjectDocument,
	ScapeImportResult,
} from '../src/common/editor/controller/native-project-types.ts';
import {
	EditorControllerLifetime,
	EditorProjectGeneration,
} from '../src/common/editor/controller/lifecycle.ts';

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

function project(id: string): NativeProjectDocument {
	return { id, title: id, schemaVersion: 5, sources: [], clips: [] };
}

function nativeFile(name: string): Blob & Readonly<{ name: string }> {
	const file = new Blob(['scape']);
	Object.defineProperty(file, 'name', { value: name });
	return file as Blob & Readonly<{ name: string }>;
}

function createFixture(
	importScapeProject: NativeProjectServiceRuntime['importScapeProject'],
	overrides: Partial<NativeProjectServiceRuntime> = {},
) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const projectGeneration = new EditorProjectGeneration();
	let activeProject = project('active-project');
	projectGeneration.activate(activeProject.id);
	const switched: string[] = [];
	const statuses: string[] = [];
	const state = { importing: false, saveState: 'saved', readOnly: false, mobile: false };
	const publishedImporting: boolean[] = [];
	const runtime: Partial<NativeProjectServiceRuntime> = {
		lifetime,
		projectGeneration,
		state,
		copy: {
			projectNotFound: 'Project not found.',
			projectReadOnly: 'Project is read-only.',
			missingSourcesPreventSave: 'Missing sources.',
			projectSaved: 'Project saved.',
			futureProjectReadOnly: 'Future project.',
			chooseAup4File: 'Choose AUP4.',
			aup4Validating: 'Validating.',
			importing: 'Importing.',
			oversizedAup4ReadOnly: 'Oversized.',
			newerAup4ReadOnly: 'Newer project.',
			aup4Opened: 'Opened.',
			aup4OnlyV2: 'AUP4 requires V2.',
			aup4Saving: 'Saving.',
			sourcePcmUnavailable: 'Missing source.',
			aup4Saved: 'Saved.',
		},
		store: {} as NativeProjectServiceRuntime['store'],
		getProject: () => activeProject,
		switchProject: async (nextProject) => {
			activeProject = nextProject;
			projectGeneration.activate(nextProject.id);
			switched.push(nextProject.id);
		},
		editingBlocked: () => false,
		importScapeProject,
		setStatus: (message) => { statuses.push(message); },
		publishDocumentSnapshot: () => { publishedImporting.push(state.importing); },
		...overrides,
	};
	return {
		activateProject(id: string) {
			activeProject = project(id);
			projectGeneration.activate(id);
			runtime.publishDocumentSnapshot?.();
		},
		publishedImporting,
		service: createNativeProjectService(runtime as NativeProjectServiceRuntime),
		state,
		statuses,
		switched,
	};
}

test('Scape open decorates capacity estimates with import task ownership', async () => {
	let importSignal: AbortSignal | undefined;
	const estimates: Array<Readonly<{
		requiredBytes: number;
		operation: 'export' | 'import';
		signal?: AbortSignal;
	}>> = [];
	const fixture = createFixture(async (_file, _store, options) => {
		importSignal = options.signal;
		const estimateStorageForPreflight = options.estimateStorageForPreflight;
		assert.equal(typeof estimateStorageForPreflight, 'function');
		assert.deepEqual(await estimateStorageForPreflight(100, 'import'), {
			usage: 25,
			quota: 1_000,
		});
		return { project: project('imported-project'), readOnly: false, manifest: {} };
	}, {
		estimateStorageForPreflight: async (requiredBytes, operation, signal) => {
			estimates.push({ requiredBytes, operation, signal });
			return { usage: 25, quota: 1_000 };
		},
	});

	const imported = await fixture.service.openScape(nativeFile('capacity.scape'));

	assert.equal(imported?.project.id, 'imported-project');
	assert.deepEqual(fixture.switched, ['imported-project']);
	assert.deepEqual(estimates.map(({ requiredBytes, operation }) => ({ requiredBytes, operation })), [{
		requiredBytes: 100,
		operation: 'import',
	}]);
	assert.equal(estimates[0]?.signal, importSignal);
});

test('a stale Scape open republishes cleared import state after external activation', async () => {
	const imported = deferred<ScapeImportResult>();
	const fixture = createFixture(() => imported.promise);
	const opening = fixture.service.openScape(nativeFile('stale.scape'));
	fixture.activateProject('new-active-project');
	imported.resolve({ project: project('stale-import'), readOnly: false, manifest: {} });

	await assert.rejects(opening, (error: unknown) => (
		error instanceof Error && error.name === 'AbortError'
	));
	assert.deepEqual(fixture.switched, []);
	assert.equal(fixture.state.importing, false);
	assert.deepEqual(fixture.publishedImporting, [true, true, false]);
});

test('Scape open composes caller cancellation with task ownership and suppresses a late import result', async () => {
	const imported = deferred<ScapeImportResult>();
	const caller = new AbortController();
	const reason = 'primitive caller cancellation';
	const capture: { signal?: AbortSignal } = {};
	const fixture = createFixture((_file, _store, options) => {
		capture.signal = options.signal;
		return imported.promise;
	});
	const opening = fixture.service.openScape(nativeFile('caller.scape'), { signal: caller.signal });
	assert.ok(capture.signal instanceof AbortSignal);
	assert.notEqual(capture.signal, caller.signal, 'native task and caller cancellation use a composed signal');
	caller.abort(reason);
	assert.equal(capture.signal.reason, reason);
	imported.resolve({ project: project('stale-import'), readOnly: false, manifest: {} });

	await assert.rejects(opening, (error: unknown) => error === reason);
	assert.deepEqual(fixture.switched, []);
	assert.equal(fixture.state.importing, false);
	assert.equal(fixture.statuses.includes('Project saved.'), false);
});

test('an already-aborted Scape caller rejects before archive import', async () => {
	const caller = new AbortController();
	const reason = new DOMException('Caller was already cancelled.', 'AbortError');
	caller.abort(reason);
	let importCalls = 0;
	const fixture = createFixture(async () => {
		importCalls += 1;
		return { project: project('unreachable'), readOnly: false, manifest: {} };
	});

	await assert.rejects(
		fixture.service.openScape(nativeFile('cancelled.scape'), { signal: caller.signal }),
		(error: unknown) => error === reason,
	);
	assert.equal(importCalls, 0);
	assert.deepEqual(fixture.switched, []);
	assert.equal(fixture.state.importing, false);
});
