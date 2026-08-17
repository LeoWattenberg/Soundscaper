/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DELIVERY_PRESETS_SETTING_KEY,
	createDeliveryPresetService,
} from '../src/common/editor/controller/delivery-preset-service.ts';

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

test('the service requires controller state rather than inventing its own', () => {
	assert.throws(() => createDeliveryPresetService({} as never), /requires controller state/u);
});
