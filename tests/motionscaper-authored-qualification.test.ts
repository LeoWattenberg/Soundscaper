/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionSurface, decodeMotionChannel, encodeMotionChannel, motionSurfaceToRgba8 } from '../src/common/editor/motion-surface.ts';
import type { MotionNativeReference } from '../desktop/motionscaper-native-reference.ts';
import { verifyMotionAuthoredNative, verifyMotionAuthoredPreview } from '../desktop/motionscaper-authored-oracles.ts';
import { finishMotionAuthoredQualification } from '../desktop/motionscaper-authored-lifecycle.ts';

function fixture() {
	const surface = createMotionSurface(160, 96);
	for (let y = 8; y < 72; y++) for (let x = 10; x < 150; x++) surface.pixels.set([decodeMotionChannel(74 / 255, 'srgb'), decodeMotionChannel(128 / 255, 'srgb'), 1, 1], (y * 160 + x) * 4);
	for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) surface.pixels.set([1, 1, 1, 1], (y * 160 + x) * 4);
	surface.pixels.set([.2, .1, .05, .5], (42 * 160 + 96) * 4);
	const rgba = new Float32Array(surface.pixels.length * 2);
	for (let frame = 0; frame < 2; frame++) for (let i = 0; i < surface.pixels.length; i += 4) {
		const alpha = surface.pixels[i + 3]!; const at = frame * surface.pixels.length + i; rgba[at + 3] = alpha;
		for (let channel = 0; channel < 3; channel++) rgba[at + channel] = alpha ? encodeMotionChannel(surface.pixels[i + channel]! / alpha, 'rec709') : 0;
	}
	const metadata: MotionNativeReference = { width: 160, height: 96, profile: 4, colorDepth: 12, alphaDepth: 12, colorPrimaries: 1, colorTransfer: 1, colorSpace: 1, frames: [{ num: 0, den: 15360 }, { num: 512, den: 15360 }], audio: null };
	return { surface, decoded: { rgba, pcm: new Float32Array(), metadata } };
}
test('Motionscaper authored native oracle checks every fine-edge channel with the unchanged eight-code bound', () => {
	const { surface, decoded } = fixture(); assert.ok(verifyMotionAuthoredNative([surface, surface], decoded).maximumRec709ColorError < 1 / 1023);
	const at = surface.pixels.length + (42 * 160 + 96) * 4; decoded.rgba[at] = decoded.rgba[at]! + 9 / 1023;
	assert.throws(() => verifyMotionAuthoredNative([surface, surface], decoded), /eight code/u);
});
test('Motionscaper authored native oracle refuses nonfinite/short output, wrong cadence, tags, audio and changed alpha', () => {
	for (const change of ['nan', 'short', 'time', 'tags', 'audio', 'alpha', 'partial'] as const) {
		const { surface, decoded } = fixture();
		if (change === 'nan') decoded.rgba[8] = NaN;
		if (change === 'short') decoded.rgba = decoded.rgba.subarray(0, decoded.rgba.length - 1);
		if (change === 'time') decoded.metadata = { ...decoded.metadata, frames: [{ num: 0, den: 30 }, { num: 2, den: 30 }] };
		if (change === 'tags') decoded.metadata = { ...decoded.metadata, colorSpace: 6 };
		if (change === 'audio') decoded.pcm = new Float32Array(1);
		if (change === 'alpha') decoded.rgba[3] = .00001;
		if (change === 'partial') decoded.rgba[(42 * 160 + 96) * 4 + 3] = .5 + 3 / 1023;
		assert.throws(() => verifyMotionAuthoredNative([surface, surface], decoded), /./u, change);
	}
});
test('Motionscaper authored preview retains exact alpha/card/white-interior and one-code premultiplied checks', () => {
	const { surface } = fixture(); const bytes = Array.from(motionSurfaceToRgba8(surface, 'srgb'));
	assert.equal(verifyMotionAuthoredPreview(surface, bytes), 0);
	const changed = bytes.slice(); changed[(42 * 160 + 96) * 4] = changed[(42 * 160 + 96) * 4]! + 3;
	assert.throws(() => verifyMotionAuthoredPreview(surface, changed), /one 8-bit code/u);
	for (const value of [NaN, -1, 256]) { const invalid = bytes.slice(); invalid[0] = value; assert.throws(() => verifyMotionAuthoredPreview(surface, invalid)); }
	const absentText = bytes.map((value, index) => index % 4 === 3 ? value : 0); assert.throws(() => verifyMotionAuthoredPreview(surface, absentText));
	const alpha = bytes.slice(); alpha[3] = 1; assert.throws(() => verifyMotionAuthoredPreview(surface, alpha), /alpha/u);
});
test('Motionscaper authored publication waits for cleanup and source verification and preserves all failures', async () => {
	const order: string[] = []; const primary = new Error('workload'), cleanup = new Error('live child'), source = new Error('changed source');
	let evidence: unknown;
	await assert.rejects(finishMotionAuthoredQualification(async () => { throw primary; }, async () => { order.push('cleanup'); throw cleanup; }, async () => { order.push('verify'); throw source; }, async value => { order.push('record'); evidence = value; }), error => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup, source]); return true;
	});
	assert.deepEqual(order, ['cleanup', 'verify', 'record']); assert.deepEqual(evidence, { status: 'failed', receipt: null, errors: ['Error: workload', 'Error: live child', 'Error: changed source'] });
	await assert.rejects(finishMotionAuthoredQualification(() => Promise.resolve('render complete'), () => Promise.reject(cleanup), () => Promise.resolve(), () => Promise.resolve()), /Authored qualification/u);
	assert.equal(await finishMotionAuthoredQualification(() => Promise.resolve('done'), () => Promise.resolve(), () => Promise.resolve(), value => { assert.equal(value.status, 'passed'); return Promise.resolve(); }), 'done');
});
