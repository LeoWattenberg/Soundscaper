/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipSourceMonitorPanel from '../src/common/editor/ui/inspector/ClipSourceMonitorPanel.tsx';
import type { ClipSourceController } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Source monitor transport and source editor failures use the workspace runner without inline errors', async () => {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const noop = () => undefined;
	const focusFailure = new Error('Cannot focus source'), playFailure = new Error('Cannot play source');
	const errors: unknown[] = [];
	const run = (operation: () => unknown) => {
		try { void Promise.resolve(operation()).catch(cause => { errors.push(cause); }); } catch (cause) { errors.push(cause); }
	};
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update: noop }, audioWarp: { addSourceMarker: noop, moveSourceMarker: noop, deleteSourceMarker: noop }, timeline: {},
		effects: { setSourceSelection: noop }, clipSourcePreview: {
			focus: () => { throw focusFailure; }, blur: noop, stop: noop, seek: noop, setLoop: noop, setLoopRange: noop, setSelection: noop, trim: noop,
			playPause: () => Promise.reject(playFailure), subscribe: () => noop,
			snapshot: () => ({ clipId: 'clip', focused: false, state: 'stopped', positionFrame: 0, loop: false, loopRange: null }),
		},
	} };
	const project = createSoundscaperProject({ id: 'project', now: '2026-10-02T00:00:00Z',
		sources: [createAudioSource({ id: 'source', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 48_000, sourceDurationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
	try {
		await act(async () => root.render(<ClipSourceMonitorPanel controller={controller} snapshot={{ project, selectedClipId: 'clip' }} copy={ENGLISH_COPY} run={run} />));
		await act(async () => reactProps(dom.one('[data-clip-source-editor]')).onFocusCapture());
		await act(async () => reactProps(dom.one('[data-clip-properties-active-clip]')).onKeyDown({ code: 'Space',
			target: dom.one('[data-clip-properties-active-clip]'), stopPropagation() {}, preventDefault() {} }));
		assert.deepEqual(errors, [focusFailure, playFailure]);
		assert.equal(dom.find('[role="alert"]'), null);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
