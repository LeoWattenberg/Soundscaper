/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { collectProjectSourceIds } from '../src/common/editor/retention.js';
import { exportScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import {
	canonicalPcmBytes,
	digest,
	readPcm,
	writePcm,
} from './helpers/desktop-project-library-fallback-handoff-fixture.ts';
import {
	createCycleProducedTakeFixture,
	type CycleProducedAudioSource,
} from './helpers/cycle-produced-take-fixture.ts';

interface ScapeImportResult {
	readonly project: AudioEditorProjectCurrent;
	readonly collision: 'copy' | 'replace' | null;
}

const COLLIDING_CHANNELS = Object.freeze([Object.freeze([0.875, -0.875])]);

test('current Scape collision-copy preserves and exactly remaps take-only PCM after reopen', async (context) => {
	const fixture = await createCycleProducedTakeFixture('recovery');
	context.after(async () => { await fixture.store.close(); });
	const sender = fixture.store;
	const recipient = memoryStore(context, 'scape-take-only-recipient');
	assert.deepEqual(fixture.project.clips, []);
	assert.deepEqual(fixture.project.projectBin.clips, []);
	assert.deepEqual(
		[...collectProjectSourceIds(fixture.project)],
		fixture.pcm.map(({ source }) => source.id),
		'take groups must be the only logical roots for both PCM sources',
	);
	const exported = await exportScapeProject(fixture.project, sender);
	assert.ok(exported.blob instanceof Blob);
	assert.deepEqual(exported.manifest.assets.map(({ kind, sha256, size, sourceId }) => ({
		kind, sha256, size, sourceId,
	})), fixture.pcm.map(({ channels, source }) => {
		const body = canonicalPcmBytes(channels);
		return { kind: 'audio', sha256: digest(body), size: body.byteLength, sourceId: source.id };
	}));

	await recipient.saveProject(createCurrentAudioEditorProject({
		id: fixture.project.id,
		title: 'Existing collision owner',
		now: '2026-08-12T12:30:00.000Z',
	}));
	for (const { source } of fixture.pcm) {
		await writePcm(recipient, collisionSource(source), COLLIDING_CHANNELS);
	}

	const copied = await importScapeProject(exported.blob, recipient, {
		collision: 'copy',
	}) as ScapeImportResult;
	assert.equal(copied.collision, 'copy');
	assert.notEqual(copied.project.id, fixture.project.id);
	assert.equal(copied.project.revision, 0);
	assert.match(copied.project.title, / copy$/u);

	const remappedSourceIds = new Map<string, string>();
	for (const [index, { source }] of fixture.pcm.entries()) {
		const importedSource = copied.project.sources[index];
		assert.ok(importedSource);
		const importedId = dataString(importedSource, 'id');
		assert.notEqual(importedId, source.id);
		assert.equal(dataString(importedSource, 'storageKey'), importedId);
		remappedSourceIds.set(source.id, importedId);
	}
	const originalGroup = fixture.project.takeGroups[0];
	const copiedGroup = copied.project.takeGroups[0];
	assert.ok(originalGroup && copiedGroup);
	assert.deepEqual(copiedGroup, {
		...originalGroup,
		takes: originalGroup.takes.map((take) => ({
			...take,
			sourceId: remappedSourceIds.get(take.sourceId),
		})),
	});
	assert.deepEqual(copiedGroup.takes.map(({ id, sourceId }) => ({ id, sourceId })),
		originalGroup.takes.map(({ id, sourceId }) => ({ id, sourceId: remappedSourceIds.get(sourceId) })));

	for (const { channels, source } of fixture.pcm) {
		const importedId = remappedSourceIds.get(source.id);
		assert.ok(importedId);
		assert.deepEqual(await readPcm(recipient, importedId), channels);
		assert.deepEqual(await readPcm(recipient, source.id), COLLIDING_CHANNELS,
			'the recipient-owned colliding PCM must remain untouched');
	}

	const reopened = await recipient.loadProject(copied.project.id);
	assert.ok(reopened);
	assert.equal(
		serializeScapeProjectDocument(reopened),
		serializeScapeProjectDocument(copied.project),
	);
	const exactReopened = reopened as AudioEditorProjectCurrent;
	assert.deepEqual(exactReopened.takeGroups, copied.project.takeGroups);
	for (const { channels, source } of fixture.pcm) {
		const importedId = remappedSourceIds.get(source.id);
		assert.ok(importedId);
		assert.deepEqual(await readPcm(recipient, importedId), channels);
	}
});

function collisionSource(source: CycleProducedAudioSource): CycleProducedAudioSource {
	return { ...source, storageKey: source.id, frameCount: COLLIDING_CHANNELS[0]!.length,
		chunkFrames: COLLIDING_CHANNELS[0]!.length };
}

function dataString(value: Readonly<Record<string, unknown>>, key: string): string {
	const candidate = value[key];
	if (typeof candidate !== 'string' || !candidate) throw new TypeError(`Expected ${key}.`);
	return candidate;
}

function memoryStore(context: TestContext, label: string): AudioEditorProjectStore {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `${label}-${String(Date.now())}-${String(Math.random())}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}
