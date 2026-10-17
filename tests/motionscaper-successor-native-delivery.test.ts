/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperSuccessorNativeSink, framescaperSuccessorNativeDelivery } from '../src/framescaper/editor-successor-native-delivery-adapter.ts';
import { dispatchFramescaperSuccessorDeliveryCall } from '../desktop/framescaper-successor-delivery-ipc.ts';
import { MOTION_PRORES_DELIVERY_PROFILE, type MotionDesktopDelivery } from '../src/common/editor/motion-desktop-delivery-contract.ts';
import { createBlobScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { openMotionNativeFrameReader } from '../src/common/editor/motion-native-frame-carrier-v1.ts';
import type { FramescaperSuccessorNativeDelivery, FramescaperSuccessorNativePlan } from '../src/framescaper/editor-successor-native-delivery-contract.ts';
const plan: FramescaperSuccessorNativePlan = { identity: { projectId: 'frame-project', revisionDigest: 'a'.repeat(64), sequenceId: 'edit-sequence' }, width: 2, height: 1, frameRate: { num: 30, den: 1 }, firstFrame: 0, frameCount: 1 };
const profile = { ...MOTION_PRORES_DELIVERY_PROFILE, projectSchemaFamily: 'framescaper', projectSchemaVersion: 2, inputPrecision: 'frame-finishing-rgba8' } as const;
for (const inputEncoding of ['srgb', 'rec709'] as const) await test(`successor native adapter preserves Frame sequence identity and explicitly converts partial ${inputEncoding} alpha`, async () => {
	const chunks: Uint8Array<ArrayBuffer>[] = []; let commits = 0;
	const delivery: FramescaperSuccessorNativeDelivery = {
		getProfile: async () => profile,
		async begin(request) { assert.deepEqual(request.plan, plan); return { token: 'owned' }; },
		async write(request) { assert.equal(request.token, 'owned'); assert.equal(request.offset, chunks.reduce((sum, bytes) => sum + bytes.length, 0)); chunks.push(request.bytes.slice()); },
		async commit() { commits++; return { identity: plan.identity, name: 'output.mov', byteLength: 10, sha256: 'b'.repeat(64), frameCount: 1, profile, audio: null }; }, cancel: async () => {},
	};
	assert.equal(framescaperSuccessorNativeDelivery({ scapeDesktop: { v1: { motionDelivery: delivery } } }), null);
	assert.equal(framescaperSuccessorNativeDelivery({ framescaperSuccessorDesktop: { v1: { delivery } } }), delivery);
	const sink = await createFramescaperSuccessorNativeSink(delivery, { plan, inputEncoding, suggestedName: 'output.mov' }); assert.ok(sink);
	await sink.writeRgba(0, Uint8Array.of(128, 64, 192, 128, 255, 128, 1, 0)); assert.equal(commits, 0);
	const receipt = await sink.finish(); assert.deepEqual(receipt.identity, plan.identity); assert.equal(commits, 1);
	const source = createBlobScapeArchiveByteSource(new Blob(chunks));
	const carrier = await openMotionNativeFrameReader(source, { projectId: plan.identity.projectId, revisionDigest: plan.identity.revisionDigest, compositionId: plan.identity.sequenceId });
	const surface = await carrier.read(0);
	const decode = inputEncoding === 'srgb' ? (value: number) => ((value + 0.055) / 1.055) ** 2.4 : (value: number) => ((value + 0.099) / 1.099) ** (1 / 0.45);
	for (const [index, value] of [128, 64, 192].entries()) assert.ok(Math.abs(surface.pixels[index]! - decode(value / 255) * (128 / 255)) < 0.00001); assert.ok(Math.abs(surface.pixels[3]! - 128 / 255) < 0.00001);
	assert.deepEqual([...surface.pixels.slice(4)], [0, 0, 0, 0]);
});
await test('successor native IPC admits only its explicit sequence plan and rejects baseline or Motion identities', async () => {
	const calls: unknown[] = []; const authority: MotionDesktopDelivery = { getProfile: async () => MOTION_PRORES_DELIVERY_PROFILE,
		async begin(request) { calls.push(request); return { token: 'owned' }; }, write: async () => {}, cancel: async () => {}, commit: async () => { throw new Error('unused'); } };
	assert.deepEqual(await dispatchFramescaperSuccessorDeliveryCall(authority, 'getProfile', {}), profile);
	await dispatchFramescaperSuccessorDeliveryCall(authority, 'begin', { plan, suggestedName: 'frame.mov' });
	assert.deepEqual(calls, [{ plan: { ...plan, identity: { projectId: plan.identity.projectId, revisionDigest: plan.identity.revisionDigest, compositionId: plan.identity.sequenceId } }, suggestedName: 'frame.mov' }]);
	for (const identity of [{ ...plan.identity, compositionId: 'foreign' }, { projectId: 'motion', revisionDigest: 'a'.repeat(64), compositionId: 'comp' }]) {
		await assert.rejects(dispatchFramescaperSuccessorDeliveryCall(authority, 'begin', { plan: { ...plan, identity }, suggestedName: 'frame.mov' }), /identity|fields/u);
	}
	await assert.rejects(dispatchFramescaperSuccessorDeliveryCall(authority, 'render-v14', { path: '/tmp/foreign' }), /Unsupported/u);
	await assert.rejects(dispatchFramescaperSuccessorDeliveryCall(authority, 'begin', { plan, suggestedName: 'x.mov', nativeInputPath: '/tmp/unowned' }), /fields/u);
});
