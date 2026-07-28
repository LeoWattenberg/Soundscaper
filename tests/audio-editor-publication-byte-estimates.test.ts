import assert from 'node:assert/strict';
import test from 'node:test';

import {
	checkedPublicationByteSum,
	estimateEncodedDerivativePublication,
	estimatePcmRenderPublication,
} from '../src/common/editor/publication-byte-estimates.ts';
import {
	PCM_ENCODING_RAW_F32LE,
	PcmContainerWriter,
	crc32,
} from '../src/common/editor/wavpack/index.js';
import { generateWaveformPeaksFallback } from '../src/common/editor/controller/waveform-analysis.ts';

test('encoded derivative publication reports its exact bounded binary payload', () => {
	assert.deepEqual(estimateEncodedDerivativePublication(123), {
		binaryPayload: {
			bytes: 123,
			certainty: 'exact',
			scope: 'encoded-derivative-binary-payload',
		},
		peakResidentBytes: null,
	});
});

test('PCM render publication bounds canonical containers and exact v4 peak arrays', () => {
	assert.deepEqual(estimatePcmRenderPublication({
		frameCount: 4,
		channelCount: 1,
		chunkFrames: 65_536,
		includeWaveformPeaks: true,
	}), {
		rawPcmBytes: 16,
		chunkCount: 1,
		pcmContainer: {
			bytes: 104,
			certainty: 'upper-bound',
			scope: 'canonical-opfs-pcm-container',
		},
		waveformPeaks: {
			bytes: 108,
			certainty: 'exact',
			scope: 'waveform-v4-float32-payload',
		},
		binaryPayload: {
			bytes: 212,
			certainty: 'upper-bound',
			scope: 'pcm-and-waveform-binary-payload',
		},
		peakResidentBytes: null,
	});

	const boundary = estimatePcmRenderPublication({
		frameCount: 65_537,
		channelCount: 2,
		chunkFrames: 65_536,
		includeWaveformPeaks: true,
	});
	assert.equal(boundary.pcmContainer.bytes, 524_408);
	assert.equal(boundary.waveformPeaks.bytes, 377_040);
	assert.equal(boundary.binaryPayload.bytes, 901_448);

	const peaks = generateWaveformPeaksFallback([new Float32Array(4)]);
	const actualPeakBytes = peaks.levels.reduce((total, level) => total + level.channels.reduce(
		(channelTotal, channel) => channelTotal
			+ channel.minimums.byteLength
			+ channel.maximums.byteLength
			+ channel.rms.byteLength,
		0,
	), 0);
	assert.equal(actualPeakBytes, 108);
});

test('the PCM container bound equals an all-raw canonical file', async () => {
	const parts: BlobPart[] = [];
	const writable = {
		async write(part: BlobPart) { parts.push(part); },
		async close() {},
	};
	const writer = new PcmContainerWriter(writable as never, {
		channelCount: 2,
		sampleRate: 48_000,
		chunkFrames: 2,
	} as never);
	for (const frames of [2, 2, 1]) {
		const payload = new ArrayBuffer(frames * 2 * Float32Array.BYTES_PER_ELEMENT);
		await writer.write({
			encoding: PCM_ENCODING_RAW_F32LE,
			payload,
			frames,
			pcmCrc32: crc32(payload),
		} as never);
	}
	await writer.close();
	const estimate = estimatePcmRenderPublication({
		frameCount: 5,
		channelCount: 2,
		chunkFrames: 2,
	});
	assert.equal(new Blob(parts).size, 176);
	assert.equal(new Blob(parts).size, estimate.pcmContainer.bytes);
	assert.equal(estimate.waveformPeaks.bytes, 0);
});

test('publication estimates reject invalid and unsafe byte geometry', () => {
	assert.equal(checkedPublicationByteSum(1, 2, 3), 6);
	assert.throws(
		() => checkedPublicationByteSum(Number.MAX_SAFE_INTEGER, 1),
		/safe integer range/u,
	);
	assert.equal(estimateEncodedDerivativePublication(0).binaryPayload.bytes, 0);
	for (const input of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => estimateEncodedDerivativePublication(input), /safe non-negative integer/u);
	}
	for (const options of [
		{ frameCount: 0, channelCount: 1, chunkFrames: 1 },
		{ frameCount: 1, channelCount: 0, chunkFrames: 1 },
		{ frameCount: 1, channelCount: 65, chunkFrames: 1 },
		{ frameCount: 1, channelCount: 1, chunkFrames: 0 },
		{ frameCount: 1, channelCount: 1, chunkFrames: 65_537 },
	]) {
		assert.throws(() => estimatePcmRenderPublication(options), /PCM publication/u);
	}
	assert.throws(
		() => estimatePcmRenderPublication({
			frameCount: 0x1_0000_0000,
			channelCount: 1,
			chunkFrames: 1,
		}),
		/container chunk count/u,
	);
	assert.throws(
		() => estimatePcmRenderPublication({
			frameCount: Number(0xffff_ffffn * 65_536n),
			channelCount: 64,
			chunkFrames: 65_536,
		}),
		/safe integer range/u,
	);
});
