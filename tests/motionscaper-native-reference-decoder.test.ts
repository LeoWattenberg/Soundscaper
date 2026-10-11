/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectMotionNativeReference } from '../desktop/motionscaper-native-reference.ts';

test('native reference admission refuses missing precision, timing and bounded output evidence', () => {
	const metadata = { width: 32, height: 16, frames: [{ num: 0, den: 30 }], colorDepth: 12, alphaDepth: 12, profile: 4, colorPrimaries: 1, colorTransfer: 1, colorSpace: 1, audio: null };
	assert.equal(inspectMotionNativeReference(metadata, 32 * 16 * 16, 0).frames.length, 1);
	for (const bad of [{ ...metadata, colorDepth: 8 }, { ...metadata, alphaDepth: 8 }, { ...metadata, colorTransfer: 13 }, { ...metadata, frames: [{ num: 0, den: 0 }] }, { ...metadata, frames: Array(33).fill({ num: 0, den: 1 }) }, { ...metadata, width: 4096 }]) assert.throws(() => inspectMotionNativeReference(bad, 32 * 16 * 16, 0));
	assert.throws(() => inspectMotionNativeReference(metadata, 0, 0));
	assert.throws(() => inspectMotionNativeReference(metadata, 32 * 16 * 16, 8));
});

test('real pinned helper MOV decodes ten-bit color, source-depth alpha, exact PTS and PCM24', { skip: !process.env.MOTIONSCAPER_REFERENCE_STAGE }, async () => {
	const { mkdtemp, readFile, rm } = await import('node:fs/promises'); const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
	const { createMotionscaperNativeEncoder } = await import('../desktop/motionscaper-native-executor.ts');
	const { createMotionscaperDeliveryAuthority } = await import('../desktop/motionscaper-delivery-authority.ts');
	const { createMotionNativeFrameWriter } = await import('../src/common/editor/motion-native-frame-carrier-v1.ts');
	const { createMotionNativePcmWriter, motionNativePcmPlan } = await import('../src/common/editor/motion-native-pcm-carrier-v1.ts');
	const { createMotionSurface } = await import('../src/common/editor/motion-surface.ts');
	const { buildMotionNativeReferenceDecoder, decodeMotionNativeReference } = await import('../desktop/motionscaper-native-reference.ts');
	const stage = process.env.MOTIONSCAPER_REFERENCE_STAGE!; const directory = await mkdtemp(join(tmpdir(), 'motionscaper-reference-'));
	const encoder = await createMotionscaperNativeEncoder(stage, JSON.parse(await readFile(join(stage, 'app/desktop/native-payload.json'), 'utf8')) as unknown); assert.ok(encoder);
	const movie = join(directory, 'output.mov'); const authority = createMotionscaperDeliveryAuthority({ encoder, chooseOutput: () => Promise.resolve(movie) });
	try {
		const decoder = await buildMotionNativeReferenceDecoder(directory);
		const plan = { identity: { projectId: 'reference', revisionDigest: 'a'.repeat(64), compositionId: 'main' }, width: 32, height: 16, frameRate: { num: 30000, den: 1001 }, firstFrame: 10, frameCount: 2 };
		const audio = { sampleRate: 48000, channels: 2 as const }; const pcmPlan = motionNativePcmPlan(plan, audio); const selected = await authority.begin({ plan, suggestedName: 'output.mov', audio }); assert.ok(selected);
		let offset = 0, audioOffset = 0;
		const writer = await createMotionNativeFrameWriter(plan, new WritableStream<Uint8Array>({ async write(bytes) { await authority.write({ token: selected.token, offset, bytes }); offset += bytes.length; } }));
		for (let i = 0; i < 2; i++) await writer.write(i, createMotionSurface(32, 16, [0.3456789, 0.1234567, 0.7891234, 0.2345678]));
		const frames = await writer.finish();
		const sound = await createMotionNativePcmWriter(pcmPlan, new WritableStream<Uint8Array>({ async write(bytes) { await authority.write({ token: selected.token, offset: audioOffset, bytes, stream: 'audio' }); audioOffset += bytes.length; } }));
		await sound.write({ ...plan.identity, revision: 1, ...audio, sampleCount: pcmPlan.sampleCount, startSample: { num: 16016, den: 1 }, interleaved: Float32Array.from({ length: pcmPlan.sampleCount * 2 }, (_, i) => i % 2 ? -.1234567 : .7654321) });
		const receipt = await sound.finish(); await authority.commit({ token: selected.token, ...frames, audio: receipt });
		const decoded = await decodeMotionNativeReference(decoder, movie, directory);
		assert.deepEqual(decoded.metadata.frames, [{ num: 0, den: 30000 }, { num: 1001, den: 30000 }]);
		assert.deepEqual(decoded.metadata.audio, { ...audio, sampleCount: 3204 });
		const rec709 = (v: number) => v < .018 ? 4.5 * v : 1.099 * v ** .45 - .099;
		for (const [channel, linear] of [.3456789, .1234567, .7891234].entries()) assert.ok(Math.abs(decoded.rgba[channel]! - rec709(linear)) < .006);
		assert.ok(Math.abs(decoded.rgba[3]! - .2345678) < .0006);
		assert.ok(Math.abs(decoded.pcm[0]! - .7654321) < 2 ** -23); assert.ok(Math.abs(decoded.pcm[1]! + .1234567) < 2 ** -23);
	} finally { await authority.dispose(); await rm(directory, { recursive: true, force: true }); }
});
