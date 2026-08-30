/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	TimelineSlipSlidePreviewGuides,
} from '../src/common/editor/ui/timeline/TimelineOverlayComponents.jsx';

const TIMELINE_ROOT = new URL('../src/common/editor/ui/timeline/', import.meta.url);

test('timeline pointer hooks capture immutable slip/slide authority and preserve the route', async () => {
	const [start, move, finish] = await Promise.all([
		readFile(new URL('useTimelinePointerStart.js', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('useTimelinePointerMove.js', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('useTimelinePointerFinish.js', TIMELINE_ROOT), 'utf8'),
	]);

	assert.match(start, /captureTimelineSlipSlidePointerGesture/u);
	assert.match(start, /canonicalVideoTrim:\s*snapshot\.capabilities\?\.videoCompositing === true/u);
	assert.match(start, /pointerType:\s*event\.pointerType/u);
	assert.match(start, /isPrimary:\s*event\.isPrimary/u);
	assert.match(start, /altKey:\s*event\.altKey/u);
	assert.match(start, /shiftKey:\s*event\.shiftKey/u);
	assert.match(start, /ctrlKey:\s*event\.ctrlKey/u);
	assert.match(start, /metaKey:\s*event\.metaKey/u);
	assert.match(start, /pointerDownSample:\s*frameAtClientX\(event\.clientX, lane\)/u);
	assert.match(start, /controller\.actions\.video\.trim\.slipSlide\.capturePointerAuthority\(capture\)/u);
	assert.match(start, /slipSlideMode/u);
	assert.match(start, /slipSlidePointerAuthority/u);
	assert.match(start, /touchPointers\.current\.size === 2[\s\S]*?setSelectionPreview\(null\)[\s\S]*?pointerSession\.current = null/u);
	assert.match(start, /slipSlideMode !== null[\s\S]*?rollRippleMode === null && event\.shiftKey/u);
	assert.match(start, /rollRippleMode === null && \(event\.metaKey \|\| event\.ctrlKey\)/u);
	assert.ok(
		start.indexOf('const slipSlideGesture = captureTimelineSlipSlidePointerGesture')
			< start.indexOf('&& slipSlideGesture === null'),
		'eligible Alt body gestures are considered before the legacy body-selection return',
	);

	assert.match(move, /resolveTimelineSlipSlidePointerPreview/u);
	assert.match(move, /const currentPointerSample = frameAtClientX\(event\.clientX, session\.lane\)/u);
	assert.match(move, /controller\.actions\.video\.trim\.slipSlide\.preview\(request\)/u);
	assert.match(move, /setDraggingClipIds\(new Set\(preview\.previews\.map/u);
	assert.match(move, /setDraggingClipIds\(new Set\(session\.clipIds\)\)/u);
	assert.ok(
		move.indexOf('const preview = resolveTimelineSlipSlidePointerPreview')
			< move.indexOf('isOverOutputDock(event.clientX'),
		'captured body gestures cannot change into ordinary project-bin or lane moves',
	);

	assert.match(finish, /commitTimelineSlipSlidePointer/u);
	assert.match(finish, /const currentPointerSample = frameAtClientX\(event\.clientX, session\.lane\)/u);
	assert.match(finish, /controller\.actions\.video\.trim\.slipSlide\.commit\(request\)/u);
	assert.ok(
		finish.indexOf('commitTimelineSlipSlidePointer({') < finish.indexOf('isOverOutputDock(event.clientX'),
		'captured release commits before ordinary move destinations are examined',
	);
	assert.ok(
		finish.indexOf('commitTimelineSlipSlidePointer({')
			< finish.indexOf('Math.hypot(event.clientX - session.startX'),
		'captured zero-delta release commits instead of seeking',
	);
	assert.ok(
		finish.indexOf('setSelectionPreview(null)')
			< finish.indexOf('if (!session || cancelled || pinchSession.current || !project) return'),
		'abnormal pointer completion clears the rubber-band preview before returning',
	);
});

test('slide renders two transient conformed guides without changing the roll/ripple guide', () => {
	const markup = renderGuides({ start: 24_000, end: 72_000 });
	assert.equal((markup.match(/data-slip-slide-trim-guide="true"/gu) ?? []).length, 2);
	assert.match(markup, /data-slip-slide-guide-role="start"/u);
	assert.match(markup, /data-slip-slide-guide-role="end"/u);
	assert.match(markup, /style="left:312px;height:144px"/u);
	assert.match(markup, /style="left:432px;height:144px"/u);
	assert.doesNotMatch(markup, /data-roll-ripple-trim-guide/u);
	for (const samples of [
		null,
		{ start: 1.5, end: 72_000 },
		{ start: 24_000, end: Number.MAX_SAFE_INTEGER + 1 },
	]) {
		assert.equal(renderGuides(samples), '');
	}
});

test('workspace and clip rows expose stable transient slip source evidence', async () => {
	const [workspace, overlays, audioProjection, videoFilmstrip] = await Promise.all([
		readFile(new URL('TimelineWorkspaceView.jsx', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('TimelineOverlayComponents.jsx', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('useAudioTrackRowViewModel.js', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('VideoFilmstrip.jsx', TIMELINE_ROOT), 'utf8'),
	]);

	assert.match(workspace, /<TimelineSlipSlidePreviewGuides[\s\S]*?samples=\{clipDragPreview\?\.guideSamples\}/u);
	assert.match(overlays, /data-slip-slide-trim-guide="true"[\s\S]*?data-slip-slide-guide-role=\{role\}/u);
	for (const source of [audioProjection, videoFilmstrip]) {
		assert.match(source, /data-slip-slide-source-preview/u);
		assert.match(source, /data-slip-slide-preview-source-start/u);
		assert.match(source, /data-slip-slide-preview-source-end/u);
	}
	assert.match(audioProjection, /new Map\(projection\.clips[\s\S]*?filter\(\(clip\) => clip\.sourceSlipPreview\)/u);
});

function renderGuides(samples: Readonly<{ readonly start: number; readonly end: number }> | null): string {
	const runtime = globalThis as typeof globalThis & { React?: typeof React };
	const previous = runtime.React;
	runtime.React = React;
	try {
		return renderToStaticMarkup(React.createElement(TimelineSlipSlidePreviewGuides, {
			samples,
			panelWidth: 240,
			pixelsPerSecond: 120,
			sampleRate: 48_000,
			height: 144,
		}));
	} finally {
		if (previous === undefined) Reflect.deleteProperty(runtime, 'React');
		else runtime.React = previous;
	}
}
