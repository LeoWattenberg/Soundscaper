/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import FreesoundPanel, {
	type FreesoundPanelState,
} from '../src/common/editor/ui/workspace/FreesoundPanel.tsx';
import { ENGLISH_COPY as BASE_ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { FREESOUND_ATTRIBUTION_COPY_BY_LOCALE } from '../src/common/i18n/freesound-attribution-copy.js';

const COPY = { ...BASE_ENGLISH_COPY, ...FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.en };
const SOUND = {
	soundId: 101,
	name: 'Rain in pines.wav',
	username: 'field-recorder',
	soundUrl: 'https://freesound.org/s/101/',
	licenseName: 'Creative Commons 0',
	licenseCode: 'cc0' as const,
	licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
	durationLabel: '0:18',
};
const STATE: FreesoundPanelState = {
	query: 'rain', license: 'all', sort: 'relevance', page: 1, pageCount: 1,
	totalResults: 2, status: 'ready', previewingSoundId: null, previewPaused: false,
	results: [
		{ ...SOUND, waveformUrl: 'https://soundscaper.org/api/freesound/sounds/101/waveform?asset=789&source=cdn' },
		{ ...SOUND, soundId: 202, name: 'Dry leaves.wav', waveformUrl: null },
	],
};

test('Freesound results place play beside a waveform, with license and insert actions underneath', () => {
	const markup = renderToStaticMarkup(<FreesoundPanel
		copy={COPY}
		state={STATE}
		disabled={false}
		onSearch={() => undefined}
		onPreview={() => undefined}
		onPausePreview={() => undefined}
		onResumePreview={() => undefined}
		onInsertAtPlayhead={() => undefined}
		onAddToProjectBin={() => undefined}
	/>);
	const firstResult = markup.slice(
		markup.indexOf('data-freesound-sound-id="101"'),
		markup.indexOf('data-freesound-sound-id="202"'),
	);
	const previewRow = firstResult.match(
		/<div class="kw-audio-editor__freesound-result-preview">([\s\S]*?)<\/div>/u,
	)?.[1];
	assert.ok(previewRow, 'waveform and play button share a preview row');
	assert.match(previewRow,
		/<button\b[^>]*aria-label="Play preview: Rain in pines\.wav"[^>]*>[\s\S]*?<\/button>\s*<span class="kw-audio-editor__freesound-waveform">\s*<img\b[^>]*src="[^"]*\/api\/freesound\/sounds\/101\/waveform\?asset=789&amp;source=cdn"[^>]*alt=""/u,
	);
	const actions = firstResult.match(
		/<div class="kw-audio-editor__freesound-result-actions">([\s\S]*?)<\/div>/u,
	)?.[1];
	assert.ok(actions, 'license and insert buttons share an action row');
	assert.match(actions,
		/<a\b[^>]*class="kw-audio-editor__freesound-result-license"[\s\S]*?<\/a>[\s\S]*?>Insert at playhead[\s\S]*?>Add to Project Bin/u,
	);
	assert.ok(firstResult.indexOf('kw-audio-editor__freesound-result-preview')
		< firstResult.indexOf('kw-audio-editor__freesound-result-actions'));
	const secondResult = markup.slice(markup.indexOf('data-freesound-sound-id="202"'));
	assert.doesNotMatch(secondResult, /\/api\/freesound\/sounds\/202\/waveform/u);
});
