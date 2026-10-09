/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import type { ClipSourceController, ClipSourceProject } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

Object.assign(ReactTestElement.prototype, { select: () => undefined });

for (const initiallyBlocked of [true, false]) test(`Source rename releases live mutation admission (initially blocked=${String(initiallyBlocked)})`, async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const source = createAudioSource({ id: 'source', storageKey: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const document = createSoundscaperProject({ id: 'source-rename', now: '2026-10-09T12:00:00.000Z', sampleRate: 48_000,
		sources: [source], tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0,
			durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000 })],
	});
	const clip = resolveRuntimeClipProjection(document, document.clips[0]!);
	const project: ClipSourceProject = { id: document.id, sampleRate: document.sampleRate,
		tempoMap: document.tempoMap, sources: [source], clips: [clip] };
	const updates: unknown[] = [];
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update(_id, changes) { updates.push(changes); } }, timeline: {}, effects: { setSourceSelection() {} },
		audioWarp: { addSourceMarker() {}, moveSourceMarker() {}, deleteSourceMarker() {} },
		clipSourcePreview: { focus() {}, blur() {}, playPause() {}, stop() {}, seek() {},
			setLoop() {}, setLoopRange() {}, setSelection() {}, trim() {},
			subscribe: () => () => {}, snapshot: () => ({ clipId: null, focused: false,
				state: 'stopped', positionFrame: 0, loop: false, loopRange: null }) },
	} };
	const render = async (blocked: boolean) => {
		await act(async () => { root.render(<ClipSourceEditor controller={controller} project={project}
			clipId={clip.id} copy={ENGLISH_COPY} blocked={blocked} />); });
	};
	const begin = async () => {
		await act(async () => { reactProps(dom.one('.clip-header__name')).onDoubleClick({ stopPropagation() {} }); });
	};
	try {
		await render(initiallyBlocked);
		await begin();
		if (initiallyBlocked) {
			assert.equal(dom.container.querySelectorAll('.clip-header__name-input').length, 0,
				'an already blocked source header must not admit a rename draft');
		} else {
			assert.equal(dom.container.querySelectorAll('.clip-header__name-input').length, 1);
			await render(true);
			await act(async () => { reactProps(dom.one('.clip-header__name-input')).onKeyDown({ key: 'Enter',
				currentTarget: { value: 'Refused draft', closest: () => null }, preventDefault() {}, stopPropagation() {} }); });
			assert.equal(updates.length, 0, 'a callback captured before a live block cannot publish a rename');
		}
		await render(false);
		await begin();
		await act(async () => { reactProps(dom.one('.clip-header__name-input')).onKeyDown({ key: 'Enter',
			currentTarget: { value: 'Ordinary name', closest: () => null }, preventDefault() {}, stopPropagation() {} }); });
		assert.deepEqual(updates, [{ title: 'Ordinary name' }]);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
