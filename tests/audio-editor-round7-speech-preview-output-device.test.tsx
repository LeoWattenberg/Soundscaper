/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioEditorListeningGainContext, AudioEditorListeningOutputDeviceContext,
	AudioEditorListeningPreview } from '../src/common/editor/ui/audio-editor-listening-preview.tsx';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

for (const initialOutput of ['', 'speakers-a', 'native:asio']) test(`mounted listening media routes initial/live output ${initialOutput || 'default'} while preserving gain and paused transport`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorMedia = Object.getOwnPropertyDescriptor(globalThis, 'HTMLMediaElement');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const routes: string[] = [];
	const priorSetSink = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'setSinkId');
	Object.defineProperty(ReactTestElement.prototype, 'setSinkId', { configurable: true,
		value: async (deviceId: string) => { routes.push(deviceId); } });
	Object.defineProperty(globalThis, 'HTMLMediaElement', { configurable: true, value: ReactTestElement });
	const root = createRoot(dom.container as unknown as Element);
	const render = async (output: string, gain = .25): Promise<void> => {
		await act(async () => root.render(<AudioEditorListeningGainContext.Provider value={gain}>
			<AudioEditorListeningOutputDeviceContext.Provider value={output}>
				<AudioEditorListeningPreview controls src="blob:normal-generated-speech" />
			</AudioEditorListeningOutputDeviceContext.Provider>
		</AudioEditorListeningGainContext.Provider>));
	};
	try {
		await render(initialOutput);
		assert.deepEqual(routes, [initialOutput.startsWith('native:') ? '' : initialOutput], 'normal mounted native media inherits the editor output');
		const player = dom.one('audio') as unknown as HTMLAudioElement;
		assert.equal(player.volume, .25);
		Object.defineProperty(player, 'paused', { configurable: true, value: true });
		player.currentTime = .25;
		await render('speakers-b', 0);
		assert.deepEqual(routes, [initialOutput.startsWith('native:') ? '' : initialOutput, 'speakers-b']);
		assert.equal(player.volume, 0);
		assert.equal(player.paused, true);
		assert.equal(player.currentTime, .25);
		assert.equal(dom.one('audio') === (player as unknown as ReactTestElement), true);
	} finally {
		await act(async () => root.unmount());
		if (priorSetSink) Object.defineProperty(ReactTestElement.prototype, 'setSinkId', priorSetSink);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'setSinkId');
		if (priorMedia) Object.defineProperty(globalThis, 'HTMLMediaElement', priorMedia);
		else Reflect.deleteProperty(globalThis, 'HTMLMediaElement');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('mounted native speech controls wait for the latest speaker allocation and retire pending output safely', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorMedia = Object.getOwnPropertyDescriptor(globalThis, 'HTMLMediaElement');
	const priorSink = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'setSinkId');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	let releaseFirst: (() => void) | undefined;
	const firstOutput = new Promise<void>(resolve => { releaseFirst = resolve; });
	let rejectRetired: ((error: Error) => void) | undefined;
	const retiredOutput = new Promise<void>((_resolve, reject) => { rejectRetired = reject; });
	void retiredOutput.catch(() => undefined);
	const routes: string[] = [];
	Object.defineProperty(ReactTestElement.prototype, 'setSinkId', { configurable: true,
		value: async (deviceId: string) => {
			routes.push(deviceId);
			if (deviceId === 'speakers-a') await firstOutput;
			if (deviceId === 'speakers-c') await retiredOutput;
		} });
	Object.defineProperty(globalThis, 'HTMLMediaElement', { configurable: true, value: ReactTestElement });
	const root = createRoot(dom.container as unknown as Element);
	const render = async (output: string): Promise<void> => {
		await act(async () => root.render(<AudioEditorListeningOutputDeviceContext.Provider value={output}>
			<AudioEditorListeningPreview controls src="blob:normal-generated-speech" />
		</AudioEditorListeningOutputDeviceContext.Provider>));
	};
	let unmounted = false;
	try {
		await render('speakers-a');
		assert.deepEqual(routes, ['speakers-a']);
		assert.equal(dom.one('audio').hasAttribute('controls'), false, 'native Play waits for its actual output allocation');
		await render('speakers-b');
		assert.deepEqual(routes, ['speakers-a'], 'native allocations remain serialized');
		assert.equal(dom.one('audio').hasAttribute('controls'), false);
		await act(async () => { releaseFirst?.(); await firstOutput; });
		assert.deepEqual(routes, ['speakers-a', 'speakers-b']);
		assert.equal(dom.one('audio').hasAttribute('controls'), true, 'only the latest chosen device admits native playback');
		await render('speakers-c');
		assert.equal(dom.one('audio').hasAttribute('controls'), false);
		await act(async () => root.unmount()); unmounted = true;
		await act(async () => { rejectRetired?.(new Error('The retired output disappeared.')); await retiredOutput.catch(() => undefined); });
		assert.deepEqual(routes, ['speakers-a', 'speakers-b', 'speakers-c']);
	} finally {
		releaseFirst?.();
		if (!unmounted) await act(async () => root.unmount());
		if (priorSink) Object.defineProperty(ReactTestElement.prototype, 'setSinkId', priorSink);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'setSinkId');
		if (priorMedia) Object.defineProperty(globalThis, 'HTMLMediaElement', priorMedia);
		else Reflect.deleteProperty(globalThis, 'HTMLMediaElement');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
