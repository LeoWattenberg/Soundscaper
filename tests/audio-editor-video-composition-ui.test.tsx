/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	DEFAULT_VIDEO_CLIP_COMPOSITION,
	VIDEO_CLIP_COMPOSITION_BLEND_MODES,
} from '../src/common/editor/video-clip-composition.ts';
import { createVideoCompositionApplicationMenuItems } from '../src/common/editor/ui/video-composition-application-menu.ts';
import {
	createVideoCompositionCommitCommand,
	createVideoCompositionDialogModel,
	createVideoCompositionDraft,
	createVideoCompositionSetCommand,
	parseVideoCompositionDraft,
} from '../src/common/editor/ui/video-composition-dialog-model.ts';
import VideoCompositionDialog from '../src/common/editor/ui/inspector/VideoCompositionDialog.tsx';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

test('video composition is a capability-gated Framescaper menu action for one writable V19 video clip', () => {
	const opened: string[] = [];
	const input = {
		productId: 'framescaper', capability: true, project: project(),
		selectedClipId: 'video', editingBlocked: false,
		copy: { videoCompositionMenu: 'Transform and compositing…' },
		open: () => { opened.push('video-composition'); },
	};
	const [item] = createVideoCompositionApplicationMenuItems(input);
	assert.deepEqual({ id: item?.id, label: item?.label, disabled: item?.disabled }, {
		id: 'video-composition-editor', label: 'Transform and compositing…', disabled: false,
	});
	item?.onClick();
	assert.deepEqual(opened, ['video-composition']);
	assert.deepEqual(createVideoCompositionApplicationMenuItems({ ...input, productId: 'soundscaper' }), []);
	assert.deepEqual(createVideoCompositionApplicationMenuItems({ ...input, capability: false }), []);
	assert.equal(createVideoCompositionApplicationMenuItems({ ...input, editingBlocked: true })[0]?.disabled, true);
	assert.equal(createVideoCompositionApplicationMenuItems({ ...input, project: project({ locked: true }) })[0]?.disabled, true);
	assert.equal(createVideoCompositionApplicationMenuItems({ ...input, project: project({ selection: ['video', 'audio'] }) })[0]?.disabled, false);
	assert.equal(createVideoCompositionApplicationMenuItems({ ...input, project: project({ selection: ['video', 'other-video'] }) })[0]?.disabled, true);
	assert.equal(createVideoCompositionApplicationMenuItems({ ...input, selectedClipId: 'audio' })[0]?.disabled, true);
	assert.equal(createVideoCompositionApplicationMenuItems({ ...input, project: { ...project(), schemaVersion: 18 } })[0]?.disabled, true);
});

test('a linked A/V selection resolves the focused video clip as one composition owner', () => {
	const linked = project({ selection: ['video', 'audio'] });
	const model = createVideoCompositionDialogModel({
		productId: 'framescaper', capability: true, project: linked,
		snapshot: { selectedClipId: 'video' },
	});
	assert.equal(model.clipId, 'video');
	assert.equal(model.operationsBlocked, false);
});

test('blend or order edits update an overlapping transition partner in one batch', () => {
	const transition = project();
	transition.clips[0] = {
		...transition.clips[0], sequenceStartFrame: 0, sequenceFrameCount: 20,
	};
	transition.clips[1] = {
		...transition.clips[1], id: 'incoming', sequenceStartFrame: 10, sequenceFrameCount: 20,
	};
	transition.tracks[0] = { ...transition.tracks[0], clipIds: ['video', 'incoming'] };
	transition.selection = { clipIds: ['video'] };
	const next = { ...DEFAULT_VIDEO_CLIP_COMPOSITION, blendMode: 'screen' as const };
	const command = createVideoCompositionCommitCommand(
		transition, 'video', DEFAULT_VIDEO_CLIP_COMPOSITION, next,
	);
	assert.equal(command.type, 'batch');
	assert.deepEqual(command.commands.map(({ clipId }) => clipId), ['video', 'incoming']);
});

test('video composition dialog model derives selection and blocking only from the immutable snapshot', () => {
	const editable = createVideoCompositionDialogModel({
		productId: 'framescaper', capability: true, project: project(),
		snapshot: { selectedClipId: 'video' },
	});
	assert.deepEqual({
		clipId: editable.clipId,
		clipName: editable.clipName,
		composition: editable.composition,
		operationsBlocked: editable.operationsBlocked,
		blockReason: editable.blockReason,
	}, {
		clipId: 'video', clipName: 'Picture', composition: DEFAULT_VIDEO_CLIP_COMPOSITION,
		operationsBlocked: false, blockReason: null,
	});
	for (const [label, model, reason] of [
		['read only', createVideoCompositionDialogModel({ productId: 'framescaper', capability: true, project: project(), snapshot: { selectedClipId: 'video', readOnly: true } }), 'read-only'],
		['busy', createVideoCompositionDialogModel({ productId: 'framescaper', capability: true, project: project(), snapshot: { selectedClipId: 'video', importing: true } }), 'busy'],
		['locked', createVideoCompositionDialogModel({ productId: 'framescaper', capability: true, project: project({ locked: true }), snapshot: { selectedClipId: 'video' } }), 'locked'],
		['multiple video', createVideoCompositionDialogModel({ productId: 'framescaper', capability: true, project: project({ selection: ['video', 'other-video'] }), snapshot: { selectedClipId: null } }), 'no-video-clip'],
		['unsupported product', createVideoCompositionDialogModel({ productId: 'soundscaper', capability: true, project: project(), snapshot: { selectedClipId: 'video' } }), 'unsupported'],
		['unsupported capability', createVideoCompositionDialogModel({ productId: 'framescaper', capability: false, project: project(), snapshot: { selectedClipId: 'video' } }), 'unsupported'],
	] as const) {
		assert.equal(model.operationsBlocked, true, label);
		assert.equal(model.blockReason, reason, label);
	}
});

test('video composition draft converts display units and builds one canonical optimistic command', () => {
	const neutral = createVideoCompositionDraft(DEFAULT_VIDEO_CLIP_COMPOSITION);
	assert.equal(neutral.positionXPercent, '0');
	assert.equal(neutral.positionYPercent, '0');
	assert.equal(neutral.scaleXPercent, '100');
	assert.equal(neutral.opacityPercent, '100');
	assert.equal(createVideoCompositionDraft({
		...DEFAULT_VIDEO_CLIP_COMPOSITION,
		transform: { ...DEFAULT_VIDEO_CLIP_COMPOSITION.transform, positionX: 0.7 },
	}).positionXPercent, '20');
	const composition = parseVideoCompositionDraft({
		...neutral,
		cropLeftPercent: '10', cropTopPercent: '20', cropRightPercent: '30', cropBottomPercent: '5',
		anchorXPercent: '25', anchorYPercent: '75',
		positionXPercent: '-125', positionYPercent: '250',
		scaleXPercent: '150', scaleYPercent: '50', rotationDegrees: '45',
		flipHorizontal: true, flipVertical: true,
		opacityPercent: '40', blendMode: 'screen', compositingOrder: '7',
	});
	assert.deepEqual(composition, {
		schemaVersion: 1,
		crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.05 },
		transform: {
			anchorX: 0.25, anchorY: 0.75, positionX: -0.75, positionY: 3,
			scaleX: 1.5, scaleY: 0.5, rotationDegrees: 45,
			flipHorizontal: true, flipVertical: true,
		},
		opacity: 0.4, blendMode: 'screen', compositingOrder: 7,
	});
	const command = createVideoCompositionSetCommand('video', DEFAULT_VIDEO_CLIP_COMPOSITION, composition);
	assert.deepEqual(command, {
		type: 'video-composition/set', clipId: 'video',
		expectedComposition: DEFAULT_VIDEO_CLIP_COMPOSITION, composition,
	});
	assert.equal(Object.isFrozen(command), true);
	assert.throws(() => parseVideoCompositionDraft({
		...neutral, cropLeftPercent: '50', cropRightPercent: '50',
	}), /left.*right.*less than 1/iu);
	assert.throws(() => parseVideoCompositionDraft({
		...neutral, compositingOrder: '1.5',
	}), /safe integer/iu);
	assert.throws(() => parseVideoCompositionDraft({
		...neutral, opacityPercent: '',
	}), /opacity/iu);
});

test('video composition dialog exposes every field, reset/apply, and accessible status semantics', () => {
	const markup = renderToStaticMarkup(<VideoCompositionDialog
		productId="framescaper"
		capability
		controller={{ actions: { edit: { commit: () => undefined } } }}
		snapshot={{ project: project(), selectedClipId: 'video' }}
		copy={{}}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(markup, /role="dialog"[^>]*aria-label="Transform and compositing"/u);
	assert.match(markup, /aria-describedby="video-composition-description"/u);
	assert.match(markup, /data-video-composition-dialog="true"/u);
	for (const legend of ['Crop', 'Transform', 'Compositing']) {
		assert.match(markup, new RegExp(`<legend>${legend}</legend>`, 'u'));
	}
	for (const field of [
		'crop-left', 'crop-top', 'crop-right', 'crop-bottom',
		'anchor-x', 'anchor-y', 'position-x', 'position-y',
		'scale-x', 'scale-y', 'rotation', 'flip-horizontal', 'flip-vertical',
		'opacity', 'blend-mode', 'compositing-order',
	]) assert.match(markup, new RegExp(`data-video-composition-field="${field}"`, 'u'), field);
	for (const mode of VIDEO_CLIP_COMPOSITION_BLEND_MODES) {
		assert.match(markup, new RegExp(`<option value="${mode}"`, 'u'));
	}
	assert.match(markup, /type="submit"[^>]*>Apply</u);
	assert.match(markup, /type="button"[^>]*>Reset</u);
	assert.match(markup, /aria-live="polite" aria-atomic="true"/u);
	const lockedMarkup = renderToStaticMarkup(<VideoCompositionDialog
		productId="framescaper"
		capability
		controller={{ actions: { edit: { commit: () => undefined } } }}
		snapshot={{ project: project({ locked: true }), selectedClipId: 'video' }}
		copy={{}}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(lockedMarkup, /<fieldset[^>]*disabled=""[^>]*>[\s\S]*<legend>Crop<\/legend>/u);
	assert.match(lockedMarkup, /Unlock the video track/u);
});

test('video composition remains menu-reached and capability guarded in workspace wiring', async () => {
	const [menus, runtime, overlays, dialog] = await Promise.all([
		readFile(new URL('../src/common/editor/ui/application-menus.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/workspace-application-menu-runtime.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/inspector/VideoCompositionDialog.tsx', import.meta.url), 'utf8'),
	]);
	assert.match(menus, /clip-boundaries[\s\S]*\.\.\.videoCompositionItems[\s\S]*clip-properties/u);
	assert.match(runtime, /openVideoComposition: \(\) => openSurface\('video-composition'\)/u);
	assert.match(overlays, /productId === 'framescaper'[\s\S]*capabilities\.videoGeometry[\s\S]*activeSurface === 'video-composition'/u);
	assert.match(overlays, /import\('\.\.\/inspector\/VideoCompositionDialog\.tsx'\)/u);
	assert.doesNotMatch(overlays, /capabilities\.videoGeometry && activeSurface !==/u);
	assert.match(dialog, /initialFocus=\{'\[data-video-composition-field="crop-left"\]'\}/u);
	assert.match(dialog, /controller\.actions\.edit\.commit\(command\)/u);
	assert.match(dialog, /onBlur=/u);
});

test('video composition copy is complete in English and German catalogs', () => {
	for (const key of [
		'videoCompositionMenu', 'videoCompositionTitle', 'videoCompositionDescription',
		'videoCompositionCrop', 'videoCompositionTransform', 'videoCompositionCompositing',
		'videoCompositionApply', 'videoCompositionReset', 'videoCompositionReadOnly',
		'videoCompositionInvalid', 'videoCompositionApplyFailed',
		'videoCompositionBlendScreen', 'videoCompositionBlendDifference',
	] as const) {
		assert.equal(typeof ENGLISH_COPY[key], 'string', `English ${key}`);
		assert.equal(typeof GERMAN_COPY[key], 'string', `German ${key}`);
		assert.notEqual(ENGLISH_COPY[key], GERMAN_COPY[key], key);
	}
});

function project(options: Readonly<{ locked?: boolean; selection?: readonly string[] }> = {}): {
	schemaVersion: number;
	clips: Array<Record<string, unknown>>;
	tracks: Array<Record<string, unknown>>;
	selection: { clipIds: readonly string[] };
} {
	return {
		schemaVersion: 19,
		clips: [
			{ id: 'video', kind: 'video', title: 'Picture', videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION },
			{ id: 'other-video', kind: 'video', title: 'Other picture', videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION },
			{ id: 'audio', kind: 'audio', title: 'Sound' },
		],
		tracks: [
			{ id: 'video-track', type: 'video', locked: options.locked === true, clipIds: ['video'] },
			{ id: 'audio-track', type: 'audio', locked: false, clipIds: ['audio'] },
		],
		selection: { clipIds: options.selection ?? [] },
	};
}
