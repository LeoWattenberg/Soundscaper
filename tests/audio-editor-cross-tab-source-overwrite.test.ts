/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ClipTimePitchRenderCacheCoordinator } from '../src/common/editor/clip-time-pitch-cache.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { FakeStaffPadClient, clipFixture, sourceFixture, sourceStore } from './helpers/clip-time-pitch-cache-fixture.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('a default commit preserves an existing source held by unsaved same-tab history', async () => {
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(), memoryFallback: false, preferOpfs: false,
		databaseName: `same-tab-overwrite-${crypto.randomUUID()}`,
	});
	try {
		const originalWriter = await store.beginSourceWrite('unsaved-source', { sampleRate: 48_000 });
		await originalWriter.write([Float32Array.of(0.25)]);
		const original = await originalWriter.commit();
		const conflictingWriter = await store.beginSourceWrite('unsaved-source', { sampleRate: 48_000 });
		await conflictingWriter.write([Float32Array.of(0.9)]);
		await assert.rejects(conflictingWriter.commit(), { name: 'SourceAlreadyExistsError' });
		assert.deepEqual(await store.getSourceMetadata('unsaved-source'), original);
		assert.equal((await store.readSourceChunk('unsaved-source', 0))?.channels[0]?.[0], 0.25);
	} finally {
		await store.close();
	}
});

test('an explicit replacement cannot commit against a superseded source generation', async () => {
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(), memoryFallback: false, preferOpfs: false,
		databaseName: `same-tab-generation-${crypto.randomUUID()}`,
	});
	try {
		const firstWriter = await store.beginSourceWrite('shared-source', { sampleRate: 48_000 });
		await firstWriter.write([Float32Array.of(0.1)]);
		const first = await firstWriter.commit();
		const staleWriter = await store.beginSourceWrite('shared-source', { sampleRate: 48_000 });
		await staleWriter.write([Float32Array.of(0.3)]);
		const newerWriter = await store.beginSourceWrite('shared-source', { sampleRate: 48_000 });
		await newerWriter.write([Float32Array.of(0.5)]);
		const newer = await newerWriter.commit({}, {
			ifAbsent: false, expectedSourceToken: String(first.sourceToken),
		});
		await assert.rejects(staleWriter.commit({}, {
			ifAbsent: false, expectedSourceToken: String(first.sourceToken),
		}), { name: 'SourceReplacementRetainedError' });
		assert.deepEqual(await store.getSourceMetadata('shared-source'), newer);
		assert.equal((await store.readSourceChunk('shared-source', 0))?.channels[0]?.[0], 0.5);
	} finally {
		await store.close();
	}
});

test('an explicit replacement preserves a base used by an unsaved derived source', async () => {
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(), memoryFallback: false, preferOpfs: false,
		databaseName: `derived-base-overwrite-${crypto.randomUUID()}`,
	});
	try {
		const originalWriter = await store.beginSourceWrite('base-source', { sampleRate: 48_000, channelCount: 1 });
		await originalWriter.write([Float32Array.of(0.25)]);
		await originalWriter.write([Float32Array.of(0.5)]);
		const original = await originalWriter.commit({ chunkFrames: 1 });
		await store.writeDerivedSource('derived-source', 'base-source', [{
			index: 1, channels: [Float32Array.of(0.75)],
		}], { sampleRate: 48_000, channelCount: 1, chunkFrames: 1 });
		const replacement = await store.beginSourceWrite('base-source', { sampleRate: 48_000, channelCount: 1 });
		await replacement.write([Float32Array.of(0.9)]);
		await assert.rejects(replacement.commit({}, {
			ifAbsent: false, expectedSourceToken: String(original.sourceToken),
		}), { name: 'SourceReplacementRetainedError' });
		assert.deepEqual(await store.getSourceMetadata('base-source'), original);
		assert.equal((await store.readSourceChunk('derived-source', 0))?.channels[0]?.[0], 0.25);
	} finally {
		await store.close();
	}
});

test('StaffPad cache repair preserves an unrelated unsaved source at its deterministic ID', async () => {
	const store = await sourceStore('cache-id-collision');
	const client = new FakeStaffPadClient();
	const coordinator = new ClipTimePitchRenderCacheCoordinator({ store, client });
	try {
		const clip = clipFixture();
		const source = sourceFixture();
		const plan = await coordinator.plan(clip, source);
		const writer = await store.beginSourceWrite(plan.cacheSourceId, {
			name: 'Imported audio', mimeType: 'audio/wav', sampleRate: plan.sampleRate,
		});
		await writer.write([Float32Array.of(0.5)]);
		const imported = await writer.commit();
		await assert.rejects(coordinator.prepareCommittedOutput(clip, source));
		assert.equal(client.calls.length, 0);
		assert.deepEqual(await store.getSourceMetadata(plan.cacheSourceId), imported);
		assert.equal((await store.readSourceChunk(plan.cacheSourceId, 0))?.channels[0]?.[0], 0.5);
	} finally {
		await coordinator.dispose();
		await store.close();
	}
});

test('a source created during StaffPad rendering keeps its deterministic ID', async () => {
	const store = await sourceStore('cache-id-render-race');
	const client = new FakeStaffPadClient();
	const coordinator = new ClipTimePitchRenderCacheCoordinator({ store, client });
	try {
		const clip = clipFixture();
		const source = sourceFixture();
		const plan = await coordinator.plan(clip, source);
		const gate = client.blockNext();
		const rendering = coordinator.prepareCommittedOutput(clip, source);
		await client.waitForCalls(1);
		const writer = await store.beginSourceWrite(plan.cacheSourceId, {
			name: 'Imported audio', mimeType: 'audio/wav', sampleRate: plan.sampleRate,
		});
		await writer.write([Float32Array.of(0.5)]);
		const imported = await writer.commit();
		(gate as unknown as { resolve: () => void }).resolve();
		await assert.rejects(rendering);
		assert.deepEqual(await store.getSourceMetadata(plan.cacheSourceId), imported);
		assert.equal((await store.readSourceChunk(plan.cacheSourceId, 0))?.channels[0]?.[0], 0.5);
	} finally {
		await coordinator.dispose();
		await store.close();
	}
});

test('StaffPad repair cannot replace a newer source generation', async () => {
	const store = await sourceStore('cache-generation-race');
	const client = new FakeStaffPadClient();
	const coordinator = new ClipTimePitchRenderCacheCoordinator({ store, client });
	try {
		const clip = clipFixture();
		const source = sourceFixture();
		const plan = await coordinator.plan(clip, source);
		const staleWriter = await store.beginSourceWrite(plan.cacheSourceId, {
			mimeType: 'audio/x-kw-staffpad-cache', sampleRate: plan.sampleRate,
			cacheKey: plan.finalKey, sourceId: plan.sourceId, cacheSchemaVersion: 0,
		});
		await staleWriter.write([Float32Array.of(0.1)]);
		const stale = await staleWriter.commit();
		const gate = client.blockNext();
		const rendering = coordinator.prepareCommittedOutput(clip, source);
		await client.waitForCalls(1);
		const newerWriter = await store.beginSourceWrite(plan.cacheSourceId, {
			mimeType: 'audio/wav', sampleRate: plan.sampleRate,
		});
		await newerWriter.write([Float32Array.of(0.5)]);
		const newer = await newerWriter.commit({}, {
			ifAbsent: false, expectedSourceToken: String(stale.sourceToken),
		});
		(gate as unknown as { resolve: () => void }).resolve();
		await assert.rejects(rendering);
		assert.deepEqual(await store.getSourceMetadata(plan.cacheSourceId), newer);
		assert.equal((await store.readSourceChunk(plan.cacheSourceId, 0))?.channels[0]?.[0], 0.5);
	} finally {
		await coordinator.dispose();
		await store.close();
	}
});

test('one editor cannot replace PCM still owned by another open editor', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `cross-tab-overwrite-${crypto.randomUUID()}`;
	const create = () => createProjectStore({ indexedDB, databaseName, memoryFallback: false, preferOpfs: false });
	const first = create();
	const second = create();
	try {
		await first.ready();
		await second.ready();
		const originalWriter = await first.beginSourceWrite('shared-source', { sampleRate: 48_000 });
		await originalWriter.write([Float32Array.of(0.25)]);
		const original = await originalWriter.commit();
		const reader = await first.openSourceReadSession('shared-source', { expectedSource: original });
		assert.ok(reader);
		try {
			const replacement = await second.beginSourceWrite('shared-source', { sampleRate: 48_000 });
			await replacement.write([Float32Array.of(0.9)]);
			await assert.rejects(replacement.commit({}, {
				ifAbsent: false, expectedSourceToken: String(original.sourceToken),
			}), { name: 'SourceReplacementRetainedError' });
			assert.deepEqual(await first.getSourceMetadata('shared-source'), original);
			assert.equal((await reader.chunk(0)).channels[0]?.[0], 0.25);
		} finally {
			await reader.release();
		}
		await first.close();
		const replacement = await second.beginSourceWrite('shared-source', { sampleRate: 48_000 });
		await replacement.write([Float32Array.of(0.75)]);
		const published = await replacement.commit({}, {
			ifAbsent: false, expectedSourceToken: String(original.sourceToken),
		});
		assert.notEqual(published.sourceToken, original.sourceToken);
		assert.equal((await second.readSourceChunk('shared-source', 0))?.channels[0]?.[0], 0.75);
	} finally {
		await first.close();
		await second.close();
	}
});

test('an existing source referenced by a saved project cannot be replaced in place', async () => {
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(), memoryFallback: false, preferOpfs: false,
		databaseName: `saved-source-overwrite-${crypto.randomUUID()}`,
	});
	try {
		const originalWriter = await store.beginSourceWrite('saved-source', { sampleRate: 48_000 });
		await originalWriter.write([Float32Array.of(0.5)]);
		const original = await originalWriter.commit();
		await store.saveProject({
			id: 'project-1', schemaFamily: 'soundscaper', schemaVersion: 1,
			revision: 1, updatedAt: '2026-09-24T00:00:00.000Z',
			sources: [{ id: 'saved-source' }],
			clips: [{ id: 'clip-1', sourceId: 'saved-source' }],
		});
		const saved = await store.getSourceMetadata('saved-source');
		assert.equal(saved?.sourceToken, original.sourceToken);
		const replacement = await store.beginSourceWrite('saved-source', { sampleRate: 48_000 });
		await replacement.write([Float32Array.of(0.9)]);
		await assert.rejects(replacement.commit({}, {
			ifAbsent: false, expectedSourceToken: String(saved?.sourceToken),
		}), { name: 'SourceReplacementRetainedError' });
		assert.deepEqual(await store.getSourceMetadata('saved-source'), saved);
		assert.equal((await store.readSourceChunk('saved-source', 0))?.channels[0]?.[0], 0.5);
	} finally {
		await store.close();
	}
});
