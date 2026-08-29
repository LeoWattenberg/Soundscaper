/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DELIVERY_PRESETS_SETTING_KEY,
	createDeliveryPresetService,
} from '../src/common/editor/controller/delivery-preset-service.ts';
import { createDeliveryPresetState } from '../src/common/editor/delivery-preset-store.ts';

function harness() {
	const persisted: Array<[string, unknown]> = [];
	let published = 0;
	let ids = 0;
	const state: { deliveryPresets?: unknown } = {};
	const service = createDeliveryPresetService({
		state,
		persistSetting: (key, value) => { persisted.push([key, value]); },
		publishDocumentSnapshot: () => { published += 1; },
		createId: (prefix) => `${prefix}-${++ids}`,
	});
	return { service, state, persisted, published: () => published };
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((complete) => { resolve = complete; });
	return { promise, resolve };
}

test('saving persists under its own key and publishes once', async () => {
	const { service, persisted, published } = harness();
	const preset = await service.save({
		label: 'CD master', kind: 'audio', format: 'wav', settings: { sampleRate: 44_100 },
	});
	assert.equal(preset.label, 'CD master');
	assert.equal(preset.id, 'delivery-preset-1');
	assert.equal(persisted.length, 1);
	assert.equal(persisted[0][0], DELIVERY_PRESETS_SETTING_KEY);
	assert.equal(published(), 1);
	assert.deepEqual(service.list().map(({ label }) => label), ['CD master']);
});

test('presets saved in one session are still there in the next, and survive its first save', async () => {
	// The service persists but the collection has to be read back, or every
	// session starts empty and its first save writes that empty collection with
	// the new preset alone — destroying every preset saved before it.
	const settings = new Map<string, unknown>();
	let ids = 0;
	const session = (stored: unknown) => {
		const state: { deliveryPresets?: unknown } = {
			deliveryPresets: createDeliveryPresetState((stored ?? {}) as Record<string, unknown>),
		};
		return createDeliveryPresetService({
			state,
			persistSetting: (key, value) => { settings.set(key, value); },
			createId: (prefix) => `${prefix}-${++ids}`,
		});
	};

	const first = session(null);
	await first.save({ label: 'CD master', kind: 'audio', format: 'wav', settings: { sampleRate: 44_100 } });
	await first.save({ label: 'Podcast', kind: 'audio', format: 'mp3', settings: { bitRate: 128 } });

	const second = session(settings.get(DELIVERY_PRESETS_SETTING_KEY));
	assert.deepEqual(second.list().map(({ label }) => label), ['CD master', 'Podcast'],
		'a new session opens with the presets the last one saved');

	await second.save({ label: 'Radio edit', kind: 'audio', format: 'flac', settings: {} });
	const third = session(settings.get(DELIVERY_PRESETS_SETTING_KEY));
	assert.deepEqual(third.list().map(({ label }) => label), ['CD master', 'Podcast', 'Radio edit'],
		'and saving in it adds to them rather than replacing them');
});

test('the service reads an empty state without being seeded first', () => {
	const { service } = harness();
	assert.deepEqual(service.list(), [], 'a fresh session has no presets, not an error');
	assert.throws(() => service.apply('missing'), /does not exist/u);
});

test('delete and import both persist and publish', async () => {
	const { service, persisted, published } = harness();
	const preset = await service.save({ label: 'CD', kind: 'audio', format: 'wav' });
	const encoded = service.export(preset.id);

	await service.delete(preset.id);
	assert.deepEqual(service.list(), []);

	await service.import(encoded);
	assert.deepEqual(service.list().map(({ label }) => label), ['CD']);
	assert.equal(persisted.length, 3, 'save, delete, and import each persist');
	assert.equal(published(), 3);
});

test('list filters by kind so the dialog only offers presets it can use', async () => {
	const { service } = harness();
	await service.save({ label: 'CD', kind: 'audio', format: 'wav' });
	await service.save({ label: 'Web', kind: 'video', format: 'mp4' });
	assert.deepEqual(service.list('audio').map(({ label }) => label), ['CD']);
	assert.deepEqual(service.list('video').map(({ label }) => label), ['Web']);
});

test('a rejected preset never reaches the persisted state', async () => {
	const { service, persisted } = harness();
	await assert.rejects(
		() => service.import('{"schemaVersion":1,"presets":[{"schemaVersion":1,"id":"x","label":"X","kind":"audio","format":"wav","settings":{"nope":1}}]}'),
		/Unknown audio delivery setting/u,
	);
	assert.equal(persisted.length, 0, 'a refused import must not write anything');
	assert.deepEqual(service.list(), []);
});

test('a failed required write stays invisible and does not poison the mutation queue', async () => {
	const failure = new Error('settings unavailable');
	let published = 0;
	let shouldFail = true;
	const state: { deliveryPresets?: unknown } = {};
	const service = createDeliveryPresetService({
		state,
		persistSetting: async () => {
			if (shouldFail) {
				shouldFail = false;
				throw failure;
			}
		},
		publishDocumentSnapshot: () => { published += 1; },
		createId: () => 'delivery-preset-1',
	});

	await assert.rejects(
		() => service.save({ label: 'Must persist', kind: 'audio', format: 'wav' }),
		(error: unknown) => error === failure,
	);

	assert.deepEqual(service.list(), []);
	assert.equal(state.deliveryPresets, undefined);
	assert.equal(published, 0);

	await service.save({ label: 'Retry', kind: 'audio', format: 'wav' });
	assert.deepEqual(service.list().map(({ label }) => label), ['Retry']);
	assert.equal(published, 1);
});

test('overlapping delivery preset saves retain both changes in required storage', async () => {
	const firstWrite = deferred();
	let writeCount = 0;
	let durable: unknown = null;
	let nextId = 0;
	const state: { deliveryPresets?: unknown } = {};
	const service = createDeliveryPresetService({
		state,
		persistSetting: async (_key, value) => {
			writeCount += 1;
			if (writeCount === 1) await firstWrite.promise;
			durable = value;
		},
		createId: () => `delivery-preset-${++nextId}`,
	});

	const first = service.save({ label: 'First', kind: 'audio', format: 'wav' });
	await Promise.resolve();
	const secondOptions = {
		label: 'Second', kind: 'audio' as const, format: 'flac', settings: { quality: 5 },
	};
	const second = service.save(secondOptions);
	secondOptions.label = 'Changed after invocation';
	secondOptions.settings.quality = 9;
	const importedSize = { width: 1_080, height: 1_920 };
	const imported = service.import({
		schemaVersion: 1,
		presets: [{
			schemaVersion: 1, id: 'imported', label: 'Imported', kind: 'video', format: 'mp4',
			settings: { size: importedSize },
		}],
	});
	importedSize.width = 320;
	await Promise.resolve();
	const writesBeforeRelease = writeCount;
	firstWrite.resolve();
	await Promise.all([first, second, imported]);

	assert.equal(writesBeforeRelease, 1, 'the second mutation waits for the first required write');
	assert.deepEqual(service.list().map(({ label }) => label), ['First', 'Second', 'Imported']);
	const persisted = createDeliveryPresetState(durable as never);
	assert.deepEqual(persisted.presets.map(({ label }) => label), ['First', 'Second', 'Imported']);
	assert.equal(persisted.presets[1]?.settings.quality, 5);
	assert.deepEqual(persisted.presets[2]?.settings.size, { width: 1_080, height: 1_920 });
});

test('the service requires controller state rather than inventing its own', () => {
	assert.throws(() => createDeliveryPresetService({} as never), /requires controller state/u);
});

test('delete preserves the preset-id validator for invalid runtime callers', async () => {
	const { service } = harness();
	await assert.rejects(() => service.delete(null as never), /presetId must be a non-empty string/u);
});
