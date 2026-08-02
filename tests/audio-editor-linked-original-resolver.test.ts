/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LinkedOriginalResolver,
	type LinkedOriginalPort,
} from '../src/common/editor/storage/linked-original-resolver.ts';
import {
	LinkedOriginalRepository,
	type LinkedOriginalLocatorReference,
} from '../src/common/editor/storage/linked-original-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

const NOW = '2026-08-02T10:11:12.345Z';

test('linked audio resolution binds exact canonical geometry to one pathless WAV snapshot', async () => {
	const body = new Blob(['linked wave body'], { type: 'audio/wav' });
	const reads: unknown[] = [];
	const resolver = fixtureResolver({
		load(kind, locatorId, { expectedRevision }) {
			reads.push({ kind, locatorId, expectedRevision });
			return { blob: body, locatorRevision: 'snapshot_0000000000000001' };
		},
	});
	const source = audioSource();

	const binding = await resolver.bind('project-linked-audio', source, 'locator_0000000000000001', {
		expectedLocatorRevision: 'snapshot_0000000000000001',
		expectedSnapshot: body,
	});
	assert.equal(binding.schemaVersion, 2);
	assert.equal(binding.kind, 'audio');
	assert.equal(binding.byteLength, body.size);
	assert.deepEqual(binding.sourceShape, sourceShape());
	assert.equal('path' in binding, false);

	const resolved = await resolver.resolve('project-linked-audio', source);
	assert.ok(resolved);
	assert.equal(await resolved.blob.text(), 'linked wave body');
	assert.deepEqual(resolved.metadata, {
		sourceId: source.storageKey,
		storage: 'linked-original-v2',
		path: null,
		committedAt: NOW,
		kind: 'audio',
		mimeType: source.mimeType,
		size: body.size,
		sha256: binding.sha256,
	});
	assert.deepEqual(reads, [
		{ kind: 'audio', locatorId: 'locator_0000000000000001', expectedRevision: 'snapshot_0000000000000001' },
		{ kind: 'audio', locatorId: 'locator_0000000000000001', expectedRevision: 'snapshot_0000000000000001' },
	]);
});

test('linked audio resolution fails before locator I/O when canonical source geometry drifts', async () => {
	let reads = 0;
	const body = new Blob(['stable linked wave'], { type: 'audio/wav' });
	const resolver = fixtureResolver({
		load() {
			reads += 1;
			return { blob: body, locatorRevision: 'snapshot_0000000000000001' };
		},
	});
	const source = audioSource();
	await resolver.bind('project-linked-audio', source, 'locator_0000000000000001');
	assert.equal(reads, 1);

	for (const [field, value] of [
		['storageKey', 'other-storage'],
		['mimeType', 'audio/x-wav'],
		['frameCount', 3],
		['channelCount', 2],
		['chunkFrames', 1],
	] as const) {
		await assert.rejects(
			resolver.resolve('project-linked-audio', { ...source, [field]: value }),
			/binding.*source|source.*binding/iu,
		);
	}
	assert.equal(reads, 1);
});

test('linked audio resolution rejects same-length changed content', async () => {
	const source = audioSource();
	const body = new Blob(['stable linked wave'], { type: source.mimeType });
	let current = body;
	const resolver = fixtureResolver({
		load(_kind, _locatorId, { expectedRevision }) {
			return {
				blob: current,
				locatorRevision: expectedRevision ?? 'snapshot_0000000000000001',
			};
		},
	});
	await resolver.bind('project-linked-audio', source, 'locator_0000000000000001');
	current = new Blob(['tamper linked wave'], { type: source.mimeType });
	await assert.rejects(
		resolver.resolve('project-linked-audio', source),
		/SHA-256|digest/iu,
	);
});

test('linked audio resolution rejects a binding replacement after body verification', async () => {
	const source = audioSource();
	const body = new Blob(['stable linked wave'], { type: source.mimeType });
	const { resolver, repository } = fixtureResolverParts({
		async load(_kind, _locatorId, { expectedRevision }) {
			if (expectedRevision) {
				const binding = await repository.get('project-linked-audio', source.id);
				assert.ok(binding);
				await repository.putIfCurrent({
					...bindingInputFrom(binding),
					locatorId: 'locator_0000000000000002',
					locatorRevision: 'snapshot_0000000000000002',
				}, binding.bindingToken);
			}
			return { blob: body, locatorRevision: expectedRevision ?? 'snapshot_0000000000000001' };
		},
	});
	await resolver.bind('project-linked-audio', source, 'locator_0000000000000001');
	await assert.rejects(
		resolver.resolve('project-linked-audio', source),
		/binding.*changed|changed.*binding/iu,
	);
});

test('generic locator release is kindful and closed', async () => {
	const released: unknown[] = [];
	const resolver = fixtureResolver({
		load() { return null; },
		release(reference) { released.push(reference); return true; },
	});
	const reference = Object.freeze({
		kind: 'audio' as const,
		locatorId: 'locator_0000000000000001',
		locatorRevision: 'revision_0000000000000001',
	});
	assert.equal(await resolver.release(reference), true);
	assert.deepEqual(released, [reference]);
	await assert.rejects(
		resolver.release({ ...reference, kind: 'video', path: '/tmp/audio.wav' } as never),
		/unsupported field|reference/iu,
	);
	assert.deepEqual(released, [reference]);
});

test('generic resolver reconciles only a complete durable kindful inventory', async () => {
	const references = Object.freeze([Object.freeze({
		kind: 'audio' as const,
		locatorId: 'locator_0000000000000001',
		locatorRevision: 'revision_0000000000000001',
	}), Object.freeze({
		kind: 'video' as const,
		locatorId: 'locator_0000000000000001',
		locatorRevision: 'revision_0000000000000002',
	})]);
	const canonicalProjectIds = Object.freeze(['project-linked-audio']);
	const calls: unknown[] = [];
	const repository = reconciliationRepository(async (value: readonly string[]) => {
		calls.push({ projectIds: value });
		return references;
	});
	const resolver = new LinkedOriginalResolver(repository, {
		load() { throw new Error('external media must not be inspected during reconciliation'); },
		release() { throw new Error('external media must not be released during reconciliation'); },
		reconcile(value) { calls.push({ references: value }); return 2; },
	});

	assert.equal(await resolver.reconcileLocators(canonicalProjectIds), 2);
	assert.deepEqual(calls, [
		{ projectIds: canonicalProjectIds },
		{ references },
	]);
});

test('generic resolver skips binding mutation and IPC when reconciliation is unavailable', async () => {
	const canonicalProjectIds = Object.freeze(['project-linked-audio']);
	let repositoryCalls = 0;
	const repository = reconciliationRepository(async () => {
		repositoryCalls += 1;
		return [];
	});
	const unsupported = new LinkedOriginalResolver(repository, { load: () => null });
	assert.equal(await unsupported.reconcileLocators(canonicalProjectIds), null);
	assert.equal(repositoryCalls, 0);

	let ipcCalls = 0;
	const ephemeral = new LinkedOriginalResolver(reconciliationRepository(async () => null), {
		load: () => null,
		reconcile() { ipcCalls += 1; return 0; },
	});
	assert.equal(await ephemeral.reconcileLocators(canonicalProjectIds), null);
	assert.equal(ipcCalls, 0);
});

test('generic resolver fails before IPC on inventory errors and invalid removal counts', async () => {
	const failure = new Error('generic binding inventory is corrupt');
	let ipcCalls = 0;
	const corrupt = new LinkedOriginalResolver(reconciliationRepository(async () => {
		throw failure;
	}), {
		load: () => null,
		reconcile() { ipcCalls += 1; return 0; },
	});
	await assert.rejects(
		corrupt.reconcileLocators(['project-linked-audio']),
		(error) => error === failure,
	);
	assert.equal(ipcCalls, 0);

	for (const count of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
		const malformed = new LinkedOriginalResolver(reconciliationRepository(async () => []), {
			load: () => null,
			reconcile: () => count,
		});
		await assert.rejects(
			malformed.reconcileLocators(['project-linked-audio']),
			/removal count|non-negative|safe integer/iu,
		);
	}
});

function fixtureResolver(port: LinkedOriginalPort): LinkedOriginalResolver {
	return fixtureResolverParts(port).resolver;
}

function fixtureResolverParts(port: LinkedOriginalPort) {
	let token = 0;
	const memory = getMemoryDatabase(`linked-original-resolver-${Date.now()}-${Math.random()}`);
	const repository = new LinkedOriginalRepository({ memory, database: async () => null }, {
		now: () => new Date(NOW),
		createBindingToken: () => `binding_token_${String(++token).padStart(8, '0')}`,
	});
	return { repository, resolver: new LinkedOriginalResolver(repository, port) };
}

function reconciliationRepository(
	reconcile: (
		canonicalProjectIds: readonly string[],
	) => Promise<readonly LinkedOriginalLocatorReference[] | null>,
): LinkedOriginalRepository {
	return {
		get: async () => null,
		putIfCurrent: async () => null,
		reconcileDurableLocatorReferences: reconcile,
	} as unknown as LinkedOriginalRepository;
}

function audioSource() {
	return Object.freeze({
		kind: 'audio' as const,
		id: 'source-linked-audio',
		storageKey: 'external/physical-audio',
		name: 'Linked recording.wav',
		mimeType: 'audio/wav',
		...sourceShape(),
	});
}

function sourceShape() {
	return Object.freeze({
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32' as const,
		chunkFrames: 2,
	});
}

function bindingInputFrom(binding: NonNullable<Awaited<ReturnType<LinkedOriginalRepository['get']>>>) {
	const { bindingToken: _bindingToken, boundAt: _boundAt, ...input } = binding;
	return input;
}
