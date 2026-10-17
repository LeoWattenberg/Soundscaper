/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { framescaperSuccessorPlaybackCanonicalProject } from '../src/framescaper/editor-project-successor-playback.ts';
import { createFramescaperSuccessorEnvironment, assertFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
test('successor environment binds its own durable catalog and explicit transient playback', async () => {
	const factory = createInstrumentedIndexedDB();
	const env = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: factory as unknown as IDBFactory, preferOpfs: false } });
	try {
		assert.equal(assertFramescaperSuccessorEnvironment(env), env); assert.throws(() => assertFramescaperSuccessorEnvironment({ ...env }), /exact|environment/iu);
		const project = env.runtime.createProject({ id: 'environment', title: 'Successor' });
		assert.equal(project.schemaVersion, 2); await env.controllerStore.createProjectIfAbsent(project);
		assert.equal((await env.controllerStore.loadProject(project.id))?.schemaVersion, 2);
		await env.playback.prepareProjectForActivation?.(project);
		const projection = env.playback.projectForPlayback(project).project;
		assert.equal(projection.schemaVersion, 1); assert.deepEqual(framescaperSuccessorPlaybackCanonicalProject(projection), project);
		assert.equal(framescaperSuccessorPlaybackCanonicalProject({ ...projection }), null);
		assert.equal(factory.recordCount('kw-media-framescaper-editor-v1', 'projects'), 0);
	} finally { await env.close(); }
	await assert.rejects(createFramescaperSuccessorEnvironment({ line: 'baseline' }), /successor/iu);
	await assert.rejects(createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { databaseName: 'kw-media-framescaper-editor-v1' } }), /override|namespace/iu);
});
