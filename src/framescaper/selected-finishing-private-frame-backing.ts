/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderRgbaFrameV13 as Frame } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';

const FILL = Uint8Array.prototype.fill;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** Only register newly owned copies or owner-returned frames. Capture and
 * injected effect callback results remain borrowed until separately copied. */
export function createSelectedFinishingPrivateFrameBacking() {
	const pixels = new Set<Uint8Array<ArrayBuffer>>();
	return Object.freeze({
		retain(frame: Frame): Frame { pixels.add(frame.pixels); return frame; },
		retire(): void {
			for (const view of pixels) if (Reflect.apply(BUFFER_SIZE, view.buffer, []) !== 0) Reflect.apply(FILL, view, [0]);
			pixels.clear();
		},
	});
}
