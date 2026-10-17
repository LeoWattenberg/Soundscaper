/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMotionscaperDeliveryAuthority } from '../desktop/motionscaper-delivery-authority.ts';
import { createMotionscaperDesktopProresSink } from '../src/motionscaper/desktop-delivery-adapter.ts';
import { openMotionNativePcmReader, motionNativePcmPlan } from '../src/common/editor/motion-native-pcm-carrier-v1.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import { MOTION_PRORES_DELIVERY_PROFILE, type MotionDesktopDelivery } from '../src/motionscaper/desktop-delivery-contract.ts';
import { dispatchMotionscaperDeliveryCall } from '../desktop/motionscaper-delivery-ipc.ts';
const plan = { identity: { projectId: 'p', revisionDigest: 'a'.repeat(64), compositionId: 'c' }, width: 1, height: 1,
	frameRate: { num: 24, den: 1 }, firstFrame: 0, frameCount: 1 };
test('desktop PCM export authenticates an independent sidecar before publishing the A/V file', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-pcm-delivery-')); const path = join(root, 'output.mov');
	await writeFile(path, 'original'); let runs = 0;
	const audio = { sampleRate: 48000, channels: 2 as const }; const pcm = motionNativePcmPlan(plan, audio);
	const authority = createMotionscaperDeliveryAuthority({ chooseOutput: async () => path, encoder: { async encode(request) {
		runs++; assert.ok(request.audio); const bytes = await readFile(request.audio.source);
		assert.equal(request.audio.sha256, createHash('sha256').update(bytes).digest('hex'));
		const reader = await openMotionNativePcmReader(createScapeArchiveByteSource({ size: bytes.length, read: ({ offset, length }) => bytes.subarray(offset, offset + length) }), pcm);
		assert.deepEqual(await reader.read(0), new Float32Array(4000).fill(0.1234567));
		const output = Buffer.from('A/V MOV'); await writeFile(request.output, output);
		return { byteLength: output.length, sha256: createHash('sha256').update(output).digest('hex'), frameCount: 1, audioSamples: 2000 };
	} } });
	try {
		await assert.rejects(dispatchMotionscaperDeliveryCall(authority, 'begin', { plan, suggestedName: 'x.mov', audio: { sampleRate: 48000, channels: 2, path: '/foreign' } }), /closed/u);
		await assert.rejects(dispatchMotionscaperDeliveryCall(authority, 'begin', { plan, suggestedName: 'x.mov', audio: { sampleRate: 384000, channels: 2 } }), /sample rate/u);
		const sink = await createMotionscaperDesktopProresSink(authority, { plan, suggestedName: 'x.mov', audio }); assert.ok(sink?.audio);
		await sink.audio.write({ ...plan.identity, revision: 1, startSample: { num: 0, den: 1 }, sampleRate: 48000, channels: 2, sampleCount: 2000, interleaved: new Float32Array(4000).fill(0.1234567) });
		await sink.write({ index: 0, time: { num: 0, den: 1 }, duration: { num: 1, den: 24 }, surface: { ...createMotionSurface(1, 1), consumedOperationIds: [] } });
		assert.equal(await readFile(path, 'utf8'), 'original');
		const result = await sink.finish(); assert.equal(runs, 1); assert.equal(result.profile.audioOutputBits, 24);
		assert.deepEqual(result.audio, { ...audio, sampleCount: 2000 }); assert.equal(await readFile(path, 'utf8'), 'A/V MOV');
		assert.deepEqual(await readdir(root), ['output.mov']);
	} finally { await authority.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('native delivery refuses an altered or missing audio grant and preserves the old destination', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-pcm-refusal-')); const path = join(root, 'output.mov'); await writeFile(path, 'original');
	let runs = 0; const authority = createMotionscaperDeliveryAuthority({ chooseOutput: async () => path, encoder: { async encode() { runs++; throw new Error('must not encode'); } } });
	try {
		for (const mode of ['missing', 'corrupt']) {
			const delivery = { ...authority, commit: (request: Parameters<MotionDesktopDelivery['commit']>[0]) => {
				const { audio, ...video } = request;
				return authority.commit(mode === 'missing' ? video : { ...video, audio: { ...audio!, sha256: '0'.repeat(64) } });
			} };
			const sink = await createMotionscaperDesktopProresSink(delivery, { plan, suggestedName: 'x.mov', audio: { sampleRate: 48000, channels: 1 } }); assert.ok(sink?.audio);
			await sink.audio.write({ ...plan.identity, revision: 1, startSample: { num: 0, den: 1 }, sampleRate: 48000, channels: 1, sampleCount: 2000, interleaved: new Float32Array(2000) });
			await sink.write({ index: 0, time: { num: 0, den: 1 }, duration: { num: 1, den: 24 }, surface: { ...createMotionSurface(1, 1), consumedOperationIds: [] } });
			await assert.rejects(sink.finish(), /sidecar/u); assert.equal(await readFile(path, 'utf8'), 'original'); assert.deepEqual(await readdir(root), ['output.mov']);
		}
		assert.equal(runs, 0);
	} finally { await authority.dispose(); await rm(root, { recursive: true, force: true }); }
});
test('native finish preserves primary and cancellation failures and permits cleanup retry', async () => {
	let cancelled = 0;
	const delivery: MotionDesktopDelivery = { getProfile: async () => MOTION_PRORES_DELIVERY_PROFILE, begin: async () => ({ token: 't' }),
		write: async () => undefined, commit: async () => { throw new Error('primary native failure'); },
		cancel: async () => { if (++cancelled === 1) throw new Error('cancellation failure'); } };
	const sink = await createMotionscaperDesktopProresSink(delivery, { plan, suggestedName: 'x.mov' }); assert.ok(sink);
	await sink.write({ index: 0, time: { num: 0, den: 1 }, duration: { num: 1, den: 24 }, surface: { ...createMotionSurface(1, 1), consumedOperationIds: [] } });
	await assert.rejects(sink.finish(), error => error instanceof AggregateError && error.errors.length === 2
		&& String(error.errors[0]).includes('primary native failure') && String(error.errors[1]).includes('cancellation failure'));
	await sink.abort('retry cleanup'); assert.equal(cancelled, 2);
});
