/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';

test('a refused default-view save restores the last live track view and permits retry', async () => {
	const store = createMemoryStore();
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const saveSetting = store.saveSetting.bind(store);
	let refuseNextPreferenceSave = false;
	store.saveSetting = async (key: string, value: unknown) => {
		if (refuseNextPreferenceSave && key === 'audio-editor-preferences-v1') {
			refuseNextPreferenceSave = false;
			throw new DOMException('The device storage is full.', 'QuotaExceededError');
		}
		await saveSetting(key, value);
	};
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY, locale: 'en', store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: { dispose() {} } as unknown as Options['ffmpeg'],
	});
	try {
		await controller.ready;
		await Promise.resolve(controller.actions.preferences.setDefaultView('waveform-rainbow'));
		assert.equal(controller.getSnapshot().timeline.view, 'waveform-rainbow');
		refuseNextPreferenceSave = true;
		await assert.rejects(Promise.resolve(controller.actions.preferences.setDefaultView('half-wave')),
			{ name: 'QuotaExceededError' });
		assert.equal((controller.getSnapshot().preferences as ReturnType<typeof createAudioEditorPreferencesV1>)
			.appearance.defaultView, 'waveform-rainbow');
		assert.equal(controller.getSnapshot().timeline.view, 'waveform-rainbow');
		await Promise.resolve(controller.actions.preferences.setDefaultView('half-wave'));
		assert.equal((controller.getSnapshot().preferences as ReturnType<typeof createAudioEditorPreferencesV1>)
			.appearance.defaultView, 'half-wave');
		assert.equal(controller.getSnapshot().timeline.view, 'half-wave');
	} finally {
		await controller.dispose();
	}
});

for (const refused of [[1], [2], [1, 2]]) {
	test(`overlapping default-view saves retain only successful choices after refusals ${refused.join(',')}`, async () => {
		const fixture = await defaultViewFixture(refused);
		try {
			const first = Promise.resolve(fixture.controller.actions.preferences.setDefaultView('half-wave'));
			const second = Promise.resolve(fixture.controller.actions.preferences.setDefaultView('multiview'));
			const outcomes = await Promise.allSettled([first, second]);
			assert.deepEqual(outcomes.map(({ status }) => status), [1, 2].map((attempt) => (
				refused.includes(attempt) ? 'rejected' : 'fulfilled'
			)));
			const expected = !refused.includes(2) ? 'multiview'
				: !refused.includes(1) ? 'half-wave' : 'waveform-rainbow';
			const snapshot = fixture.controller.getSnapshot();
			assert.equal((snapshot.preferences as ReturnType<typeof createAudioEditorPreferencesV1>)
				.appearance.defaultView, expected);
			assert.equal(snapshot.timeline.view, expected);
		} finally { await fixture.controller.dispose(); }
	});
}

test('refused preference writes preserve an independent live view and later view choices', async () => {
	const fixture = await defaultViewFixture([1, 2]);
	try {
		fixture.controller.actions.timeline.setView('multiview');
		await assert.rejects(Promise.resolve(fixture.controller.actions.preferences.setDefaultView('half-wave')),
			{ name: 'QuotaExceededError' });
		assert.equal(fixture.controller.getSnapshot().timeline.view, 'multiview');
		const failed = Promise.resolve(fixture.controller.actions.preferences.setDefaultView('half-wave'));
		fixture.controller.actions.timeline.setView('spectrogram');
		await assert.rejects(failed, { name: 'QuotaExceededError' });
		assert.equal(fixture.controller.getSnapshot().timeline.view, 'spectrogram');
	} finally { await fixture.controller.dispose(); }
});

async function defaultViewFixture(refused: readonly number[]) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createMemoryStore();
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY, locale: 'en', store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: { dispose() {} } as unknown as Options['ffmpeg'],
	});
	await controller.ready;
	await Promise.resolve(controller.actions.preferences.setDefaultView('waveform-rainbow'));
	const saveSetting = store.saveSetting.bind(store);
	let attempt = 0;
	store.saveSetting = async (key: string, value: unknown) => {
		if (key === 'audio-editor-preferences-v1' && refused.includes(++attempt)) {
			throw new DOMException('The device storage is full.', 'QuotaExceededError');
		}
		await saveSetting(key, value);
	};
	return { controller };
}
