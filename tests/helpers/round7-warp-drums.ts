/* SPDX-License-Identifier: AGPL-3.0-only */

export function round7DrumPcm(): Float32Array {
	const pcm = new Float32Array(48_000);
	for (const onset of [9_000, 19_000, 30_000, 42_000]) {
		for (let offset = 0; offset < 1_200; offset++) {
			pcm[onset + offset] = .8 * Math.sin(offset * Math.PI / 24) * (1 - offset / 1_200);
		}
	}
	return pcm;
}

export function round7DrumWav(): Buffer {
	const pcm = round7DrumPcm();
	const bytes = Buffer.alloc(44 + pcm.length * 2);
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(48_000, 24); bytes.writeUInt32LE(96_000, 28);
	bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
	bytes.writeUInt32LE(pcm.length * 2, 40);
	for (let frame = 0; frame < pcm.length; frame++) bytes.writeInt16LE(Math.round((pcm[frame] ?? 0) * 32_767), 44 + frame * 2);
	return bytes;
}
