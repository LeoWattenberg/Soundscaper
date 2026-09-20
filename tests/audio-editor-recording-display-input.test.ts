/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
	requestDisplayInput,
	supportsDisplayAudioCapture,
} from '../src/common/editor/recording-display-input.ts';

function installCaptureController(context: TestContext, value: unknown): void {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'CaptureController');
	Object.defineProperty(globalThis, 'CaptureController', { configurable: true, value });
	context.after(() => {
		if (previous) Object.defineProperty(globalThis, 'CaptureController', previous);
		else Reflect.deleteProperty(globalThis, 'CaptureController');
	});
}

test('uses display-audio capability detection instead of browser sniffing', () => {
	const mediaDevices = { getDisplayMedia: () => Promise.resolve({}) };
	assert.equal(supportsDisplayAudioCapture(mediaDevices), true);
	assert.equal(supportsDisplayAudioCapture({}), false);
});

test('display recording keeps focus on the editor before the permission prompt opens', async (context) => {
	const controllers: CaptureControllerStub[] = [];
	class CaptureControllerStub {
		focus: string | null = null;
		constructor() { controllers.push(this); }
		setFocusBehavior(behavior: string): void { this.focus = behavior; }
	}
	installCaptureController(context, CaptureControllerStub);
	const stream = { id: 'shared-audio-and-video' } as MediaStream;
	const mediaDevices = {
		getDisplayMedia(options: DisplayMediaStreamOptions & { controller?: CaptureControllerStub }) {
			assert.equal(this, mediaDevices);
			assert.equal(options.controller, controllers.at(-1));
			assert.equal(options.controller?.focus, 'no-focus-change');
			return Promise.resolve(stream);
		},
	};
	assert.equal(await requestDisplayInput({ mediaDevices }), stream);
	assert.equal(await requestDisplayInput({ mediaDevices }), stream);
	assert.equal(controllers.length, 2, 'a different source requires a fresh capture controller');
	assert.notEqual(controllers[0], controllers[1]);
});

test('display recording works when conditional focus is unavailable or unsupported', async (context) => {
	const stream = { id: 'shared-audio-and-video' } as MediaStream;
	const mediaDevices = {
		getDisplayMedia(options: DisplayMediaStreamOptions) {
			assert.equal(Reflect.get(options, 'controller'), undefined);
			return Promise.resolve(stream);
		},
	};
	installCaptureController(context, undefined);
	assert.equal(await requestDisplayInput({ mediaDevices }), stream);
	Object.defineProperty(globalThis, 'CaptureController', { configurable: true, value: class {
		setFocusBehavior(): never { throw new DOMException('Unsupported focus behavior', 'NotSupportedError'); }
	} });
	assert.equal(await requestDisplayInput({ mediaDevices }), stream);
	Object.defineProperty(globalThis, 'CaptureController', { configurable: true, value: class {
		constructor() { throw new Error('Capture controllers are unavailable on this host.'); }
	} });
	assert.equal(await requestDisplayInput({ mediaDevices }), stream);
});

test('display recording preserves the browser failure after the sharing prompt', async (context) => {
	installCaptureController(context, undefined);
	const failure = new DOMException('Could not start audio source', 'NotReadableError');
	await assert.rejects(requestDisplayInput({
		mediaDevices: { getDisplayMedia: () => Promise.reject(failure) },
	}), (error: unknown) => error === failure);
});
