import assert from 'node:assert/strict';
import test from 'node:test';

import { createWavHeader, inspectWavLayout } from '../src/common/editor/wav.js';

const UINT32_MAX = 0xffff_ffff;

test('20-bit WAV counts its extensible fmt chunk when choosing RIFF over RF64', () => {
	const options = { channelCount: 2, bitDepth: 20 as const, totalFrames: 715_827_873 };

	const layout = inspectWavLayout(options);
	assert.equal(layout.headerByteLength, 12 + 36 + 48 + 8);
	assert.ok(layout.riffSize > UINT32_MAX, `expected an oversized riffSize, got ${layout.riffSize}`);
	assert.equal(layout.container, 'rf64');
	assert.equal(layout.riffSize, layout.byteLength - 8);

	const header = createWavHeader(options);
	const view = viewOf(header);
	assert.equal(ascii(header, 0, 4), 'RF64');
	assert.equal(view.getUint32(4, true), UINT32_MAX);
	assert.equal(ascii(header, 12, 4), 'ds64');
	assert.equal(view.getBigUint64(20, true), BigInt(layout.byteLength - 8));
	assert.equal(view.getBigUint64(28, true), BigInt(layout.dataByteLength));
});

test('20-bit WAV keeps RIFF for the largest layout its 32-bit size field can state', () => {
	const options = { channelCount: 2, bitDepth: 20 as const, totalFrames: 715_827_872 };

	const layout = inspectWavLayout(options);
	assert.equal(layout.container, 'riff');
	assert.equal(layout.riffSize, 4_294_967_292);
	assert.ok(layout.riffSize <= UINT32_MAX);

	const header = createWavHeader(options);
	assert.equal(ascii(header, 0, 4), 'RIFF');
	assert.equal(viewOf(header).getUint32(4, true), layout.riffSize);
});

test('multichannel broadcast WAV counts its extensible fmt chunk when choosing RIFF over RF64', () => {
	const bext = { description: 'Extensible boundary' };

	const overflowing = inspectWavLayout({
		channelCount: 6, bitDepth: 24, totalFrames: 238_609_257, bext,
	});
	assert.equal(overflowing.bextByteLength, 610);
	assert.equal(overflowing.headerByteLength, 12 + 36 + 610 + 48 + 8);
	assert.ok(overflowing.riffSize > UINT32_MAX, `expected an oversized riffSize, got ${overflowing.riffSize}`);
	assert.equal(overflowing.container, 'rf64');

	const overflowingHeader = createWavHeader({
		channelCount: 6, bitDepth: 24, totalFrames: 238_609_257, bext,
	});
	assert.equal(ascii(overflowingHeader, 0, 4), 'RF64');
	assert.equal(viewOf(overflowingHeader).getUint32(4, true), UINT32_MAX);
	assert.equal(viewOf(overflowingHeader).getBigUint64(20, true), BigInt(overflowing.byteLength - 8));

	const fitting = inspectWavLayout({
		channelCount: 6, bitDepth: 24, totalFrames: 238_609_256, bext,
	});
	assert.equal(fitting.container, 'riff');
	assert.equal(fitting.riffSize, 4_294_967_278);

	const fittingHeader = createWavHeader({
		channelCount: 6, bitDepth: 24, totalFrames: 238_609_256, bext,
	});
	assert.equal(ascii(fittingHeader, 0, 4), 'RIFF');
	assert.equal(viewOf(fittingHeader).getUint32(4, true), fitting.riffSize);
});

test('every RIFF layout across the extensible boundary states its real size in the header', () => {
	for (let totalFrames = 715_827_870; totalFrames <= 715_827_880; totalFrames += 1) {
		const options = { channelCount: 2, bitDepth: 20 as const, totalFrames };
		const layout = inspectWavLayout(options);
		const view = viewOf(createWavHeader(options));
		if (layout.container === 'riff') {
			assert.ok(
				layout.riffSize <= UINT32_MAX,
				`riff container at ${totalFrames} frames declares riffSize ${layout.riffSize}`,
			);
			assert.equal(view.getUint32(4, true), layout.riffSize);
		} else {
			assert.equal(view.getUint32(4, true), UINT32_MAX);
		}
	}
});

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function viewOf(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
