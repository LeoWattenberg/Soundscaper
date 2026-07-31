/* SPDX-License-Identifier: AGPL-3.0-only */

import { DESKTOP_DIRECT_BWF_SMOKE_FIXTURE } from '../../scripts/lib/desktop-direct-bwf-smoke-file.mjs';

export function validDesktopDirectBwfFileEvidence() {
	const output = DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.output;
	return {
		byteLength: output.byteLength,
		sha256: 'c'.repeat(64),
		maximumReadChunkBytes: 1024 * 1024,
		riff: {
			riffId: 'RIFF', riffBytes: output.byteLength, waveId: 'WAVE',
			bextId: 'bext', bextOffset: 12, bextPayloadBytes: 689, bextPadBytes: 1,
			formatId: 'fmt ', formatOffset: 710, formatBytes: 40, formatTag: 0xfffe,
			channelCount: 4, sampleRate: 384_000, byteRate: 3_072_000, blockAlign: 8,
			bitsPerSample: 16, extensionBytes: 22, validBitsPerSample: 16, channelMask: 0x0f,
			subformatGuid: '0100000000001000800000aa00389b71',
			dataId: 'data', dataOffset: 758, dataBytes: output.dataBytes,
			pcmOffset: output.headerByteLength, dataPadBytes: 0, trailingBytes: 0,
			frameCount: output.frameCount,
		},
		bext: { ...DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.bext },
		signal: {
			frameCount: output.frameCount,
			channelComparisons: output.frameCount * 3,
			channelMismatchSamples: 0,
			maximumCarryBytes: 7,
			nonzeroFrames: 6_300_000,
			positiveFrames: 3_150_000,
			negativeFrames: 3_150_000,
			zeroCrossings: 7_260,
			peakAbsoluteSample: 10_000,
			sampleSum: 0,
			sampleSquareSum: output.frameCount * 7_000 ** 2,
			meanSample: 0,
			rmsSample: 7_000,
		},
	};
}
