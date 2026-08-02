/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { IPC, READ_PROFILE_MATERIALIZED_V1 } from '../desktop/constants.js';
import { registerDesktopLinkedVideoLocatorIpc } from '../desktop/linked-video-locator-ipc.js';

const LOCATOR_ID = 'a'.repeat(64);
const LOCATOR_REVISION = 'b'.repeat(64);
const READ_ID = 'c'.repeat(64);
const VIDEO_PATH = process.platform === 'win32' ? 'C:\\media\\selected.mp4' : '/media/selected.mp4';
const OWNER = Object.freeze({ generation: 7 });

test('linked-video IPC chooses one video and returns only frozen opaque metadata', async () => {
	const fixture = harness();
	fixture.dialogResult = { canceled: false, filePaths: [VIDEO_PATH] };
	fixture.locator = {
		locatorId: LOCATOR_ID,
		locatorRevision: LOCATOR_REVISION,
		name: 'selected.mp4',
		size: 42,
		mimeType: 'video/mp4',
		lastModified: 123,
		path: VIDEO_PATH,
	};

	const result = await fixture.handlers.get(IPC.chooseLinkedVideoOriginal)(fixture.event);

	assert.deepEqual(fixture.dialogCalls, [{
		window: fixture.window,
		options: {
			title: 'Link video original',
			properties: ['openFile'],
			filters: [{ name: 'Video', extensions: ['m4v', 'mp4', 'webm'] }],
		},
	}]);
	assert.deepEqual(fixture.storeCalls, [{
		method: 'registerPath',
		path: VIDEO_PATH,
		options: { owner: OWNER, mimeType: 'video/mp4', displayName: 'selected.mp4' },
	}]);
	assert.deepEqual(result, {
		locatorId: LOCATOR_ID,
		locatorRevision: LOCATOR_REVISION,
		name: 'selected.mp4',
		size: 42,
		mimeType: 'video/mp4',
		lastModified: 123,
	});
	assert.equal(Object.isFrozen(result), true);
	assert.equal('path' in result, false);
});

test('linked-video IPC handles cancellation and rejects non-video or ambiguous dialog results', async () => {
	const fixture = harness();
	fixture.dialogResult = { canceled: true, filePaths: [] };
	assert.equal(
		await fixture.handlers.get(IPC.chooseLinkedVideoOriginal)(fixture.event),
		null,
	);
	assert.deepEqual(fixture.storeCalls, []);

	fixture.dialogResult = { canceled: false, filePaths: [VIDEO_PATH, VIDEO_PATH] };
	await assert.rejects(
		fixture.handlers.get(IPC.chooseLinkedVideoOriginal)(fixture.event),
		/single video/iu,
	);
	fixture.dialogResult = {
		canceled: false,
		filePaths: [process.platform === 'win32' ? 'C:\\media\\notes.txt' : '/media/notes.txt'],
	};
	await assert.rejects(
		fixture.handlers.get(IPC.chooseLinkedVideoOriginal)(fixture.event),
		/video file type/iu,
	);
});

test('linked-video IPC validates load input and returns a materialized pathless descriptor', async () => {
	const fixture = harness();
	fixture.loaded = {
		locatorRevision: LOCATOR_REVISION,
		descriptor: {
			...readDescriptor(),
			path: VIDEO_PATH,
		},
		path: VIDEO_PATH,
	};

	const result = await fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
	});

	assert.deepEqual(fixture.storeCalls, [{
		method: 'load',
		locatorId: LOCATOR_ID,
		options: { owner: OWNER, expectedRevision: LOCATOR_REVISION },
	}]);
	assert.deepEqual(result, {
		locatorRevision: LOCATOR_REVISION,
		descriptor: readDescriptor(),
	});
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.descriptor), true);
	assert.equal('path' in result, false);
	assert.equal('path' in result.descriptor, false);

	fixture.loaded = null;
	assert.equal(await fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
		locatorId: LOCATOR_ID,
		expectedRevision: null,
	}), null);
	await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
			locatorId: LOCATOR_ID,
			expectedRevision: undefined,
		}),
		/revision/iu,
	);
	await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
			locatorId: '../selected.mp4',
			expectedRevision: null,
		}),
		/identifier/iu,
	);
});

test('linked-video IPC rejects malformed store values and scopes release to the renderer owner', async () => {
	const fixture = harness();
	fixture.locator = {
		locatorId: LOCATOR_ID,
		locatorRevision: 'not-a-revision',
		name: 'selected.mp4',
		size: 42,
		mimeType: 'video/mp4',
		lastModified: 123,
	};
	fixture.dialogResult = { canceled: false, filePaths: [VIDEO_PATH] };
	await assert.rejects(
		fixture.handlers.get(IPC.chooseLinkedVideoOriginal)(fixture.event),
		/revision/iu,
	);

	fixture.loaded = {
		locatorRevision: LOCATOR_REVISION,
		descriptor: { ...readDescriptor(), readProfile: 'scape-range-v1' },
	};
	await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
			locatorId: LOCATOR_ID,
			expectedRevision: null,
		}),
		/materialized/iu,
	);

	assert.equal(
		await fixture.handlers.get(IPC.releaseLinkedVideoOriginal)(fixture.event, LOCATOR_ID),
		true,
	);
	assert.deepEqual(fixture.storeCalls.at(-1), {
		method: 'release', locatorId: LOCATOR_ID, options: { owner: OWNER },
	});
	await assert.rejects(
		fixture.handlers.get(IPC.releaseLinkedVideoOriginal)(fixture.event, 'wrong'),
		/identifier/iu,
	);
});

test('desktop main wires linked-video grants into renderer revocation and shutdown', async () => {
	const [source, runtimeSource] = await Promise.all([
		readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../desktop/linked-video-locator-runtime.js', import.meta.url), 'utf8'),
	]);
	assert.match(source, /createDesktopLinkedVideoLocatorRuntime\(\{ readCapabilities, registryPath: resolve\(app\.getPath\('userData'\)/u);
	assert.match(source, /await linkedVideoLocators\.ready\(\)/u);
	assert.match(source, /linkedVideoLocators\.registerIpc\(/u);
	assert.match(source, /linkedVideoLocators\?\.revokeOwner\(owner\)/u);
	assert.match(source, /linkedVideoLocators\?\.dispose\(\)/u);
	assert.match(runtimeSource, /registerDesktopLinkedVideoLocatorIpc\(\{ \.\.\.options, store \}\)/u);
});

function harness() {
	const handlers = new Map();
	const dialogCalls = [];
	const storeCalls = [];
	const fixture = {
		dialogCalls,
		storeCalls,
		handlers,
		event: Object.freeze({ owner: OWNER }),
		window: Object.freeze({ id: 1 }),
		dialogResult: { canceled: true, filePaths: [] },
		locator: null,
		loaded: null,
	};
	const store = {
		async registerPath(path, options) {
			storeCalls.push({ method: 'registerPath', path, options });
			return fixture.locator;
		},
		async load(locatorId, options) {
			storeCalls.push({ method: 'load', locatorId, options });
			return fixture.loaded;
		},
		release(locatorId, options) {
			storeCalls.push({ method: 'release', locatorId, options });
			return true;
		},
	};
	registerDesktopLinkedVideoLocatorIpc({
		dialog: {
			async showOpenDialog(window, options) {
				dialogCalls.push({ window, options });
				return fixture.dialogResult;
			},
		},
		handle(channel, listener) { handlers.set(channel, listener); },
		ownerFor: (event) => event.owner,
		store,
		windowFor: () => fixture.window,
	});
	return fixture;
}

function readDescriptor() {
	return {
		id: READ_ID,
		url: `soundscaper-app://bundle/_desktop/read/${READ_PROFILE_MATERIALIZED_V1}/${READ_ID}/selected.mp4`,
		name: 'selected.mp4',
		size: 42,
		mimeType: 'video/mp4',
		readProfile: READ_PROFILE_MATERIALIZED_V1,
		lastModified: 123,
	};
}
