/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const TIMELINE_ROOT = new URL('../src/common/editor/ui/timeline/', import.meta.url);

test('TrackNew keeps the eight local callback edge and sign rows', async () => {
	const vendor = await readFile(new URL(
		'../vendor/audacity-design-system/components/src/Track/TrackNew.tsx',
		import.meta.url,
	), 'utf8');

	assert.match(vendor, /if \(e\.altKey && e\.shiftKey[\s\S]*?const stretchAmount = 0\.1;[\s\S]*?const isCompressing = e\.metaKey \|\| e\.ctrlKey;[\s\S]*?const edge = isCompressing[\s\S]*?e\.key === 'ArrowLeft' \? 'right' : 'left'[\s\S]*?e\.key === 'ArrowLeft' \? 'left' : 'right'[\s\S]*?const delta = isCompressing \? stretchAmount : -stretchAmount;[\s\S]*?onClipStretch\?\.\(clip\.id, edge, delta\);/u);
	assert.match(vendor, /if \(e\.shiftKey && !e\.altKey[\s\S]*?const trimAmount = 0\.1;[\s\S]*?const isTrimming = e\.metaKey \|\| e\.ctrlKey;[\s\S]*?const edge = isTrimming[\s\S]*?e\.key === 'ArrowLeft' \? 'right' : 'left'[\s\S]*?e\.key === 'ArrowLeft' \? 'left' : 'right'[\s\S]*?const delta = isTrimming \? trimAmount : -trimAmount;[\s\S]*?onClipTrim\?\.\(clip\.id, edge, delta\);/u);
});

test('TrackNew leaves Audacity selection and project-boundary chords to the host', async () => {
	const vendor = await readFile(new URL(
		'../vendor/audacity-design-system/components/src/Track/TrackNew.tsx',
		import.meta.url,
	), 'utf8');

	assert.doesNotMatch(
		vendor,
		/\(e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'\) && e\.shiftKey[\s\S]{0,200}?e\.preventDefault\(\)/u,
		'focused clips must not consume Shift+Up/Down before the host extends track selection',
	);
	assert.match(
		vendor,
		/if \(\(e\.key === 'Home' \|\| e\.key === 'End'\) && \(e\.altKey \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey\)\) return;\s*\/\/ Plain Home \/ End still delegate/u,
		'modified Home/End must bypass the vendored roving-focus handler',
	);
});

test('the audio row routes only its focused TrackNew callbacks through canonical step ports', async () => {
	const [navigation, row, list, adapter] = await Promise.all([
		readFile(new URL('useAudioTrackRowNavigation.js', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('AudioTrackRow.jsx', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('TrackListView.jsx', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('clip-focus-trim-keyboard-routing.ts', TIMELINE_ROOT), 'utf8'),
	]);

	assert.match(list, /canonicalVideoTrim=\{snapshot\.capabilities\?\.videoCompositing === true\}/u);
	assert.match(row, /canonicalVideoTrim,/u);
	assert.match(row, /useAudioTrackRowNavigation\(\{[\s\S]*?canonicalVideoTrim,/u);
	assert.match(row, /onClipTrim=\{trimClipBySeconds\}/u);
	assert.match(row, /onClipStretch=\{stretchClipBySeconds\}/u);

	assert.match(navigation, /routeClipFocusTrimKeyboard/u);
	assert.match(navigation, /operation:\s*'trim'/u);
	assert.match(navigation, /controller\.actions\.video\.trim\.commitStep\(step\)/u);
	assert.match(navigation, /operation:\s*'rate-stretch'/u);
	assert.match(navigation, /controller\.actions\.video\.trim\.rateStretch\.commitStep\(step\)/u);
	assert.match(navigation, /commitLegacy:\s*\(\) => trimClipBySecondsLegacy\(clipId, edge, deltaSeconds\)/u);
	assert.match(navigation, /commitLegacy:\s*\(\) => stretchClipBySecondsLegacy\(clipId, edge, deltaSeconds\)/u);
	assert.match(navigation, /secondsDeltaToFrames\(deltaSeconds, sampleRate\)/u);
	assert.doesNotMatch(navigation, /catch\s*\(/u);
	assert.doesNotMatch(adapter, /addEventListener|removeEventListener|document\.|window\./u);
});
