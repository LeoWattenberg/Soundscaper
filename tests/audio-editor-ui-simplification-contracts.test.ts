/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { FocusEvent } from 'react';

import { trackSources } from '../src/common/editor/ui/application-menu-model.js';
import { mediaTrackBlockBounds } from '../src/common/editor/ui/timeline-track-block-geometry.ts';
import { constrainDialogDragOffset } from '../src/common/editor/ui/dialog-drag-bounds.ts';
import { formatDbtp, formatEbuLoudness, formatLra, normalizeMeterSettings, DEFAULT_PLAYBACK_METER_SETTINGS } from '../src/common/editor/ui/meter-settings.ts';
import { handleEditorToolbarBlur, handleEditorToolbarFocus } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { videoPreviewBlendPixel } from '../src/common/editor/ui/video-preview-composition-blend.ts';

test('track block bounds include nonadjacent siblings on either side of the selected lane', () => {
	assert.deepEqual(mediaTrackBlockBounds([
		{ id: 'first', laneGroupId: 'linked' },
		{ id: 'other' },
		{ id: 'selected', laneGroupId: 'linked' },
		{ id: 'last', laneGroupId: 'linked' },
	], 'selected'), { start: 0, end: 3 });
});

test('track block scans retain array traversal semantics for sparse sibling lists', () => {
	const tracks = [{ id: 'first', laneGroupId: 'linked' }];
	tracks.length = 3;
	tracks[2] = { id: 'last', laneGroupId: 'linked' };
	assert.deepEqual(mediaTrackBlockBounds(tracks, 'first'), { start: 0, end: 2 });
});

test('track sources retain first-use order, the last source record and unique identities', () => {
	const first = { id: 'first', name: 'obsolete' };
	const second = { id: 'second', name: 'second' };
	const replacement = { id: 'first', name: 'replacement' };
	const project = {
		clips: [{ id: 'one', sourceId: 'first' }, { id: 'two', sourceId: 'second' }, { id: 'three', sourceId: 'first' }],
		sources: [first, second, replacement],
	};
	assert.deepEqual(trackSources(project, { type: 'audio', clipIds: ['missing', 'one', 'two', 'three'] }), [replacement, second]);
	assert.deepEqual(trackSources(project, { type: 'label', clipIds: ['one'] }), []);
});

test('a title wider than the viewport stays anchored at the minimum inset', () => {
	assert.deepEqual(constrainDialogDragOffset({ x: 500, y: 500 }, { x: 0, y: 0 },
		{ left: 100, right: 900, top: 100, bottom: 130 }, { width: 640, height: 480 }),
	{ x: -92, y: 342 });
});

test('meter normalization and numeric labels preserve invalid values and enum fallback', () => {
	assert.deepEqual(normalizeMeterSettings({
		position: 'side', style: null, type: 'missing', dbRange: '96',
		ebuScale: 'plus18', ebuUnit: 'missing', ebuLiveValue: 'short-term',
	}, DEFAULT_PLAYBACK_METER_SETTINGS), {
		...DEFAULT_PLAYBACK_METER_SETTINGS, dbRange: 96, ebuScale: 'plus18', ebuLiveValue: 'short-term',
	});
	for (const value of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.equal(formatLra(value), '— LU');
		assert.equal(formatDbtp(value), '— dBTP');
		assert.equal(formatEbuLoudness(value), '— LUFS');
	}
	assert.equal(formatLra(-1.25), '−1.3 LU');
	assert.equal(formatDbtp(-0.04), '−0.0 dBTP');
	assert.equal(formatEbuLoudness(-24, 'relative'), '−1.0 LU');
});

test('toolbar focus and external blur retain the greatest active tab index', () => {
	const elements = [4, -1, -1].map((tabIndex) => ({
		tabIndex,
		getAttribute() { return String(this.tabIndex); },
		matches: () => false,
		closest: () => null,
		contains: () => false,
		getClientRects: () => [{}],
	}));
	const currentTarget = {
		querySelector: () => ({ querySelectorAll: () => elements }),
		contains: () => false,
	};
	handleEditorToolbarFocus({ currentTarget, target: elements[2] } as unknown as FocusEvent<HTMLElement>);
	assert.deepEqual(elements.map(({ tabIndex }) => tabIndex), [-1, -1, 4]);
	handleEditorToolbarBlur({ currentTarget, relatedTarget: null } as unknown as FocusEvent<HTMLElement>);
	assert.deepEqual(elements.map(({ tabIndex }) => tabIndex), [4, -1, -1]);
});

test('transparent blend sources and backdrops preserve premultiplied alpha for every mode', () => {
	for (const mode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'exclusion'] as const) {
		assert.deepEqual(videoPreviewBlendPixel(mode, [0.2, 0.3, 0.4, 0.5], [0, 0, 0, 0]), [0.2, 0.3, 0.4, 0.5]);
		assert.deepEqual(videoPreviewBlendPixel(mode, [0, 0, 0, 0], [0.1, 0.2, 0.3, 0.5]), [0.1, 0.2, 0.3, 0.5]);
	}
});
