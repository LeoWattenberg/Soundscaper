/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decodeFramescaperBrowserNativeImageV1,
	type FramescaperBrowserNativeImageDecodeSessionV1,
} from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model-v30.ts';

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1);

test('browser-native decode creates one authenticated mixed-timing frame pack', async () => {
	let closed = false;
	const session: FramescaperBrowserNativeImageDecodeSessionV1 = {
		metadata: { width: 2, height: 1, frameCount: 2, topology: 'animated', runtimeVersion: 'test-1' },
		async decodeFrame(index) {
			return index === 0
				? { rgba: Uint8Array.of(21, 34, 55, 0, 1, 2, 3, 255), durationMicroseconds: null }
				: { rgba: Uint8Array.of(8, 9, 10, 255, 11, 12, 13, 255), durationMicroseconds: 250_000 };
		},
		close() { closed = true; },
	};
	const decoded = await decodeFramescaperBrowserNativeImageV1({
		bytes: PNG, fileName: 'motion.png', mimeTypeHint: 'text/plain',
		open: async ({ format, mimeType }) => {
			assert.equal(format, 'png');
			assert.equal(mimeType, 'image/png');
			return session;
		},
	});
	assert.equal(closed, true);
	assert.equal(decoded.recognizedFormat, 'png');
	assert.equal(decoded.canonicalMimeType, 'image/png');
	assert.equal(decoded.publication.timingMode, 'mixed');
	assert.equal(decoded.publication.durationTicks, '5250000');
	assert.equal(decoded.publication.frameCount, 2);
	assert.equal(decoded.notices.length, 1);
	const source = {
		schemaVersion: 1 as const, kind: 'image' as const, id: 'image-source-test',
		name: 'motion.png', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: 'image-source-test', contentSha256: decoded.publication.contentSha256,
		assetByteLength: decoded.publication.assetByteLength,
		original: {
			fileName: 'motion.png', mimeType: 'text/plain', recognizedFormat: 'png',
			byteLength: PNG.byteLength, sha256: decoded.publication.originalSha256,
		},
		canonical: {
			width: 2, height: 1, hasAlpha: true, frameCount: 2,
			durationTicks: '5250000', timingMode: 'mixed' as const,
		},
		conversionReceiptSha256: decoded.publication.conversionReceiptSha256,
	};
	const reader = await openFramescaperImageFramePackV1({
		source,
		read: (offset, length) => decoded.publication.bytes.slice(offset, offset + length),
	});
	assert.deepEqual(reader.timings, [
		{ presentationTicks: 0n, durationTicks: 5_000_000n },
		{ presentationTicks: 5_000_000n, durationTicks: 250_000n },
	]);
	assert.deepEqual(await reader.readFrame(0), Uint8Array.of(0, 0, 0, 0, 1, 2, 3, 255));
});

test('browser-native decode rejects excluded bytes before opening a decoder', async () => {
	let opened = false;
	await assert.rejects(() => decodeFramescaperBrowserNativeImageV1({
		bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
		fileName: 'drawing.png', mimeTypeHint: 'image/png',
		open: async () => { opened = true; throw new Error('must not open'); },
	}), /excluded SVG/iu);
	assert.equal(opened, false);
});

test('browser-native decode closes a failing decoder session', async () => {
	let closed = false;
	await assert.rejects(() => decodeFramescaperBrowserNativeImageV1({
		bytes: PNG, fileName: 'bad.png', mimeTypeHint: 'image/png',
		open: async () => ({
			metadata: { width: 1, height: 1, frameCount: 1, topology: 'single', runtimeVersion: 'test-1' },
			async decodeFrame() { throw new Error('decode stopped'); },
			close() { closed = true; },
		}),
	}), /decode stopped/iu);
	assert.equal(closed, true);
});
