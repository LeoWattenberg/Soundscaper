/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import type { ClipSourceController } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('Space on the initially focused properties body belongs to its source transport', async () => {
	const f = await fixture();
	try {
		assert.equal(f.dom.container.ownerDocument.activeElement, f.body);
		const event = await f.space(f.body);
		assert.deepEqual(f.sourceCalls, ['clip']);
		assert.equal(f.mainCalls(), 0);
		assert.equal(event.defaultPrevented, true);
	} finally { await f.cleanup(); }
});

test('Space retains native drawer, input, and button behavior without starting project playback', async () => {
	const f = await fixture();
	try {
		for (const selector of ['summary', 'input', 'button']) {
			const event = await f.space(f.dom.one(selector));
			assert.equal(event.defaultPrevented, false, selector);
		}
		assert.deepEqual(f.sourceCalls, []);
		assert.equal(f.mainCalls(), 0);
	} finally { await f.cleanup(); }
});

test('an already handled source Space never triggers a second transport action', async () => {
	const f = await fixture();
	try {
		await f.space(f.body, true);
		assert.deepEqual(f.sourceCalls, []);
		assert.equal(f.mainCalls(), 0);
	} finally { await f.cleanup(); }
});

async function fixture() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const project = createSoundscaperProject({ id: 'project', now: '2026-10-02T12:00:00.000Z', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', frameCount: 1_000, channelCount: 1, sampleRate: 48_000 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 1_000, sourceDurationFrames: 1_000 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
	});
	const noop = () => undefined;
	const sourceCalls: string[] = [];
	let mainCalls = 0;
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update: noop }, audioWarp: { addSourceMarker: noop, moveSourceMarker: noop, deleteSourceMarker: noop }, timeline: {},
		effects: { setSourceSelection: noop }, clipSourcePreview: {
			focus: noop, blur: noop, stop: noop, seek: noop, setLoop: noop, setLoopRange: noop, setSelection: noop, trim: noop,
			playPause: async clipId => { sourceCalls.push(clipId); }, subscribe: () => noop,
			snapshot: () => ({ clipId: 'clip', focused: false, state: 'stopped', positionFrame: 0, loop: false, loopRange: null }),
		},
	} };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => { root.render(<ClipPropertiesPanel controller={controller} copy={ENGLISH_COPY}
		snapshot={{ project, selectedClipId: 'clip', capabilities: { audioEffects: false } }}
		focusRequest={{ projectId: 'project', clipId: 'clip', field: null }} />); });
	const body = dom.one('[data-clip-properties-active-clip]');
	return {
		dom, body, sourceCalls, mainCalls: () => mainCalls,
		space: async (target: ReactTestElement, defaultPrevented = false) => {
			let stopped = false;
			const event = { target: target as unknown as EventTarget, key: ' ', code: 'Space', defaultPrevented,
				altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
				preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; },
			};
			await act(async () => {
				reactProps(body).onKeyDown?.(event);
				if (!stopped) handleWorkspaceKeyboard(event, { preferences: { shortcuts: { 'action://playback/toggle-play-stop': ['Space'] } } },
					handler => handler(), { menus: [{ id: 'action://playback/toggle-play-stop', onClick: () => { mainCalls += 1; } }] });
			});
			return event;
		},
		cleanup: async () => {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}
