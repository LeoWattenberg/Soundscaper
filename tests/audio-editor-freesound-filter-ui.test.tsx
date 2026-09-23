/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import FreesoundPanel, {
	type FreesoundPanelState,
} from '../src/common/editor/ui/workspace/FreesoundPanel.tsx';
import { FREESOUND_ATTRIBUTION_COPY_BY_LOCALE } from '../src/common/i18n/freesound-attribution-copy.js';

const state: FreesoundPanelState = {
	query: 'rain', license: 'all', sort: 'relevance', page: 1, pageCount: 1,
	totalResults: 1, status: 'ready', previewingSoundId: null, previewPaused: false,
	results: [{
		soundId: 42, name: 'Rain.wav', username: 'recordist', soundUrl: 'https://freesound.org/s/42/',
		licenseName: 'Creative Commons 0', licenseCode: 'cc0',
		licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
		durationSeconds: 1, durationLabel: '0:01',
	}],
};

function panel(projectBinVisible: boolean): string {
	return renderToStaticMarkup(<FreesoundPanel
		copy={FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.en}
		state={state} disabled={false} projectBinVisible={projectBinVisible}
		onSearch={() => undefined} onPreview={() => undefined}
		onPausePreview={() => undefined} onResumePreview={() => undefined}
		onSeekPreview={() => undefined} onInsertAtPlayhead={() => undefined}
		onAddToProjectBin={() => undefined}
	/>);
}

test('Freesound offers all, commercial, and CC0 only as license filters', () => {
	const markup = panel(true);
	assert.match(markup, /value="all"[^>]*>All licenses<\/option>/u);
	assert.match(markup, /value="commercial"[^>]*>Commercial use<\/option>/u);
	assert.match(markup, /value="cc0"[^>]*>No attribution<\/option>/u);
	assert.doesNotMatch(markup, /<option[^>]*value="cc-by(?:-nc)?"/u);
});

test('Freesound only offers the Project Bin action while that panel is shown', () => {
	assert.match(panel(true), /Add to Project Bin/u);
	const markup = panel(false);
	assert.match(markup, />Add to project</u);
	assert.doesNotMatch(markup, /Add to Project Bin/u);
});
