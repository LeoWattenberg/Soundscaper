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
		playback: false,
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
		{ locatorId: LOCATOR_ID, expectedRevision: LOCATOR_REVISION, playback: false },
	]);
	assert.equal(await fixture.bridge.loadLinkedVideoOriginal({
		locatorId: LOCATOR_ID,
		expectedRevision: null,
		playback: false,
	}), null);
	assert.deepEqual([fixture.invocations[1][0], { ...fixture.invocations[1][1] }], [
		'soundscaper:v1:linked-video:load',
		{ locatorId: LOCATOR_ID, expectedRevision: null, playback: false },
	]);

	assert.throws(() => fixture.bridge.loadLinkedVideoOriginal({
		locatorId: 'wrong', expectedRevision: null, playback: false,
	}), /identifier/iu);
	assert.throws(() => fixture.bridge.loadLinkedVideoOriginal({
		locatorId: LOCATOR_ID, expectedRevision: undefined, playback: false,
	}), /revision/iu);
	assert.throws(() => fixture.bridge.loadLinkedVideoOriginal({
		locatorId: LOCATOR_ID, expectedRevision: null, playback: false,
		path: '/private/selected.mp4',
	}), /unsupported field/iu);
	let getterCalls = 0;
	const accessorRequest = { locatorId: LOCATOR_ID, expectedRevision: null };
	Object.defineProperty(accessorRequest, 'playback', {
		enumerable: true,
		get() { getterCalls += 1; return false; },
	});
	assert.throws(
		() => fixture.bridge.loadLinkedVideoOriginal(accessorRequest),
		/unsupported field/iu,
	);
	assert.equal(getterCalls, 0);
});

test('preload exposes exact linked-video playback leases on the existing load channel', async () => {
	const descriptor = readDescriptor('linked-video-range-v1');
	const fixture = await loadPreload([{ locatorRevision: LOCATOR_REVISION, descriptor }]);
	const result = await fixture.bridge.loadLinkedVideoOriginal({
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
		playback: true,
	});
	assert.deepEqual({ ...result, descriptor: { ...result.descriptor } }, {
		locatorRevision: LOCATOR_REVISION,
		descriptor,
	});
	assert.deepEqual([fixture.invocations[0][0], { ...fixture.invocations[0][1] }], [
		'soundscaper:v1:linked-video:load',
		{ locatorId: LOCATOR_ID, expectedRevision: LOCATOR_REVISION, playback: true },
	]);
	assert.throws(() => fixture.bridge.loadLinkedVideoOriginal({
		locatorId: LOCATOR_ID,
		expectedRevision: null,
		playback: true,
	}), /exact|revision/iu);
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
	const loadFixture = await loadPreload(loadCases.flatMap((value) => [value, true]));
	for (const _candidate of loadCases) {
		await assert.rejects(
			loadFixture.bridge.loadLinkedVideoOriginal({
				locatorId: LOCATOR_ID, expectedRevision: null, playback: false,
			}),
			/materialized|MIME|capability URL|revision|Scape/iu,
		);
	}
	const playbackFixture = await loadPreload([{
		locatorRevision: LOCATOR_REVISION,
		descriptor: readDescriptor(),
	}, true]);
	await assert.rejects(playbackFixture.bridge.loadLinkedVideoOriginal({
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
		playback: true,
	}), /linked-video-range|playback/iu);
});

test('preload preserves linked-video response-validation and read-cleanup failures', async () => {
	const fixture = await loadPreload([{
		locatorRevision: LOCATOR_REVISION,
		descriptor: { ...readDescriptor(), url: 'file:///private/selected.mp4' },
	}, new Error('read cleanup failed')]);
	await assert.rejects(fixture.bridge.loadLinkedVideoOriginal({
		locatorId: LOCATOR_ID,
		expectedRevision: LOCATOR_REVISION,
		playback: false,
	}), (error) => {
		assert.equal(error.name, 'AggregateError');
		assert.match(String(error.errors[0]), /capability URL/iu);
		assert.match(String(error.errors[1]), /cleanup failed/iu);
		return true;
	});
	assert.deepEqual(fixture.invocations.map(([channel, value]) => [
		channel, typeof value === 'object' ? { ...value } : value,
	]), [
		['soundscaper:v1:linked-video:load', {
			locatorId: LOCATOR_ID, expectedRevision: LOCATOR_REVISION, playback: false,
		}],
		['soundscaper:v1:files:release', READ_ID],
	]);
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

test('preload validates and freezes the complete linked-video startup inventory', async () => {
	const fixture = await loadPreload([2]);
	const references = [{ locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION }];
	assert.equal(await fixture.bridge.reconcileLinkedVideoOriginals(references), 2);
	assert.deepEqual(fixture.invocations.map(([channel, value]) => [
		channel,
		value.map((reference) => ({ ...reference })),
	]), [[
		'soundscaper:v1:linked-video:reconcile', references,
	]]);
	assert.equal(Object.isFrozen(fixture.invocations[0][1]), true);
	assert.equal(Object.isFrozen(fixture.invocations[0][1][0]), true);
	for (const value of [
		[{ ...references[0], path: '/private/selected.mp4' }],
		[references[0], references[0]],
		[{ locatorId: 'wrong', locatorRevision: LOCATOR_REVISION }],
		Array.from({ length: 129 }, (_, index) => ({
			locatorId: index.toString(16).padStart(64, '0'),
			locatorRevision: LOCATOR_REVISION,
		})),
	]) assert.throws(
		() => fixture.bridge.reconcileLinkedVideoOriginals(value),
		/field|duplicate|identifier|count|limit/iu,
	);
	assert.equal(fixture.invocations.length, 1);
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

function readDescriptor(readProfile = 'materialized-v1') {
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
					const result = invocationResults.shift();
					return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
				},
				send: () => {},
				on: () => {},
				removeListener: () => {},
			},
		}),
	});
	return { bridge, invocations };
}
