/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import {
	createBaselineAudioEditorProject,
	importBaselineScapeProject,
} from './helpers/baseline-scape-runtime.ts';

const SOURCE_ID = 'shared-archive-source';
const NOW = '2026-09-24T00:00:00.000Z';

test('concurrent Scape imports keep both PCM bodies when source IDs collide across stores', async (context) => {
	const firstArchive = await audioArchive(context, 'first-project', 0.25);
	const secondArchive = await audioArchive(context, 'second-project', -0.75);
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const options = {
		indexedDB,
		preferOpfs: false,
		databaseName: `scape-source-race-${String(Date.now())}-${String(Math.random())}`,
	};
	const firstStore = createProjectStore(options);
	const secondStore = createProjectStore(options);
	context.after(async () => { await Promise.all([firstStore.close(), secondStore.close()]); });
	await Promise.all([firstStore.ready(), secondStore.ready()]);

	// Both imports must finish their absent-ID lookups before either can publish PCM.
	let lookups = 0;
	let releaseLookups!: () => void;
	const bothLookedUp = new Promise<void>((resolve) => { releaseLookups = resolve; });
	const race = (store: typeof firstStore): typeof firstStore => new Proxy(store, {
		get(target, property, receiver) {
			if (property === 'getSourceMetadata') return async (sourceId: string) => {
				const metadata = await target.getSourceMetadata(sourceId);
				if (sourceId === SOURCE_ID && lookups++ < 2) {
					if (lookups === 2) releaseLookups();
					await bothLookedUp;
				}
				return metadata;
			};
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	const [first, second] = await Promise.all([
		importBaselineScapeProject(firstArchive, race(firstStore)),
		importBaselineScapeProject(secondArchive, race(secondStore)),
	]);
	const firstSourceId = first.project.sources[0]?.id;
	const secondSourceId = second.project.sources[0]?.id;
	assert.ok(firstSourceId);
	assert.ok(secondSourceId);
	assert.notEqual(firstSourceId, secondSourceId);
	assert.ok([firstSourceId, secondSourceId].includes(SOURCE_ID));
	assert.deepEqual(await sourceSamples(firstStore, firstSourceId), [0.25, 0.25]);
	assert.deepEqual(await sourceSamples(secondStore, secondSourceId), [-0.75, -0.75]);
	assert.deepEqual((await firstStore.loadProject('first-project'))?.sources, first.project.sources);
	assert.deepEqual((await secondStore.loadProject('second-project'))?.sources, second.project.sources);
});

async function audioArchive(context: TestContext, projectId: string, sample: number): Promise<Blob> {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `scape-source-race-export-${projectId}-${String(Math.random())}`,
	});
	context.after(async () => { await store.close(); });
	const writer = await store.beginSourceWrite(SOURCE_ID, {
		name: `${projectId}.wav`, mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1,
	});
	await writer.write([Float32Array.of(sample, sample)]);
	await writer.commit();
	const clip = createAudioClip({
		id: `${projectId}-clip`, sourceId: SOURCE_ID, timelineStartFrame: 0, durationFrames: 2,
	});
	const project = createBaselineAudioEditorProject({
		id: projectId,
		title: projectId,
		now: NOW,
		sampleRate: 48_000,
		sources: [createAudioSource({
			id: SOURCE_ID, storageKey: SOURCE_ID, name: `${projectId}.wav`,
			mimeType: 'audio/wav', frameCount: 2, channelCount: 1,
		})],
		clips: [clip],
		tracks: [createAudioTrack({ id: `${projectId}-track`, name: projectId, clipIds: [clip.id] })],
	});
	const exported = await exportScapeProject(project, store);
	assert.ok(exported.blob instanceof Blob);
	return exported.blob;
}

async function sourceSamples(store: ReturnType<typeof createProjectStore>, sourceId: string): Promise<number[]> {
	const samples: number[] = [];
	for await (const chunk of store.readSourceChunks(sourceId)) {
		const channels = chunk.channels || chunk;
		samples.push(...channels[0]!);
	}
	return samples;
}
