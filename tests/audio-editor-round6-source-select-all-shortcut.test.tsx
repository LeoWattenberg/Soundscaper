/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import type { ClipSourceController, ClipSourceProject } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the source Select all owner releases a configured extra-modifier chord', async () => {
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
	let selections = 0;
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update() {} }, timeline: {}, effects: { setSourceSelection(value) { if (value) selections += 1; } },
		audioWarp: { addSourceMarker() {}, moveSourceMarker() {}, deleteSourceMarker() {} },
		clipSourcePreview: { focus() {}, blur() {}, playPause() {}, stop() {}, seek() {},
			setLoop() {}, setLoopRange() {}, setSelection() {}, trim() {}, subscribe: () => () => {},
			snapshot: () => ({ clipId: null, focused: false, state: 'stopped', positionFrame: 0, loop: false, loopRange: null }) },
	} };
	try {
		await act(async () => root.render(<ClipSourceEditor controller={controller} project={project}
			clipId="clip" copy={{ clipSourceWaveform: 'Source waveform' }} blocked={false} />));
		const editor = dom.one('.audio-editor-clip-source-editor');
		const waveform = dom.one('.audio-editor-source-wave-area');
		let prevented = false;
		await act(async () => reactProps(editor).onKeyDown({ target: waveform, currentTarget: editor,
			key: 'a', ctrlKey: true, altKey: true,
			preventDefault() { prevented = true; }, stopPropagation() {} }));
		assert.equal(prevented, false, 'Ctrl+Alt+A must remain available to its command owner');
		assert.equal(selections, 0);
		for (const modifier of ['ctrlKey', 'metaKey']) {
			prevented = false;
			await act(async () => reactProps(editor).onKeyDown({ target: waveform, currentTarget: editor,
				key: 'a', [modifier]: true,
				preventDefault() { prevented = true; }, stopPropagation() {} }));
			assert.equal(prevented, true, 'ordinary Select all still owns its exact chord');
		}
		assert.equal(selections, 2);
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
