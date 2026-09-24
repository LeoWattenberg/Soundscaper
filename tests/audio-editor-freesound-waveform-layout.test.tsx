/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
	durationSeconds: 18,
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

test('Freesound license marks use one standalone Zero, BY, or NC icon', () => {
	const source = readFileSync(new URL(
		'../src/common/editor/ui/workspace/FreesoundPanel.tsx', import.meta.url,
	), 'utf8');
	for (const [code, binding, asset] of [
		['cc0', 'ccZeroIcon', 'cc-zero-icon.svg'],
		["'cc-by'", 'ccByIcon', 'cc-by-icon.svg'],
		["'cc-by-nc'", 'ccNcIcon', 'cc-nc-icon.svg'],
	]) {
		assert.match(source, new RegExp(`import ${binding} from './assets/${asset}'`, 'u'));
		assert.match(source, new RegExp(`${code}: ${binding}`, 'u'));
		const svg = readFileSync(new URL(`../src/common/editor/ui/workspace/assets/${asset}`, import.meta.url), 'utf8');
		assert.match(svg, /<svg\b/u);
		assert.match(svg, /width="64px" height="64px"/u);
	}
});

test('Freesound results place play beside a waveform, with license and insert actions underneath', () => {
	const markup = renderToStaticMarkup(<FreesoundPanel
		copy={COPY}
		state={STATE}
		disabled={false}
		onSearch={() => undefined}
		onPreview={() => undefined}
		onPausePreview={() => undefined}
		onResumePreview={() => undefined}
		onSeekPreview={() => undefined}
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
		/<button\b[^>]*aria-label="Play preview: Rain in pines\.wav"[^>]*>[\s\S]*?<\/button>\s*<button\b[^>]*class="kw-audio-editor__freesound-waveform"[^>]*aria-label="Seek and play preview: Rain in pines\.wav"[^>]*>\s*<img\b[^>]*src="[^"]*\/api\/freesound\/sounds\/101\/waveform\?asset=789&amp;source=cdn"[^>]*alt=""/u,
	);
	const actions = firstResult.match(
		/<div class="kw-audio-editor__freesound-result-actions">([\s\S]*?)<\/div>/u,
	)?.[1];
	assert.ok(actions, 'license and insert buttons share an action row');
	assert.match(actions,
		/<a\b[^>]*class="kw-audio-editor__freesound-result-license"[\s\S]*?<\/a>[\s\S]*?>Add to project[\s\S]*?>Add to Project Bin/u,
	);
	assert.ok(firstResult.indexOf('kw-audio-editor__freesound-result-preview')
		< firstResult.indexOf('kw-audio-editor__freesound-result-actions'));
	const secondResult = markup.slice(markup.indexOf('data-freesound-sound-id="202"'));
	assert.doesNotMatch(secondResult, /\/api\/freesound\/sounds\/202\/waveform/u);
});

test('Freesound action glyphs and preview position are shown on the waveform', () => {
	const markup = renderToStaticMarkup(<FreesoundPanel
		copy={COPY}
		state={{ ...STATE, previewingSoundId: 101, previewPositionSeconds: 4.5 }}
		disabled={false}
		onSearch={() => undefined}
		onPreview={() => undefined}
		onPausePreview={() => undefined}
		onResumePreview={() => undefined}
		onSeekPreview={() => undefined}
		onInsertAtPlayhead={() => undefined}
		onAddToProjectBin={() => undefined}
	/>);
	const active = markup.slice(markup.indexOf('data-freesound-sound-id="101"'), markup.indexOf('data-freesound-sound-id="202"'));
	const inactive = markup.slice(markup.indexOf('data-freesound-sound-id="202"'));
	assert.match(active, /class="kw-audio-editor__freesound-preview-playhead"[^>]*style="left:25%"/u);
	assert.doesNotMatch(inactive, /kw-audio-editor__freesound-preview-playhead/u);
	assert.match(active, /\uF3B0[\s\S]*?>Add to project/u);
	assert.match(active, /\uF3AF[\s\S]*?>Add to Project Bin/u);
	const withoutWaveform = renderToStaticMarkup(<FreesoundPanel
		copy={COPY}
		state={{ ...STATE, previewingSoundId: 202, previewPositionSeconds: 9 }}
		disabled={false}
		onSearch={() => undefined}
		onPreview={() => undefined}
		onPausePreview={() => undefined}
		onResumePreview={() => undefined}
		onSeekPreview={() => undefined}
		onInsertAtPlayhead={() => undefined}
		onAddToProjectBin={() => undefined}
	/>);
	assert.match(withoutWaveform.slice(withoutWaveform.indexOf('data-freesound-sound-id="202"')),
		/kw-audio-editor__freesound-waveform[^>]*>[\s\S]*?class="kw-audio-editor__freesound-preview-playhead"/u);
});
