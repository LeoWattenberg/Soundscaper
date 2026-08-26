/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveAnchoredTimelineScrollX } from '../src/common/editor/ui/timeline/timeline-render-window.ts';

test('timeline render window keeps its anchor within half a viewport', () => {
	assert.equal(resolveAnchoredTimelineScrollX({
		scrollX: 399,
		renderScrollX: 0,
		viewportWidth: 800,
	}), 0);
	assert.equal(resolveAnchoredTimelineScrollX({
		scrollX: 400,
		renderScrollX: 0,
		viewportWidth: 800,
	}), 400);
	assert.equal(resolveAnchoredTimelineScrollX({
		scrollX: 1_001,
		renderScrollX: 1_400,
		viewportWidth: 800,
	}), 1_400, 'reverse scrolling shares the same bounded anchor');
	assert.equal(resolveAnchoredTimelineScrollX({
		scrollX: 1_000,
		renderScrollX: 1_400,
		viewportWidth: 800,
	}), 1_000);
});

test('timeline render window rejects invalid geometry', () => {
	assert.throws(() => resolveAnchoredTimelineScrollX({
		scrollX: Number.NaN,
		renderScrollX: 0,
		viewportWidth: 800,
	}), /finite/u);
	assert.throws(() => resolveAnchoredTimelineScrollX({
		scrollX: 0,
		renderScrollX: 0,
		viewportWidth: 0,
	}), /positive/u);
});

test('only expensive clip projections consume the anchored viewport', async () => {
	const [workspace, trackList, audioRow, audioRowViewModel] = await Promise.all([
		readFile(new URL('../src/common/editor/ui/timeline/TimelineWorkspaceView.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/timeline/TrackListView.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/timeline/AudioTrackRow.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/timeline/useAudioTrackRowViewModel.js', import.meta.url), 'utf8'),
	]);

	assert.match(workspace, /renderViewportStartFrame=\{renderViewportStartFrame\}/u);
	assert.match(workspace, /scrollX=\{scrollX\}/u, 'rulers and overlays retain exact scroll');
	assert.match(trackList, /<AudioTrackRow[\s\S]*renderViewportStartFrame=\{renderViewportStartFrame\}/u);
	assert.match(trackList, /<VideoTrackRow[\s\S]*renderViewportStartFrame=\{renderViewportStartFrame\}/u);
	assert.match(audioRow, /useAudioTrackRowViewModel\(\{/u);
	assert.doesNotMatch(audioRow, /projectClipsToViewport|createAudioTrackRowClipViewModels/u);
	assert.match(audioRowViewModel, /useMemo\(\(\) => projectClipsToViewport/u);
	assert.match(audioRowViewModel, /const projectedSelection = useMemo/u);
	assert.match(audioRowViewModel, /viewModelRevision/u, 'document and visual updates still invalidate the stable model');
});
