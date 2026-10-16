/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import type { ClipSourceController, ClipSourceProject } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the source vertical ruler releases modified context-menu entry before opening its local view', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const constructors = new Map<string, PropertyDescriptor | undefined>();
	for (const key of ['HTMLInputElement', 'HTMLButtonElement']) {
		constructors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, value: class {} });
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const project: ClipSourceProject = {
		id: 'project', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		sources: [{ id: 'source', sampleRate: 24_000, channelCount: 1, frameCount: 24_000 }],
		clips: [{ id: 'clip', sourceId: 'source', kind: 'audio', anchor: 'sample', reversed: false,
			timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 24_000 }],
	};
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update() {} }, timeline: {}, effects: { setSourceSelection() {} },
		audioWarp: { addSourceMarker() {}, moveSourceMarker() {}, deleteSourceMarker() {} },
		clipSourcePreview: { focus() {}, blur() {}, playPause() {}, stop() {}, seek() {},
			setLoop() {}, setLoopRange() {}, setSelection() {}, trim() {}, subscribe: () => () => {},
			snapshot: () => ({ clipId: null, focused: false, state: 'stopped', positionFrame: 0, loop: false, loopRange: null }) },
	} };
	try {
		await act(async () => root.render(<ClipSourceEditor controller={controller} project={project}
			clipId="clip" copy={{ clipSourceWaveform: 'Source waveform' }} blocked={false} />));
		const ruler = dom.one('.audio-editor-source-vertical-ruler');
		for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
			let prevented = false;
			await act(async () => reactProps(ruler).onKeyDown({ target: ruler, currentTarget: ruler,
				key: 'F10', shiftKey: true, [modifier]: true, preventDefault() { prevented = true; } }));
			assert.equal(prevented, false, `${modifier} must remain available to its command owner`);
			assert.equal(dom.container.querySelectorAll('[role="menu"]').length, 0);
		}
		let prevented = false;
		await act(async () => reactProps(ruler).onKeyDown({ target: ruler, currentTarget: ruler,
			key: 'F10', shiftKey: true, preventDefault() { prevented = true; } }));
		assert.equal(prevented, true, 'ordinary Shift+F10 still opens the native view menu');
		assert.equal(dom.container.querySelectorAll('[role="menu"]').length, 1);
	} finally {
		await act(async () => root.unmount());
		for (const [key, descriptor] of constructors) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
