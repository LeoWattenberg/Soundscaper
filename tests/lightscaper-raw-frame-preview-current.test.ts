/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	admitFramescaperImageProjectBinThumbnailResourcesTimelineImage as bin,
	admitFramescaperImageTimelineFilmstripResourcesTimelineImage as filmstrip,
	admitFramescaperImageTimelinePreviewResourcesTimelineImage as preview,
} from '../src/framescaper/editor-selected-timeline-image-image-preview-resources.ts';
import { materializeFramescaperCurrentImageThumbnail } from '../src/framescaper/timeline-image-current-frame-source.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { editableImageFixture } from './helpers/framescaper-editable-image-current-fixture.ts';

test('actual Source4 RAW preview, filmstrip and Project Bin admission use the phasewise native ceiling and deliver a real worker thumbnail', { timeout: 20_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1({ orientation: 6 });
	try { await f.withDefaultTransport(async () => {
		const context = { source: f.source, width: 32, height: 32 };
		for (const budget of [bin(f.source, 32, 32), filmstrip([context]), preview([context])]) {
			assert.ok(budget.totalBytes > 512n * 1024n * 1024n); assert.ok(budget.totalBytes <= 1024n * 1024n * 1024n);
			assert.equal(budget.sourceCount, 1); assert.equal(budget.contextCount, 1);
		}
		const output = await materializeFramescaperCurrentImageThumbnail({ loadMediaAsset: async () => f.body }, f.source, 0n, 32, 32);
		try {
			const expected = f.native.words.map((word, index) => { if (index % 4 === 3) return 255; const value = Math.fround(word / 65535);
				return Math.round(255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055)); });
			assert.deepEqual([...output], expected); assert.equal(f.workers.active(), 0);
		} finally { output.fill(0); }
	}); } finally { await f.close(); }
});

test('mixed Source4 and legacy image previews charge all resident images under the native aggregate ceiling', { timeout: 20_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1(), legacy = editableImageFixture({ crop: false });
	try {
		const budget = preview([{ source: f.source, width: 32, height: 32 }, { source: legacy.source, width: 2, height: 2 }]);
		assert.equal(budget.sourceCount, 2); assert.equal(budget.contextCount, 2);
		assert.equal(budget.snapshotBytes, BigInt(f.source.assetByteLength + legacy.source.assetByteLength));
		assert.ok(budget.totalBytes > 512n * 1024n * 1024n); assert.ok(budget.totalBytes <= 1024n * 1024n * 1024n);
	} finally { await f.close(); }
});

test('native preview policy refuses aggregate output beyond 1 GiB and preserves the exact legacy 512 MiB ceiling', { timeout: 20_000 }, async () => {
	const f = await createRawFrameFixtureCurrentV1(), legacy = editableImageFixture({ crop: false });
	try {
		assert.throws(() => bin(f.source, 12_000, 12_000), /1 GiB/u);
		assert.throws(() => bin(legacy.source, 12_000, 12_000), /512 MiB/u);
		const old = bin(legacy.source, 2, 2); assert.ok(old.totalBytes < 512n * 1024n * 1024n);
	} finally { await f.close(); }
});
