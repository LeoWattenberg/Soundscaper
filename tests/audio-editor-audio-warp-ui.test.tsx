/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import AudioWarpDialog from '../src/common/editor/ui/dialogs/AudioWarpDialog.tsx';
import { createAudioWarpApplicationMenuItems } from '../src/common/editor/ui/audio-warp-application-menu.ts';
import { createAudioWarpDialogModel } from '../src/common/editor/ui/audio-warp-dialog-model.ts';
import { CANONICAL_EXTRA_COPY_BY_LOCALE } from '../src/common/i18n/canonical-extras.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

const NOW = '2026-08-12T20:00:00.000Z';

test('audio warp menu is selected-audio-only, Soundscaper-only, and opens no default chrome', async () => {
	const opened: string[] = [];
	const input = {
		productId: 'soundscaper', capability: true, project: project(),
		selectedClipId: 'clip', editingBlocked: false, copy: ENGLISH_COPY,
		open: () => { opened.push('audio-warp'); },
	};
	const [item] = createAudioWarpApplicationMenuItems(input);
	assert.deepEqual({ id: item?.id, label: item?.label, disabled: item?.disabled }, {
		id: 'audio-warp-editor', label: 'Audio warp and transients', disabled: false,
	});
	item?.onClick();
	assert.deepEqual(opened, ['audio-warp']);
	assert.deepEqual(createAudioWarpApplicationMenuItems({ ...input, productId: 'framescaper' }), []);
	assert.deepEqual(createAudioWarpApplicationMenuItems({ ...input, capability: false }), []);
	assert.equal(createAudioWarpApplicationMenuItems({
		...input, project: project(false, false, createSoundscaperProjectV21),
	})[0]?.disabled, false);
	assert.equal(createAudioWarpApplicationMenuItems({ ...input, selectedClipId: null })[0]?.disabled, true);
	assert.equal(createAudioWarpApplicationMenuItems({ ...input, editingBlocked: true })[0]?.disabled, true);
	assert.equal(createAudioWarpApplicationMenuItems({ ...input, project: project(true) })[0]?.disabled, true);

	const [menus, runtime, overlays] = await Promise.all([
		readFile(new URL('../src/common/editor/ui/application-menus.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/workspace-application-menu-runtime.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', import.meta.url), 'utf8'),
	]);
	assert.match(menus, /id: 'pitch-tempo'[\s\S]*createPitchAndTempoApplicationMenuItems/u);
	assert.match(runtime, /openAudioWarp: \(\) => openSurface\('audio-warp'\)/u);
	assert.match(overlays, /capabilities\.audioWarp && activeSurface === 'audio-warp'/u);
	assert.doesNotMatch(overlays, /capabilities\.audioWarp && activeSurface !==/u);
});

test('dialog enablement derives only from the selected clip snapshot, edit block, and owning lock', () => {
	const editable = createAudioWarpDialogModel({
		productId: 'soundscaper', project: project(), snapshot: { selectedClipId: 'clip' },
	});
	assert.deepEqual({
		clipId: editable.clipId,
		clipName: editable.clipName,
		sourceName: editable.sourceName,
		hasWarpMap: editable.hasWarpMap,
		operationsBlocked: editable.operationsBlocked,
		blockReason: editable.blockReason,
	}, {
		clipId: 'clip', clipName: 'Warp clip', sourceName: 'Warp source',
		hasWarpMap: false, operationsBlocked: false, blockReason: null,
	});
	for (const [label, model, reason] of [
		['read-only', createAudioWarpDialogModel({ productId: 'soundscaper', project: project(), snapshot: { selectedClipId: 'clip', readOnly: true } }), 'read-only'],
		['busy', createAudioWarpDialogModel({ productId: 'soundscaper', project: project(), snapshot: { selectedClipId: 'clip', importing: true } }), 'busy'],
		['locked', createAudioWarpDialogModel({ productId: 'soundscaper', project: project(true), snapshot: { selectedClipId: 'clip' } }), 'locked'],
		['no clip', createAudioWarpDialogModel({ productId: 'soundscaper', project: project(), snapshot: { selectedClipId: null } }), 'no-audio-clip'],
	] as const) {
		assert.equal(model.operationsBlocked, true, label);
		assert.equal(model.blockReason, reason, label);
	}
	assert.equal(createAudioWarpDialogModel({
		productId: 'framescaper', project: project(), snapshot: { selectedClipId: 'clip' },
	}).clipId, null);
	assert.equal(createAudioWarpDialogModel({
		productId: 'soundscaper',
		project: project(false, false, createSoundscaperProjectV21),
		snapshot: { selectedClipId: 'clip' },
	}).operationsBlocked, false);
});

test('dialog exposes pointer and keyboard-native analysis, exact strengths, groove, map, and runtime status', async () => {
	const markup = renderToStaticMarkup(<AudioWarpDialog
		productId="soundscaper"
		controller={{ actions: { audioWarp: actionPorts() } }}
		snapshot={{ project: project(false, true), selectedClipId: 'clip' }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(markup, /role="dialog"[^>]*aria-label="Audio warp and transients"/u);
	assert.match(markup, /data-audio-warp-dialog="true"/u);
	assert.match(markup, /Runtime: exact offline fallback/u);
	assert.match(markup, /data-audio-warp-analyze="true"/u);
	assert.match(markup, /type="range"[^>]*min="0"[^>]*max="100"/u);
	assert.match(markup, /<fieldset[^>]*>[\s\S]*<legend>Quantization<\/legend>/u);
	assert.match(markup, /Enable groove template/u);
	assert.match(markup, /Groove offsets \(maximum 128/u);
	assert.match(markup, /Create identity warp map/u);
	assert.match(markup, /Warp markers/u);
	assert.match(markup, /Add marker/u);
	assert.match(markup, /Clear warp map/u);
	assert.match(markup, /aria-live="polite" aria-atomic="true"/u);

	const css = await readFile(new URL('../src/common/editor/ui/audio-editor-design-system/27-audio-warp.css', import.meta.url), 'utf8');
	assert.match(css, /@media \(forced-colors: active\)/u);
	assert.match(css, /forced-color-adjust: none/u);
});

test('audio warp copy is complete and localized in English and German', () => {
	const required = [
		'audioWarpMenu', 'audioWarpTitle', 'audioWarpAnalyze', 'audioWarpCreateIdentity',
		'audioWarpMarkers', 'audioWarpAddMarker', 'audioWarpMoveMarker', 'audioWarpDeleteMarker',
		'audioWarpQuantization', 'audioWarpGridOrigin', 'audioWarpGridInterval',
		'audioWarpStrength', 'audioWarpQuantize', 'audioWarpEnableGroove',
		'audioWarpGrooveOffsets', 'audioWarpGrooveStrength', 'audioWarpApplyGroove',
		'audioWarpClear', 'audioWarpRealtimeStatus', 'audioWarpOfflineStatus',
		'audioWarpReadOnly', 'audioWarpLocked', 'audioWarpBusy', 'audioWarpNoSelection',
	];
	for (const key of required) {
		assert.equal(typeof CANONICAL_EXTRA_COPY_BY_LOCALE.en[key], 'string', `English ${key}`);
		assert.equal(typeof CANONICAL_EXTRA_COPY_BY_LOCALE.de[key], 'string', `German ${key}`);
		assert.notEqual(CANONICAL_EXTRA_COPY_BY_LOCALE.en[key], key);
		assert.notEqual(CANONICAL_EXTRA_COPY_BY_LOCALE.de[key], key);
	}
	assert.equal(CANONICAL_EXTRA_COPY_BY_LOCALE.de.audioWarpMenu, 'Audio-Warp und Transienten');
});

function actionPorts() {
	return {
		view: () => ({
			selectedClipId: 'clip', clipName: 'Warp clip', sourceName: 'Warp source',
			hasWarpMap: false, warpMap: null, blockReason: null,
			renderStatus: { path: 'exact-offline' as const, realtimeAcceleration: false, exactOfflineAvailable: true, fallback: true },
		}),
		analyze: () => Promise.resolve({ analysis: { transients: [{ sourceFrame: 150, strength: 1 }] } }),
		createIdentityMap: () => undefined,
		addMarker: () => undefined,
		moveMarker: () => undefined,
		deleteMarker: () => undefined,
		quantize: () => Promise.resolve(),
		applyGroove: () => Promise.resolve(),
		clear: () => undefined,
	};
}

function project(
	locked = false,
	withWarpMap = false,
	createProject: typeof createAudioEditorProjectV17 | typeof createSoundscaperProjectV21 = createAudioEditorProjectV17,
) {
	const source = createAudioSource({
		id: 'source', storageKey: 'source', name: 'Warp source',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'clip', sourceId: 'source', title: 'Warp clip',
		timelineStartFrame: 0, durationFrames: 200,
		sourceStartFrame: 100, sourceDurationFrames: 200,
		warpMap: withWarpMap ? {
			feature: 'audio-warp',
			points: [
				{ outer: 0, source: 100, mode: 'forward' },
				{ outer: 200, source: 300, mode: 'forward' },
			],
		} : null,
	});
	return createProject({
		id: 'warp-ui-project', title: 'Warp UI project', now: NOW,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Track', locked, clipIds: ['clip'] })],
	});
}
