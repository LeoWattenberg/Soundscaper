/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorCodecRuntime as createBrowserRuntime } from '../src/common/editor/editor-codec-runtime.ts';
import {
	DesktopCodecRuntimeUnavailableError,
	createEditorCodecRuntime as createDesktopRuntime,
} from '../src/common/editor/editor-codec-runtime.desktop.ts';

test('browser codec composition retains the lazy browser FFmpeg runtime', () => {
	const runtime = createBrowserRuntime({ idleTimeoutMs: false });
	assert.equal(typeof runtime.load, 'function');
	assert.equal(typeof runtime.decode, 'function');
	assert.equal(typeof runtime.encodeFileToSink, 'function');
	runtime.dispose();
});

test('desktop codec composition fails closed without a main-process operation bridge', async () => {
	const runtime = createDesktopRuntime();
	const capabilities = runtime.capabilities();
	const formats = capabilities.formats as Readonly<Record<string, Readonly<{ available: boolean }>>>;
	assert.equal(formats.wav?.available, true);
	assert.equal(formats.mp3?.available, false);
	await assert.rejects(
		() => runtime.load(),
		(error) => error instanceof DesktopCodecRuntimeUnavailableError
			&& error.code === 'DESKTOP_CODEC_RUNTIME_UNAVAILABLE',
	);
	await assert.rejects(() => runtime.decode(new Blob()), /desktop codec providers are unavailable/iu);
	assert.equal(runtime.dispose(), undefined);
});
