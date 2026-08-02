/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const LOCATOR_ID = 'a'.repeat(64);
const LOCATOR_REVISION = 'b'.repeat(64);
const READ_ID = 'c'.repeat(64);

test('preload exposes a frozen pathless linked-video chooser result', async () => {
	const raw = { ...locator(), path: '/private/selected.mp4', secret: true };
	const fixture = await loadPreload([raw]);
	const result = await fixture.bridge.chooseLinkedVideoOriginal();

	assert.deepEqual({ ...result }, locator());
	assert.equal(Object.isFrozen(result), true);
	assert.equal('path' in result, false);
	assert.deepEqual(fixture.invocations, [[
		'soundscaper:v1:linked-video:choose', undefined,
	]]);
});

test('preload validates linked-video load requests and sanitizes materialized descriptors', async () => {
	const raw = {
		locatorRevision: LOCATOR_REVISION,
		descriptor: { ...readDescriptor(), path: '/private/selected.mp4' },
		path: '/private/selected.mp4',
	};
	const fixture = await loadPreload([raw, null]);
	const result = await fixture.bridge.loadLinkedVideoOriginal({
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
	});

	assert.deepEqual({ ...result, descriptor: { ...result.descriptor } }, {
		locatorRevision: LOCATOR_REVISION,
		descriptor: readDescriptor(),
	});
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.descriptor), true);
	assert.equal('path' in result, false);
	assert.equal('path' in result.descriptor, false);
	assert.deepEqual([fixture.invocations[0][0], { ...fixture.invocations[0][1] }], [
		'soundscaper:v1:linked-video:load',
		{ locatorId: LOCATOR_ID, expectedRevision: LOCATOR_REVISION },
	]);
	assert.equal(await fixture.bridge.loadLinkedVideoOriginal({
		locatorId: LOCATOR_ID,
		expectedRevision: null,
	}), null);
	assert.deepEqual([fixture.invocations[1][0], { ...fixture.invocations[1][1] }], [
		'soundscaper:v1:linked-video:load',
		{ locatorId: LOCATOR_ID, expectedRevision: null },
	]);

	assert.throws(() => fixture.bridge.loadLinkedVideoOriginal({
		locatorId: 'wrong', expectedRevision: null,
	}), /identifier/iu);
	assert.throws(() => fixture.bridge.loadLinkedVideoOriginal({
		locatorId: LOCATOR_ID, expectedRevision: undefined,
	}), /revision/iu);
});

test('preload rejects malformed linked-video metadata and non-video read descriptors', async () => {
	const cases = [
		{ ...locator(), locatorId: 'wrong' },
		{ ...locator(), name: '../selected.mp4' },
		{ ...locator(), size: 512 * 1024 ** 2 + 1 },
		{ ...locator(), mimeType: 'audio/mp4' },
	];
	const choiceFixture = await loadPreload(cases);
	for (const _candidate of cases) {
		await assert.rejects(
			choiceFixture.bridge.chooseLinkedVideoOriginal(),
			/identifier|name|size|MIME/iu,
		);
	}

	const loadCases = [
		{ locatorRevision: LOCATOR_REVISION, descriptor: { ...readDescriptor(), readProfile: 'scape-range-v1' } },
		{ locatorRevision: LOCATOR_REVISION, descriptor: { ...readDescriptor(), mimeType: 'audio/mp4' } },
		{ locatorRevision: LOCATOR_REVISION, descriptor: { ...readDescriptor(), url: 'file:///private/selected.mp4' } },
		{ locatorRevision: 'wrong', descriptor: readDescriptor() },
	];
	const loadFixture = await loadPreload(loadCases);
	for (const _candidate of loadCases) {
		await assert.rejects(
			loadFixture.bridge.loadLinkedVideoOriginal({
				locatorId: LOCATOR_ID, expectedRevision: null,
			}),
			/materialized|MIME|capability URL|revision|Scape/iu,
		);
	}
});

test('preload validates owner-scoped linked-video release identifiers', async () => {
	const fixture = await loadPreload([true]);
	assert.equal(await fixture.bridge.releaseLinkedVideoOriginal(LOCATOR_ID), true);
	assert.deepEqual(fixture.invocations, [[
		'soundscaper:v1:linked-video:release', LOCATOR_ID,
	]]);
	assert.throws(
		() => fixture.bridge.releaseLinkedVideoOriginal('../selected.mp4'),
		/identifier/iu,
	);
});

function locator() {
	return {
		locatorId: LOCATOR_ID,
		locatorRevision: LOCATOR_REVISION,
		name: 'selected.mp4',
		size: 42,
		mimeType: 'video/mp4',
		lastModified: 123,
	};
}

function readDescriptor() {
	return {
		id: READ_ID,
		url: `soundscaper-app://bundle/_desktop/read/materialized-v1/${READ_ID}/selected.mp4`,
		name: 'selected.mp4',
		size: 42,
		mimeType: 'video/mp4',
		readProfile: 'materialized-v1',
		lastModified: 123,
	};
}

async function loadPreload(invocationResults) {
	let bridge;
	const invocations = [];
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		ArrayBuffer,
		Object,
		Promise,
		RangeError,
		String,
		TypeError,
		Uint8Array,
		URL,
		require: () => ({
			contextBridge: {
				exposeInMainWorld(name, value) {
					if (name === 'scapeDesktop') bridge = value.v1;
				},
			},
			ipcRenderer: {
				invoke(channel, value) {
					invocations.push([channel, value]);
					return Promise.resolve(invocationResults.shift());
				},
				send: () => {},
				on: () => {},
				removeListener: () => {},
			},
		}),
	});
	return { bridge, invocations };
}
