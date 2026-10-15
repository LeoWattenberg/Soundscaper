/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_COM_DEFAULT_SERVER_URL,
	normalizeAudioEditorAdvancedPreferences,
	normalizeAudioComServerUrl,
} from '../src/common/editor/advanced-preferences.ts';
import {
	applyAudioEditorWorkspace, createAudioEditorPreferencesV1,
	loadAudioEditorPreferencesV1, updateAudioEditorPreferencesV1,
} from '../src/common/editor/preferences.js';

test('audio.com is the default server for new and older editor preferences', () => {
	assert.equal(AUDIO_COM_DEFAULT_SERVER_URL, 'https://api.audio.com');
	assert.deepEqual(normalizeAudioEditorAdvancedPreferences(undefined), { audioComServerUrl: AUDIO_COM_DEFAULT_SERVER_URL });
	const preferences = createAudioEditorPreferencesV1();
	assert.equal(preferences.advanced.audioComServerUrl, AUDIO_COM_DEFAULT_SERVER_URL);
	const { advanced: _advanced, ...older } = preferences;
	assert.equal(loadAudioEditorPreferencesV1(older).preferences.advanced.audioComServerUrl, AUDIO_COM_DEFAULT_SERVER_URL);
});

test('server preferences normalize API origins and support loopback development', () => {
	for (const [input, expected] of [
		[' https://API.AUDIO.COM/ ', 'https://api.audio.com'],
		['https://audiocity.example:8443/', 'https://audiocity.example:8443'],
		['http://localhost:8787/', 'http://localhost:8787'],
		['http://127.0.0.1:8787', 'http://127.0.0.1:8787'],
		['http://[::1]:8787', 'http://[::1]:8787'],
	]) assert.equal(normalizeAudioComServerUrl(input), expected);
});

test('server preferences reject credentials, API paths, and insecure remote origins', () => {
	for (const value of [
		'', null, 4, 'not a URL', 'https://user:password@example.org',
		'https://example.org/v1', 'https://example.org/?token=secret',
		'https://example.org/#fragment', 'http://audiocity.example', 'https://audiocity.example.',
		'http://localhost.example:8787', 'file:///tmp/server', 'javascript:alert(1)',
	]) assert.throws(() => normalizeAudioComServerUrl(value), /server URL/u);
});

test('advanced preferences accept only a plain data server setting', () => {
	for (const value of [null, [], new Date(), { unknown: true }]) {
		assert.throws(() => normalizeAudioEditorAdvancedPreferences(value), /advanced preferences/u);
	}
	assert.throws(() => normalizeAudioEditorAdvancedPreferences({ get audioComServerUrl() { throw new Error('untrusted getter'); } }), /data property/u);
	assert.throws(() => normalizeAudioEditorAdvancedPreferences(Object.defineProperty({}, 'audioComServerUrl', { value: 'https://example.org' })), /data property/u);
	assert.equal(Object.isFrozen(normalizeAudioEditorAdvancedPreferences({})), true);
});

test('server choice persists through partial updates, reloads, and workspace changes', () => {
	const changed = updateAudioEditorPreferencesV1(createAudioEditorPreferencesV1(), {
		advanced: { audioComServerUrl: 'https://audiocity.example/' },
	});
	const updated = updateAudioEditorPreferencesV1(changed, { advanced: {}, performance: { optimizeFor: 'speed' } });
	const restored = loadAudioEditorPreferencesV1(JSON.parse(JSON.stringify(updated))).preferences;
	assert.equal(restored.advanced.audioComServerUrl, 'https://audiocity.example');
	assert.equal(applyAudioEditorWorkspace(restored, 'classic').advanced.audioComServerUrl, 'https://audiocity.example');
	assert.equal(updateAudioEditorPreferencesV1(restored, { advanced: { audioComServerUrl: AUDIO_COM_DEFAULT_SERVER_URL } }).advanced.audioComServerUrl,
		AUDIO_COM_DEFAULT_SERVER_URL);
});
