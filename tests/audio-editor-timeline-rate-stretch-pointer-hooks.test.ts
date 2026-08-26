/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	TimelineRateStretchPreviewGuide,
} from '../src/common/editor/ui/timeline/TimelineOverlayComponents.jsx';

const TIMELINE_ROOT = new URL('../src/common/editor/ui/timeline/', import.meta.url);

test('pointer hooks route existing canonical video stretch handles through fresh absolute plans', async () => {
	const [move, finish] = await Promise.all([
		readFile(new URL('useTimelinePointerMove.js', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('useTimelinePointerFinish.js', TIMELINE_ROOT), 'utf8'),
	]);

	assert.match(move, /resolveTimelineRateStretchPointerPreview/u);
	assert.match(move, /requestedBoundarySample:\s*frameAtClientX\(event\.clientX, session\.lane\)/u);
	assert.match(move, /controller\.actions\.video\.trim\.rateStretch\.preview\(request\)/u);
	assert.match(move, /setDraggingClipIds\(new Set\(preview\.previews\.map/u);
	assert.match(move, /setDraggingClipIds\(new Set\(session\.clipIds\)\)/u);

	assert.match(finish, /usesFrameCanonicalTimelineRateStretch/u);
	assert.match(finish, /commitTimelineRateStretchPointer/u);
	assert.match(finish, /requestedBoundarySample:\s*frameAtClientX\(event\.clientX, session\.lane\)/u);
	assert.match(finish, /controller\.actions\.video\.trim\.rateStretch\.commit\(request\)/u);
	assert.ok(
		finish.indexOf('usesFrameCanonicalTimelineRateStretch({')
			< finish.indexOf('Math.hypot(event.clientX - session.startX'),
		'canonical zero-distance release commits before the legacy seek threshold',
	);
	assert.match(finish, /if \(usesFrameCanonicalTimelineRateStretch\(\{[\s\S]*?\}\)\) \{[\s\S]*?commitTimelineRateStretchPointer/u);
});

test('timeline renders one conformed rate-stretch guide with the shared transient style', async () => {
	const markup = renderGuide(24_000);
	assert.match(markup, /class="audio-editor-trim-preview-guide"/u);
	assert.match(markup, /data-rate-stretch-guide="true"/u);
	assert.match(markup, /data-rate-stretch-edge="right"/u);
	assert.match(markup, /data-rate-stretch-boundary-sample="24000"/u);
	assert.match(markup, /style="left:312px;height:144px"/u);
	assert.equal(renderGuide(1.5), '');
	assert.equal(renderGuide(Number.MAX_SAFE_INTEGER + 1), '');

	const [workspace, css, annotationsCss] = await Promise.all([
		readFile(new URL('TimelineWorkspaceView.jsx', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('../audio-editor-design-system/08-timeline-clips-effects.css', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('../audio-editor-design-system/19-timeline-annotations.css', TIMELINE_ROOT), 'utf8'),
	]);
	assert.match(workspace, /<TimelineRateStretchPreviewGuide[\s\S]*?sample=\{clipDragPreview\?\.rateStretchGuideSample\}/u);
	assert.match(workspace, /edge=\{clipDragPreview\?\.rateStretchGuideEdge\}/u);
	assert.match(css, /audio-editor-trim-preview-guide\s*\{[^}]*position: absolute;[^}]*pointer-events: none;/u);
	assert.match(annotationsCss, /data-show-markers='true'[^}]*audio-editor-trim-preview-guide[^}]*\{\s*top: 67px;/u);
});

test('participant rows expose rate-stretch state and audio renders its changed geometry', async () => {
	const [audioProjection, audioViewModel, filmstrip] = await Promise.all([
		readFile(new URL('useAudioTrackRowViewModel.js', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('audio-track-row-view-model.js', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('VideoFilmstrip.jsx', TIMELINE_ROOT), 'utf8'),
	]);
	assert.match(audioProjection, /filter\(\(clip\) => clip\.rateStretchPreview\)/u);
	assert.match(audioProjection, /data-rate-stretch-preview/u);
	assert.match(audioProjection, /data-rate-stretch-waveform-preview/u);
	assert.match(audioViewModel, /reuseCachedWaveform:\s*Boolean\([\s\S]*?clip\.waveformPreviewKind !== 'trim'[\s\S]*?clip\.waveformPreviewKind !== 'rate-stretch'/u);
	assert.match(filmstrip, /data-rate-stretch-preview/u);
	assert.match(filmstrip, /createVideoRateBadgeModel\(\{[\s\S]*?clip,[\s\S]*?source,[\s\S]*?projectSampleRate:\s*sampleRate/u);
	assert.match(filmstrip, /data-video-rate-badge="true"/u);
	assert.match(filmstrip, /data-video-playback-rate=\{rateBadge\.playbackRate\}/u);
	assert.doesNotMatch(filmstrip, /Number\(clip\.speedRatio\)/u);
});

function renderGuide(sample: number): string {
	const runtime = globalThis as typeof globalThis & { React?: typeof React };
	const previous = runtime.React;
	runtime.React = React;
	try {
		return renderToStaticMarkup(React.createElement(TimelineRateStretchPreviewGuide, {
			sample,
			edge: 'right',
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
