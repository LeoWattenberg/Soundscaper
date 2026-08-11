/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	timelineTrimPreviewGuideLeft,
	TimelineTrimPreviewGuide,
} from '../src/common/editor/ui/timeline/TimelineOverlayComponents.jsx';

const TIMELINE_ROOT = new URL('../src/common/editor/ui/timeline/', import.meta.url);

test('timeline pointer hooks capture and preserve the roll/ripple trim gesture route', async () => {
	const [start, move, finish] = await Promise.all([
		readFile(new URL('useTimelinePointerStart.js', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('useTimelinePointerMove.js', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('useTimelinePointerFinish.js', TIMELINE_ROOT), 'utf8'),
	]);

	assert.match(start, /captureTimelineRollRippleTrimPointerMode/u);
	assert.match(start, /canonicalVideoTrim:\s*snapshot\.capabilities\?\.videoCompositing === true/u);
	assert.match(start, /pointerType:\s*event\.pointerType/u);
	assert.match(start, /altKey:\s*event\.altKey/u);
	assert.match(start, /shiftKey:\s*event\.shiftKey/u);
	assert.match(start, /rollRippleMode/u);
	assert.match(start, /rollRippleMode === null && event\.shiftKey/u);
	assert.match(start, /rollRippleMode === null && \(event\.metaKey \|\| event\.ctrlKey\)/u);

	assert.match(move, /resolveTimelineRollRippleTrimPointerPreview/u);
	assert.match(move, /const requestedBoundarySample = frameAtClientX\(event\.clientX, session\.lane\)/u);
	assert.match(move, /resolveTimelineRollRippleTrimPointerPreview\(\{[\s\S]*?requestedBoundarySample,/u);
	assert.match(move, /controller\.actions\.video\.trim\.rollRipple\.preview\(request\)/u);
	assert.match(move, /clipKind:\s*\(clipId\)/u);
	assert.match(move, /setDraggingClipIds\(new Set\(preview\.previews\.map/u);
	assert.match(move, /setDraggingClipIds\(new Set\(session\.clipIds\)\)/u);

	assert.match(finish, /commitTimelineRollRippleTrimPointer/u);
	assert.match(finish, /const requestedBoundarySample = frameAtClientX\(event\.clientX, session\.lane\)/u);
	assert.match(finish, /commitTimelineRollRippleTrimPointer\(\{[\s\S]*?requestedBoundarySample,/u);
	assert.match(finish, /controller\.actions\.video\.trim\.rollRipple\.commit\(request\)/u);
});

test('the transient trim guide uses the conformed sample in timeline coordinates', () => {
	assert.equal(timelineTrimPreviewGuideLeft(24_000, 240, 120, 48_000), 312);
	const markup = renderGuide(24_000);
	assert.match(markup, /class="audio-editor-trim-preview-guide"/u);
	assert.match(markup, /data-roll-ripple-trim-guide="true"/u);
	assert.match(markup, /aria-hidden="true"/u);
	assert.match(markup, /style="left:312px;height:144px"/u);
	for (const sample of [null, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
		assert.equal(renderGuide(sample), '', String(sample));
	}
});

test('the timeline renders the transient guide only from a roll/ripple preview', async () => {
	const [workspace, overlays, css, annotationsCss] = await Promise.all([
		readFile(new URL('TimelineWorkspaceView.jsx', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('TimelineOverlayComponents.jsx', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('../audio-editor-design-system/08-timeline-clips-effects.css', TIMELINE_ROOT), 'utf8'),
		readFile(new URL('../audio-editor-design-system/19-timeline-annotations.css', TIMELINE_ROOT), 'utf8'),
	]);

	assert.match(workspace, /<TimelineTrimPreviewGuide[\s\S]*?sample=\{clipDragPreview\?\.guideSample\}/u);
	assert.ok(
		workspace.indexOf('className="audio-editor-timeline-inner"')
			< workspace.indexOf('<TimelineTrimPreviewGuide'),
		'the absolute guide shares the horizontally scrolling timeline layer',
	);
	assert.match(overlays, /if \(!Number\.isSafeInteger\(sample\)\) return null;/u);
	assert.match(overlays, /data-roll-ripple-trim-guide="true"[\s\S]*?aria-hidden="true"/u);
	assert.match(css, /audio-editor-trim-preview-guide\s*\{[^}]*position: absolute;[^}]*pointer-events: none;/u);
	assert.match(annotationsCss, /data-has-annotations='true'[^}]*audio-editor-trim-preview-guide[^}]*\{\s*top: 67px;/u);
});

function renderGuide(sample: number | null): string {
	const runtime = globalThis as typeof globalThis & { React?: typeof React };
	const previous = runtime.React;
	runtime.React = React;
	try {
		return renderToStaticMarkup(React.createElement(TimelineTrimPreviewGuide, {
			sample, panelWidth: 240, pixelsPerSecond: 120, sampleRate: 48_000, height: 144,
		}));
	} finally {
		if (previous === undefined) Reflect.deleteProperty(runtime, 'React');
		else runtime.React = previous;
	}
}
