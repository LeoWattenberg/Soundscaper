/* SPDX-License-Identifier: AGPL-3.0-only */

import { DESKTOP_DIRECT_BW64_SMOKE_FIXTURE } from '../../scripts/lib/desktop-direct-bw64-smoke-file.mjs';

export function validDesktopDirectBw64FileEvidence() {
	const fixture = DESKTOP_DIRECT_BW64_SMOKE_FIXTURE;
	return {
		byteLength: fixture.output.byteLength,
		sha256: 'c'.repeat(64),
		maximumReadChunkBytes: 1024 * 1024,
		riff: {
			riffId: 'BW64', riffBytes32: 0xffff_ffff, riffBytes: fixture.output.byteLength,
			waveId: 'WAVE', ds64Id: 'ds64', ds64Offset: fixture.offsets.ds64,
			ds64PayloadBytes: fixture.output.ds64PayloadBytes,
			dataBytes: fixture.output.dataBytes, sampleCount: 0, tableLength: 0,
			bextId: 'bext', bextOffset: fixture.offsets.bext,
			bextPayloadBytes: fixture.output.bextPayloadBytes, bextPadBytes: 0,
			formatId: 'fmt ', formatOffset: fixture.offsets.format,
			formatBytes: fixture.output.formatBytes, formatTag: 1,
			channelCount: fixture.output.channelCount, sampleRate: fixture.output.sampleRate,
			byteRate: fixture.output.sampleRate * fixture.output.blockAlign,
			blockAlign: fixture.output.blockAlign, bitsPerSample: fixture.output.bitDepth,
			chnaId: 'chna', chnaOffset: fixture.offsets.chna,
			chnaPayloadBytes: fixture.output.chnaPayloadBytes, chnaPadBytes: 0,
			dataId: 'data', dataOffset: fixture.offsets.data, dataBytes32: 0xffff_ffff,
			pcmOffset: fixture.offsets.pcm, dataPadBytes: fixture.output.dataPadBytes,
			axmlId: 'axml', axmlOffset: fixture.offsets.axml,
			axmlPayloadBytes: fixture.output.axmlPayloadBytes, axmlPadBytes: 0,
			trailingBytes: 0, frameCount: fixture.output.frameCount,
		},
		bext: {
			...fixture.bext,
			payloadSha256: fixture.hashes.bextPayload,
		},
		chna: {
			numTracks: 6,
			numUids: 6,
			entries: Array.from({ length: 6 }, (_, index) => ({
				trackIndex: index + 1,
				uid: `ATU_${String(index + 1).padStart(8, '0')}`,
				trackRef: `AC_0001000${String(index + 1)}_00`,
				packRef: 'AP_00010003',
			})),
			payloadSha256: fixture.hashes.chnaPayload,
		},
		axml: {
			version: 'ITU-R_BS.2076-3',
			...fixture.adm,
			payloadSha256: fixture.hashes.axmlPayload,
		},
		signal: {
			frameCount: fixture.output.frameCount,
			channelComparisons: fixture.output.frameCount * 5,
			channelMismatchSamples: 0,
			maximumCarryBytes: 11,
			nonzeroFrames: 16_894_240,
			positiveFrames: 8_447_120,
			negativeFrames: 8_447_120,
			zeroCrossings: 19_359,
			peakAbsoluteSample: 9_830,
			sampleSum: 0,
			sampleSquareSum: 816_000_000_000_000,
			meanSample: 0,
			rmsSample: Math.sqrt(816_000_000_000_000 / fixture.output.frameCount),
		},
	};
}
