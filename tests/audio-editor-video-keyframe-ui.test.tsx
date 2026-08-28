/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import VideoKeyframeDialog from '../src/common/editor/ui/inspector/VideoKeyframeDialog.tsx';
import { videoKeyframeTransferShortcut } from '../src/common/editor/ui/video-keyframe-transfer-shortcut.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

test('the baseline keyframe dialog exposes exact curve editing, transfer, and accessible keyboard-native controls', () => {
	const markup = renderToStaticMarkup(<VideoKeyframeDialog
		productId="framescaper"
		capability
		controller={{ actions: { edit: { commit: () => undefined } } }}
		snapshot={{ project: project(), selectedClipId: 'video' }}
		copy={{}}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(markup, /role="dialog"[^>]*aria-label="Video keyframes"/u);
	assert.match(markup, /aria-describedby="video-keyframes-description"/u);
	assert.match(markup, /data-video-keyframe-dialog="true"/u);
	for (const legend of ['Add curve', 'Edit curve', 'Copy, paste, and presets']) {
		assert.match(markup, new RegExp(`<legend>${legend}</legend>`, 'u'));
	}
	for (const hook of [
		'target', 'start', 'end', 'start-value', 'end-value', 'interpolation',
		'curve', 'anchor', 'anchor-position', 'anchor-value', 'segment', 'segment-kind', 'transfer',
	]) assert.match(markup, new RegExp(`data-video-keyframe-field="${hook}"`, 'u'), hook);
	for (const kind of ['hold', 'linear', 'eased', 'bezier']) {
		assert.match(markup, new RegExp(`<option value="${kind}"`, 'u'));
	}
	assert.match(markup, /maxLength="262144"/u);
	assert.match(markup, /role="status" aria-live="polite" aria-atomic="true"/u);
	assert.match(markup, /type="submit"[^>]*>Add curve/u);
	assert.match(markup, /type="button"[^>]*>Copy curve/u);
	assert.match(markup, /type="button"[^>]*>Paste curve/u);
	assert.match(markup, /type="button"[^>]*>Prepare preset/u);
	assert.match(markup, /type="button"[^>]*>Apply preset/u);
	assert.match(markup, /type="button"[^>]*>Insert anchor/u);
	assert.match(markup, /aria-keyshortcuts="Control\+Shift\+C"/u);
	assert.match(markup, /aria-keyshortcuts="Control\+Shift\+V"/u);
});

test('blocked keyframe UI is explained and disables its complete editing surface', () => {
	const markup = renderToStaticMarkup(<VideoKeyframeDialog
		productId="framescaper"
		capability
		controller={{ actions: { edit: { commit: () => undefined } } }}
		snapshot={{ project: project(true), selectedClipId: 'video' }}
		copy={{}}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(markup, /Unlock the video track to edit keyframes/u);
	assert.match(markup, new RegExp('<fieldset[^>]*disabled=""[^>]*>[\\s\\S]*?<legend>Add curve</legend>', 'u'));
	assert.match(markup, new RegExp('<fieldset[^>]*disabled=""[^>]*>[\\s\\S]*?<legend>Edit curve</legend>', 'u'));
});

test('advertised curve-transfer shortcuts route only the exact enabled chord', () => {
	assert.equal(videoKeyframeTransferShortcut({ key: 'c', ctrlKey: true, shiftKey: true }), 'copy');
	assert.equal(videoKeyframeTransferShortcut({ key: 'V', ctrlKey: true, shiftKey: true }), 'paste');
	assert.equal(videoKeyframeTransferShortcut({ key: 'c', ctrlKey: true, shiftKey: true }, true), null);
	assert.equal(videoKeyframeTransferShortcut({ key: 'c', ctrlKey: true, shiftKey: false }), null);
	assert.equal(videoKeyframeTransferShortcut({ key: 'v', ctrlKey: false, shiftKey: true }), null);
});

test('the German surface localizes both curve-creation and curve-editing interpolation choices', () => {
	const markup = renderToStaticMarkup(<VideoKeyframeDialog
		productId="framescaper" capability
		controller={{ actions: { edit: { commit: () => undefined } } }}
		snapshot={{ project: project(), selectedClipId: 'video' }}
		copy={GERMAN_COPY}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.equal((markup.match(/<option value="eased">Weich<\/option>/gu) ?? []).length, 2);
	assert.equal((markup.match(/<option value="bezier">Bézier<\/option>/gu) ?? []).length, 2);
});

test('keyframe UI stays lazy, menu-reached, and guarded by its capability', async () => {
	const [menus, runtime, overlays, dialog] = await Promise.all([
		readFile(new URL('../src/common/editor/ui/application-menus.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/workspace-application-menu-runtime.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/inspector/VideoKeyframeDialog.tsx', import.meta.url), 'utf8'),
	]);
	assert.match(menus, /clip-boundaries[\s\S]*\.\.\.videoFinishingItems[\s\S]*clip-properties/u);
	assert.match(runtime, /openVideoKeyframes: \(\) => openSurface\('video-keyframes'\)/u);
	assert.match(overlays, /capabilities\.videoKeyframes && activeSurface === 'video-keyframes'/u);
	assert.match(overlays, /import\('\.\.\/inspector\/VideoKeyframeDialog\.tsx'\)/u);
	assert.doesNotMatch(overlays, /capabilities\.videoKeyframes && activeSurface !==/u);
	assert.match(dialog, /initialFocus=\{'\[data-video-keyframe-field="target"\]'\}/u);
	assert.match(dialog, /controller\.actions\.edit\.commit\(command\)/u);
	const curveEditor = await readFile(new URL('../src/common/editor/ui/inspector/VideoKeyframeCurveEditor.tsx', import.meta.url), 'utf8');
	assert.match(curveEditor, /useEffect\(\(\) => \{[\s\S]*setAnchorIndex\(0\); setSegmentIndex\(0\);[\s\S]*\}, \[curve, model, stableKey\]\)/u,
		'curve switches and removals reset local fields from the surviving immutable curve');
});

test('English and German catalogs own all keyframe interaction and target copy', () => {
	for (const key of [
		'videoKeyframesMenu', 'videoKeyframesTitle', 'videoKeyframesDescription',
		'videoKeyframesAddCurve', 'videoKeyframesEditCurve', 'videoKeyframesTransfer',
		'videoKeyframesCopy', 'videoKeyframesPaste', 'videoKeyframesSavePreset',
		'videoKeyframesApplyPreset', 'videoKeyframesInvalid', 'videoKeyframesLocked',
		'videoKeyframeTargetCropLeft', 'videoKeyframeTargetPositionX',
		'videoKeyframeTargetRotation', 'videoKeyframeTargetOpacity',
	] as const) {
		assert.equal(typeof ENGLISH_COPY[key], 'string', `English ${key}`);
		assert.equal(typeof GERMAN_COPY[key], 'string', `German ${key}`);
	}
	assert.notEqual(ENGLISH_COPY.videoKeyframesDescription, GERMAN_COPY.videoKeyframesDescription);
	assert.notEqual(ENGLISH_COPY.videoKeyframeTargetCropLeft, GERMAN_COPY.videoKeyframeTargetCropLeft);
});

function project(locked = false) {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1,
		clips: [{
			id: 'video', kind: 'video', title: 'Picture', sequenceStartFrame: 0, sequenceFrameCount: 20,
			videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
			videoEffects: [createVideoEffect('pixelate', { id: 'pixels' })],
			videoKeyframes: {
				schemaVersion: 1,
				timeDomain: {
					authoredDuration: { num: 20, den: 1 },
					viewStart: { num: 0, den: 1 },
					viewDuration: { num: 20, den: 1 },
				},
				curves: [{
					target: { kind: 'composition', parameterId: 'opacity' },
					curve: {
						anchors: [
							{ position: { num: 0, den: 1 }, value: 0.25 },
							{ position: { num: 20, den: 1 }, value: 0.75 },
						],
						segments: [{ kind: 'linear' }],
					},
				}],
			},
		}],
		tracks: [{ id: 'track', type: 'video', locked, clipIds: ['video'] }],
		selection: { clipIds: ['video'] },
	};
}
