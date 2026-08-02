/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopLinkedOriginalAccess } from '../src/common/editor/desktop-linked-original-port.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

const LOCATOR_ID = 'a'.repeat(64);
const REVISION = 'b'.repeat(64);

test('file service exposes a kind-aware materialized linked-original port and preserves video compatibility', async () => {
	const calls: Array<readonly [string, unknown?]> = [];
	const bridge = bridgeFixture(calls);
	const service = createAudioEditorFileService({
		bridge,
		fetch: async (url: string) => new Response(url.includes('selected.wav') ? 'RIFF' : 'video', {
			headers: { 'Content-Length': url.includes('selected.wav') ? '4' : '5' },
		}),
	});

	assert.equal(service.linkedOriginalsAvailable, true);
	assert.equal(service.linkedAudioOriginalsAvailable, true);
	assert.ok(service.linkedOriginalPort);
	assert.ok(service.linkedVideoOriginalPort);
	const choice = await service.chooseLinkedAudioOriginal();
	assert.ok(choice);
	assert.equal(choice.name, 'selected.wav');
	assert.equal(choice.file.name, 'selected.wav');
	assert.equal(await choice.file.text(), 'RIFF');

	const audio = await service.linkedOriginalPort.load('audio', LOCATOR_ID, {
		expectedRevision: REVISION,
	});
	assert.ok(audio);
	assert.equal(audio.locatorRevision, REVISION);
	assert.equal(await audio.blob.text(), 'RIFF');
	const video = await service.linkedOriginalPort.load('video', LOCATOR_ID, {
		expectedRevision: REVISION,
	});
	assert.ok(video);
	assert.equal(await video.blob.text(), 'video');

	const references = [
		{ kind: 'audio' as const, locatorId: LOCATOR_ID, locatorRevision: REVISION },
		{ kind: 'video' as const, locatorId: 'c'.repeat(64), locatorRevision: 'd'.repeat(64) },
	];
	assert.equal(await service.linkedOriginalPort.reconcile(references), 2);
	assert.equal(await service.linkedOriginalPort.release(references[0]), true);
	assert.equal(await service.releaseLinkedAudioOriginal({
		locatorId: LOCATOR_ID, locatorRevision: REVISION,
	}), true);
	const legacyVideoReference = {
		locatorId: references[1].locatorId,
		locatorRevision: references[1].locatorRevision,
	};
	assert.equal(await service.linkedVideoOriginalPort.reconcile?.([legacyVideoReference]), 2);
	assert.equal(await service.linkedVideoOriginalPort.release(legacyVideoReference), true);

	assert.deepEqual(calls.filter(([method]) => method === 'loadLinkedAudioOriginal').map(([, value]) => value), [
		{ locatorId: LOCATOR_ID, expectedRevision: REVISION, range: false },
		{ locatorId: LOCATOR_ID, expectedRevision: REVISION, range: false },
	]);
	assert.deepEqual(calls.filter(([method]) => method === 'loadLinkedVideoOriginal').map(([, value]) => value), [[
		{ locatorId: LOCATOR_ID, expectedRevision: REVISION, playback: false },
	]].flat());
	assert.deepEqual(calls.filter(([method]) => method === 'reconcileLinkedOriginals').map(([, value]) => value), [
		references,
		[{ kind: 'video', ...legacyVideoReference }],
	]);
	assert.deepEqual(calls.filter(([method]) => method === 'releaseLinkedOriginal').map(([, value]) => value), [
		references[0], references[0], { kind: 'video', ...legacyVideoReference },
	]);
	assert.equal(calls.some(([method, value]) => method === 'loadLinkedAudioOriginal'
		&& Boolean((value as { playback?: unknown })?.playback)), false);
});

test('kind-aware port rejects open records and cleans a failed linked-audio choice through the shared inventory', async () => {
	const calls: Array<readonly [string, unknown?]> = [];
	const bridge = bridgeFixture(calls);
	bridge.chooseLinkedAudioOriginal = async () => ({
		...audioLocator(), name: '../private.wav', path: '/private/selected.wav',
	});
	const service = createAudioEditorFileService({ bridge, fetch: async () => new Response('RIFF') });

	await assert.rejects(service.chooseLinkedAudioOriginal(), /name|closed|unsupported/iu);
	assert.deepEqual(calls.filter(([method]) => method === 'releaseLinkedOriginal').at(-1)?.[1], {
		kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: REVISION,
	});
	await assert.rejects(
		Promise.resolve(service.linkedOriginalPort?.load('image' as never, LOCATOR_ID, {
			expectedRevision: REVISION,
		})),
		/kind|audio|video/iu,
	);
	await assert.rejects(
		Promise.resolve(service.linkedOriginalPort?.release({
			kind: 'video', locatorId: LOCATOR_ID,
		} as never)),
		/field|revision/iu,
	);
});

test('kind-aware port releases delegated video range ownership when cancellation wins the handoff', async () => {
	const controller = new AbortController();
	const reason = new Error('cancel delegated video range handoff');
	let releases = 0;
	const lease = Object.freeze({
		locatorRevision: REVISION,
		byteLength: 5,
		mimeType: 'video/mp4',
		async readRange() { return new Uint8Array(1); },
		async release() { releases += 1; },
	});
	const access = createDesktopLinkedOriginalAccess({
		bridge: {
			async loadLinkedAudioOriginal() { return null; },
			async reconcileLinkedOriginals() { return 0; },
			async releaseLinkedOriginal() { return true; },
			async releaseRead() { return true; },
		},
		fetch: async () => new Response(),
		videoPort: {
			async load() { return null; },
			leasePlayback() {
				const result = Promise.resolve(lease);
				controller.abort(reason);
				return result;
			},
		},
		async openReadDescriptor() { return new Blob(); },
	});

	await assert.rejects(
		Promise.resolve(access.port?.leaseRange?.('video', LOCATOR_ID, {
			expectedRevision: REVISION,
			signal: controller.signal,
		})),
		(error: unknown) => error === reason,
	);
	assert.equal(releases, 1);
});

function bridgeFixture(calls: Array<readonly [string, unknown?]>) {
	return {
		async chooseLinkedAudioOriginal() {
			calls.push(['chooseLinkedAudioOriginal']);
			return audioLocator();
		},
		async loadLinkedAudioOriginal(value: unknown) {
			calls.push(['loadLinkedAudioOriginal', value]);
			return { locatorRevision: REVISION, descriptor: descriptor('audio') };
		},
		async chooseLinkedVideoOriginal() { return null; },
		async loadLinkedVideoOriginal(value: unknown) {
			calls.push(['loadLinkedVideoOriginal', value]);
			return { locatorRevision: REVISION, descriptor: descriptor('video') };
		},
		async reconcileLinkedVideoOriginals() { return 0; },
		async releaseLinkedVideoOriginal() { return true; },
		async reconcileLinkedOriginals(value: unknown) {
			calls.push(['reconcileLinkedOriginals', value]);
			return 2;
		},
		async releaseLinkedOriginal(value: unknown) {
			calls.push(['releaseLinkedOriginal', value]);
			return true;
		},
		async releaseRead(value: unknown) { calls.push(['releaseRead', value]); return true; },
	};
}

function audioLocator() {
	return {
		locatorId: LOCATOR_ID, locatorRevision: REVISION, name: 'selected.wav',
		size: 4, mimeType: 'audio/wav', lastModified: 123,
	};
}

function descriptor(kind: 'audio' | 'video') {
	const id = (kind === 'audio' ? 'e' : 'f').repeat(64);
	const name = kind === 'audio' ? 'selected.wav' : 'selected.mp4';
	return {
		id,
		url: `soundscaper-app://bundle/_desktop/read/materialized-v1/${id}/${name}`,
		name,
		size: kind === 'audio' ? 4 : 5,
		mimeType: kind === 'audio' ? 'audio/wav' : 'video/mp4',
		readProfile: 'materialized-v1',
		lastModified: 123,
	};
}
