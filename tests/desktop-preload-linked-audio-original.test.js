/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const LOCATOR_ID = 'a'.repeat(64);
const REVISION = 'b'.repeat(64);
const READ_ID = 'c'.repeat(64);

test('preload exposes pathless linked-WAV choose and materialized-load methods', async () => {
	const rawLocator = { ...locator(), path: '/private/selected.wav' };
	const rawLoaded = {
		locatorRevision: REVISION,
		descriptor: { ...readDescriptor(), path: '/private/selected.wav' },
	};
	const fixture = await loadPreload([rawLocator, rawLoaded]);
	const choice = await fixture.bridge.chooseLinkedAudioOriginal();
	const loaded = await fixture.bridge.loadLinkedAudioOriginal({
		locatorId: LOCATOR_ID, expectedRevision: REVISION, range: false,
	});

	assert.deepEqual({ ...choice }, locator());
	assert.equal(Object.isFrozen(choice), true);
	assert.equal('path' in choice, false);
	assert.deepEqual({ ...loaded, descriptor: { ...loaded.descriptor } }, {
		locatorRevision: REVISION, descriptor: readDescriptor(),
	});
	assert.equal(Object.isFrozen(loaded), true);
	assert.equal(Object.isFrozen(loaded.descriptor), true);
	assert.equal('path' in loaded.descriptor, false);
	assert.deepEqual(fixture.invocations.map(([channel, value]) => [
		channel, value && typeof value === 'object' ? { ...value } : value,
	]), [
		['soundscaper:v1:linked-audio:choose', undefined],
		['soundscaper:v1:linked-audio:load', {
			locatorId: LOCATOR_ID, expectedRevision: REVISION, range: false,
		}],
	]);
});

test('preload accepts only exact linked-audio range requests and sanitizes their profile', async () => {
	const rawLoaded = {
		locatorRevision: REVISION,
		descriptor: {
			...readDescriptor('linked-audio-range-v1'),
			path: '/private/selected.wav',
		},
	};
	const fixture = await loadPreload([rawLoaded]);
	const loaded = await fixture.bridge.loadLinkedAudioOriginal({
		locatorId: LOCATOR_ID, expectedRevision: REVISION, range: true,
	});

	assert.equal(loaded.descriptor.readProfile, 'linked-audio-range-v1');
	assert.equal('path' in loaded.descriptor, false);
	assert.deepEqual(fixture.invocations.map(([channel, value]) => [channel, { ...value }]), [[
		'soundscaper:v1:linked-audio:load',
		{ locatorId: LOCATOR_ID, expectedRevision: REVISION, range: true },
	]]);
	assert.throws(() => fixture.bridge.loadLinkedAudioOriginal({
		locatorId: LOCATOR_ID, expectedRevision: null, range: true,
	}), /exact|revision|range/iu);
	for (const value of [
		{ locatorId: LOCATOR_ID, expectedRevision: REVISION },
		{ locatorId: LOCATOR_ID, expectedRevision: REVISION, range: 'yes' },
		{ locatorId: LOCATOR_ID, expectedRevision: REVISION, range: false, path: '/private' },
	]) assert.throws(() => fixture.bridge.loadLinkedAudioOriginal(value), /field|boolean|mode|range/iu);
	assert.equal(fixture.invocations.length, 1);
});

test('preload admits exact classic AIFF and RF64 locator, materialized, and range DTOs', async () => {
	for (const { name, mimeType } of [
		{ name: 'selected.aif', mimeType: 'audio/aiff' },
		{ name: 'selected.aiff', mimeType: 'audio/aiff' },
		{ name: 'selected.rf64', mimeType: 'audio/rf64' },
	]) {
		const rawLocator = { ...locator({ name, mimeType }), path: `/private/${name}` };
		const rawMaterialized = {
			locatorRevision: REVISION,
			descriptor: {
				...readDescriptor('materialized-v1', { name, mimeType }),
				path: `/private/${name}`,
			},
		};
		const rawRange = {
			locatorRevision: REVISION,
			descriptor: {
				...readDescriptor('linked-audio-range-v1', { name, mimeType }),
				path: `/private/${name}`,
			},
		};
		const fixture = await loadPreload([rawLocator, rawMaterialized, rawRange]);

		const choice = await fixture.bridge.chooseLinkedAudioOriginal();
		const materialized = await fixture.bridge.loadLinkedAudioOriginal({
			locatorId: LOCATOR_ID, expectedRevision: REVISION, range: false,
		});
		const range = await fixture.bridge.loadLinkedAudioOriginal({
			locatorId: LOCATOR_ID, expectedRevision: REVISION, range: true,
		});

		assert.deepEqual({ ...choice }, locator({ name, mimeType }));
		assert.equal('path' in choice, false);
		for (const [loaded, readProfile] of [
			[materialized, 'materialized-v1'],
			[range, 'linked-audio-range-v1'],
		]) {
			assert.equal(loaded.descriptor.name, name);
			assert.equal(loaded.descriptor.mimeType, mimeType);
			assert.equal(loaded.descriptor.readProfile, readProfile);
			assert.equal('path' in loaded.descriptor, false);
		}
	}
});

test('preload rejects mismatched classic AIFF filename and MIME pairs', async () => {
	const mismatches = [
		{ name: 'selected.aif', mimeType: 'audio/wav' },
		{ name: 'selected.aiff', mimeType: 'audio/rf64' },
		{ name: 'selected.wav', mimeType: 'audio/aiff' },
		{ name: 'selected.aifc', mimeType: 'audio/aiff' },
		{ name: 'selected.aiff', mimeType: 'audio/x-aiff' },
	];
	const choiceFixture = await loadPreload(mismatches.map((value) => locator(value)));
	for (const _value of mismatches) {
		await assert.rejects(choiceFixture.bridge.chooseLinkedAudioOriginal(), /AIFF|WAV|MIME/iu);
	}
	const materializedFixture = await loadPreload(mismatches.flatMap((value) => [{
		locatorRevision: REVISION,
		descriptor: readDescriptor('materialized-v1', value),
	}, true]));
	for (const _value of mismatches) {
		await assert.rejects(materializedFixture.bridge.loadLinkedAudioOriginal({
			locatorId: LOCATOR_ID, expectedRevision: REVISION, range: false,
		}), /AIFF|WAV|MIME/iu);
	}
	const rangeFixture = await loadPreload(mismatches.flatMap((value) => [{
		locatorRevision: REVISION,
		descriptor: readDescriptor('linked-audio-range-v1', value),
	}, true]));
	for (const _value of mismatches) {
		await assert.rejects(rangeFixture.bridge.loadLinkedAudioOriginal({
			locatorId: LOCATOR_ID, expectedRevision: REVISION, range: true,
		}), /AIFF|WAV|MIME/iu);
	}
});

test('preload rejects linked audio playback-shaped requests and unsupported responses', async () => {
	const fixture = await loadPreload([
		{ ...locator(), mimeType: 'audio/mpeg' },
		{ locatorRevision: REVISION, descriptor: { ...readDescriptor(), readProfile: 'linked-video-range-v1' } },
		true,
	]);
	await assert.rejects(fixture.bridge.chooseLinkedAudioOriginal(), /WAV|MIME/iu);
	await assert.rejects(fixture.bridge.loadLinkedAudioOriginal({
		locatorId: LOCATOR_ID, expectedRevision: REVISION, range: false,
	}), /materialized|WAV|capability URL/iu);
	assert.throws(() => fixture.bridge.loadLinkedAudioOriginal({
		locatorId: LOCATOR_ID, expectedRevision: REVISION, range: false, playback: true,
	}), /unsupported field|playback/iu);
	assert.deepEqual(fixture.invocations.map(([channel]) => channel), [
		'soundscaper:v1:linked-audio:choose',
		'soundscaper:v1:linked-audio:load',
		'soundscaper:v1:files:release',
	]);
});

test('preload exposes one closed kind-aware reconciliation and release inventory', async () => {
	const fixture = await loadPreload([2, true]);
	const references = [
		{ kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: REVISION },
		{ kind: 'video', locatorId: 'd'.repeat(64), locatorRevision: 'e'.repeat(64) },
	];
	assert.equal(await fixture.bridge.reconcileLinkedOriginals(references), 2);
	assert.equal(await fixture.bridge.releaseLinkedOriginal(references[0]), true);
	assert.deepEqual(fixture.invocations.map(([channel, value]) => [
		channel, Array.isArray(value) ? value.map((item) => ({ ...item })) : { ...value },
	]), [
		['soundscaper:v1:linked-original:reconcile', references],
		['soundscaper:v1:linked-original:release', references[0]],
	]);
	for (const reference of [
		{ ...references[0], kind: 'image' },
		{ locatorId: LOCATOR_ID, locatorRevision: REVISION },
		{ ...references[0], path: '/private/selected.wav' },
	]) assert.throws(
		() => fixture.bridge.releaseLinkedOriginal(reference),
		/kind|field|media/iu,
	);
	assert.equal(fixture.invocations.length, 2);
});

function locator({ name = 'selected.wav', mimeType = 'audio/wav' } = {}) {
	return {
		locatorId: LOCATOR_ID, locatorRevision: REVISION, name,
		size: 42, mimeType, lastModified: 123,
	};
}

function readDescriptor(readProfile = 'materialized-v1', { name = 'selected.wav', mimeType = 'audio/wav' } = {}) {
	return {
		id: READ_ID,
		url: `soundscaper-app://bundle/_desktop/read/${readProfile}/${READ_ID}/${name}`,
		name, size: 42, mimeType,
		readProfile, lastModified: 123,
	};
}

async function loadPreload(invocationResults) {
	let bridge;
	const invocations = [];
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		AggregateError, ArrayBuffer, Object, Promise, RangeError, String, TypeError, Uint8Array, URL,
		require: () => ({
			contextBridge: { exposeInMainWorld(name, value) { if (name === 'scapeDesktop') bridge = value.v1; } },
			ipcRenderer: {
				invoke(channel, value) {
					invocations.push([channel, value]);
					const result = invocationResults.shift();
					return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
				},
				send: () => {}, on: () => {}, removeListener: () => {},
			},
		}),
	});
	return { bridge, invocations };
}
