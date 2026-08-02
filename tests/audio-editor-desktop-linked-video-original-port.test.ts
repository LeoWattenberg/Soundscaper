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
			async reconcileLinkedVideoOriginals(references: unknown) {
				calls.push(['reconcile', references]);
				return 2;
			},
			async releaseLinkedVideoOriginal(reference: unknown) {
				calls.push(['release-locator', reference]);
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
		['load', { locatorId: LOCATOR_ID, expectedRevision: LOCATOR_REVISION, playback: false }],
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
	assert.equal(await service.linkedVideoOriginalPort.reconcile?.([{
		locatorId: LOCATOR_ID,
		locatorRevision: LOCATOR_REVISION,
	}]), 2);
	assert.equal(await service.linkedVideoOriginalPort.release({
		locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
	}), true);
	assert.deepEqual(calls.slice(-5), [
		['load', { locatorId: LOCATOR_ID, expectedRevision: null, playback: false }],
		['fetch', descriptor.url],
		['release-read', READ_ID],
		['reconcile', [{ locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION }]],
		['release-locator', { locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION }],
	]);
});

test('linked-video chooser cancellation is inert and the browser adapter stays absent', async () => {
	let loadCalls = 0;
	const desktop = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() { return null; },
			async loadLinkedVideoOriginal() { loadCalls += 1; return null; },
			async reconcileLinkedVideoOriginals() { return 0; },
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
	const releases: unknown[] = [];
	const service = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() { return locatorChoice(); },
			async loadLinkedVideoOriginal() {
				return { locatorRevision: LOCATOR_REVISION, descriptor: readDescriptor() };
			},
			async reconcileLinkedVideoOriginals() { return 0; },
			async releaseLinkedVideoOriginal(reference: unknown) {
				releases.push(reference);
				return true;
			},
			async releaseRead() { return true; },
		},
		fetch: async () => new Response('denied', { status: 500 }),
	});

	await assert.rejects(service.chooseLinkedVideoOriginal(), /status 500/iu);
	assert.deepEqual(releases, [{ locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION }]);
});

test('linked-video chooser releases a locator when cancellation wins after selection', async () => {
	const controller = new AbortController();
	const reason = new Error('cancel linked selection');
	const releases: unknown[] = [];
	const service = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() {
				controller.abort(reason);
				return locatorChoice();
			},
			async loadLinkedVideoOriginal() { throw new Error('must not load'); },
			async reconcileLinkedVideoOriginals() { return 0; },
			async releaseLinkedVideoOriginal(reference: unknown) {
				releases.push(reference);
				return true;
			},
		},
	});

	await assert.rejects(
		service.chooseLinkedVideoOriginal({ signal: controller.signal }),
		(error: unknown) => error === reason,
	);
	assert.deepEqual(releases, [{ locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION }]);
});

test('linked-video load releases an admitted read when cancellation wins with the response', async () => {
	const controller = new AbortController();
	const reason = new Error('cancel linked load');
	const releasedReads: string[] = [];
	const service = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() { return null; },
			async loadLinkedVideoOriginal() {
				controller.abort(reason);
				return { locatorRevision: LOCATOR_REVISION, descriptor: readDescriptor() };
			},
			async reconcileLinkedVideoOriginals() { return 0; },
			async releaseLinkedVideoOriginal() { return true; },
			async releaseRead(id: string) { releasedReads.push(id); return true; },
		},
		fetch: async () => { throw new Error('must not fetch an aborted read'); },
	});

	await assert.rejects(
		Promise.resolve(service.linkedVideoOriginalPort?.load(LOCATOR_ID, {
			expectedRevision: LOCATOR_REVISION,
			signal: controller.signal,
		})),
		(error: unknown) => error === reason,
	);
	assert.deepEqual(releasedReads, [READ_ID]);
});

test('linked-video chooser preserves primary and unacknowledged locator cleanup failures', async () => {
	const service = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() { return locatorChoice(); },
			async loadLinkedVideoOriginal() { return null; },
			async reconcileLinkedVideoOriginals() { return 0; },
			async releaseLinkedVideoOriginal() { return false; },
		},
	});

	await assert.rejects(service.chooseLinkedVideoOriginal(), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.match(String(error.errors[0]), /unavailable|changed/iu);
		assert.match(String(error.errors[1]), /not acknowledged/iu);
		return true;
	});
});

test('linked-video port rejects malformed bridge DTOs before body fetch', async () => {
	let fetchCalls = 0;
	const releases: unknown[] = [];
	const service = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() {
				return { ...locatorChoice(), path: '/private/selected.mp4' };
			},
			async loadLinkedVideoOriginal() { throw new Error('must not load'); },
			async reconcileLinkedVideoOriginals() { return 0; },
			async releaseLinkedVideoOriginal(reference: unknown) {
				releases.push(reference);
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
	assert.deepEqual(releases, [{ locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION }]);

	const loadService = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() { return null; },
			async loadLinkedVideoOriginal() {
				return { locatorRevision: 'bad', descriptor: readDescriptor() };
			},
			async reconcileLinkedVideoOriginals() { return 0; },
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

test('linked-video cleanup requires an exact own-data locator reference', async () => {
	let getterCalls = 0;
	const accessorChoice = { ...locatorChoice() };
	Object.defineProperty(accessorChoice, 'locatorRevision', {
		enumerable: true,
		get() { getterCalls += 1; return LOCATOR_REVISION; },
	});
	const { locatorRevision: _omitted, ...missingRevision } = locatorChoice();
	for (const choice of [
		{ ...locatorChoice(), locatorRevision: 'bad' }, missingRevision, accessorChoice,
	]) {
		const releases: unknown[] = [];
		const service = createAudioEditorFileService({ bridge: {
			async chooseLinkedVideoOriginal() { return choice; },
			async loadLinkedVideoOriginal() { throw new Error('must not load'); },
			async reconcileLinkedVideoOriginals() { return 0; },
			async releaseLinkedVideoOriginal(reference: unknown) { releases.push(reference); return true; },
		} });
		await assert.rejects(service.chooseLinkedVideoOriginal(), /revision|unsupported field|data field/iu);
		assert.deepEqual(releases, []);
	}
	assert.equal(getterCalls, 0);
});

test('linked-video release rejects non-exact references before invoking the bridge', async () => {
	let releaseCalls = 0;
	const service = createAudioEditorFileService({ bridge: {
		async chooseLinkedVideoOriginal() { return null; },
		async loadLinkedVideoOriginal() { return null; },
		async reconcileLinkedVideoOriginals() { return 0; },
		async releaseLinkedVideoOriginal() { releaseCalls += 1; return true; },
	} });
	assert.ok(service.linkedVideoOriginalPort);
	const release = service.linkedVideoOriginalPort.release as (value: unknown) => Promise<boolean>;
	for (const value of [LOCATOR_ID, { locatorId: LOCATOR_ID }, {
		locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION, path: '/private/movie.mp4',
	}]) await assert.rejects(release(value), /object|unsupported field/iu);
	assert.equal(releaseCalls, 0);
});

test('linked-video reconciliation rejects malformed references and bridge results', async () => {
	const service = createAudioEditorFileService({
		bridge: {
			async chooseLinkedVideoOriginal() { return null; },
			async loadLinkedVideoOriginal() { return null; },
			async reconcileLinkedVideoOriginals() { return -1; },
			async releaseLinkedVideoOriginal() { return true; },
		},
	});
	assert.ok(service.linkedVideoOriginalPort);
	await assert.rejects(
		Promise.resolve(service.linkedVideoOriginalPort.reconcile?.([{
			locatorId: LOCATOR_ID,
			locatorRevision: LOCATOR_REVISION,
		}])),
		/removal count|non-negative/iu,
	);
	await assert.rejects(
		Promise.resolve(service.linkedVideoOriginalPort.reconcile?.([{
			locatorId: '../selected.mp4',
			locatorRevision: LOCATOR_REVISION,
		}])),
		/locator identifier/iu,
	);
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
