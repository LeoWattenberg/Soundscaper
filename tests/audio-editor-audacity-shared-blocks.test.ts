/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { planAudacitySampleBlockStorage } from '../src/common/editor/aup4-import-block-storage.ts';
import { streamAup4SourceAudio } from '../src/common/editor/aup4-import-audio.ts';
import type { Aup4ImportSourcePlan } from '../src/common/editor/aup4-import-plan.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';
import { readPcm } from './helpers/project-store-pcm-fixture.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeAup4Client } from '../src/common/editor/controller/document/native-project-types.ts';
import { createFixture, nativeFile, project } from './helpers/native-project-service-fixture.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

function source(sourceId: string, ids: readonly number[]): Aup4ImportSourcePlan {
	const blocks = ids.map((blockId, index) => ({ blockId, start: index * 3, frameCount: 3 }));
	return { sourceId, sampleRate: 48_000, channelCount: 1, frameCount: ids.length * 3,
		channelPlans: [{ sampleRate: 48_000, frameCount: ids.length * 3, outputFrames: ids.length * 3, blocks }] };
}

test('Audacity storage plans keep shared, reordered and silent blocks without multiplying PCM', async () => {
	const plan = planAudacitySampleBlockStorage([source('one', [1, 2]), source('two', [2, 1, -3])], 'pool');
	assert.equal(plan.pcmBytes, 24);
	assert.equal(plan.backingSources.length, 1);
	assert.equal(plan.backingSources[0]?.frameCount, 6);
	assert.equal(plan.sequences.length, 2);
	const reads: number[] = [];
	const backing = plan.backingSources[0]!;
	for await (const _chunk of streamAup4SourceAudio(backing, (block) => {
		reads.push(block.blockId);
		return Float32Array.of(block.blockId, 0, -block.blockId);
	})) { /* Pull all backing PCM. */ }
	assert.deepEqual(reads, [1, 2]);
});

test('ten clips sharing a two-GiB recording require two GiB of backing PCM', () => {
	const blocks = Array.from({ length: 2_048 }, (_, index) => ({ blockId: index + 1,
		start: index * 262_144, frameCount: 262_144 }));
	const frameCount = 2_048 * 262_144;
	const sources = Array.from({ length: 10 }, (_, index): Aup4ImportSourcePlan => ({
		sourceId: `source-${String(index)}`, sampleRate: 48_000, frameCount, channelCount: 1,
		channelPlans: [{ sampleRate: 48_000, frameCount, outputFrames: frameCount, blocks }],
	}));
	const plan = planAudacitySampleBlockStorage(sources, 'pool');
	assert.equal(plan.pcmBytes, 2 * 1024 ** 3);
	assert.equal(plan.sequences.length, 10);
	assert.equal(plan.backingSources[0]?.channelPlans[0]?.blocks.length, 2_048);
});

test('mixed-rate channels retain streaming resampling and silence plans remain bounded', () => {
	const mixed = { ...source('mixed', [1]), channelPlans: [
		{ ...source('mixed', [1]).channelPlans[0]!, sampleRate: 44_100 },
	] };
	const plan = planAudacitySampleBlockStorage([mixed], 'pool');
	assert.deepEqual(plan.backingSources, [mixed]);
	assert.deepEqual(plan.sequences, []);
	const silence = planAudacitySampleBlockStorage([source('silence', [-3, -3])], 'pool');
	assert.equal(silence.pcmBytes, 4);
	assert.equal(silence.backingSources[0]?.frameCount, 1);
});

test('shared block sources survive reopening, read across chunk boundaries, and protect their backing PCM', async (context) => {
	const store = createMemoryProjectStore(context, 'audacity-shared-blocks');
	const plan = planAudacitySampleBlockStorage([source('one', [1, 2]), source('two', [2, 1, -3])], 'pool');
	const writer = await store.beginSourceWrite('pool', { sampleRate: 48_000, channelCount: 1, chunkFrames: 4 });
	await writer.write([Float32Array.of(1, 2, 3, 4)]);
	await writer.write([Float32Array.of(5, 6)]);
	await writer.commit();
	for (const sequence of plan.sequences) {
		await store.writeSampleBlockSource(sequence.sourceId, sequence.baseSourceId, sequence.channels, {
			sampleRate: 48_000, channelCount: 1, frameCount: sequence.sourceId === 'one' ? 6 : 9, chunkFrames: 4,
		});
	}
	assert.deepEqual(await readPcm(store, 'one'), [[1, 2, 3, 4, 5, 6]]);
	assert.deepEqual(await readPcm(store, 'two'), [[4, 5, 6, 1, 2, 3, 0, 0, 0]]);
	const session = await store.openSourceReadSession('two');
	assert.ok(session);
	assert.deepEqual(Array.from((await session.chunk(1)).channels[0]!), [2, 3, 0, 0]);
	await session.release();
	await assert.rejects(store.deleteSource('pool'), /retained/u);
	const edited = await store.writeDerivedSource('edited', 'two', [{ index: 1, channels: [Float32Array.of(8, 8, 8, 8)] }]);
	assert.equal(edited.storage, 'copy-on-write');
	assert.deepEqual(await readPcm(store, 'edited'), [[4, 5, 6, 1, 8, 8, 8, 8, 0]]);
	assert.deepEqual(await readPcm(store, 'two'), [[4, 5, 6, 1, 2, 3, 0, 0, 0]]);
	await store.deleteSource('edited');
	await store.deleteSource('two');
	await store.deleteSource('one');
	await store.deleteSource('pool');
	assert.deepEqual(await store.listSources(), []);
});

test('invalid shared block ranges never publish a source', async (context) => {
	const store = createMemoryProjectStore(context, 'audacity-invalid-blocks');
	const writer = await store.beginSourceWrite('pool', { sampleRate: 48_000, channelCount: 1, chunkFrames: 3 });
	await writer.write([Float32Array.of(1, 2, 3)]);
	await writer.commit();
	await assert.rejects(store.writeSampleBlockSource('bad', 'pool', [[{ start: 0, frameCount: 4, poolStartFrame: 0 }]], {
		sampleRate: 48_000, channelCount: 1, frameCount: 4, chunkFrames: 3,
	}), /range/u);
	assert.equal(await store.getSourceMetadata('bad'), null);
});

test('IndexedDB reopening preserves stereo block sharing and pruning keeps its backing source', async (context) => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const options = { indexedDB, preferOpfs: false, databaseName: `shared-stereo-${String(Date.now())}` };
	let store = createProjectStore(options);
	context.after(async () => { await store.close(); });
	const writer = await store.beginSourceWrite('pool', { sampleRate: 48_000, channelCount: 1, chunkFrames: 3 });
	await writer.write([Float32Array.of(1, 2, 3)]);
	await writer.write([Float32Array.of(4, 5, 6)]);
	await writer.commit();
	await store.writeSampleBlockSource('stereo', 'pool', [
		[{ start: 0, frameCount: 3, poolStartFrame: 0 }, { start: 3, frameCount: 3, poolStartFrame: 3 }],
		[{ start: 0, frameCount: 3, poolStartFrame: 3 }],
	], { sampleRate: 48_000, channelCount: 2, frameCount: 6, chunkFrames: 3 });
	await store.close();
	store = createProjectStore(options);
	assert.deepEqual(await readPcm(store, 'stereo'), [[1, 2, 3, 4, 5, 6], [4, 5, 6, 0, 0, 0]]);
	await store.pruneUnreferencedSources({ protectedProjects: [{ schemaFamily: 'soundscaper', schemaVersion: 1,
		clips: [{ sourceId: 'stereo' }] }], minimumAgeMs: 0, now: Date.now() + 2 * 24 * 60 * 60 * 1_000 });
	assert.ok(await store.getSourceMetadata('pool'));
	const metadata = await store.getSourceMetadata('stereo');
	assert.ok(metadata);
	assert.equal(await store.sourceRepository.replaceMetadataIfCurrent(metadata, { ...metadata, sampleBlockChannels: [] }), false);
});

for (const failPublication of [false, true]) {
	test(`Audacity import preflights unique PCM and ${failPublication ? 'rolls back dependent sources first' : 'publishes shared sources'}`, async (context) => {
		const store = createMemoryProjectStore(context, 'native-shared-blocks');
		const plans = [source('one', [1, 2]), source('two', [2, 1])];
		const storage = planAudacitySampleBlockStorage(plans, 'pool');
		const imported = { ...project('imported'), sources: plans.map((plan) => ({ kind: 'audio' as const,
			id: plan.sourceId, name: plan.sourceId, mimeType: 'audio/x-audacity-sampleblocks',
			frameCount: plan.frameCount, channelCount: plan.channelCount, sampleRate: plan.sampleRate,
		})) };
		const events: string[] = [];
		const client: NativeAup4Client = {
			initialize: async () => ({ opfs: true }), create: async () => undefined,
			openFile: async () => ({ readOnly: false }),
			planImport: async (_id, options) => {
				assert.equal(options.preserveSampleBlocks, true);
				return { project: imported, sources: [], sampleBlockStorage: storage };
			},
			decode: async () => assert.fail('Unexpected buffered decoding'),
			async *readSourceChunks(_id, sourceId) {
				events.push(`read:${sourceId}`);
				assert.equal(sourceId, 'pool');
				yield [Float32Array.of(1, 2, 3, 4, 5, 6)];
			},
			writeSnapshot: async () => ({}), commit: async () => undefined, export: async () => ({}),
			inspect: async () => ({}), delete: async () => undefined,
		};
		const fixture = createFixture({ createAup4Client: () => client, store: {
			estimateStorage: async () => ({ usage: 0, quota: 1_000_000 }),
			beginSourceWrite: store.beginSourceWrite.bind(store),
			writeSampleBlockSource: async (id, base, channels, metadata) => {
				if (failPublication && id === 'two') throw new Error('Publication failed');
				return store.writeSampleBlockSource(id, base, channels, metadata);
			},
			deleteSource: async (id) => { events.push(`delete:${id}`); await store.deleteSource(id); },
		}, preflightStorage: (bytes) => { assert.equal(bytes, 24); events.push('preflight'); } });
		const opening = createNativeProjectService(fixture.runtime).openAudacityProject(nativeFile('shared.aup3'));
		if (failPublication) {
			await assert.rejects(opening, /Publication failed/u);
			assert.deepEqual(events, ['preflight', 'read:pool', 'delete:one', 'delete:pool']);
			assert.deepEqual(await store.listSources(), []);
			assert.deepEqual(fixture.switched, []);
		} else {
			await opening;
			assert.deepEqual(events, ['preflight', 'read:pool']);
			assert.deepEqual(await readPcm(store, 'two'), [[4, 5, 6, 1, 2, 3]]);
			assert.deepEqual(fixture.switched, ['imported']);
		}
	});
}
