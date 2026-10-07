/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import ProjectBinCard from '../src/common/editor/ui/workspace/ProjectBinCard.jsx';
import ProjectBinPanel from '../src/common/editor/ui/workspace/ProjectBinPanel.jsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('the mounted camera audition inherits listening gain and applies live changes without restarting playback', async () => {
	const dom = installReactTestDom();
	const prototype = Object.getPrototypeOf(dom.container) as object;
	const overrides = { volume: 1, currentTime: 0, play: () => { plays++; return Promise.resolve(); }, pause: () => undefined };
	const prior = new Map(Object.keys(overrides).map(key => [key, Object.getOwnPropertyDescriptor(prototype, key)]));
	let plays = 0;
	for (const [key, value] of Object.entries(overrides)) Object.defineProperty(prototype, key, { value, writable: true, configurable: true });
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const video = { id: 'video', kind: 'video', sourceId: 'camera', title: 'Camera', binItemId: 'item',
		sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 60, sourceInFrame: 0, sourceFrameCount: 60 };
	const source = { id: 'camera', kind: 'video', frameRate: { num: 30, den: 1 }, sourceFrameCount: 60,
		sampleFrameCount: 96_000, sampleRate: 48_000 };
	const audio = { id: 'audio', kind: 'audio', sourceId: 'sound', durationFrames: 96_000, sourceDurationFrames: 96_000 };
	const props = { clip: video, itemClips: [video, audio], source, sources: [source],
		project: { id: 'project', schemaVersion: 17, sampleRate: 48_000, primarySequenceId: 'main',
			sequences: [{ id: 'main', rate: { num: 30, den: 1 } }], sources: [source] },
		controller: { actions: { projectBin: { getVisualData: () => ({ mediaUrl: 'blob:camera' }),
			instanceCount: () => 0, stopPreview: () => undefined } } },
		copy: ENGLISH_COPY, locale: 'en', mutationBlocked: false, missing: false, selectedMediaTrack: null,
		preview: { clipId: 'video', binItemId: 'item', kind: 'video', state: 'playing' },
		run: () => undefined, onOpenMenu: () => undefined, onDragEnd: () => undefined };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(React.createElement(ProjectBinCard, { ...props, playbackGain: 0 })));
		const media = dom.one('video') as typeof dom.container & { volume: number; muted: boolean };
		assert.equal(media.volume, 0, 'camera audio must respect the already-muted listening output');
		assert.equal(media.muted, false, 'the existing audio companion remains audible when the listener unmutes');
		assert.equal(plays, 1);
		await act(async () => root.render(React.createElement(ProjectBinCard, { ...props, playbackGain: 0.25 })));
		assert.equal(media.volume, 0.25);
		assert.equal(plays, 1, 'listening gain changes must not restart the source transport');
		await act(async () => root.render(React.createElement(ProjectBinCard, { ...props, playbackGain: 0 })));
		assert.equal(media.volume, 0);
		assert.equal(plays, 1);
		const project = { ...props.project, revision: 0, clips: [], tracks: [], projectBin: { clips: [video, audio] } };
		const renderPanel = async (gain: number): Promise<void> => {
			await act(async () => root.render(React.createElement(ProjectBinPanel, {
				controller: props.controller, snapshot: { project, projectBinPreview: props.preview,
					audioDevices: { playbackGain: gain }, productId: 'framescaper' }, copy: ENGLISH_COPY, locale: 'en',
				fileService: {}, run: () => undefined, blocked: false,
			})));
		};
		await renderPanel(0);
		const panelMedia = dom.one('video') as typeof media;
		assert.equal(panelMedia.volume, 0, 'the panel forwards the actual audio-device snapshot gain');
		await renderPanel(0.5);
		assert.equal(panelMedia.volume, 0.5);
		assert.equal(plays, 2, 'live panel updates retain the existing audition transport');
	} finally {
		await act(async () => root.unmount());
		for (const [key, descriptor] of prior) {
			if (descriptor) Object.defineProperty(prototype, key, descriptor);
			else Reflect.deleteProperty(prototype, key);
		}
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});
