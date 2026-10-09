/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { liveFixture } from './helpers/framescaper-native-live-openfx-fixture.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';
import { cloneFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperVideoExportStrategyNativeMedia } from '../src/framescaper/video-export-strategy-native-media.ts';
import type { FramescaperVideoExportStrategyFinishingDependencies } from '../src/framescaper/video-export-strategy-finishing.ts';

const text = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
const parsed = parseCubeLutV1(text), body = new TextEncoder().encode(text);
const ref = { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256, byteLength: parsed.byteLength,
	size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax };
const effect = { id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: ref } };
const source = [255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255];
const cube = [0,0,255,255,0,255,0,255,255,0,0,255,255,255,255,255];
const filtered = [0,255,0,255,255,0,0,255,0,0,255,255,255,255,255,255];

test('the maintained nativeMedia selected export pairs current16 cube rendering with OpenFX before the pinned H264 encoder', async () => {
	const original = liveFixture(true).project, clips = original.clips as readonly Readonly<Record<string, unknown>>[];
	const project = cloneFramescaperProjectNativeMedia(PROFILE, { ...original,
		clips: clips.map(clip => clip.id === 'video-clip' ? { ...clip, videoEffects: [effect] } : clip) });
	const canonicalProject = project as unknown as Readonly<Record<string, unknown>>;
	const rate = { num: 1, den: 1 }, input = new Uint8Array(source), encoder = await createPinnedExportEncoderV1();
	let pluginCalls = 0, offlineCalls = 0; const captures: string[] = [], loads: string[] = [];
	const dependencies: FramescaperVideoExportStrategyFinishingDependencies = {
		captureExactFrame(entry) { captures.push(String(entry.clipId)); return { width: 2, height: 2, pixels: input }; },
		async encodeOffline(request) {
			offlineCalls++; assert.ok(request.rgbaCompositor); const compositor = request.rgbaCompositor;
			assert.deepEqual(request.sources.map(value => value.sourceId), ['video-source']);
			const clip = (request.project.clips as readonly Readonly<{ id: string; videoEffects: readonly unknown[] }>[])
				.find(value => value.id === 'video-clip'); assert.ok(clip); assert.deepEqual(clip.videoEffects, []);
			assert.equal(request.startFrame, 0); assert.equal(request.endFrame, 48_000);
			const frameSource = createVideoExactPictureExportFrameSource({ sampleRate: Number(project.sampleRate),
				startFrame: request.startFrame!, endFrame: request.endFrame!, canvas: request.canvas });
			assert.equal(frameSource.frameCount, 1);
			return encodeVideoKeyframeVideo(encoder.editor, { frameSource, format: request.format, quality: request.quality,
				signal: request.signal, assertCurrent: request.assertCurrent, producer: { width: 2, height: 2, byteLength: 16,
					async produce(frame, target) {
						await compositor({ frame, width: 2, height: 2, rgba: target, signal: request.signal,
							layers: [{ trackId: 'video-track', entries: [{ clipId: 'video-clip', sourceId: 'video-source',
								presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 }, displayWidth: 2, displayHeight: 2,
								effects: clip.videoEffects, intervalProgress: 0, renderDescription: {
									crop: { normalized: { left: 0, top: 0, right: 0, bottom: 0 }, sourcePixels: { x: 0, y: 0, width: 2, height: 2 } },
									sourceDisplayToCanvas: [1,0,0,1,0,0], opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0,
								} }] }] });
						assert.deepEqual(Array.from(target), filtered);
					}, dispose() {},
				} });
		}, async encodeOfflineToSink() { throw Error('This bounded case never opens a sink.'); },
	};
	const strategy = createFramescaperVideoExportStrategyNativeMedia(PROFILE, dependencies, {
		async loadMediaAsset(key) { loads.push(key); assert.equal(key, ref.storageKey); assert.deepEqual(captures, ['video-clip']); return new Blob([body]); },
	}, async request => {
		pluginCalls++; assert.equal(request.plan.version, 14); assert.equal(request.instanceId, 'ofx-instance');
		assert.deepEqual(Array.from(request.inputs[0]!.rgba.pixels), cube);
		const rgba = request.inputs[0]!.rgba, pixels = new Uint8Array(rgba.pixels.length);
		for (let index = 0; index < pixels.length; index += 4) pixels.set([rgba.pixels[index+1]!, rgba.pixels[index+2]!, rgba.pixels[index]!, rgba.pixels[index+3]!], index);
		return { mode: 'render', rgba: { width: 2, height: 2, pixels }, backend: 'cpu', retriedOnCpu: false, reportsDegradation: false };
	});
	try {
		const exportProject = strategy.createExportProject({ canonicalProject, delivery: { project: { deliveryProjection: true },
			audioRenderedFallback: null, videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [] } });
		const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'mp4', range: 'project', includeAudio: false,
			canvas: { width: 2, height: 2, frameRate: rate, fit: 'contain', backgroundColor: '#00000000' } }); assert.ok(plan);
		const result = await strategy.encode({ canonicalProject, exportProject, plan, timingBySourceId: new Map(),
			timingViewsBySourceId: new Map([['video-source', { kind: 'cfr', rate, frameCount: 1 }]]),
			videoBlobs: new Map([['video-source', new Blob(['capture-fixture'])]]), audioMix: null,
			editorFfmpeg: {}, webCodecs: null, signal: new AbortController().signal, maximumOutputBytes: 1024 * 1024, assertCurrent() {} });
		assert.equal(pluginCalls, 1); assert.equal(offlineCalls, 1); assert.deepEqual(loads, [ref.storageKey]);
		assert.deepEqual(Array.from(input), source); assert.deepEqual(encoder.inputCopies, [filtered]);
		assert.ok(encoder.calls[0]!.includes('libx264')); assert.ok(encoder.calls[0]!.includes('yuv420p'));
		// The selected compositor is exact straight RGBA. Declared H264/YUV420
		// delivery is lossy and removes alpha; compare identical codec parameters.
		assert.deepEqual(encoder.decode(result.bytes), encoder.decode(encoder.referenceEncode(new Uint8Array(filtered))));
	} finally { encoder.close(); }
});
