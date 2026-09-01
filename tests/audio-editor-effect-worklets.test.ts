/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { warmAudacityWorklet } from '../src/common/editor/engine/effect-worklets.ts';

test('Audacity worklet warm-up rejects and disconnects when readiness never arrives', async () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode');
	let disconnected = false;
	class SilentAudioWorkletNode {
		readonly port = { onmessage: null, start() {} };
		onprocessorerror: (() => void) | null = null;
		disconnect(): void { disconnected = true; }
	}
	Object.defineProperty(globalThis, 'AudioWorkletNode', {
		configurable: true,
		value: SilentAudioWorkletNode,
	});
	try {
		const module = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
		await assert.rejects(
			() => warmAudacityWorklet({} as BaseAudioContext, module, 1),
			/Audacity real-time processor timed out/u,
		);
		assert.equal(disconnected, true);
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'AudioWorkletNode', descriptor);
		else Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
	}
});
