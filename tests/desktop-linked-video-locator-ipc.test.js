/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	IPC,
	READ_PROFILE_LINKED_VIDEO_RANGE_V1,
	READ_PROFILE_MATERIALIZED_V1,
} from '../desktop/constants.js';
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
		playback: false,
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
		playback: false,
	}), null);
	await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
			locatorId: LOCATOR_ID,
			expectedRevision: undefined,
			playback: false,
		}),
		/revision/iu,
	);
	await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
			locatorId: '../selected.mp4',
			expectedRevision: null,
			playback: false,
		}),
		/identifier/iu,
	);
	await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
			locatorId: LOCATOR_ID,
			expectedRevision: null,
			playback: false,
			path: VIDEO_PATH,
		}),
		/unsupported field/iu,
	);
	let getterCalls = 0;
	const accessorRequest = { locatorId: LOCATOR_ID, expectedRevision: null };
	Object.defineProperty(accessorRequest, 'playback', {
		enumerable: true,
		get() { getterCalls += 1; return false; },
	});
	await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, accessorRequest),
		/enumerable data field/iu,
	);
	assert.equal(getterCalls, 0);
});

test('linked-video IPC leases an exact pathless playback descriptor on the load channel', async () => {
	const fixture = harness();
	fixture.loaded = {
		locatorRevision: LOCATOR_REVISION,
		descriptor: readDescriptor(READ_PROFILE_LINKED_VIDEO_RANGE_V1),
	};

	const result = await fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
		playback: true,
	});

	assert.deepEqual(fixture.storeCalls, [{
		method: 'leasePlayback',
		locatorId: LOCATOR_ID,
		options: { owner: OWNER, expectedRevision: LOCATOR_REVISION },
	}]);
	assert.deepEqual(result, {
		locatorRevision: LOCATOR_REVISION,
		descriptor: readDescriptor(READ_PROFILE_LINKED_VIDEO_RANGE_V1),
	});
	await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
			locatorId: LOCATOR_ID,
			expectedRevision: null,
			playback: true,
		}),
		/exact|revision/iu,
	);
});

test('linked-video IPC rolls back an admitted descriptor when response validation fails', async () => {
	const fixture = harness();
	fixture.loaded = {
		locatorRevision: LOCATOR_REVISION,
		descriptor: { ...readDescriptor(), url: 'file:///private/selected.mp4' },
	};
	await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
			locatorId: LOCATOR_ID,
			expectedRevision: LOCATOR_REVISION,
			playback: false,
		}),
		/capability URL/iu,
	);
	assert.deepEqual(fixture.readCapabilityCalls, [{
		method: 'release', id: READ_ID, owner: OWNER,
	}]);
});

test('linked-video IPC preserves response-validation and rollback failures', async () => {
	const fixture = harness();
	fixture.loaded = {
		locatorRevision: LOCATOR_REVISION,
		descriptor: { ...readDescriptor(), url: 'file:///private/selected.mp4' },
	};
	fixture.releaseReadError = new Error('read cleanup failed');
	await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
			locatorId: LOCATOR_ID,
			expectedRevision: LOCATOR_REVISION,
			playback: false,
		}),
		(error) => {
			assert.ok(error instanceof AggregateError);
			assert.match(String(error.errors[0]), /capability URL/iu);
			assert.match(String(error.errors[1]), /cleanup failed/iu);
			return true;
		},
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
	assert.equal(fixture.storeCalls.some(({ method }) => method === 'release'), false);

	fixture.loaded = {
		locatorRevision: LOCATOR_REVISION,
		descriptor: { ...readDescriptor(), readProfile: 'scape-range-v1' },
	};
	await assert.rejects(
		fixture.handlers.get(IPC.loadLinkedVideoOriginal)(fixture.event, {
			locatorId: LOCATOR_ID,
			expectedRevision: null,
			playback: false,
		}),
		/materialized/iu,
	);

	assert.equal(
		await fixture.handlers.get(IPC.releaseLinkedVideoOriginal)(fixture.event, {
			locatorId: LOCATOR_ID,
			locatorRevision: LOCATOR_REVISION,
		}),
		true,
	);
	assert.deepEqual(fixture.storeCalls.at(-1), {
		method: 'release', locatorId: LOCATOR_ID,
		options: { owner: OWNER, expectedRevision: LOCATOR_REVISION },
	});
	const releaseCalls = fixture.storeCalls.length;
	for (const value of [
		LOCATOR_ID,
		{ locatorId: LOCATOR_ID },
		{ locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION, path: VIDEO_PATH },
		Object.defineProperty({ locatorRevision: LOCATOR_REVISION }, 'locatorId', { enumerable: true, get() { throw new Error('must not read'); } }),
	]) await assert.rejects(
		fixture.handlers.get(IPC.releaseLinkedVideoOriginal)(fixture.event, value),
		/field|identifier|reference/iu,
	);
	assert.equal(fixture.storeCalls.length, releaseCalls);
});

test('linked-video IPC treats an unacknowledged exact chooser rollback as cleanup failure', async () => {
	const fixture = harness();
	fixture.dialogResult = { canceled: false, filePaths: [VIDEO_PATH] };
	fixture.locator = {
		locatorId: LOCATOR_ID,
		locatorRevision: LOCATOR_REVISION,
		name: '../selected.mp4',
		size: 42,
		mimeType: 'video/mp4',
		lastModified: 123,
	};
	fixture.releaseResult = false;
	await assert.rejects(
		fixture.handlers.get(IPC.chooseLinkedVideoOriginal)(fixture.event),
		(error) => {
			assert.ok(error instanceof AggregateError);
			assert.match(String(error.errors[0]), /name/iu);
			assert.match(String(error.errors[1]), /not acknowledged/iu);
			return true;
		},
	);
	assert.deepEqual(fixture.storeCalls.at(-1), {
		method: 'release', locatorId: LOCATOR_ID,
		options: { owner: OWNER, expectedRevision: LOCATOR_REVISION },
	});
});

test('linked-video IPC accepts only a complete bounded exact startup inventory', async () => {
	const fixture = harness();
	fixture.reconciled = 2;
	const references = [{ locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION }];

	assert.equal(await fixture.handlers.get(IPC.reconcileLinkedVideoOriginals)(
		fixture.event,
		references,
	), 2);
	assert.deepEqual(fixture.storeCalls.at(-1), {
		method: 'reconcileStartup', references, options: { owner: OWNER },
	});
	for (const value of [
		[{ ...references[0], path: VIDEO_PATH }],
		[references[0], references[0]],
		[{ locatorId: 'wrong', locatorRevision: LOCATOR_REVISION }],
		Array.from({ length: 129 }, (_, index) => ({
			locatorId: index.toString(16).padStart(64, '0'),
			locatorRevision: LOCATOR_REVISION,
		})),
	]) {
		await assert.rejects(
			fixture.handlers.get(IPC.reconcileLinkedVideoOriginals)(fixture.event, value),
			/field|duplicate|identifier|count|limit/iu,
		);
	}
	assert.equal(fixture.storeCalls.filter(({ method }) => method === 'reconcileStartup').length, 1);
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
	assert.match(runtimeSource, /releaseRead: \(id, owner\) => readCapabilities\.release\(id, \{ owner \}\)/u);
});

function harness() {
	const handlers = new Map();
	const dialogCalls = [];
	const readCapabilityCalls = [];
	const storeCalls = [];
	const fixture = {
		dialogCalls,
		readCapabilityCalls,
		storeCalls,
		handlers,
		event: Object.freeze({ owner: OWNER }),
		window: Object.freeze({ id: 1 }),
		dialogResult: { canceled: true, filePaths: [] },
		locator: null,
		loaded: null,
		reconciled: 0,
		releaseResult: true,
		releaseReadError: null,
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
		async leasePlayback(locatorId, options) {
			storeCalls.push({ method: 'leasePlayback', locatorId, options });
			return fixture.loaded;
		},
		release(locatorId, options) {
			storeCalls.push({ method: 'release', locatorId, options });
			return fixture.releaseResult;
		},
		reconcileStartup(references, options) {
			storeCalls.push({ method: 'reconcileStartup', references, options });
			return fixture.reconciled;
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
		releaseRead(id, owner) {
			readCapabilityCalls.push({ method: 'release', id, owner });
			if (fixture.releaseReadError) throw fixture.releaseReadError;
			return true;
		},
		store,
		windowFor: () => fixture.window,
	});
	return fixture;
}

function readDescriptor(readProfile = READ_PROFILE_MATERIALIZED_V1) {
	return {
		id: READ_ID,
		url: `soundscaper-app://bundle/_desktop/read/${readProfile}/${READ_ID}/selected.mp4`,
		name: 'selected.mp4',
		size: 42,
		mimeType: 'video/mp4',
		readProfile,
		lastModified: 123,
	};
}
