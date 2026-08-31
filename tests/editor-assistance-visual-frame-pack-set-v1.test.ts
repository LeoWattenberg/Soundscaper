/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceVisualFramePackSetV1,
	reviewAssistanceVisualFramePackSetV1,
} from '../src/common/editor/assistance/visual-frame-pack-set-v1.ts';
import { createAssistanceVisualFramePackV2 } from
	'../src/common/editor/assistance/visual-frame-pack-v2.ts';

const MAGIC_BYTES = new TextEncoder().encode('soundscaper-assistance-frame-pack-set-v1\n').byteLength;

test('visual frame-pack sets strictly preserve ordered member custody', () => {
	const body = join(createAssistanceVisualFramePackSetV1([
		pack({ sourceFrame: 10, presentationTick: '100' }),
		pack({ sourceFrame: 20, presentationTick: '200' }),
	]));
	const reviewed = reviewAssistanceVisualFramePackSetV1(body);
	assert.equal(reviewed.frameCount, 2);
	assert.deepEqual(reviewed.packs.map((member) => member.frame(0).sourceFrame), [10, 20]);
	assert.deepEqual(reviewed.packs.map((member) => member.frameTiming(0)), [
		{ sourceFrame: 10, presentationTick: '100' },
		{ sourceFrame: 20, presentationTick: '200' },
	]);

	assert.throws(() => reviewAssistanceVisualFramePackSetV1(body.subarray(0, body.length - 1)),
		/truncated/iu);
	assert.throws(() => reviewAssistanceVisualFramePackSetV1(join([body, Uint8Array.of(0)])),
		/trailing/iu);

	const memberLength = body.slice();
	new DataView(memberLength.buffer).setUint32(MAGIC_BYTES + 12, body.byteLength, true);
	assert.throws(() => reviewAssistanceVisualFramePackSetV1(memberLength),
		/truncated|oversized/iu);

	const frameCount = body.slice();
	new DataView(frameCount.buffer).setUint32(MAGIC_BYTES + 8, 3, true);
	assert.throws(() => reviewAssistanceVisualFramePackSetV1(frameCount), /frame count/iu);
});

test('visual frame-pack sets reject cross-pack geometry and order drift', () => {
	assert.throws(() => createAssistanceVisualFramePackSetV1([
		pack({ sourceFrame: 10, presentationTick: '100' }),
		pack({ sourceFrame: 20, presentationTick: '200' }, 2),
	]), /geometry|timescale/iu);
	assert.throws(() => createAssistanceVisualFramePackSetV1([
		pack({ sourceFrame: 10, presentationTick: '100' }),
		pack({ sourceFrame: 10, presentationTick: '200' }),
	]), /order/iu);
});

function pack(
	frame: Readonly<{ sourceFrame: number; presentationTick: string }>,
	rasterWidth = 1,
): readonly Uint8Array[] {
	return createAssistanceVisualFramePackV2({ sourceWidth: 1_920, sourceHeight: 1_080,
		rasterWidth, rasterHeight: 1, timescale: 1_000,
		frames: [{ ...frame, rgba: new Uint8Array(rasterWidth * 4) }] });
}

function join(chunks: readonly Uint8Array[]): Uint8Array {
	const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const result = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	return result;
}
