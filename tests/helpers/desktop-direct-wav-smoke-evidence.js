/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE,
	DESKTOP_DIRECT_BW64_SMOKE_FIXTURE,
	DESKTOP_DIRECT_BWF_SMOKE_FIXTURE,
	DESKTOP_DIRECT_WAV_SMOKE_FIXTURE,
	DESKTOP_DIRECT_WAV_SMOKE_MODE,
} from '../../scripts/lib/desktop-direct-wav-smoke.mjs';

export function validDesktopDirectWavPayload(invocation) {
	return {
		schemaVersion: 1,
		mode: DESKTOP_DIRECT_WAV_SMOKE_MODE,
		productId: invocation.productId,
		token: invocation.plan.token,
		renderer: {
			imported: true,
			completed: true,
			cancelled: true,
			aiffCompleted: true,
			bwfCompleted: true,
			bw64Completed: true,
			realtimeCount: 5,
			downloadVisible: false,
		},
		native: {
			selectionPurposes: Array.from({ length: 5 }, () => 'audio-pcm-mix'),
			completedBytes: DESKTOP_DIRECT_WAV_SMOKE_FIXTURE.output.byteLength,
			completedAiffBytes: DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE.output.byteLength,
			completedBwfBytes: DESKTOP_DIRECT_BWF_SMOKE_FIXTURE.output.byteLength,
			completedBw64Bytes: DESKTOP_DIRECT_BW64_SMOKE_FIXTURE.output.byteLength,
			aiffChoiceValidated: true,
			bwfChoiceValidated: true,
			bw64ChoiceValidated: true,
			cancelledAbsent: true,
			stagingFilesRemaining: 0,
		},
	};
}

export function validDesktopDirectWavSignalEvidence() {
	return {
		frameCount: 6_335_992, channelComparisons: 95_039_880,
		channelMismatchSamples: 0, maximumCarryBytes: 20,
		nonzeroFrames: 6_335_333, positiveFrames: 3_167_671,
		negativeFrames: 3_167_662, zeroCrossings: 7_259,
		peakAbsoluteSample: 9_830, sampleSum: 2_612,
		sampleSquareSum: 306_120_561_101_570, meanSample: 0.000_412_247_995_262_620_3,
		rmsSample: 6_950.866_384_869_063,
	};
}

export function validDesktopDirectAiffFileEvidence() {
	const output = DESKTOP_DIRECT_AIFF_SMOKE_FIXTURE.output;
	return {
		byteLength: output.byteLength, sha256: 'b'.repeat(64), maximumReadChunkBytes: 1024 * 1024,
		aiff: {
			formId: 'FORM', formBytes: output.byteLength, typeId: 'AIFF', commId: 'COMM', commBytes: 18,
			channelCount: output.channelCount, frameCount: output.frameCount, bitsPerSample: output.bitDepth,
			sampleRateHex: output.sampleRateHex, soundId: 'SSND', soundBytes: output.dataBytes + 8,
			offset: 0, blockSize: 0, pcmOffset: output.headerBytes, pcmBytes: output.dataBytes,
			dataPadBytes: 0, trailingBytes: 0,
		},
		signal: validDesktopDirectWavSignalEvidence(),
	};
}
