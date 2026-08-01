/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from '../src/common/editor/storage/derivative-cache-entry.ts';
import { freshVerifiedMediaContentDigest } from '../src/common/editor/storage/media-content-provenance.ts';
import {
	VIDEO_DERIVATIVE_RECIPES,
	videoDerivativeIdentity,
	type VideoDerivativeRecipe,
} from '../src/common/editor/storage/video-derivative-relationship.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

interface InstrumentedIndexedDB {
	open(name: string, version?: number): IDBOpenDBRequest;
	records(databaseName: string, storeName: string): Record<string, unknown>[];
	seedRecord(databaseName: string, storeName: string, value: unknown, primaryKey?: IDBValidKey): void;
}

interface BoundDerivativeStore {
	readonly memory: {
		readonly mediaAssets: Map<string, unknown>;
		readonly videoDerivatives: Map<string, unknown>;
	};
	ready(): Promise<unknown>;
	writeMediaAsset(sourceId: string, blob: Blob): Promise<Record<string, unknown>>;
	saveVideoDerivative(sourceId: string, input: Readonly<{
		timestamp?: number;
		type?: string;
		recipe?: VideoDerivativeRecipe;
		blob?: unknown;
		metadata?: Record<string, unknown>;
	}>): Promise<Record<string, unknown>>;
	loadVideoDerivative(sourceId: string, selector?: Readonly<{
		timestamp?: number;
		type?: string;
		recipe?: VideoDerivativeRecipe;
	}>): Promise<Blob | null>;
	listVideoDerivatives(sourceId: string, selector?: Readonly<{
		type?: string;
		recipe?: VideoDerivativeRecipe;
	}>): Promise<Record<string, unknown>[]>;
	deleteVideoDerivative(sourceId: string, selector?: Readonly<{
		timestamp?: number;
		type?: string;
		recipe?: VideoDerivativeRecipe;
	}>): Promise<void>;
}

const RECIPE_V2 = Object.freeze({
	id: VIDEO_DERIVATIVE_RECIPES.poster.id,
	version: VIDEO_DERIVATIVE_RECIPES.poster.version + 1,
});

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} derivatives bind exact original content, recipe, and output integrity`, async () => {
		const fixture = createFixture(backend, `binding-${backend}`);
		await fixture.store.ready();
		const original = new Blob(['original-video'], { type: 'video/webm' });
		const originalSha256 = sha256('original-video');
		await fixture.store.writeMediaAsset('video-source', original);

		const v1 = await fixture.store.saveVideoDerivative('video-source', {
			timestamp: 0,
			type: 'poster',
			recipe: VIDEO_DERIVATIVE_RECIPES.poster,
			blob: new Blob(['poster-v1'], { type: 'image/webp' }),
			metadata: {
				derivativeBindingVersion: 99,
				originalSha256: 'caller-spoof',
				recipeId: 'caller-spoof',
				recipeVersion: 99,
				outputSha256: 'caller-spoof',
			},
		});
		const v2 = await fixture.store.saveVideoDerivative('video-source', {
			timestamp: 0,
			type: 'poster',
			recipe: RECIPE_V2,
			blob: new Blob(['poster-v2'], { type: 'image/webp' }),
		});

		assert.notEqual(v1.key, v2.key);
		assert.deepEqual(bindingScalars(v1), {
			derivativeBindingVersion: 1,
			originalSha256,
			recipeId: VIDEO_DERIVATIVE_RECIPES.poster.id,
			recipeVersion: VIDEO_DERIVATIVE_RECIPES.poster.version,
			outputSha256: sha256('poster-v1'),
		});
		assert.deepEqual(bindingScalars(v2), {
			derivativeBindingVersion: 1,
			originalSha256,
			recipeId: RECIPE_V2.id,
			recipeVersion: RECIPE_V2.version,
			outputSha256: sha256('poster-v2'),
		});
		assert.equal(
			v1.key,
			videoDerivativeIdentity(
				'video-source', originalSha256, 0, 'poster', VIDEO_DERIVATIVE_RECIPES.poster,
			).key,
		);
		assert.equal(
			await (await fixture.store.loadVideoDerivative('video-source', {
				timestamp: 0, type: 'poster', recipe: VIDEO_DERIVATIVE_RECIPES.poster,
			}))?.text(),
			'poster-v1',
		);
		assert.equal(
			await (await fixture.store.loadVideoDerivative('video-source', {
				timestamp: 0, type: 'poster', recipe: RECIPE_V2,
			}))?.text(),
			'poster-v2',
		);
		assert.deepEqual(
			(await fixture.store.listVideoDerivatives('video-source')).map(({ recipeVersion }) => recipeVersion),
			[VIDEO_DERIVATIVE_RECIPES.poster.version],
			'default lookup exposes only the maintained recipe revision',
		);
		assert.deepEqual(
			(await fixture.store.listVideoDerivatives('video-source', {
				type: 'poster', recipe: RECIPE_V2,
			})).map(({ recipeVersion }) => recipeVersion),
			[RECIPE_V2.version],
		);

		const records = fixture.records(VIDEO_DERIVATIVE_STORE_NAME);
		assert.equal(records.length, 2);
		if (backend === 'indexeddb') {
			assert.deepEqual(
				fixture.records(DERIVATIVE_CACHE_ENTRY_STORE_NAME).map(bindingScalars),
				records.map(bindingScalars),
				'companion rows retain the exact binding and output-integrity scalars',
			);
		}
	});

	test(`${backend} derivative publication requires repository-trusted original provenance`, async () => {
		const fixture = createFixture(backend, `trusted-original-${backend}`);
		await fixture.store.ready();

		await assert.rejects(
			fixture.store.saveVideoDerivative('missing', {
				type: 'poster', blob: new Blob(['poster']),
			}),
			/verified original media|original media.*missing/iu,
		);
		fixture.seedMediaAsset('untrusted', {
			sourceId: 'untrusted',
			storage: 'indexeddb-blob',
			blob: new Blob(['original']),
			size: 8,
			sha256: sha256('original'),
		});
		await assert.rejects(
			fixture.store.saveVideoDerivative('untrusted', {
				type: 'poster', blob: new Blob(['poster']),
			}),
			/verified original media/iu,
		);
		assert.deepEqual(fixture.records(VIDEO_DERIVATIVE_STORE_NAME), []);
		assert.deepEqual(fixture.records(DERIVATIVE_CACHE_ENTRY_STORE_NAME), []);
	});

	test(`${backend} derivative loads reject wrong-size and equal-size corrupt bodies`, async () => {
		const fixture = createFixture(backend, `integrity-${backend}`);
		await fixture.store.ready();
		await fixture.store.writeMediaAsset('video-source', new Blob(['original-video']));
		const metadata = await fixture.store.saveVideoDerivative('video-source', {
			type: 'poster',
			blob: new Blob(['poster-body']),
		});
		const record = onlyRecord(fixture.records(VIDEO_DERIVATIVE_STORE_NAME));

		fixture.seedDerivative({ ...record, blob: new Blob(['short']) });
		await assert.rejects(
			fixture.store.loadVideoDerivative('video-source', { type: 'poster' }),
			/derivative.*size|size.*derivative/iu,
		);
		fixture.seedDerivative({ ...record, blob: new Blob(['altered-bod']) });
		await assert.rejects(
			fixture.store.loadVideoDerivative('video-source', { type: 'poster' }),
			/derivative.*digest|digest.*derivative/iu,
		);
		if (backend === 'indexeddb') {
			fixture.seedDerivative({
				...record,
				blob: new Blob(['altered-bod']),
				outputSha256: sha256('altered-bod'),
			});
			await assert.rejects(
				fixture.store.loadVideoDerivative('video-source', { type: 'poster' }),
				/paired integrity/iu,
				'payload metadata cannot override the companion digest',
			);
		}
		assert.equal(metadata.outputSha256, sha256('poster-body'));
	});

	test(`${backend} explicit recipe deletion preserves other revisions`, async () => {
		const fixture = createFixture(backend, `recipe-delete-${backend}`);
		await fixture.store.ready();
		await fixture.store.writeMediaAsset('video-source', new Blob(['original-video']));
		await fixture.store.saveVideoDerivative('video-source', {
			type: 'poster',
			recipe: VIDEO_DERIVATIVE_RECIPES.poster,
			blob: new Blob(['poster-v1']),
		});
		await fixture.store.saveVideoDerivative('video-source', {
			type: 'poster',
			recipe: RECIPE_V2,
			blob: new Blob(['poster-v2']),
		});

		await fixture.store.deleteVideoDerivative('video-source', {
			timestamp: 0,
			type: 'poster',
			recipe: RECIPE_V2,
		});

		assert.equal(
			await (await fixture.store.loadVideoDerivative('video-source', {
				type: 'poster', recipe: VIDEO_DERIVATIVE_RECIPES.poster,
			}))?.text(),
			'poster-v1',
		);
		assert.equal(
			await fixture.store.loadVideoDerivative('video-source', { type: 'poster', recipe: RECIPE_V2 }),
			null,
		);
		assert.equal(fixture.records(VIDEO_DERIVATIVE_STORE_NAME).length, 1);
		if (backend === 'indexeddb') {
			assert.equal(fixture.records(DERIVATIVE_CACHE_ENTRY_STORE_NAME).length, 1);
		}

		await fixture.store.deleteVideoDerivative('video-source', { type: 'poster' });
		assert.deepEqual(fixture.records(VIDEO_DERIVATIVE_STORE_NAME), []);
	});
}

test('video derivative relationships reject open or noncanonical identity fields', () => {
	const digest = 'a'.repeat(64);
	const positiveZero = videoDerivativeIdentity('source', digest, 0, 'poster');
	const negativeZero = videoDerivativeIdentity('source', digest, -0, 'poster');
	assert.equal(negativeZero.key, positiveZero.key);
	assert.equal(negativeZero.timestamp, 0);
	assert.throws(() => videoDerivativeIdentity('source', digest.toUpperCase(), 0, 'poster'), /lowercase SHA-256/u);
	assert.throws(() => videoDerivativeIdentity('source', digest, -1, 'poster'), /non-negative/u);
	assert.throws(() => videoDerivativeIdentity('source', digest, 0, 'proxy'), /poster or thumbnail/u);
	assert.throws(
		() => videoDerivativeIdentity('source', digest, 0, 'poster', { id: 'x'.repeat(129), version: 1 }),
		/cannot exceed 128/u,
	);
	assert.throws(
		() => videoDerivativeIdentity('source', digest, 0, 'poster', { id: 'recipe', version: 0 }),
		/positive safe integer/u,
	);
});

test('same-key original replacement makes prior derivatives cache misses', async () => {
	const fixture = createFixture('memory', 'replacement');
	await fixture.store.writeMediaAsset('video-source', new Blob(['original-a']));
	await fixture.store.saveVideoDerivative('video-source', {
		type: 'poster', blob: new Blob(['poster-a']),
	});
	const replacement = new Blob(['original-b']);
	fixture.seedMediaAsset('video-source', {
		sourceId: 'video-source',
		...freshVerifiedMediaContentDigest(sha256('original-b')),
		storage: 'indexeddb-blob',
		blob: replacement,
		size: replacement.size,
	});

	assert.equal(await fixture.store.loadVideoDerivative('video-source', { type: 'poster' }), null);
	assert.deepEqual(await fixture.store.listVideoDerivatives('video-source'), []);
});

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} same-digest replacement generation is a cache miss`, async () => {
		const fixture = createFixture(backend, `same-digest-replacement-${backend}`);
		const replacement = new Blob(['original-video']);
		await fixture.store.writeMediaAsset('video-source', replacement);
		await fixture.store.saveVideoDerivative('video-source', {
			type: 'poster', blob: new Blob(['poster']),
		});
		fixture.seedMediaAsset('video-source', {
			sourceId: 'video-source',
			...freshVerifiedMediaContentDigest(sha256('original-video')),
			storage: 'indexeddb-blob',
			blob: replacement,
			size: replacement.size,
		});

		assert.equal(await fixture.store.loadVideoDerivative('video-source', { type: 'poster' }), null);
		assert.deepEqual(await fixture.store.listVideoDerivatives('video-source'), []);
	});
}

test('legacy unbound derivative rows are disposable cache misses', async () => {
	const fixture = createFixture('memory', 'legacy-unbound');
	await fixture.store.writeMediaAsset('video-source', new Blob(['original-video']));
	const legacyKey = JSON.stringify(['video-source', 'poster', 0]);
	fixture.store.memory.videoDerivatives.set(legacyKey, {
		key: legacyKey,
		sourceId: 'video-source',
		timestamp: 0,
		type: 'poster',
		storage: 'indexeddb-blob',
		blob: new Blob(['legacy-poster']),
		size: 13,
		committedAt: new Date(0).toISOString(),
	});

	assert.equal(await fixture.store.loadVideoDerivative('video-source', { type: 'poster' }), null);
	assert.deepEqual(await fixture.store.listVideoDerivatives('video-source'), []);
});

function createFixture(backend: 'memory' | 'indexeddb', suffix: string) {
	const indexedDB = backend === 'indexeddb'
		? createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB
		: null;
	const databaseName = `video-derivative-binding-${suffix}-${Date.now()}-${Math.random()}`;
	const store = createProjectStore({
		indexedDB,
		memoryFallback: backend === 'memory',
		preferOpfs: false,
		databaseName,
	}) as unknown as BoundDerivativeStore;
	return {
		store,
		records(storeName: string): Record<string, unknown>[] {
			if (indexedDB) return indexedDB.records(databaseName, storeName);
			if (storeName === VIDEO_DERIVATIVE_STORE_NAME) {
				return [...store.memory.videoDerivatives.values()] as Record<string, unknown>[];
			}
			return [];
		},
		seedMediaAsset(sourceId: string, record: Record<string, unknown>) {
			if (indexedDB) indexedDB.seedRecord(databaseName, 'mediaAssets', record);
			else store.memory.mediaAssets.set(sourceId, structuredClone(record));
		},
		seedDerivative(record: Record<string, unknown>) {
			if (indexedDB) indexedDB.seedRecord(databaseName, VIDEO_DERIVATIVE_STORE_NAME, record);
			else store.memory.videoDerivatives.set(String(record.key), structuredClone(record));
		},
	};
}

function bindingScalars(record: Record<string, unknown>) {
	return {
		derivativeBindingVersion: record.derivativeBindingVersion,
		originalSha256: record.originalSha256,
		recipeId: record.recipeId,
		recipeVersion: record.recipeVersion,
		outputSha256: record.outputSha256,
	};
}

function onlyRecord(records: Record<string, unknown>[]): Record<string, unknown> {
	assert.equal(records.length, 1);
	return records[0];
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
