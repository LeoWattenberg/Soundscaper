/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

const LOCATOR_ID = '1'.repeat(64);
const LOCATOR_REVISION = '2'.repeat(64);
const READ_ID = '3'.repeat(64);

test('desktop file service chooses and materializes one pathless linked-video original', async () => {
	const calls: Array<readonly [string, unknown?]> = [];
	const descriptor = readDescriptor();
	const service = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() {
				calls.push(['choose']);
				return locatorChoice();
			},
			async loadLinkedVideoOriginal(request: unknown) {
				calls.push(['load', request]);
				return { locatorRevision: LOCATOR_REVISION, descriptor };
			},
			async releaseLinkedVideoOriginal(locatorId: unknown) {
				calls.push(['release-locator', locatorId]);
				return true;
			},
			async releaseRead(id: unknown) {
				calls.push(['release-read', id]);
				return true;
			},
		},
		fetch: async (url: string) => {
			calls.push(['fetch', url]);
			return new Response('video body', {
				headers: { 'Content-Length': '10', 'Content-Type': 'video/mp4' },
			});
		},
	});

	assert.equal(service.linkedVideoOriginalsAvailable, true);
	assert.ok(service.linkedVideoOriginalPort);
	const choice = await service.chooseLinkedVideoOriginal();
	assert.ok(choice);
	assert.equal(choice.locatorId, LOCATOR_ID);
	assert.equal(choice.locatorRevision, LOCATOR_REVISION);
	assert.equal(choice.name, 'selected.mp4');
	assert.equal(choice.file.name, 'selected.mp4');
	assert.equal(choice.file.type, 'video/mp4');
	assert.equal(await choice.file.text(), 'video body');
	assert.equal(Object.isFrozen(choice), true);
	assert.deepEqual(calls, [
		['choose'],
		['load', { locatorId: LOCATOR_ID, expectedRevision: LOCATOR_REVISION }],
		['fetch', descriptor.url],
		['release-read', READ_ID],
	]);

	const snapshot = await service.linkedVideoOriginalPort.load(LOCATOR_ID, {
		expectedRevision: null,
	});
	assert.ok(snapshot);
	assert.equal(snapshot.locatorRevision, LOCATOR_REVISION);
	assert.ok(snapshot.blob instanceof Blob);
	assert.equal(await snapshot.blob.text(), 'video body');
	assert.equal(await service.linkedVideoOriginalPort.release(LOCATOR_ID), true);
	assert.deepEqual(calls.slice(-4), [
		['load', { locatorId: LOCATOR_ID, expectedRevision: null }],
		['fetch', descriptor.url],
		['release-read', READ_ID],
		['release-locator', LOCATOR_ID],
	]);
});

test('linked-video chooser cancellation is inert and the browser adapter stays absent', async () => {
	let loadCalls = 0;
	const desktop = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() { return null; },
			async loadLinkedVideoOriginal() { loadCalls += 1; return null; },
			async releaseLinkedVideoOriginal() { return true; },
		},
	});
	assert.equal(await desktop.chooseLinkedVideoOriginal(), null);
	assert.equal(loadCalls, 0);

	const browser = createAudioEditorFileService({ bridge: null });
	assert.equal(browser.linkedVideoOriginalsAvailable, false);
	assert.equal(browser.linkedVideoOriginalPort, null);
	assert.equal(await browser.chooseLinkedVideoOriginal(), null);
});

test('linked-video chooser releases a new locator when materialization fails', async () => {
	const releases: string[] = [];
	const service = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() { return locatorChoice(); },
			async loadLinkedVideoOriginal() {
				return { locatorRevision: LOCATOR_REVISION, descriptor: readDescriptor() };
			},
			async releaseLinkedVideoOriginal(locatorId: string) {
				releases.push(locatorId);
				return true;
			},
			async releaseRead() { return true; },
		},
		fetch: async () => new Response('denied', { status: 500 }),
	});

	await assert.rejects(service.chooseLinkedVideoOriginal(), /status 500/iu);
	assert.deepEqual(releases, [LOCATOR_ID]);
});

test('linked-video chooser releases a locator when cancellation wins after selection', async () => {
	const controller = new AbortController();
	const reason = new Error('cancel linked selection');
	const releases: string[] = [];
	const service = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() {
				controller.abort(reason);
				return locatorChoice();
			},
			async loadLinkedVideoOriginal() { throw new Error('must not load'); },
			async releaseLinkedVideoOriginal(locatorId: string) {
				releases.push(locatorId);
				return true;
			},
		},
	});

	await assert.rejects(
		service.chooseLinkedVideoOriginal({ signal: controller.signal }),
		(error: unknown) => error === reason,
	);
	assert.deepEqual(releases, [LOCATOR_ID]);
});

test('linked-video chooser preserves primary and locator cleanup failures', async () => {
	const service = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() { return locatorChoice(); },
			async loadLinkedVideoOriginal() { return null; },
			async releaseLinkedVideoOriginal() { throw new Error('locator cleanup failed'); },
		},
	});

	await assert.rejects(service.chooseLinkedVideoOriginal(), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(String(error.errors[0]), /unavailable|changed/iu);
		assert.match(String(error.errors[1]), /cleanup failed/iu);
		return true;
	});
});

test('linked-video port rejects malformed bridge DTOs before body fetch', async () => {
	let fetchCalls = 0;
	const releases: string[] = [];
	const service = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() {
				return { ...locatorChoice(), path: '/private/selected.mp4' };
			},
			async loadLinkedVideoOriginal() { throw new Error('must not load'); },
			async releaseLinkedVideoOriginal(locatorId: string) {
				releases.push(locatorId);
				return true;
			},
		},
		fetch: async () => {
			fetchCalls += 1;
			throw new Error('must not fetch');
		},
	});
	await assert.rejects(service.chooseLinkedVideoOriginal(), /closed|unsupported field/iu);
	assert.equal(fetchCalls, 0);
	assert.deepEqual(releases, [LOCATOR_ID]);

	const loadService = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() { return null; },
			async loadLinkedVideoOriginal() {
				return { locatorRevision: 'bad', descriptor: readDescriptor() };
			},
			async releaseLinkedVideoOriginal() { return true; },
		},
		fetch: async () => {
			fetchCalls += 1;
			throw new Error('must not fetch');
		},
	});
	assert.ok(loadService.linkedVideoOriginalPort);
	await assert.rejects(
		() => Promise.resolve(loadService.linkedVideoOriginalPort?.load(LOCATOR_ID, { expectedRevision: null })),
		/locator revision/iu,
	);
	assert.equal(fetchCalls, 0);
});

function locatorChoice() {
	return {
		locatorId: LOCATOR_ID,
		locatorRevision: LOCATOR_REVISION,
		name: 'selected.mp4',
		size: 10,
		mimeType: 'video/mp4',
		lastModified: 123,
	};
}

function readDescriptor() {
	return {
		id: READ_ID,
		readProfile: 'materialized-v1',
		url: `soundscaper-app://bundle/_desktop/read/materialized-v1/${READ_ID}/selected.mp4`,
		name: 'selected.mp4',
		size: 10,
		mimeType: 'video/mp4',
		lastModified: 123,
	};
}
