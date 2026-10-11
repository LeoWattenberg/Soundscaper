/* SPDX-License-Identifier: AGPL-3.0-only */

/** A native PCM fixture whose exactly representable ramp changes sign between stereo channels. */
export function motionWavFixture(channels = 1, frames = 4800): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(44 + frames * channels * 2); const view = new DataView(bytes.buffer);
	const text = (at: number, value: string) => { bytes.set(new TextEncoder().encode(value), at); };
	text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, 48000, true); view.setUint32(28, 48000 * channels * 2, true);
	view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.length - 44, true);
	for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
		view.setInt16(44 + (frame * channels + channel) * 2, (frame % 127 - 63) * 256 * (channel % 2 ? -1 : 1), true);
	}
	return bytes;
}
