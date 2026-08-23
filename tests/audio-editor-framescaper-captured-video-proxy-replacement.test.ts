/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { VideoProxyAttachmentV18 } from '../src/common/editor/video-proxy-attachment-v18.ts';
import { createFramescaperCapturedVideoProxySchedulerV19 } from '../src/framescaper/editor-captured-video-proxy-scheduler.ts';
import {
	capturedProxyRequest,
	capturedProxyStorageInventory,
	capturedVideoSource,
	createCapturedProxyFixture,
} from './helpers/framescaper-captured-video-proxy-fixture.ts';
import { FramescaperDesktopV10MainFixture } from './helpers/framescaper-desktop-v10-store-fixture.ts';
import {
	ORIGINAL_SOURCE_ID,
	createVideoProxyFixture,
	deferred,
} from './helpers/video-proxy-relationship-fixtures.ts';

test('captured proxy replacement proves and atomically swaps old to new without reclaiming the old bodies',
	async (context) => {
		const fixture = await createCapturedProxyFixture(context, 19);
		await fixture.schedule(capturedProxyRequest(
			fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256,
		));
		const before = await fixture.controllerStore.loadProject(String(fixture.origin.id));
		assert.ok(before);
		const oldAttachment = structuredClone(
			capturedVideoSource(before, ORIGINAL_SOURCE_ID).proxyAttachment,
		) as VideoProxyAttachmentV18;
		fixture.relationship.setCandidate(new Blob(['replacement-proxy'], { type: 'video/webm' }));

		await fixture.schedule({
			...capturedProxyRequest(before, ORIGINAL_SOURCE_ID, fixture.originalSha256),
			expectedProxyAttachment: oldAttachment,
		});

		const after = await fixture.controllerStore.loadProject(String(fixture.origin.id));
		assert.ok(after);
		const replacement = capturedVideoSource(after, ORIGINAL_SOURCE_ID).proxyAttachment;
		assert.ok(replacement);
		assert.notDeepEqual(replacement, oldAttachment);
		assert.equal(Number(after.revision), Number(before.revision) + 1);
		assert.ok(await fixture.environment.store.getMediaAssetMetadata(oldAttachment.storageKey),
			'old proxy body remains rooted until the action cleanup settles');
		assert.ok(await fixture.environment.store.getMediaAssetMetadata(oldAttachment.timingAsset.storageKey));
		assert.deepEqual(await capturedProxyStorageInventory(fixture.environment), {
			bodyKeys: [...new Set([
				oldAttachment.storageKey,
				oldAttachment.timingAsset.storageKey,
				replacement.storageKey,
				replacement.timingAsset.storageKey,
			])].sort(),
			claimKeys: [],
			tombstoneKeys: [],
		});

		const generatorCalls = fixture.relationship.counters.generatorCalls;
		await assert.rejects(fixture.schedule({
			...capturedProxyRequest(after, ORIGINAL_SOURCE_ID, fixture.originalSha256),
			expectedProxyAttachment: oldAttachment,
		}), /replacement attachment changed|stale|AbortError/iu);
		assert.equal(fixture.relationship.counters.generatorCalls, generatorCalls,
			'a stale old-attachment fence rejects before replacement generation');
		assert.deepEqual(await fixture.controllerStore.loadProject(String(fixture.origin.id)), after);
	},
);

test('desktop main-first replacement compare-and-swaps the exact old attachment', async (context) => {
	const main = new FramescaperDesktopV10MainFixture();
	main.acceptBodies = true;
	const fixture = await createCapturedProxyFixture(context, 18, false, undefined, main);
	await fixture.schedule(capturedProxyRequest(
		fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256,
	));
	const before = await fixture.controllerStore.loadProject(String(fixture.origin.id));
	assert.ok(before);
	const oldAttachment = structuredClone(
		capturedVideoSource(before, ORIGINAL_SOURCE_ID).proxyAttachment,
	) as VideoProxyAttachmentV18;
	fixture.relationship.setCandidate(new Blob(['desktop-replacement-proxy'], { type: 'video/webm' }));

	await fixture.schedule({
		...capturedProxyRequest(before, ORIGINAL_SOURCE_ID, fixture.originalSha256),
		expectedProxyAttachment: oldAttachment,
	});

	const after = await fixture.controllerStore.loadProject(String(fixture.origin.id));
	assert.ok(after);
	assert.equal(Number(after.revision), Number(before.revision) + 1);
	assert.notDeepEqual(capturedVideoSource(after, ORIGINAL_SOURCE_ID).proxyAttachment, oldAttachment);
});

test('scheduler cancellation keeps the old attachment selected throughout replacement proof', async (context) => {
	const fixture = await createCapturedProxyFixture(context, 19);
	await fixture.schedule(capturedProxyRequest(
		fixture.origin, ORIGINAL_SOURCE_ID, fixture.originalSha256,
	));
	const before = await fixture.controllerStore.loadProject(String(fixture.origin.id));
	assert.ok(before);
	const oldAttachment = structuredClone(
		capturedVideoSource(before, ORIGINAL_SOURCE_ID).proxyAttachment,
	) as VideoProxyAttachmentV18;
	const generatorGate = deferred<void>();
	const relationship = createVideoProxyFixture({ generatorGate });
	relationship.setFingerprint({ sha256: fixture.originalSha256 });
	const schedule = createFramescaperCapturedVideoProxySchedulerV19(
		fixture.environment, fixture.session, { runtime: null, candidateObserver: relationship.candidateObserver },
	);
	const pending = schedule({
		...capturedProxyRequest(before, ORIGINAL_SOURCE_ID, fixture.originalSha256),
		expectedProxyAttachment: oldAttachment,
	});
	while (relationship.counters.generatorCalls === 0) {
		await new Promise<void>((resolve) => { setImmediate(resolve); });
	}
	assert.deepEqual(await fixture.controllerStore.loadProject(String(fixture.origin.id)), before);
	const disposal = schedule.dispose();
	generatorGate.resolve();
	await assert.rejects(pending, /disposed|cancel|AbortError/iu);
	await disposal;
	assert.deepEqual(await fixture.controllerStore.loadProject(String(fixture.origin.id)), before);
});
