/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperDesktopProresSink, motionscaperDesktopDelivery } from '../src/motionscaper/desktop-delivery-adapter.ts';
import { MOTION_PRORES_DELIVERY_PROFILE, type MotionDesktopDelivery } from '../src/motionscaper/desktop-delivery-contract.ts';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { openMotionNativeFrameReader } from '../src/common/editor/motion-native-frame-carrier-v1.ts';
import { dispatchMotionscaperDeliveryCall } from '../desktop/motionscaper-delivery-ipc.ts';
const plan = { identity: { projectId: 'p', revisionDigest: 'a'.repeat(64), compositionId: 'c' }, width: 2, height: 1,
	frameRate: { num: 24000, den: 1001 }, firstFrame: 10, frameCount: 1 };
await test('Motionscaper renderer sink carries floats and waits for the native publication receipt', async () => {
	const chunks: Uint8Array[] = []; let total = 0; let published = false; let cancelled = 0;
	const delivery: MotionDesktopDelivery = {
		getProfile: () => Promise.resolve(MOTION_PRORES_DELIVERY_PROFILE), begin: () => Promise.resolve({ token: 'own' }),
		write: ({ token, offset, bytes }) => { assert.equal(token, 'own'); assert.equal(offset, total); chunks.push(new Uint8Array(bytes)); total += bytes.length; return Promise.resolve(); },
		commit: async ({ token, byteLength }) => {
			assert.equal(token, 'own'); assert.equal(byteLength, total);
			const bytes = new Uint8Array(total); let cursor = 0; for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
			const source = createScapeArchiveByteSource({ size: total, read: ({ offset, length }) => bytes.slice(offset, offset + length) });
			const reader = await openMotionNativeFrameReader(source, plan.identity); const frame = await reader.read(0);
			assert.equal(frame.pixels[0], Math.fround(0.123456 * 0.5)); assert.equal(reader.header.firstFrame, 10);
			published = true; return { identity: plan.identity, name: 'out.mov', byteLength: 30, sha256: 'b'.repeat(64), frameCount: 1, profile: MOTION_PRORES_DELIVERY_PROFILE, audio: null };
		}, cancel: () => { cancelled++; return Promise.resolve(); },
	};
	assert.equal(motionscaperDesktopDelivery({ scapeDesktop: { v1: { motionDelivery: delivery } } }), delivery);
	assert.equal(motionscaperDesktopDelivery({}), null);
	const sink = await createMotionscaperDesktopProresSink(delivery, { plan, suggestedName: 'out.mov' }); assert.ok(sink);
	await sink.write({ index: 0, time: { num: 1001, den: 2400 }, duration: { num: 1001, den: 24000 },
		surface: { ...createMotionSurface(2, 1, [0.123456, 0.2, 0.3, 0.5]), consumedOperationIds: [] } });
	assert.equal(published, false); const result = await sink.finish(); assert.equal(published, true); assert.equal(result.profile.encoderInputBits, 10);
	await sink.abort(new Error('later')); assert.equal(cancelled, 0);
	await assert.rejects(dispatchMotionscaperDeliveryCall(delivery, 'begin', { plan, suggestedName: 'x.mov', path: '/foreign' }), /closed/u);
	await assert.rejects(dispatchMotionscaperDeliveryCall(delivery, 'spawn', {}), /Unsupported/u);
	await assert.rejects(dispatchMotionscaperDeliveryCall(delivery, 'write', { token: 'own', offset: 0, bytes: new Uint8Array(4 * 1024 * 1024 + 1) }), /limit/u);
});
await test('Motionscaper renderer native export distinguishes dialog cancellation and active cancellation', async () => {
	let cancelled = 0; let abortHandler!: () => void;
	const delivery: MotionDesktopDelivery = {
		getProfile: () => Promise.resolve(MOTION_PRORES_DELIVERY_PROFILE), begin: () => Promise.resolve({ token: 'own' }),
		write: () => Promise.resolve(), commit: () => new Promise((_resolve, reject) => { abortHandler = () => { reject(new Error('native cancelled')); }; }),
		cancel: () => { cancelled++; abortHandler?.(); return Promise.resolve(); },
	};
	assert.equal(await createMotionscaperDesktopProresSink({ ...delivery, begin: () => Promise.resolve(null) }, { plan, suggestedName: 'x.mov' }), null);
	assert.equal(cancelled, 0);
	const controller = new AbortController();
	const sink = await createMotionscaperDesktopProresSink(delivery, { plan, suggestedName: 'x.mov', signal: controller.signal }); assert.ok(sink);
	await sink.write({ index: 0, time: { num: 1001, den: 2400 }, duration: { num: 1001, den: 24000 }, surface: { ...createMotionSurface(2, 1), consumedOperationIds: [] } });
	const finishing = sink.finish(); const rejection = assert.rejects(finishing, /cancel/u);
	await new Promise<void>(resolve => { setImmediate(resolve); }); controller.abort(); await rejection;
	assert.equal(cancelled, 1);
});
