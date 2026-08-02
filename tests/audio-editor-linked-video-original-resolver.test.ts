/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LinkedVideoOriginalResolver,
	type LinkedVideoOriginalPort,
} from '../src/common/editor/storage/linked-video-original-resolver.ts';
import { LinkedVideoOriginalRepository } from '../src/common/editor/storage/linked-video-original-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

const NOW = '2026-08-02T10:11:12.345Z';

test('linked video resolver derives exact body identity and resolves a fenced Blob snapshot', async () => {
	const body = new Blob(['linked original video'], { type: 'video/mp4' });
	const reads: Array<Readonly<{ locatorId: string; expectedRevision: string | null }>> = [];
	const resolver = fixtureResolver({
		async load(locatorId, { expectedRevision }) {
			reads.push({ locatorId, expectedRevision });
			return { blob: body, locatorRevision: 'snapshot_0000000000000001' };
		},
	});
	const source = videoSource();

	const binding = await resolver.bind('project-linked-video', source, 'locator_0000000000000001');
	assert.equal(binding.byteLength, body.size);
	assert.equal(binding.sha256, '20eb6c5f892090816b6ee44cdf8de96d84bcb77d87883738fdb3b67349f998d3');
	assert.deepEqual(binding.sourceShape, sourceShape());
	assert.deepEqual(reads, [{
		locatorId: 'locator_0000000000000001',
		expectedRevision: null,
	}]);

	const resolved = await resolver.resolve('project-linked-video', source);
	assert.ok(resolved);
	assert.equal(await resolved.blob.text(), 'linked original video');
	assert.deepEqual(resolved.metadata, {
		sourceId: source.storageKey,
		storage: 'linked-video-original-v1',
		path: null,
		committedAt: NOW,
		mimeType: source.mimeType,
		size: body.size,
		sha256: binding.sha256,
	});
	assert.equal('locatorId' in resolved.metadata, false);
	assert.deepEqual(reads.at(-1), {
		locatorId: 'locator_0000000000000001',
		expectedRevision: 'snapshot_0000000000000001',
	});
});

test('linked video resolver checks project source identity before privileged locator I/O', async () => {
	let reads = 0;
	const resolver = fixtureResolver({
		async load() {
			reads += 1;
			return {
				blob: new Blob(['video'], { type: 'video/mp4' }),
				locatorRevision: 'snapshot_0000000000000001',
			};
		},
	});
	const source = videoSource();
	await resolver.bind('project-linked-video', source, 'locator_0000000000000001');
	assert.equal(reads, 1);

	for (const [field, value] of [
		['storageKey', 'attacker-storage'],
		['mimeType', 'video/webm'],
		['width', 640],
		['videoCodec', 'vp9'],
	] as const) {
		await assert.rejects(
			resolver.resolve('project-linked-video', { ...source, [field]: value }),
			/binding.*source|source.*binding/iu,
			String(field),
		);
	}
	assert.equal(await resolver.resolve('other-project', source), null);
	assert.equal(reads, 1);
});

test('linked video resolver fails closed for missing, replaced, or corrupt locator snapshots', async () => {
	const source = videoSource();
	const body = new Blob(['stable video'], { type: source.mimeType });
	let current: Blob | null = body;
	let revision = 'snapshot_0000000000000001';
	const resolver = fixtureResolver({
		async load(_locatorId, { expectedRevision }) {
			if (!current || expectedRevision && expectedRevision !== revision) return null;
			return { blob: current, locatorRevision: revision };
		},
	});
	await resolver.bind('project-linked-video', source, 'locator_0000000000000001');

	current = null;
	await assert.rejects(resolver.resolve('project-linked-video', source), /unavailable|missing|changed/iu);
	current = new Blob(['same length!'], { type: source.mimeType });
	await assert.rejects(resolver.resolve('project-linked-video', source), /SHA-256|digest|changed/iu);
	current = body;
	revision = 'snapshot_0000000000000002';
	await assert.rejects(resolver.resolve('project-linked-video', source), /unavailable|missing|changed/iu);
});

test('linked video resolver rejects a binding replacement during body verification', async () => {
	const source = videoSource();
	const body = new Blob(['raced video'], { type: source.mimeType });
	const { resolver, repository } = fixtureResolverParts({
		async load(_locatorId, { expectedRevision }) {
			if (expectedRevision) {
				const current = await repository.get('project-linked-video', source.id);
				assert.ok(current);
				await repository.putIfCurrent({
					...bindingInputFrom(current),
					locatorId: 'locator_0000000000000002',
					locatorRevision: 'snapshot_0000000000000002',
				}, current.bindingToken);
			}
			return { blob: body, locatorRevision: expectedRevision ?? 'snapshot_0000000000000001' };
		},
	});
	await resolver.bind('project-linked-video', source, 'locator_0000000000000001');

	await assert.rejects(
		resolver.resolve('project-linked-video', source),
		/binding.*changed|changed.*binding/iu,
	);
});

test('linked video resolver preserves cancellation and never publishes a cancelled bind', async () => {
	const controller = new AbortController();
	const reason = new Error('cancel linked video bind');
	const { resolver, repository } = fixtureResolverParts({
		async load() {
			controller.abort(reason);
			return {
				blob: new Blob(['cancelled'], { type: 'video/mp4' }),
				locatorRevision: 'snapshot_0000000000000001',
			};
		},
	});

	await assert.rejects(
		resolver.bind('project-linked-video', videoSource(), 'locator_0000000000000001', {
			signal: controller.signal,
		}),
		(error: unknown) => error === reason,
	);
	assert.equal(await repository.get('project-linked-video', 'source-linked-video'), null);
});

test('linked video binding fences the exact chooser revision before publication', async () => {
	const reads: Array<string | null> = [];
	const { resolver, repository } = fixtureResolverParts({
		load(_locatorId, { expectedRevision }) {
			reads.push(expectedRevision);
			return {
				blob: new Blob(['changed chooser body'], { type: 'video/mp4' }),
				locatorRevision: 'snapshot_0000000000000002',
			};
		},
	});
	await assert.rejects(
		resolver.bind('project-linked-video', videoSource(), 'locator_0000000000000001', {
			expectedLocatorRevision: 'snapshot_0000000000000001',
		}),
		/unavailable|changed/iu,
	);
	assert.deepEqual(reads, ['snapshot_0000000000000001']);
	assert.equal(await repository.get('project-linked-video', 'source-linked-video'), null);
});

test('linked video binding rejects same-revision chooser body replacement', async () => {
	const expected = new Blob(['chooser-body-a'], { type: 'video/mp4' });
	const { resolver, repository } = fixtureResolverParts({
		load() {
			return {
				blob: new Blob(['chooser-body-b'], { type: 'video/mp4' }),
				locatorRevision: 'snapshot_0000000000000001',
			};
		},
	});
	await assert.rejects(
		resolver.bind('project-linked-video', videoSource(), 'locator_0000000000000001', {
			expectedLocatorRevision: 'snapshot_0000000000000001',
			expectedSnapshot: expected,
		}),
		/changed content/iu,
	);
	assert.equal(await repository.get('project-linked-video', 'source-linked-video'), null);
});

test('linked video resolver releases unused opaque locators when the platform supports it', async () => {
	const released: string[] = [];
	const resolver = fixtureResolver({
		load() { return null; },
		release(locatorId) {
			released.push(locatorId);
			return true;
		},
	});
	assert.equal(await resolver.release('locator_0000000000000001'), true);
	assert.deepEqual(released, ['locator_0000000000000001']);

	const unsupported = fixtureResolver({ load() { return null; } });
	assert.equal(await unsupported.release('locator_0000000000000002'), false);
});

function fixtureResolver(port: LinkedVideoOriginalPort): LinkedVideoOriginalResolver {
	return fixtureResolverParts(port).resolver;
}

function fixtureResolverParts(port: LinkedVideoOriginalPort) {
	let token = 0;
	const memory = getMemoryDatabase(`linked-resolver-${Date.now()}-${Math.random()}`);
	const repository = new LinkedVideoOriginalRepository({
		memory,
		database: async () => null,
	}, {
		now: () => new Date(NOW),
		createBindingToken: () => `binding_token_${String(++token).padStart(8, '0')}`,
	});
	return {
		repository,
		resolver: new LinkedVideoOriginalResolver(repository, port),
	};
}

function videoSource() {
	return Object.freeze({
		kind: 'video',
		id: 'source-linked-video',
		storageKey: 'external/physical-video',
		mimeType: 'video/mp4',
		...sourceShape(),
	});
}

function sourceShape() {
	return Object.freeze({
		frameCount: 96_000,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 29.97,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
	});
}

function bindingInputFrom(binding: Awaited<ReturnType<LinkedVideoOriginalRepository['get']>>) {
	assert.ok(binding);
	const { bindingToken: _bindingToken, boundAt: _boundAt, ...input } = binding;
	return input;
}
