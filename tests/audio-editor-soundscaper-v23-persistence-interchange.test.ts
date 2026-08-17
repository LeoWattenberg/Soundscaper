/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { createSoundscaperProjectRuntimeV23Selection } from '../src/soundscaper/editor-project-runtime-v23-selection.ts';
import { createSoundscaperEditorProjectEnvironmentV23 } from '../src/soundscaper/editor-project-environment-v23.ts';
import { createSoundscaperScapeNativeRuntimeV23 } from '../src/soundscaper/editor-scape-native-v23.ts';
import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';
import { validateSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23-validation.ts';

const NOW = '2026-08-17T00:00:00.000Z';

/** A V23 document holding a mastering sequence, which is the state at risk. */
function project(id: string) {
	const base = createSoundscaperProjectV23({
		id, title: 'Mastering', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
	} as never);
	return createSoundscaperProjectV23({
		id, title: 'Mastering', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
		masteringSequences: [{
			id: 'album',
			sequenceId: base.primarySequenceId,
			name: 'Album order',
			entries: [
				{ id: 'e1', annotationId: 'region-a', title: 'Overture', metadata: { isrc: 'GBAYE0000123' } },
				{ id: 'e2', annotationId: 'region-b', gapBeforeFrames: 96_000, fadeOutFrames: 48_000 },
			],
		}],
	} as never);
}

const sequencesOf = (value: unknown) => (
	(value as { masteringSequences: readonly unknown[] }).masteringSequences
);

test('durable V23 browser storage preserves mastering sequences and refuses foreign schemas', async (context: TestContext) => {
	const environment = await createSoundscaperEditorProjectEnvironmentV23({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	const original = project('durable-v23');

	assert.deepEqual(await environment.createProjectIfAbsent(original), original);
	const reopened = await environment.store.loadProject(original.id);
	assert.ok(reopened);
	assert.equal(validateSoundscaperProjectV23(reopened), true);
	assert.deepEqual(
		sequencesOf(reopened),
		sequencesOf(original),
		'the sequence survives a real storage round trip, entries and metadata intact',
	);
	assert.notStrictEqual(
		sequencesOf(reopened),
		original.masteringSequences,
		'and it comes back detached rather than shared',
	);

	// A V21 document must not be smuggled into V23 storage.
	await assert.rejects(
		environment.store.saveProject({ ...original, schemaVersion: 21 }),
		/V23|schemaVersion|schema version/iu,
	);
});

test('a V23 project duplicates with its mastering sequences', async (context: TestContext) => {
	const environment = await createSoundscaperEditorProjectEnvironmentV23({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	const original = project('duplicate-v23');
	await environment.createProjectIfAbsent(original);

	const copy = await environment.store.duplicateProject(original.id, {
		id: 'duplicate-v23-copy',
		title: 'Copy',
	});
	assert.equal(validateSoundscaperProjectV23(copy), true);
	assert.equal(copy.id, 'duplicate-v23-copy');
	assert.deepEqual(sequencesOf(copy), sequencesOf(original));
});

test('a native V23 Scape round trip reopens the mastering sequences exactly', async (context: TestContext) => {
	const runtime = createSoundscaperScapeNativeRuntimeV23();
	const source = memoryStore(context);
	const target = memoryStore(context);
	const original = project('scape-v23');
	await source.saveProject(original);

	const exported = await runtime.exportScapeProject(original, source);
	assert.ok(exported.blob);

	const inspected = await runtime.inspectScapeProject(
		exported.blob,
		null,
		{ signal: new AbortController().signal },
		{ retain: () => undefined },
	);
	assert.equal(inspected.schemaVersion, 23);
	assert.equal(inspected.readOnly, false);

	const imported = await runtime.importScapeProject(exported.blob, target);
	assert.equal(imported.readOnly, false);
	assert.equal(validateSoundscaperProjectV23(imported.project), true);
	assert.deepEqual(
		sequencesOf(imported.project),
		sequencesOf(original),
		'a sequence survives export and reimport as a whole document field',
	);

	const reopened = await target.loadProject(original.id);
	assert.ok(reopened);
	assert.deepEqual(sequencesOf(reopened), sequencesOf(original));
});

test('the persisted form is byte-idempotent across a save and reload', async (context: TestContext) => {
	const environment = await createSoundscaperEditorProjectEnvironmentV23({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	context.after(() => environment.close());
	const original = project('idempotent-v23');
	await environment.createProjectIfAbsent(original);
	const first = await environment.store.loadProject(original.id);
	await environment.store.saveProject(first);
	const second = await environment.store.loadProject(original.id);
	assert.equal(
		JSON.stringify(second),
		JSON.stringify(first),
		'saving what was loaded changes nothing',
	);
});

function memoryStore(context: TestContext): AudioEditorProjectStore {
	const store = createSoundscaperProjectRuntimeV23Selection().createProjectStore({
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false,
		maximumProjectDocumentBytes: 16 * 1024 * 1024,
	});
	context.after(() => store.close());
	return store;
}
