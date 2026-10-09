/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoSource, createVideoTrack } from '../../src/common/editor/project-media-factory.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../../src/framescaper/editor-project-finishing.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from '../../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from '../../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { createFramescaperSelectedExactFrameExecutionFinishing, type CaptureFrameFinishing } from '../../src/framescaper/selected-finishing-exact-frame-execution.ts';
import { createVideoEffect } from '../../src/common/editor/video-effects.js';
import { applyVideoExactBrowserEffectsFinishing } from '../../src/framescaper/editor-video-exact-browser-effects-finishing.ts';

/** One actual persisted Frame recipe and its owning exact render/timing authority. */
export function createGlobalExportContextV1(effects: readonly unknown[], width: number, height: number, backgroundColor = '#00000000') {
	const rate = Object.freeze({ num: 10, den: 1 });
	const project = createFramescaperProjectFinishing(PROFILE, {
		id: 'global-export-project', title: 'Global export', now: '2026-10-09T00:00:00.000Z',
		sources: [createVideoSource({ id: 'video-source', name: 'RGBA fixture', storageKey: 'fixture', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), frameCount: 4800, sampleFrameCount: 4800, sourceFrameCount: 1, frameRate: rate, width, height })],
		clips: [{ kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'RGBA fixture', sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1, retimeMap: null, videoEffects: effects }],
		tracks: [createVideoTrack({ id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false })],
		sequences: [{ id: 'main-sequence', rate, trackIds: ['video-track'] }], primarySequenceId: 'main-sequence',
		finishing: { colorContexts: [{ schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
			outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }] },
	});
	const timingViews = new Map([['video-source', { kind: 'cfr' as const, rate, frameCount: 1 }]]);
	const plan = createFramescaperProjectUnifiedExactRenderPlanFinishing(PROFILE, project, {
		sequenceId: 'main-sequence', sampleStart: 0, sampleDuration: 4800, outputRate: rate,
		format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: { video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p' },
		canvas: { width, height, fit: 'contain', pixelFormat: 'yuv420p', backgroundColor },
		quality: 'balanced', includeAudio: false, audioLayout: null, timingViews, visualFreshnessByModelId: new Map(),
	});
	return { project, plan, timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsFinishing(project, timingViews), width, height };
}

/** Actual browser Canvas capture, maintained selected finishing and native mixed effect readback. */
export async function qualifyGlobalExportNativeV1(mode: 'opaque' | 'geometry-alpha' | 'chroma') {
	const source = new Uint8Array(mode !== 'geometry-alpha'
		? [0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255]
		: [0,0,0,0,255,255,255,1,255,255,255,127,128,128,128,255]);
	const effects = mode === 'chroma' ? [createVideoEffect('chroma-v1',{id:'chroma',params:{saturation:-100,vibrance:73.25}})]
		: mode === 'opaque' ? [createVideoEffect('white-balance-v1', { id: 'wb', params: { temperature: 100 } }),
		createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } })]
		: [createVideoEffect('develop-geometry-v1', { id: 'geometry', params: { rotationDegrees: 90 } }),
			createVideoEffect('color-adjust', { id: 'legacy-neutral' }), createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })];
	const context = createGlobalExportContextV1(effects, 2, 2), canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
	const drawing = canvas.getContext('2d'); if (!drawing) throw new Error('Native Canvas2D unavailable.');
	drawing.putImageData(new ImageData(new Uint8ClampedArray(source), 2, 2), 0, 0);
	const read = CanvasRenderingContext2D.prototype.getImageData, glRead = WebGL2RenderingContext.prototype.readPixels;
	const captured: number[][] = []; let nativeReadbacks = 0;
	CanvasRenderingContext2D.prototype.getImageData = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof read>) {
		const result = Reflect.apply(read, this, args) as ImageData; captured.push(Array.from(result.data)); return result;
	};
	WebGL2RenderingContext.prototype.readPixels = function (this: WebGL2RenderingContext, ...args: unknown[]) {
		nativeReadbacks++; Reflect.apply(glRead, this, args);
	};
	try {
		const result = await renderGlobalExportFrameV1(context, canvas);
		const effected = await applyVideoExactBrowserEffectsFinishing({ width: 2, height: 2, pixels: source }, effects, new AbortController().signal);
		return { ...result, effectedPixels: Array.from(effected.pixels), captured, nativeReadbacks,
			authoredTypes: effects.map(value => value.type), sourceUnchanged: Array.from(source) };
	} finally {
		CanvasRenderingContext2D.prototype.getImageData = read; WebGL2RenderingContext.prototype.readPixels = glRead;
		source.fill(0); canvas.remove();
	}
}

export async function renderGlobalExportFrameV1(context: ReturnType<typeof createGlobalExportContextV1>,
	drawable?: CanvasImageSource, captureFrame?: CaptureFrameFinishing) {
	const signal = new AbortController().signal, { width, height, project } = context;
	const clips = project.clips as readonly Readonly<{ id: string; videoEffects: readonly unknown[] }>[];
	const clip = clips.find(value => value.id === 'video-clip');
	if (!clip) throw new Error('Owning fixture clip missing.');
	const execution = await createFramescaperSelectedExactFrameExecutionFinishing({ ...context,
		...(captureFrame ? { captureFrame } : {}), signal, assertCurrent() {} });
	const target = new Uint8Array(width * height * 4);
	try {
		const result = await execution.render({ sequencePosition: { num: 0, den: 1 }, timelineSample: 0, outputOrdinal: 0,
			width, height, target, signal, layers: [{ trackId: 'video-track', entries: [{ clipId: 'video-clip', sourceId: 'video-source',
				presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 }, displayWidth: width, displayHeight: height,
				video: { drawable, videoWidth: width, videoHeight: height }, effects: clip.videoEffects, intervalProgress: 0,
				renderDescription: { crop: { normalized: { left: 0, top: 0, right: 0, bottom: 0 }, sourcePixels: { x: 0, y: 0, width, height } },
					sourceDisplayToCanvas: [1,0,0,1,0,0], opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0 } }] }] });
		return { pixels: Array.from(target), ...result };
	} finally { target.fill(0); await execution.dispose(); }
}
