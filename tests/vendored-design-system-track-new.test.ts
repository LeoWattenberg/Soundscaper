/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ThemeProvider } from '../vendor/audacity-design-system/components/src/ThemeProvider/ThemeProvider.tsx';
import {
	TrackNew,
	isTrackInTimeSelectionScope,
} from '../vendor/audacity-design-system/components/src/Track/TrackNew.tsx';

const CLIP_CSS_URL = new URL(
	'../vendor/audacity-design-system/components/src/Clip/Clip.css',
	import.meta.url,
);

const IN_SCOPE_OVERLAY = 'rgba(98, 119, 136, 0.55)';
const OUT_OF_SCOPE_OVERLAY = 'rgba(49, 56, 70, 0.55)';

function renderTrack(props: Record<string, unknown>): string {
	return renderToStaticMarkup(
		React.createElement(
			ThemeProvider,
			null,
			React.createElement(TrackNew, {
				clips: [{ id: 1, name: 'One', start: 0, duration: 2 }],
				trackIndex: 0,
				width: 800,
				...props,
			} as never),
		),
	);
}

function clipWrapperStyle(markup: string, clipId: number): string {
	const match = markup.match(new RegExp(`<div data-clip-id="${clipId}"[^>]*?style="([^"]*)"`, 'u'));
	assert.ok(match, `expected a wrapper for clip ${clipId} in the rendered track`);
	return match[1];
}

test('a time selection without its own track list falls back to the broader track selection', () => {
	assert.equal(isTrackInTimeSelectionScope(undefined, 0, true), true);
	assert.equal(isTrackInTimeSelectionScope(undefined, 0, false), false);
	assert.equal(isTrackInTimeSelectionScope({}, 0, true), true);
	assert.equal(isTrackInTimeSelectionScope({ tracks: [] }, 0, true), true);
	assert.equal(isTrackInTimeSelectionScope({ tracks: [] }, 3, false), false);
});

test('a time selection carrying a track list scopes to exactly those rows', () => {
	assert.equal(isTrackInTimeSelectionScope({ tracks: [1, 2] }, 1, false), true);
	assert.equal(isTrackInTimeSelectionScope({ tracks: [1, 2] }, 0, true), false);
	assert.equal(isTrackInTimeSelectionScope({ tracks: [0] }, 0, false), true);
});

test('the time-selection band honours the empty-track-list fallback when rendering', () => {
	const emptyScope = renderTrack({
		isSelected: true,
		timeSelection: { startTime: 0.5, endTime: 1.5, tracks: [] },
	});
	const scopedElsewhere = renderTrack({
		isSelected: true,
		timeSelection: { startTime: 0.5, endTime: 1.5, tracks: [4] },
	});

	assert.ok(emptyScope.includes(IN_SCOPE_OVERLAY), 'an unscoped selection should paint the selected row in scope');
	assert.ok(!emptyScope.includes(OUT_OF_SCOPE_OVERLAY));
	assert.ok(scopedElsewhere.includes(OUT_OF_SCOPE_OVERLAY), 'a selection scoped to other rows should dim this one');
});

test('a resting clip wrapper leaves its stacking level to the stylesheet so focus can lift it', () => {
	const resting = clipWrapperStyle(renderTrack({}), 1);

	assert.doesNotMatch(
		resting,
		/z-index/u,
		'an inline z-index outranks the [data-clip-id]:focus lift, so the focus ring stays under later siblings',
	);
});

test('dragged and raised clips still float above their siblings inline', () => {
	const dragging = clipWrapperStyle(renderTrack({ draggingClipIds: new Set([1]) }), 1);
	const raised = clipWrapperStyle(renderTrack({ raisedClipIds: new Set([1]) }), 1);

	assert.match(dragging, /z-index:10/u);
	assert.match(dragging, /opacity:0\.5/u);
	assert.match(raised, /z-index:10/u);
});

test('Clip.css carries the resting, focused and mouse-focused stacking levels', async () => {
	const css = await readFile(CLIP_CSS_URL, 'utf8');

	assert.match(css, /\[data-clip-id\]\s*\{[^}]*z-index:\s*2;/u);
	assert.match(css, /\[data-clip-id\]:focus\s*\{[^}]*z-index:\s*5;/u);
	assert.match(css, /\[data-clip-id\]\[data-focus-mouse\]:focus\s*\{[^}]*z-index:\s*2;/u);
});
