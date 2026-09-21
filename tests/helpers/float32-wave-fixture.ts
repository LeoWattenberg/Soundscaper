/* SPDX-License-Identifier: AGPL-3.0-only */

/** Construct one minimal IEEE-float RIFF body for codec decode fixtures. */
export function floatWave(sampleRate: number, channelCount: number, pcm: Uint8Array): Uint8Array {
	const output = new Uint8Array(44 + pcm.byteLength);
	output.set([0x52, 0x49, 0x46, 0x46], 0);
	output.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
	output.set([0x64, 0x61, 0x74, 0x61], 36);
	const view = new DataView(output.buffer);
	view.setUint32(4, output.byteLength - 8, true);
	view.setUint32(16, 16, true);
	view.setUint16(20, 3, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * channelCount * 4, true);
	view.setUint16(32, channelCount * 4, true);
	view.setUint16(34, 32, true);
	view.setUint32(40, pcm.byteLength, true);
	output.set(pcm, 44);
	return output;
}
