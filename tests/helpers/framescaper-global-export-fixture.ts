/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoSource, createVideoTrack } from '../../src/common/editor/project-media-factory.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../../src/framescaper/editor-project-finishing.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from '../../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from '../../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { createFramescaperSelectedExactFrameExecutionFinishing, type CaptureFrameFinishing } from '../../src/framescaper/selected-finishing-exact-frame-execution.ts';
import { createVideoEffect, normalizeVideoEffect } from '../../src/common/editor/video-effects.js';
import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../../src/common/editor/closed-domain-value.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { renderVideoPreviewStraightRgba } from '../../src/common/editor/ui/video-preview-straight-rgba.ts';

/** Maintained real WebGL2 code28 over typed straight bytes; no Canvas ingress
 * quantization or capability skip is substituted for shader execution. */
export async function qualifyPostCropVignetteNativeV1() {
	const cases=[{width:3,height:3,pixels:new Uint8Array(Array.from({length:9},()=>[128,64,255,127]).flat()),params:{amount:-100}},
		{width:3,height:3,pixels:new Uint8Array(Array.from({length:9},()=>[128,64,255,127]).flat()),params:{amount:100}},
		{width:16,height:16,pixels:new Uint8Array(Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat()),params:{amount:-100,midpoint:0,feather:0,roundness:100}},
		{width:4095,height:1,pixels:new Uint8Array(Array.from({length:4095},()=>[128,64,255,127]).flat()),params:{amount:-100,roundness:100}},
		{width:2,height:1,pixels:new Uint8Array([255,255,255,127,128,64,32,127]),params:{amount:-100,midpoint:0,feather:0,highlights:100}}];
	const results=[];
	for(const input of cases){
		const before=[...input.pixels],effects=[createVideoEffect('post-crop-vignette-v1',{id:'vignette',params:input.params})];
		let rendered:Awaited<ReturnType<typeof renderVideoPreviewStraightRgba>>|undefined,cpu:Awaited<ReturnType<typeof applyVideoExactBrowserEffectsFinishing>>|undefined;
		try{
			rendered=await renderVideoPreviewStraightRgba({width:input.width,height:input.height,pixels:input.pixels},effects,new AbortController().signal);
			cpu=await applyVideoExactBrowserEffectsFinishing({width:input.width,height:input.height,pixels:input.pixels},effects,new AbortController().signal);
			results.push({pixels:[...rendered.pixels],cpu:[...cpu.pixels],source:[...input.pixels],before});
		}finally{rendered?.pixels.fill(0);cpu?.pixels.fill(0);input.pixels.fill(0);}
	}
	return results;
}

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
export async function qualifyGlobalExportNativeV1(mode: 'opaque' | 'geometry-alpha' | 'chroma' | 'black-white' | 'hsl' | 'curves' | 'curves-reverse' | 'detail' | 'clarity') {
	const source = new Uint8Array(mode === 'clarity' ? [64,64,64,255,128,128,128,255,192,192,192,255,128,128,128,255]
		: mode === 'detail' ? [40,80,120,255,100,140,180,255,160,200,240,255,220,60,20,255]
		: (mode === 'black-white'||mode==='hsl') ? [255,0,0,255,0,0,0,255,128,128,128,255,0,0,255,255] : mode !== 'geometry-alpha'
		? [0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255]
		: [0,0,0,0,255,255,255,1,255,255,255,127,128,128,128,255]);
	const curves = [createVideoEffect('point-curves-v1', { id: 'point', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } }),
		createVideoEffect('parametric-curves-v1', { id: 'parametric', params: { masterShadows: 100 } })];
	const effects = mode === 'clarity' ? [createVideoEffect('clarity-v1',{id:'clarity',params:{amount:100}})]
		: mode === 'detail' ? [createVideoEffect('detail-sharpen-v1',{id:'detail',params:{amount:100,threshold:0}})]
		: mode === 'curves' ? curves : mode === 'curves-reverse' ? [...curves].reverse()
		: mode === 'hsl' ? [createVideoEffect('hsl-mixer-v1',{id:'hsl',params:{redHue:60,orangeHue:60,yellowHue:60,greenHue:60,aquaHue:60,blueHue:60,purpleHue:60,magentaHue:60}}),
		createVideoEffect('tone-ladder-v1',{id:'tone',params:{exposure:-1}})]
		: mode === 'black-white' ? [createVideoEffect('black-white-mix-v1',{id:'mono',params:{red:100,blue:100}}),
		createVideoEffect('tone-ladder-v1',{id:'tone',params:{exposure:-1}})]
		: mode === 'chroma' ? [createVideoEffect('chroma-v1',{id:'chroma',params:{saturation:-100,vibrance:73.25}})]
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

/** A real menu-authored video recipe, evaluated on a separate literal PNG source.
 * Native Canvas ingress and the maintained selected composition deliver the
 * pre-encode bytes. This does not encode or export the imported A/V original. */
export async function qualifyAuthoredSpatialExportNativeV1(value: unknown) {
	const input = readClosedDomainRecord(value, 'authored spatial export witness', ['effects', 'png']);
	const effects = readClosedDomainArray(readClosedDomainField(input, 'effects', 'authored spatial export witness'),
		'authored spatial effects', 1, 1).map(candidate => normalizeVideoEffect(candidate));
	const effect = effects[0]!;
	if (!effect.enabled || !['noise-reduction-v1', 'grain-v1', 'texture-v1', 'dehaze-v1'].includes(effect.type)) {
		throw new RangeError('The native witness requires one enabled authored spatial effect.');
	}
	const png = readClosedDomainArray(readClosedDomainField(input, 'png', 'authored spatial export witness'),
		'literal PNG bytes', 1, 32 * 1024).map(byte => {
		if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) throw new TypeError('Literal PNG bytes refuse.');
		return byte;
	});
	const bytes = new Uint8Array(png), captured: number[][] = [];
	const canvas = document.createElement('canvas');
	const nativeRead = CanvasRenderingContext2D.prototype.getImageData;
	const receivers = new Set<CanvasRenderingContext2D>();
	let bitmap: ImageBitmap | undefined;
	try {
		bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
		if (bitmap.width !== 2 || bitmap.height !== 2) throw new RangeError('The literal native witness requires a 2 by 2 PNG.');
		canvas.width = bitmap.width; canvas.height = bitmap.height;
		const drawing = canvas.getContext('2d');
		if (!drawing) throw new Error('Native Canvas2D is required.');
		drawing.drawImage(bitmap, 0, 0);
		CanvasRenderingContext2D.prototype.getImageData = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof nativeRead>) {
			const image: unknown = Reflect.apply(nativeRead, this, args);
			if (!(image instanceof ImageData)) throw new TypeError('The native Canvas capture did not return ImageData.');
			receivers.add(this); captured.push(Array.from(image.data)); return image;
		};
		const context = createGlobalExportContextV1(effects, bitmap.width, bitmap.height);
		const result = await renderGlobalExportFrameV1(context, canvas);
		return { ...result, captured, nativeCanvasCapture: receivers.size > 0
			&& [...receivers].every(receiver => receiver instanceof CanvasRenderingContext2D), effects };
	} finally {
		CanvasRenderingContext2D.prototype.getImageData = nativeRead;
		bitmap?.close(); canvas.width = 0; canvas.height = 0; canvas.remove(); bytes.fill(0);
	}
}
