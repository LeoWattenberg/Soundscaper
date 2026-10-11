/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMotionscaperDeliveryAuthority } from './motionscaper-delivery-authority.ts';
import type { MotionNativeEncoder } from './motionscaper-native-executor.ts';
import { createMotionNativeFrameWriter } from '../src/common/editor/motion-native-frame-carrier-v1.ts';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import { createMotionNativePcmWriter, motionNativePcmPlan } from '../src/common/editor/motion-native-pcm-carrier-v1.ts';
import { divideRationals, multiplyRationals } from '../src/common/editor/timeline-time.ts';
/** Explicit packaged-test mode proves the installed helper and atomic main capability together. */
export async function smokeMotionscaperNativeDelivery(encoder: MotionNativeEncoder) {
	const directory = await mkdtemp(join(tmpdir(), 'motionscaper-native-smoke-')); const path = join(directory, 'output.mov');
	const authority = createMotionscaperDeliveryAuthority({ encoder, chooseOutput: () => Promise.resolve(path) });
	try {
		await writeFile(path, 'original destination');
		const plan = { identity: { projectId: 'smoke', revisionDigest: 'a'.repeat(64), compositionId: 'composition' },
			width: 32, height: 16, frameRate: { num: 30000, den: 1001 }, firstFrame: 10, frameCount: 2 };
		const audio = { sampleRate: 48000, channels: 2 as const }; const pcmPlan = motionNativePcmPlan(plan, audio);
		const selection = await authority.begin({ plan, suggestedName: 'output.mov', audio }); if (!selection) throw new Error('Motionscaper native smoke was unexpectedly cancelled.');
		let offset = 0;
		const writer = await createMotionNativeFrameWriter(plan, new WritableStream<Uint8Array>({ async write(bytes) {
			await authority.write({ token: selection.token, offset, bytes }); offset += bytes.byteLength;
		} }));
		for (let index = 0; index < 2; index++) await writer.write(index, createMotionSurface(32, 16, [0.123456, 0.654321, 0.345678, 0.456789]));
		const frames = await writer.finish();
		let audioOffset = 0;
		const pcmWriter = await createMotionNativePcmWriter(pcmPlan, new WritableStream<Uint8Array>({ async write(bytes) {
			await authority.write({ token: selection.token, offset: audioOffset, bytes, stream: 'audio' }); audioOffset += bytes.length;
		} }));
		await pcmWriter.write({ ...plan.identity, revision: 1, ...audio, sampleCount: pcmPlan.sampleCount,
			startSample: multiplyRationals(divideRationals(plan.firstFrame, plan.frameRate), audio.sampleRate),
			interleaved: Float32Array.from({ length: pcmPlan.sampleCount * 2 }, (_, index) => index % 2 ? -0.1234567 : 0.7654321) });
		const samples = await pcmWriter.finish();
		if (await readFile(path, 'utf8') !== 'original destination') throw new Error('Motionscaper native smoke published before commit.');
		const receipt = await authority.commit({ token: selection.token, byteLength: frames.byteLength, sha256: frames.sha256, audio: samples });
		const bytes = await readFile(path);
		if (bytes.byteLength !== receipt.byteLength || bytes.subarray(4, 8).toString('ascii') !== 'ftyp' || receipt.frameCount !== 2 || receipt.audio?.sampleCount !== 3204) throw new Error('Motionscaper native smoke did not publish a complete A/V MOV.');
		return { status: 'passed', frameCount: receipt.frameCount, sha256: receipt.sha256, profile: receipt.profile, audio: receipt.audio };
	} finally { await authority.dispose(); await rm(directory, { recursive: true, force: true }); }
}
