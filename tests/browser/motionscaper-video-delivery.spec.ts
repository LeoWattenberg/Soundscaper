/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type * as Video from '../../src/common/editor/controller/export/motion-browser-video.ts';
import type * as Surface from '../../src/common/editor/motion-surface.ts';
import type * as Bunny from 'mediabunny';
import type * as Delivery from '../../src/common/editor/motion-video-delivery.ts';
import type * as Audio from '../../src/common/editor/motion-audio-mixer.ts';
import type * as Project from '../../src/motionscaper/editor-project.ts';
import type * as Request from '../../src/motionscaper/editor-render-task.ts';
import type * as Pipeline from '../../src/common/editor/controller/export/motion-render-pipeline.ts';
import type * as Property from '../../src/common/editor/motion-property.ts';
import { recordMotionVideoEvidence } from './motionscaper-video-evidence.ts';

const bundle = (): string => buildSync({ stdin: { contents: `
	export { createMotionBrowserVideoSink } from '../../src/common/editor/controller/export/motion-browser-video.ts';
	export { createMotionSurface } from '../../src/common/editor/motion-surface.ts';
	export { MOTION_WEBM_TIMECODE_QUANTUM_SECONDS } from '../../src/common/editor/motion-video-delivery.ts';
	export { createMotionAudioMixer } from '../../src/common/editor/motion-audio-mixer.ts';
	export { createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
	export { createMotionscaperRenderRequest } from '../../src/motionscaper/editor-render-task.ts';
	export { renderMotionFrameSequence } from '../../src/common/editor/controller/export/motion-render-pipeline.ts';
	export { motionScalar } from '../../src/common/editor/motion-property.ts';
	export { Input, BufferSource, MP4, WEBM, VideoSampleSink, AudioSampleSink } from 'mediabunny';`,
	resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'iife',
	globalName: 'motionVideoFixture', target: 'es2022' }).outputFiles[0]!.text;

function expectAdmissionRefusal(refusal: string): void {
	expect(refusal).toMatch(/^Error: (?:Video encoding is unavailable in Linux WebKit\. Choose a PNG sequence or another qualified browser\.|No (?:H\.264|VP9) browser encoder supports this canvas and frame rate\.|No (?:AAC|Opus) browser audio encoder supports this sample rate and channel layout\. Choose another container\.)$/u);
}

for (const format of ['mp4', 'webm'] as const) {
	test(`M05 ${format} delivery round trips actual browser encoding, work-area timing and opaque linear coverage`, async ({ page }, testInfo) => {
		await page.goto('/en/'); await page.addScriptTag({ content: bundle() });
		const result = await page.evaluate(async (format) => {
			const fixture = (globalThis as unknown as { motionVideoFixture: typeof Video & typeof Surface & typeof Bunny }).motionVideoFixture;
			const plan = { identity: { projectId: 'browser-motion', compositionId: 'comp', revisionDigest: 'a'.repeat(64) },
				width: 32, height: 32, frameRate: { num: 30000, den: 1001 }, firstFrame: 10, frameCount: 6 };
			const chunks: Uint8Array[] = []; let committed = false;
			const writable = new WritableStream<Uint8Array>({ write(chunk) { chunks.push(chunk); }, close() { committed = true; } });
			let sink;
			try { sink = await fixture.createMotionBrowserVideoSink({ plan, format, background: [0, 0, 1], writable }); }
			catch (error) { return { supported: false as const, refusal: String(error), destinationLocked: writable.locked, chunks: chunks.length, committed }; }
			for (let index = 0; index < plan.frameCount; index++) {
				await sink.write({ index, time: { num: (plan.firstFrame + index) * 1001, den: 30000 }, duration: { num: 1001, den: 30000 },
					surface: { ...fixture.createMotionSurface(32, 32, [1, 0, 0, 0.5]), consumedOperationIds: [] } });
				if (committed) throw new Error('A partial video was published.');
			}
			await sink.finish();
			const bytes = new Uint8Array(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).arrayBuffer());
			const input = new fixture.Input({ source: new fixture.BufferSource(bytes), formats: [fixture.MP4, fixture.WEBM] });
			try {
				const track = await input.getPrimaryVideoTrack(); if (!track) throw new Error('Output has no video track.');
				const timestamps: number[] = []; const pixels: number[][] = [];
				for await (const sample of new fixture.VideoSampleSink(track).samples()) {
					try {
						timestamps.push(sample.timestamp);
						const rgba = new Uint8Array(sample.allocationSize({ format: 'RGBA' }));
						await sample.copyTo(rgba, { format: 'RGBA' }); pixels.push([...rgba.subarray(0, 4)]);
					} finally { sample.close(); }
				}
				return { supported: true as const, output: [...bytes], codec: track.codec, committed, timestamps, pixels, width: track.displayWidth, height: track.displayHeight,
					duration: await input.computeDuration(), largestChunk: Math.max(...chunks.map((chunk) => chunk.byteLength)) };
			} finally { input.dispose(); }
		}, format);
		await recordMotionVideoEvidence(testInfo, format, result);
		if (!result.supported) { expectAdmissionRefusal(result.refusal); expect(result.destinationLocked).toBe(false); expect(result.chunks).toBe(0); expect(result.committed).toBe(false); return; }
		expect(result.committed).toBe(true); expect(result.timestamps).toHaveLength(6);
		expect([result.width, result.height]).toEqual([32, 32]);
		result.timestamps.forEach((timestamp, index) => expect(Math.abs(timestamp - index * 1001 / 30000)).toBeLessThan(0.0011));
		expect(Math.abs(result.duration - 6 * 1001 / 30000)).toBeLessThan(0.002);
		for (const pixel of result.pixels) {
			expect(Math.abs(pixel[0]! - 180)).toBeLessThan(18); expect(pixel[1]).toBeLessThan(18);
			expect(Math.abs(pixel[2]! - 180)).toBeLessThan(18); expect(pixel[3]).toBe(255);
		}
		expect(result.largestChunk).toBeLessThanOrEqual(4 * 1024 * 1024);
	});
}

test('M05 two-frame 30 fps WebM uses its declared millisecond resolution without changing authoring time', async ({ page }, testInfo) => {
	await page.goto('/en/'); await page.addScriptTag({ content: bundle() });
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionVideoFixture: typeof Video & typeof Surface & typeof Bunny & typeof Delivery }).motionVideoFixture;
		const plan = { identity: { projectId: 'browser-motion', compositionId: 'comp', revisionDigest: 'a'.repeat(64) },
			width: 32, height: 32, frameRate: { num: 30, den: 1 }, firstFrame: 7, frameCount: 2 };
		let sink;
		try { sink = await fixture.createMotionBrowserVideoSink({ plan, format: 'webm' }); }
		catch (error) { return { supported: false as const, refusal: String(error) }; }
		for (let index = 0; index < 2; index++) await sink.write({ index, time: { num: 7 + index, den: 30 }, duration: { num: 1, den: 30 },
			surface: { ...fixture.createMotionSurface(32, 32, [1, 0, 0, 1]), consumedOperationIds: [] } });
		const blob = await sink.finish(); if (!blob) throw new Error('Expected completed Blob output.');
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const input = new fixture.Input({ source: new fixture.BufferSource(bytes), formats: [fixture.WEBM] });
		try {
			const track = await input.getPrimaryVideoTrack(); if (!track) throw new Error('Missing video track.');
			const timestamps: number[] = []; const durations: number[] = [];
			for await (const sample of new fixture.VideoSampleSink(track).samples()) {
				try { timestamps.push(sample.timestamp); durations.push(sample.duration); } finally { sample.close(); }
			}
			return { supported: true as const, output: [...bytes], codec: track.codec, timestamps, durations, duration: await input.computeDuration(), quantum: fixture.MOTION_WEBM_TIMECODE_QUANTUM_SECONDS };
		} finally { input.dispose(); }
	});
	await recordMotionVideoEvidence(testInfo, 'webm', result);
	if (!result.supported) { expectAdmissionRefusal(result.refusal); return; }
	expect(result.quantum).toBe(0.001);
	expect(result.timestamps).toEqual([0, 0.033]); expect(result.durations).toEqual([0.033, 0.033]);
	expect(result.duration).toBe(0.066);
	expect(Math.abs(result.duration - 2 / 30)).toBeLessThanOrEqual(result.quantum);
});

for (const format of ['webm', 'mp4'] as const) {
	test(`M05 ${format} consumes real mixed PCM and qualifies codec timing or explicit audio refusal`, async ({ page }, testInfo) => {
		await page.goto('/en/'); await page.addScriptTag({ content: bundle() });
		const result = await page.evaluate(async (format) => {
			const fixture = (globalThis as unknown as { motionVideoFixture: typeof Video & typeof Surface & typeof Bunny & typeof Audio & typeof Project & typeof Request & typeof Pipeline & typeof Property }).motionVideoFixture;
			const project = fixture.createMotionscaperProject({ id: 'audio-motion', compositionId: 'comp', title: 'Audio render', width: 32, height: 32, durationFrames: 40, frameRate: { num: 30, den: 1 } });
			const asset = { kind: 'audio' as const, id: 'audio', name: 'Tone', sampleRate: 48000, channels: 2, duration: { num: 2, den: 1 },
				sha256: 'a'.repeat(64), storageKey: `motion-sha256:${'a'.repeat(64)}`, byteLength: 1, mimeType: 'audio/wav' };
			const authored = { ...project, assets: [asset], compositions: [{ ...project.compositions[0]!, audio: [{ id: 'tone', assetId: asset.id,
				startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame: { num: 40, den: 1 }, sourceStart: { num: 0, den: 1 },
				timeScale: { num: 1, den: 1 }, enabled: true, gain: fixture.motionScalar(1) }] }] };
			const placeholder = { async write() {}, async finish() { return null; }, async abort() {}, audio: { sampleRate: 48000, channels: 2 as const, async write() {} } };
			const request = fixture.createMotionscaperRenderRequest({ project: authored, compositionId: 'comp', firstFrame: 7, endFrame: 37, sink: placeholder,
				acquire: async (revision) => {
					const audioMixer = fixture.createMotionAudioMixer({ project: revision.project, provider: {
						async describe() { return { sampleRate: 48000, channels: 2, sampleCount: 96000 }; },
						async read({ startSample, sampleCount }) { return Float32Array.from({ length: sampleCount * 2 }, (_, index) => {
							const channel = index % 2; return (channel ? 0.125 : 0.25) * Math.sin(2 * Math.PI * (channel ? 880 : 440) * (startSample + Math.floor(index / 2)) / 48000);
						}); },
					} });
					return { audioMixer, rasterizer: { async rasterize() { throw new Error('Empty visual layers.'); } }, async release() { audioMixer.dispose(); } };
				} });
			// Product admission owns both native probes, including Linux WebKit's pre-probe refusal.
			const chunks: Uint8Array[] = []; let committed = false;
			const writable = new WritableStream<Uint8Array>({ write(chunk) { chunks.push(chunk); }, close() { committed = true; } });
			let sink;
			try { sink = await fixture.createMotionBrowserVideoSink({ plan: request.plan, format, audio: { sampleRate: 48000, channels: 2 }, writable }); }
			catch (error) { return { supported: false as const, refusal: String(error), destinationLocked: writable.locked, chunks: chunks.length, committed }; }
			const receipt = await fixture.renderMotionFrameSequence({ ...request, sink });
			if (receipt.output !== null || !committed) throw new Error('Missing completed streamed media.');
			const bytes = await new Blob(chunks as Uint8Array<ArrayBuffer>[]).arrayBuffer();
			const input = new fixture.Input({ source: new fixture.BufferSource(bytes), formats: [fixture.WEBM, fixture.MP4] });
			try {
				const audio = await input.getPrimaryAudioTrack(); const video = await input.getPrimaryVideoTrack(); if (!audio || !video) throw new Error('Both tracks are required.');
				const energy = [0, 0]; const peaks = [0, 0]; let count = 0; let first = Infinity; let last = 0;
				for await (const sample of new fixture.AudioSampleSink(audio).samples()) {
					try {
						first = Math.min(first, sample.timestamp); last = Math.max(last, sample.timestamp + sample.duration);
						for (let channel = 0; channel < 2; channel++) {
							const pcm = new Float32Array(sample.numberOfFrames); sample.copyTo(pcm, { planeIndex: channel, format: 'f32-planar' });
							for (const value of pcm) { energy[channel] = energy[channel]! + value * value; peaks[channel] = Math.max(peaks[channel]!, Math.abs(value)); }
						}
						count += sample.numberOfFrames;
					} finally { sample.close(); }
				}
				let frames = 0; for await (const sample of new fixture.VideoSampleSink(video).samples()) { sample.close(); frames++; }
				return { supported: true as const, output: [...new Uint8Array(bytes)], videoCodec: video.codec, audioCodec: audio.codec, first, last, count, rms: energy.map((value) => Math.sqrt(value / count)), peaks, frames,
					sampleRate: audio.sampleRate, channels: audio.numberOfChannels, duration: await input.computeDuration() };
			} finally { input.dispose(); }
		}, format);
		await recordMotionVideoEvidence(testInfo, format, result);
		if (!result.supported) { expectAdmissionRefusal(result.refusal); expect(result.destinationLocked).toBe(false); expect(result.chunks).toBe(0); expect(result.committed).toBe(false); return; }
		expect(result.frames).toBe(30); expect([result.sampleRate, result.channels]).toEqual([48000, 2]);
		expect(result.count).toBeGreaterThanOrEqual(48000); expect(result.count).toBeLessThan(50000);
		expect(result.first).toBeLessThanOrEqual(0.001); expect(result.last).toBeGreaterThanOrEqual(0.99); expect(result.last).toBeLessThan(1.04);
		expect(result.rms![0]).toBeGreaterThan(0.15); expect(result.rms![0]).toBeLessThan(0.20);
		expect(result.rms![1]).toBeGreaterThan(0.075); expect(result.rms![1]).toBeLessThan(0.10);
		expect(result.peaks![0]).toBeLessThan(0.30); expect(result.peaks![1]).toBeLessThan(0.16);
		expect(result.duration).toBeGreaterThanOrEqual(1); expect(result.duration).toBeLessThan(1.04);
	});
}
