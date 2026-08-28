/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_IMAGE_ASSET_MAGIC,
	FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
	FRAMESCAPER_IMAGE_TICKS_PER_SECOND,
	mapFramescaperImageTimelineFrameV1,
	normalizeFramescaperImageClipV1,
	normalizeFramescaperImageSourceV1,
} from '../src/common/editor/timeline-image-model.ts';

const DIGEST_A = '11'.repeat(32);
const DIGEST_B = '22'.repeat(32);
const DIGEST_C = '33'.repeat(32);

test('V30 image source normalization closes and freezes the immutable asset descriptor', () => {
	const source = normalizeFramescaperImageSourceV1(sourceFixture());
	assert.equal(FRAMESCAPER_IMAGE_ASSET_MAGIC, 'FSCIAB01');
	assert.equal(FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, 'application/vnd.framescaper.image-asset');
	assert.equal(FRAMESCAPER_IMAGE_TICKS_PER_SECOND, 1_000_000);
	assert.deepEqual(source, sourceFixture());
	assert.equal(Object.isFrozen(source), true);
	assert.equal(Object.isFrozen(source.original), true);
	assert.equal(Object.isFrozen(source.canonical), true);

	assert.throws(() => normalizeFramescaperImageSourceV1({
		...sourceFixture(), surprise: true,
	}), /field|unsupported|unexpected/iu);
	assert.throws(() => normalizeFramescaperImageSourceV1({
		...sourceFixture(), storageKey: 'another-image',
	}), /storage key.*source id/iu);
	assert.throws(() => normalizeFramescaperImageSourceV1({
		...sourceFixture(), mimeType: 'image/png',
	}), /asset MIME/iu);
	assert.throws(() => normalizeFramescaperImageSourceV1({
		...sourceFixture(), original: { ...sourceFixture().original, fileName: '../unsafe.png' },
	}), /file name/iu);
	assert.throws(() => normalizeFramescaperImageSourceV1({
		...sourceFixture(), canonical: { ...sourceFixture().canonical, width: 8_193 },
	}), /width|dimension/iu);
	assert.throws(() => normalizeFramescaperImageSourceV1({
		...sourceFixture(), canonical: { ...sourceFixture().canonical, width: 8_192, height: 8_192 },
	}), /pixel/iu);
	assert.throws(() => normalizeFramescaperImageSourceV1({
		...sourceFixture(), canonical: { ...sourceFixture().canonical, durationTicks: '05000000' },
	}), /duration/iu);
});

test('V30 image clip normalization owns a decimal source tick without changing legacy still fields', () => {
	const clip = normalizeFramescaperImageClipV1(clipFixture());
	assert.deepEqual(clip, clipFixture());
	assert.equal(Object.isFrozen(clip), true);
	assert.throws(() => normalizeFramescaperImageClipV1({
		...clipFixture(), sourceStartTicks: 0,
	}), /source start ticks/iu);
	assert.throws(() => normalizeFramescaperImageClipV1({
		...clipFixture(), sourceStartTicks: '00',
	}), /source start ticks/iu);
	assert.throws(() => normalizeFramescaperImageClipV1({
		...clipFixture(), sequenceStartFrame: Number.MAX_SAFE_INTEGER,
	}), /sequence range/iu);
});

test('the shared mapper samples exact microsecond timing and holds the final frame', () => {
	const clip = normalizeFramescaperImageClipV1({ ...clipFixture(), sourceStartTicks: '1' });
	const timings = Object.freeze([
		Object.freeze({ presentationTicks: 0n, durationTicks: 33_334n }),
		Object.freeze({ presentationTicks: 33_334n, durationTicks: 16_666n }),
	]);
	assert.deepEqual(mapFramescaperImageTimelineFrameV1({
		clip, sequenceFrame: 10, sequenceRate: { num: 30, den: 1 }, timings,
	}), { sourceTicks: 1n, frameIndex: 0 });
	assert.deepEqual(mapFramescaperImageTimelineFrameV1({
		clip, sequenceFrame: 11, sequenceRate: { num: 30, den: 1 }, timings,
	}), { sourceTicks: 33_334n, frameIndex: 1 });
	assert.deepEqual(mapFramescaperImageTimelineFrameV1({
		clip, sequenceFrame: 39, sequenceRate: { num: 30, den: 1 }, timings,
	}), { sourceTicks: 966_667n, frameIndex: 1 });
	assert.throws(() => mapFramescaperImageTimelineFrameV1({
		clip, sequenceFrame: 9, sequenceRate: { num: 30, den: 1 }, timings,
	}), /outside.*clip/iu);
	assert.throws(() => mapFramescaperImageTimelineFrameV1({
		clip, sequenceFrame: 10, sequenceRate: { num: 60, den: 2 }, timings,
	}), /reduced/iu);
	assert.throws(() => mapFramescaperImageTimelineFrameV1({
		clip, sequenceFrame: 10, sequenceRate: { num: 30, den: 1 },
		timings: [timings[0]!, { presentationTicks: 34_000n, durationTicks: 1n }],
	}), /continuous/iu);
});

function sourceFixture() {
	return {
		schemaVersion: 1 as const,
		kind: 'image' as const,
		id: 'image-source-1',
		name: 'Animated sample',
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: 'image-source-1',
		contentSha256: DIGEST_A,
		assetByteLength: 4_096,
		original: {
			fileName: 'sample.APng', mimeType: 'image/png', recognizedFormat: 'apng',
			byteLength: 128, sha256: DIGEST_B,
		},
		canonical: {
			width: 640, height: 360, hasAlpha: true, frameCount: 2,
			durationTicks: '50000', timingMode: 'embedded' as const,
		},
		conversionReceiptSha256: DIGEST_C,
	};
}

function clipFixture() {
	return {
		schemaVersion: 1 as const,
		kind: 'image' as const,
		id: 'image-clip-1',
		sourceId: 'image-source-1',
		sequenceId: 'sequence-1',
		sequenceStartFrame: 10,
		sequenceFrameCount: 30,
		sourceStartTicks: '0',
	};
}
