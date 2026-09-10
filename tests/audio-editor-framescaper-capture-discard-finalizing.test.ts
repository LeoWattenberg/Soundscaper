/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureDurableSessionCoordinator } from '../src/common/editor/controller/capture/internal/framescaper-capture-durable-session.ts';
import {
	createFixture,
	encodedPacket,
	rawPacket,
	restartedCoordinator,
	sessionRequest,
} from './helpers/framescaper-capture-creation-recovery-fixture.ts';

test('discard releases a capture stranded in finalizing by a crash during publication', async () => {
	const fixture = await sealedCapture();
	await fixture.manifests.replace(fixture.sealed, { ...fixture.sealed, state: 'finalizing' });
	const session = await restartedCoordinator(fixture).load('project-capture', 'session-capture');
	assert.ok(session);
	assert.equal(session.manifest.state, 'finalizing');
	assert.equal(session.manifest.recoveryDecision, null);

	await session.delete();

	assert.equal(await fixture.manifests.load('project-capture', 'session-capture'), null);
	assert.equal(await fixture.encodedSpools.load('project-capture', 'camera-spool'), null);
	assert.equal(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'), null);
	assert.equal(fixture.memory.mediaAssetChunks.size, 0);
	assert.equal(fixture.memory.sourceChunks.size, 0);
});

test('a finalizing capture stays discardable through the recovery inventory it is offered from', async () => {
	const fixture = await sealedCapture();
	await fixture.manifests.replace(fixture.sealed, { ...fixture.sealed, state: 'finalizing' });
	const coordinator = restartedCoordinator(fixture);

	const inventory = await coordinator.recoveryInventory('project-capture');

	assert.equal(inventory.length, 1);
	assert.equal(inventory[0]!.manifest.state, 'finalizing');
	assert.equal(inventory[0]!.storageStatus, 'exact');
	const session = await coordinator.load('project-capture', 'session-capture');
	assert.ok(session);
	await session.delete();
	assert.deepEqual(await coordinator.recoveryInventory('project-capture'), []);
});

test('discard refuses a published capture that settles through commit and retirement', async () => {
	const fixture = await sealedCapture();
	const finalizing = await fixture.manifests.replace(
		fixture.sealed,
		{ ...fixture.sealed, state: 'finalizing' },
	);
	await fixture.manifests.replace(finalizing, {
		...finalizing,
		state: 'published',
		streams: finalizing.streams.map((stream) => ({ ...stream, playability: 'playable' })),
	});
	const session = await restartedCoordinator(fixture).load('project-capture', 'session-capture');
	assert.ok(session);

	await assert.rejects(session.delete(), /capture session can be deleted/u);

	assert.equal(
		(await fixture.manifests.load('project-capture', 'session-capture'))?.state,
		'published',
	);
});

async function sealedCapture() {
	const fixture = createFixture();
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests,
		now: () => 100,
	});
	const session = await coordinator.create(sessionRequest());
	await session.append(encodedPacket());
	await session.append(rawPacket());
	const sealed = await session.seal();
	return { ...fixture, sealed };
}
