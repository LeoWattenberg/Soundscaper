/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { IPC } from '../desktop/constants.js';
import { registerDesktopLinkedVideoLocatorIpc } from '../desktop/linked-video-locator-ipc.js';

const LOCATOR_ID = 'a'.repeat(64);
const REVISION = 'b'.repeat(64);
const READ_ID = 'c'.repeat(64);
const WAV_PATH = process.platform === 'win32' ? 'C:\\media\\selected.wav' : '/media/selected.wav';
const OWNER = Object.freeze({ renderer: 1 });

test('linked-audio IPC chooses only WAV originals and returns pathless metadata', async () => {
	const fixture = harness();
	fixture.dialogResult = { canceled: false, filePaths: [WAV_PATH] };
	fixture.locator = locator();
	const result = await fixture.handlers.get(IPC.chooseLinkedAudioOriginal)(fixture.event);

	assert.deepEqual(fixture.dialogCalls, [{
		window: fixture.window,
		options: {
			title: 'Link WAV audio original', properties: ['openFile'],
			filters: [{ name: 'Uncompressed WAV audio', extensions: ['rf64', 'wav'] }],
		},
	}]);
	assert.deepEqual(fixture.storeCalls, [{
		method: 'registerPath', path: WAV_PATH,
		options: { kind: 'audio', owner: OWNER, mimeType: 'audio/wav', displayName: 'selected.wav' },
	}]);
	assert.deepEqual(result, locator());
	assert.equal(Object.isFrozen(result), true);
	assert.equal('path' in result, false);

	for (const path of [
		process.platform === 'win32' ? 'C:\\media\\selected.mp3' : '/media/selected.mp3',
		process.platform === 'win32' ? 'C:\\media\\selected.webm' : '/media/selected.webm',
	]) {
		fixture.dialogResult = { canceled: false, filePaths: [path] };
		await assert.rejects(
			fixture.handlers.get(IPC.chooseLinkedAudioOriginal)(fixture.event),
			/WAV|audio file type/iu,
		);
	}
});

test('linked-audio IPC loads only materialized WAV descriptors through the audio kind fence', async () => {
	const fixture = harness();
	fixture.loaded = { locatorRevision: REVISION, descriptor: readDescriptor() };
	const request = { locatorId: LOCATOR_ID, expectedRevision: REVISION, range: false };
	const result = await fixture.handlers.get(IPC.loadLinkedAudioOriginal)(fixture.event, request);

	assert.deepEqual(fixture.storeCalls, [{
		method: 'load', locatorId: LOCATOR_ID,
		options: { owner: OWNER, expectedRevision: REVISION, expectedKind: 'audio' },
	}]);
	assert.deepEqual(result, fixture.loaded);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.descriptor), true);
	assert.equal('path' in result.descriptor, false);

	for (const descriptor of [
		{ ...readDescriptor(), readProfile: 'linked-video-range-v1' },
		{ ...readDescriptor(), mimeType: 'audio/mpeg' },
		{ ...readDescriptor(), name: 'selected.mp3' },
	]) {
		fixture.loaded = { locatorRevision: REVISION, descriptor };
		await assert.rejects(
			fixture.handlers.get(IPC.loadLinkedAudioOriginal)(fixture.event, request),
			/materialized|WAV|MIME|name/iu,
		);
	}
	assert.equal(fixture.storeCalls.some(({ method }) => method === 'leaseRange'), false);
});

test('linked-audio IPC requires an exact revision and leases the audio range profile', async () => {
	const fixture = harness();
	fixture.loaded = {
		locatorRevision: REVISION,
		descriptor: readDescriptor({ readProfile: 'linked-audio-range-v1' }),
	};
	const result = await fixture.handlers.get(IPC.loadLinkedAudioOriginal)(fixture.event, {
		locatorId: LOCATOR_ID, expectedRevision: REVISION, range: true,
	});

	assert.deepEqual(fixture.storeCalls, [{
		method: 'leaseRange', locatorId: LOCATOR_ID,
		options: { owner: OWNER, expectedRevision: REVISION, expectedKind: 'audio' },
	}]);
	assert.equal(result.descriptor.readProfile, 'linked-audio-range-v1');
	await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedAudioOriginal)(fixture.event, {
			locatorId: LOCATOR_ID, expectedRevision: null, range: true,
		}),
		/exact|revision|range/iu,
	);
	for (const value of [
		{ locatorId: LOCATOR_ID, expectedRevision: REVISION },
		{ locatorId: LOCATOR_ID, expectedRevision: REVISION, range: 'yes' },
		{ locatorId: LOCATOR_ID, expectedRevision: REVISION, range: false, playback: false },
	]) await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedAudioOriginal)(fixture.event, value),
		/field|boolean|mode|range/iu,
	);
});

test('linked-original IPC reconciles and releases one exact kind-aware inventory', async () => {
	const fixture = harness();
	const references = [
		{ kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: REVISION },
		{ kind: 'video', locatorId: 'd'.repeat(64), locatorRevision: 'e'.repeat(64) },
	];
	assert.equal(await fixture.handlers.get(IPC.reconcileLinkedOriginals)(
		fixture.event, references,
	), 0);
	assert.equal(await fixture.handlers.get(IPC.releaseLinkedOriginal)(
		fixture.event, references[0],
	), true);
	assert.deepEqual(fixture.storeCalls, [
		{ method: 'reconcileStartup', references, options: { owner: OWNER } },
		{
			method: 'release', locatorId: LOCATOR_ID,
			options: { owner: OWNER, expectedRevision: REVISION, expectedKind: 'audio' },
		},
	]);
	for (const value of [
		{ ...references[0], kind: 'image' },
		{ locatorId: LOCATOR_ID, locatorRevision: REVISION },
		{ ...references[0], path: WAV_PATH },
	]) await assert.rejects(
		fixture.handlers.get(IPC.releaseLinkedOriginal)(fixture.event, value),
		/kind|field|media/iu,
	);
});

function harness() {
	const handlers = new Map();
	const dialogCalls = [];
	const storeCalls = [];
	const fixture = {
		handlers, dialogCalls, storeCalls,
		event: Object.freeze({ owner: OWNER }), window: Object.freeze({ id: 1 }),
		dialogResult: { canceled: true, filePaths: [] }, locator: null, loaded: null,
	};
	const store = {
		registerPath(path, options) { storeCalls.push({ method: 'registerPath', path, options }); return fixture.locator; },
		load(locatorId, options) { storeCalls.push({ method: 'load', locatorId, options }); return fixture.loaded; },
		leaseRange(locatorId, options) { storeCalls.push({ method: 'leaseRange', locatorId, options }); return fixture.loaded; },
		reconcileStartup(references, options) { storeCalls.push({ method: 'reconcileStartup', references, options }); return 0; },
		release(locatorId, options) { storeCalls.push({ method: 'release', locatorId, options }); return true; },
	};
	registerDesktopLinkedVideoLocatorIpc({
		dialog: { showOpenDialog(window, options) { dialogCalls.push({ window, options }); return fixture.dialogResult; } },
		handle(channel, listener) { handlers.set(channel, listener); },
		ownerFor: (event) => event.owner,
		releaseRead: () => true,
		store,
		windowFor: () => fixture.window,
	});
	return fixture;
}

function locator() {
	return {
		locatorId: LOCATOR_ID, locatorRevision: REVISION, name: 'selected.wav',
		size: 42, mimeType: 'audio/wav', lastModified: 123,
	};
}

function readDescriptor(overrides = {}) {
	const readProfile = overrides.readProfile || 'materialized-v1';
	return {
		id: READ_ID,
		url: `soundscaper-app://bundle/_desktop/read/${readProfile}/${READ_ID}/selected.wav`,
		name: 'selected.wav', size: 42, mimeType: 'audio/wav',
		readProfile, lastModified: 123, ...overrides,
	};
}
