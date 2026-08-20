/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureDurableSessionCoordinator } from '../src/common/editor/controller/framescaper-capture-durable-session.ts';
import { FramescaperCaptureSessionManifestRepository } from '../src/common/editor/storage/framescaper-capture-session-manifest-repository.ts';
import {
	framescaperCaptureCreationFenceKey,
	normalizeFramescaperCaptureSessionCreation,
} from '../src/common/editor/storage/framescaper-capture-session-creation-repository.ts';
import {
	createFixture,
	manifestPort,
	sequentialId,
	sessionRequest,
} from './helpers/framescaper-capture-creation-recovery-fixture.ts';

test('publication and cleanup acknowledgement loss cannot poison the global creation journal', async () => {
	const fixture = createFixture();
	const values = fixture.values;
	let publicationStorageAcknowledgementLost = false;
	let cleanupFenceAcknowledgementLost = false;
	const manifests = new FramescaperCaptureSessionManifestRepository({
		get: values.get.bind(values), putIfAbsent: values.putIfAbsent.bind(values),
		putIfAbsentAndUpdate: values.putIfAbsentAndUpdate.bind(values),
		deleteIfCurrent: values.deleteIfCurrent.bind(values),
		listByPrefix: values.listByPrefix.bind(values),
		async putIfAbsentWhenCurrent(...args) {
			const created = await values.putIfAbsentWhenCurrent(...args);
			if (created && args[2].startsWith('framescaper-capture-session-manifest-v1:')) {
				publicationStorageAcknowledgementLost = true;
				throw new Error('publication storage acknowledgement lost');
			}
			return created;
		},
		replaceIfCurrent: values.replaceIfCurrent.bind(values),
	});
	const interrupted = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: {
			...manifestPort(manifests),
			async publishCreation(expected, manifest) {
				await manifests.publishCreation(expected, manifest);
				throw new Error('publication caller acknowledgement lost');
			},
			async replaceCreation(expected, next) {
				const creation = normalizeFramescaperCaptureSessionCreation(expected);
				const replaced = await values.replaceIfCurrent(
					framescaperCaptureCreationFenceKey(
						creation.projectFence.projectId, creation.sessionId,
					),
					creation,
					next,
				);
				assert.equal(replaced, true);
				cleanupFenceAcknowledgementLost = true;
				throw new Error('cleanup fence acknowledgement lost');
			},
		},
		now: () => 100,
		createId: sequentialId('dual-ack'),
	});

	await assert.rejects(interrupted.create(sessionRequest()), /publication caller acknowledgement lost/u);
	assert.equal(publicationStorageAcknowledgementLost, true);
	assert.equal(cleanupFenceAcknowledgementLost, true);
	assert.equal((await fixture.manifests.load(
		'project-capture', 'session-capture',
	))?.state, 'capturing');
	assert.deepEqual(await fixture.manifests.listCreations(), []);
	assert.ok(await fixture.encodedSpools.load('project-capture', 'camera-spool'));
	assert.ok(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'));

	const restarted = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools, rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests, now: () => 200, createId: sequentialId('after-split'),
	});
	assert.ok(await restarted.load('project-capture', 'session-capture'));
	const nextRequest = sessionRequest();
	const next = await restarted.create({
		...nextRequest, sessionId: 'session-after-split', generation: 2,
		streams: nextRequest.streams.map((stream) => ({
			...stream,
			streamId: `${stream.streamId}-after-split`,
			spoolId: `${stream.spoolId}-after-split`,
			sourceId: `${stream.sourceId}-after-split`,
		})),
	});
	assert.equal(next.manifest.state, 'capturing');
	assert.deepEqual(await fixture.manifests.listCreations(), []);
});
