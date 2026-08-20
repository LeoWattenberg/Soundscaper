/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureDurableSessionCoordinator } from '../src/common/editor/controller/framescaper-capture-durable-session.ts';
import { EncodedCaptureSpoolRepository } from '../src/common/editor/storage/encoded-capture-spool-repository.ts';
import { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import {
	commitManifest,
	createFixture,
	encodedOnlySessionRequest,
	encodedPacket,
	globalRawReservationCount,
	rawOnlySessionRequest,
	rawPacket,
	restartedCoordinator,
} from './helpers/framescaper-capture-creation-recovery-fixture.ts';

type FailureBoundary = 'deleting-cas-acknowledgement' | 'chunk-deletion';

test('committed retirement resumes every exact deleting spool failure boundary', async (t) => {
	for (const [kind, boundary] of [
		['encoded', 'deleting-cas-acknowledgement'],
		['encoded', 'chunk-deletion'],
		['raw', 'deleting-cas-acknowledgement'],
		['raw', 'chunk-deletion'],
	] as const) {
		await t.test(`${kind} ${boundary}`, async () => {
			const fixture = createFixture();
			let faultActive = false;
			const encodedSpools = kind === 'encoded'
				? faultyEncodedSpools(fixture, boundary, () => faultActive)
				: fixture.encodedSpools;
			const rawPcmSpools = kind === 'raw'
				? faultyRawSpools(fixture, boundary, () => faultActive)
				: fixture.rawPcmSpools;
			const coordinator = createFramescaperCaptureDurableSessionCoordinator({
				encodedSpools, rawPcmSpools, manifests: fixture.manifests,
				now: () => 100, createId: () => `terminal-${kind}-${boundary}`,
			});
			const session = await coordinator.create(kind === 'encoded'
				? encodedOnlySessionRequest()
				: rawOnlySessionRequest());
			await session.append(kind === 'encoded' ? encodedPacket() : rawPacket());
			await session.seal();
			await commitManifest(fixture.manifests, session.manifest);
			faultActive = true;

			await assert.rejects(session.retireCommitted(), /planned terminal deletion failure/u);
			const record = kind === 'encoded'
				? await fixture.encodedSpools.load('project-capture', 'camera-spool')
				: await fixture.rawPcmSpools.load('project-capture', 'microphone-spool');
			assert.equal(record?.state, 'deleting');
			assert.equal((await fixture.manifests.load(
				'project-capture', 'session-capture',
			))?.state, 'committed');
			if (kind === 'raw') assert.equal(globalRawReservationCount(
				await fixture.values.get('raw-pcm-spool-global-inventory-v1'),
			), 1);

			await restartedCoordinator(fixture).recoveryInventory('project-capture');
			assert.equal(await fixture.manifests.load('project-capture', 'session-capture'), null);
			assert.equal(await fixture.encodedSpools.load('project-capture', 'camera-spool'), null);
			assert.equal(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'), null);
			assert.equal(fixture.memory.mediaAssetChunks.size, 0);
			assert.equal(fixture.memory.sourceChunks.size, 0);
			assert.equal(globalRawReservationCount(
				await fixture.values.get('raw-pcm-spool-global-inventory-v1'),
			), 0);
		});
	}
});

function faultyEncodedSpools(
	fixture: ReturnType<typeof createFixture>,
	boundary: FailureBoundary,
	active: () => boolean,
): EncodedCaptureSpoolRepository {
	const values = fixture.values;
	return new EncodedCaptureSpoolRepository({
		get: values.get.bind(values), putIfAbsent: values.putIfAbsent.bind(values),
		putIfAbsentWhenCurrent: values.putIfAbsentWhenCurrent.bind(values),
		replaceIfCurrentWhenCurrent: values.replaceIfCurrentWhenCurrent.bind(values),
		deleteIfCurrent: values.deleteIfCurrent.bind(values), listByPrefix: values.listByPrefix.bind(values),
		async replaceIfCurrent(key, expected, replacement) {
			const replaced = await values.replaceIfCurrent(key, expected, replacement);
			if (replaced && active() && boundary === 'deleting-cas-acknowledgement'
				&& key.startsWith('framescaper-encoded-capture-spool-v1:')
				&& isDeleting(replacement)) throw new Error('planned terminal deletion failure');
			return replaced;
		},
	}, {
		write: fixture.mediaChunks.write.bind(fixture.mediaChunks),
		chunks: fixture.mediaChunks.chunks.bind(fixture.mediaChunks),
		deleteTailOwned: fixture.mediaChunks.deleteTailOwned.bind(fixture.mediaChunks),
		async deleteOwned(token, sourceId) {
			if (active() && boundary === 'chunk-deletion') {
				throw new Error('planned terminal deletion failure');
			}
			return fixture.mediaChunks.deleteOwned(token, sourceId);
		},
	});
}

function faultyRawSpools(
	fixture: ReturnType<typeof createFixture>,
	boundary: FailureBoundary,
	active: () => boolean,
): RawPcmSpoolRepository {
	const values = fixture.values;
	return new RawPcmSpoolRepository({
		get: values.get.bind(values), putIfAbsent: values.putIfAbsent.bind(values),
		putIfAbsentWhenCurrent: values.putIfAbsentWhenCurrent.bind(values),
		replaceIfCurrentWhenCurrent: values.replaceIfCurrentWhenCurrent.bind(values),
		deleteIfCurrent: values.deleteIfCurrent.bind(values), listByPrefix: values.listByPrefix.bind(values),
		async replaceIfCurrent(key, expected, replacement) {
			const replaced = await values.replaceIfCurrent(key, expected, replacement);
			if (replaced && active() && boundary === 'deleting-cas-acknowledgement'
				&& key.startsWith('raw-pcm-spool-registry-v1:')
				&& registryContainsDeleting(replacement)) throw new Error('planned terminal deletion failure');
			return replaced;
		},
	}, {
		writeChunk: fixture.sourceRecords.writeChunk.bind(fixture.sourceRecords),
		chunk: fixture.sourceRecords.chunk.bind(fixture.sourceRecords),
		deleteChunksFrom: fixture.sourceRecords.deleteChunksFrom.bind(fixture.sourceRecords),
		async deleteChunks(token) {
			if (active() && boundary === 'chunk-deletion') {
				throw new Error('planned terminal deletion failure');
			}
			await fixture.sourceRecords.deleteChunks(token);
		},
	});
}

function isDeleting(value: unknown): boolean {
	return Boolean(value && typeof value === 'object'
		&& Object.getOwnPropertyDescriptor(value, 'state')?.value === 'deleting');
}

function registryContainsDeleting(value: unknown): boolean {
	const records = value && typeof value === 'object'
		? Object.getOwnPropertyDescriptor(value, 'records')?.value
		: null;
	return Array.isArray(records) && records.some(isDeleting);
}
