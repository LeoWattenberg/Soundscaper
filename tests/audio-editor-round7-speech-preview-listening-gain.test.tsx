/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import LocalProcessingOverlays from '../src/common/editor/ui/workspace/LocalProcessingOverlays.tsx';
import { createRound7SpeechPreviewBridge } from './helpers/round7-speech-preview-bridge.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('menu-owned speech preview follows current, live and paused listening gain', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const bridge = createRound7SpeechPreviewBridge();
	const projectPort = { loadInitial: async () => null, accept: async () => undefined };
	const copy = {};
	let playbackGain = 1;
	const render = (): void => {
		const snapshot = { project: null, audioDevices: { playbackGain } };
		root.render(<LocalProcessingOverlays activeSurface="text-to-speech" fileService={{ isDesktop: true, bridge }}
			capabilities={{ assistanceAssets: true }} snapshot={snapshot} copy={copy} locale="en"
			selectedMediaPreparation={null} textToSpeechProjectPort={projectPort} setActiveSurface={() => undefined} />);
	};
	const button = (label: string): ReactTestElement => {
		const found = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === label);
		assert.ok(found, `Missing ${label}`);
		return found;
	};
	const generate = async (): Promise<HTMLAudioElement> => {
		await act(async () => { reactProps(button('Generate preview')).onClick({}); });
		for (let attempt = 0; attempt < 100 && !dom.find('audio') && !dom.find('[role="alert"]'); attempt += 1) {
			await act(async () => new Promise<void>(resolve => setTimeout(resolve, 10)));
		}
		assert.ok(dom.find('audio'), dom.container.textContent);
		return dom.one('audio') as unknown as HTMLAudioElement;
	};
	try {
		await act(async () => render());
		for (let attempt = 0; attempt < 100 && !dom.find('textarea'); attempt += 1) {
			await act(async () => new Promise<void>(resolve => setTimeout(resolve, 10)));
		}
		await act(async () => reactProps(dom.one('textarea')).onChange({ currentTarget: { value: 'A normal narration preview.' } }));
		const audio = await generate();
		assert.equal(audio.volume ?? 1, 1, 'the native unity-volume control remains healthy');
		Object.defineProperty(audio, 'paused', { configurable: true, writable: true, value: false });
		playbackGain = 0;
		await act(async () => render());
		assert.equal(audio.volume ?? 1, 0, 'the actual owned preview receives the shared mute');
		assert.equal(dom.one('audio'), audio);
		audio.pause = () => Object.defineProperty(audio, 'paused', { configurable: true, writable: true, value: true });
		audio.pause();
		playbackGain = 0.25;
		await act(async () => render());
		assert.equal(audio.volume, 0.25);
		assert.equal(audio.paused, true, 'gain changes do not resume the preview');
		assert.equal(dom.one('audio'), audio);
		await act(async () => reactProps(dom.one('textarea')).onChange({ currentTarget: { value: 'Another preview while muted.' } }));
		playbackGain = 0;
		await act(async () => render());
		const replacement = await generate();
		assert.notEqual(replacement, audio);
		assert.equal(replacement.volume ?? 1, 0, 'newly generated previews inherit current gain');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
