/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import ProjectBinCard from '../src/common/editor/ui/workspace/ProjectBinCard.jsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('a camera with engine-owned companion audio never restores the embedded original', async () => {
	const dom = installReactTestDom();
	const prototype = Object.getPrototypeOf(dom.container) as object;
	let plays = 0, pauses = 0;
	const overrides = { volume: 1, currentTime: 0, play: () => { plays++; return Promise.resolve(); }, pause: () => { pauses++; } };
	const prior = new Map(Object.keys(overrides).map(key => [key, Object.getOwnPropertyDescriptor(prototype, key)]));
	for (const [key, value] of Object.entries(overrides)) Object.defineProperty(prototype, key, { value, writable: true, configurable: true });
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const camera = { id: 'camera', kind: 'video', sampleRate: 48_000, sampleFrameCount: 96_000,
		frameRate: { num: 25, den: 1 }, sourceFrameCount: 50 };
	const video = { id: 'picture', kind: 'video', sourceId: 'camera', title: 'Camera', binItemId: 'camera-item',
		sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 50, sourceInFrame: 0, sourceFrameCount: 50 };
	const props = { clip: video, itemClips: [video, { id: 'sound', kind: 'audio', sourceId: 'authored-silence' }],
		source: camera, sources: [camera], project: { id: 'project', schemaVersion: 17, sampleRate: 48_000,
			primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 25, den: 1 } }], sources: [camera] },
		controller: { actions: { projectBin: { getVisualData: () => ({ mediaUrl: 'blob:camera' }),
			instanceCount: () => 0, stopPreview: () => undefined } } },
		copy: ENGLISH_COPY, locale: 'en', mutationBlocked: false, missing: false, selectedMediaTrack: null,
		preview: { clipId: 'picture', binItemId: 'camera-item', kind: 'video', state: 'paused', audioSourceId: 'authored-silence' },
		run: () => undefined, onOpenMenu: () => undefined, onDragEnd: () => undefined };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(React.createElement(ProjectBinCard, { ...props, playbackGain: 0.5 })));
		const media = dom.one('video') as typeof dom.container & { volume: number; currentTime: number; muted: boolean; defaultMuted: boolean };
		assert.equal(media.muted, true);
		assert.equal(media.defaultMuted, true, 'WebKit must receive the mute attribute before decoder initialization');
		assert.equal(plays, 0, 'picture playback waits for its audio companion to prepare');
		assert.equal(pauses, 1);
		await act(async () => root.render(React.createElement(ProjectBinCard, {
			...props, playbackGain: 0.5, preview: { ...props.preview, state: 'playing' },
		})));
		assert.equal(plays, 1);
		assert.equal(media.muted, true);
		await act(async () => root.render(React.createElement(ProjectBinCard, {
			...props, playbackGain: 0, preview: { ...props.preview, state: 'playing' },
		})));
		assert.equal(media.volume, 0);
		assert.equal(media.muted, true);
		assert.equal(plays, 1, 'listening gain changes do not restart picture playback');
		media.currentTime = 1.95;
		await act(async () => root.render(React.createElement(ProjectBinCard, {
			...props, playbackGain: 0, preview: { ...props.preview, state: 'stopped' },
		})));
		assert.equal(media.currentTime, 0, 'completed audio returns picture transport to the source window start');
	} finally {
		await act(async () => root.unmount());
		for (const [key, descriptor] of prior) {
			if (descriptor) Object.defineProperty(prototype, key, descriptor);
			else Reflect.deleteProperty(prototype, key);
		}
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});
