/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorPreferencesV1, updateAudioEditorPreferencesV1, applyAudioEditorWorkspace } from '../src/common/editor/preferences.js';
import { SKIN_IDS } from '../src/common/editor/skin-preferences.ts';
import { createSkinPreview } from '../src/common/editor/controller/skin-preview.ts';

function browser(search = '?useskin=sakura&project=demo#track') {
	let url = new URL(`https://soundscaper.org/editor${search}`);
	const listeners = new Set<() => void>();
	const state = { navigation: 7 };
	const scope = {
		location: { get href() { return url.href; } },
		history: { state, replaceState: (value: unknown, _title: string, href: string) => {
			assert.equal(value, state); url = new URL(href);
		} },
		addEventListener: (_type: 'popstate', listener: () => void) => { listeners.add(listener); },
		removeEventListener: (_type: 'popstate', listener: () => void) => { listeners.delete(listener); },
	};
	return { scope, listeners, navigate: (search: string) => {
		url = new URL(`https://soundscaper.org/editor${search}`);
		for (const listener of listeners) listener();
	} };
}

test('old and unknown skin preferences normalize without discarding other settings', () => {
	for (const skin of [undefined, 'future-skin', null]) {
		const preferences = createAudioEditorPreferencesV1({ appearance: { skin, theme: 'dark', clipStyle: 'classic' } });
		assert.equal(preferences.appearance.skin, 'default');
		assert.equal(preferences.appearance.theme, 'dark');
		assert.equal(preferences.appearance.clipStyle, 'classic');
	}
});

test('skin choices and workspace layouts are independent', () => {
	const original = createAudioEditorPreferencesV1();
	for (const skin of SKIN_IDS) {
		const next = updateAudioEditorPreferencesV1(original, { appearance: { skin } });
		assert.equal(next.appearance.skin, skin);
		assert.deepEqual(next.workspace, original.workspace);
		assert.equal(applyAudioEditorWorkspace(next, 'classic').appearance.skin, skin);
	}
});

test('preview reads only recognized IDs, observes history, and cleans up idempotently', () => {
	const env = browser();
	const preview = createSkinPreview(env.scope);
	let changes = 0;
	const unsubscribe = preview.subscribe(() => { changes += 1; });
	assert.equal(preview.getSnapshot(), 'sakura');
	env.navigate('?useskin=techno');
	assert.equal(preview.getSnapshot(), 'techno');
	env.navigate('?useskin=https://example.com/evil.css');
	assert.equal(preview.getSnapshot(), null);
	assert.equal(changes, 2);
	unsubscribe(); unsubscribe();
	assert.equal(env.listeners.size, 0);
});

test('ending a preview preserves unrelated URL state and never writes preferences', () => {
	const env = browser();
	const preview = createSkinPreview(env.scope);
	preview.end();
	assert.equal(preview.getSnapshot(), null);
	assert.equal(env.scope.location.href, 'https://soundscaper.org/editor?project=demo#track');
});

test('adoption waits for persistence, even when choosing the saved skin', async () => {
	const env = browser('?useskin=default');
	const preview = createSkinPreview(env.scope);
	let finish!: () => void;
	const saved: string[] = [];
	const adopting = preview.adopt('default', async (skin) => {
		saved.push(skin);
		await new Promise<void>((resolve) => { finish = resolve; });
	});
	assert.equal(preview.getSnapshot(), 'default');
	finish(); await adopting;
	assert.deepEqual(saved, ['default']);
	assert.equal(preview.getSnapshot(), null);
});

test('a failed save retains the preview and its URL', async () => {
	const env = browser();
	const preview = createSkinPreview(env.scope);
	await assert.rejects(preview.adopt('lilac', () => Promise.reject(new Error('disk full'))), /disk full/u);
	assert.equal(preview.getSnapshot(), 'sakura');
	assert.match(env.scope.location.href, /useskin=sakura/u);
});

test('a pending adoption does not end a different preview reached through history', async () => {
	const env = browser();
	const preview = createSkinPreview(env.scope);
	let finish!: () => void;
	const adopting = preview.adopt('sakura', () => new Promise<void>((resolve) => { finish = resolve; }));
	env.navigate('?useskin=lilac');
	finish(); await adopting;
	assert.equal(preview.getSnapshot(), 'lilac');
});
