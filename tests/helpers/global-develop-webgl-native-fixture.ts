/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from '../../src/common/editor/closed-domain-value.ts';
import { createVideoEffectService, type VideoEffectProject } from '../../src/common/editor/controller/clip-video/video-effect-service.ts';
import { EditorProjectGeneration } from '../../src/common/editor/controller/shared/lifecycle.ts';
import { createVideoSource, createVideoTrack } from '../../src/common/editor/project-media-factory.ts';
import { createVideoEffect } from '../../src/common/editor/video-effects.js';
import { normalizeGlobalDevelopEffectV1 } from '../../src/common/editor/video-global-develop-v1.ts';
import { COLOR_WHEELS_EFFECT_TYPE_V1, normalizeColorWheelsEffectV1 } from '../../src/common/editor/video-color-wheels-v1.ts';
import { normalizeChromaDevelopEffectV1 } from '../../src/common/editor/video-chroma-develop-v1.ts';
import { normalizeBlackWhiteMixEffectV1 } from '../../src/common/editor/video-black-white-mix-v1.ts';
import { normalizeHslMixerEffectV1 } from '../../src/common/editor/video-hsl-mixer-v1.ts';
import { isCurvesEffectTypeV1, normalizeCurvesEffectV1 } from '../../src/common/editor/video-curves-v1.ts';
import { normalizeClarityEffectV1 } from '../../src/common/editor/video-clarity-v1.ts';
import { normalizeDetailSharpenEffectV1 } from '../../src/common/editor/video-sharpen-v1.ts';
import { withGlobalDevelopPixelFrameV1 } from '../../src/common/editor/imaging/pixel-frame-global-develop-v1.ts';
import { VideoPreviewCompositor } from '../../src/common/editor/ui/video-preview-compositor.js';
import { applyVideoPreviewEntryEffects } from '../../src/common/editor/ui/video-preview-entry-effects.js';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../../src/framescaper/editor-project-finishing-commands.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../../src/framescaper/editor-video-exact-browser-effects-finishing.ts';

type Mode = 'target' | 'frame' | 'frame-spatial' | 'frame-cancel' | 'presentation';
interface Target { readonly framebuffer: WebGLFramebuffer; readonly texture: WebGLTexture; readonly width: number; readonly height: number }
interface RenderResult { readonly pixels: number[]; readonly legacyPresentationPixels?: number[];
	readonly authoredTypes?: unknown[]; readonly globalProgramLinks?: number; readonly curveProgramLinks?: number; readonly wheelsProgramLinked?: boolean; readonly chromaProgramLinked?: boolean; readonly blackWhiteProgramLinked?: boolean; readonly hslProgramLinked?: boolean; readonly detailProgramLinked?: boolean; readonly clarityProgramLinked?: boolean; readonly glError?: number }
interface Compositor {
	readonly gl: WebGL2RenderingContext; readonly programs: readonly WebGLProgram[];
	resizeToDisplaySize(options: Readonly<{ outputWidth: number; outputHeight: number }>): void;
	passesForEffects(effects: readonly unknown[], scale: Readonly<{ x: number; y: number }>): readonly unknown[];
	render(layers: readonly unknown[], options: Readonly<Record<string, unknown>>): { status: string; renderedEntryCount: number; effects: { omitted: readonly unknown[]; fallbackRendered: readonly unknown[] } };
	captureEvaluatedRgba(): { rgba: Uint8Array } | null;
	dispose(): void;
}
const LIMITS = { maximumSidePixels: 256, maximumPixels: 256, maximumBytes: 1024 };

/** Test-only: actual native shader programs and readback; no injected renderer or expected row/pixel projection. */
export async function qualifyGlobalDevelopWebglV1(value: unknown) {
	const input = record(value, 'native global render', ['source', 'effects', 'mode', 'height'], ['source', 'effects', 'mode']);
	const source = readClosedDomainArray(field(input, 'source', 'native global render'), 'native global bytes', 4, 1024);
	if (source.length % 4 || source.some(byte => typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255)) {
		throw new TypeError('Native global fixture requires bounded RGBA bytes.');
	}
	const height = Object.hasOwn(input, 'height') ? field(input, 'height', 'native global render') : 1;
	if (typeof height !== 'number' || !Number.isSafeInteger(height) || height < 1 || height > 256 || source.length % (4 * height)) throw new RangeError('Invalid native frame height.');
	const pixels = new Uint8Array(source as number[]), width = pixels.length / (4 * height);
	const effects = readClosedDomainArray(field(input, 'effects', 'native global render'), 'native global effects', 1, 64).map(normalizeEffect);
	const mode = field(input, 'mode', 'native global render');
	if (mode !== 'target' && mode !== 'frame' && mode !== 'frame-spatial' && mode !== 'frame-cancel' && mode !== 'presentation') throw new RangeError('Unknown native global fixture mode.');
	const authored = author(effects, width, height), stop = new AbortController(), signal = stop.signal;
	const cpuPixels = effects.some(effect => effect.type === 'detail-sharpen-v1' || effect.type === 'clarity-v1')
		? await spatialCpuPixels(pixels, width, height, authored, signal)
		: await withGlobalDevelopPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width, height,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels }, effects: authored, signal }, output => Array.from(output.pixels), { limits: LIMITS });
	const nativeRead = WebGL2RenderingContext.prototype.readPixels, receivers = new Set<WebGL2RenderingContext>(); let nativeReadbacks = 0;
	let retainedOutput: Uint8Array | null = null, reasonTraps = 0;
	const reason = new Proxy({}, { get() { reasonTraps++; throw Error(); }, getPrototypeOf() { reasonTraps++; throw Error(); },
		getOwnPropertyDescriptor() { reasonTraps++; throw Error(); } });
	WebGL2RenderingContext.prototype.readPixels = function (this: WebGL2RenderingContext, ...args: unknown[]) {
		nativeReadbacks++; receivers.add(this); Reflect.apply(nativeRead, this, args);
		if (mode === 'frame-cancel') { retainedOutput = args[6] as Uint8Array; stop.abort(reason); }
	};
	try {
		const result = await render(mode, pixels, width, height, authored, signal);
		return { ...result, cpuPixels, nativeReadbacks, nativeWebgl2: receivers.size > 0 && [...receivers].every(receiver => receiver instanceof WebGL2RenderingContext) };
	} catch (error) {
		if (mode !== 'frame-cancel' || error !== reason) throw error;
		return { rejectedWithReason: error === reason, abandonedOutputZero: (retainedOutput as Uint8Array | null)?.every(byte => byte === 0) === true,
			reasonTraps, nativeReadbacks, nativeWebgl2: receivers.size > 0 && [...receivers].every(receiver => receiver instanceof WebGL2RenderingContext) };
	} finally { WebGL2RenderingContext.prototype.readPixels = nativeRead; pixels.fill(0); }
}

async function spatialCpuPixels(pixels:Uint8Array<ArrayBuffer>,width:number,height:number,effects:readonly unknown[],signal:AbortSignal){
	const output=await applyVideoExactBrowserEffectsFinishing({width,height,pixels},effects,signal);
	try{return Array.from(output.pixels);}finally{output.pixels.fill(0);}
}

function normalizeEffect(value: unknown) {
	const input = record(value,'native shared effect',['id','type','enabled','params']);
	if (field(input, 'type', 'native shared effect') === COLOR_WHEELS_EFFECT_TYPE_V1) return normalizeColorWheelsEffectV1(value);
	if(field(input,'type','native shared effect')==='clarity-v1')return normalizeClarityEffectV1(value);
	if(field(input,'type','native shared effect')==='detail-sharpen-v1')return normalizeDetailSharpenEffectV1(value);
	if (isCurvesEffectTypeV1(field(input, 'type', 'native shared effect'))) return normalizeCurvesEffectV1(value);
	if(field(input,'type','native shared effect')==='hsl-mixer-v1')return normalizeHslMixerEffectV1(value);
	if(field(input,'type','native shared effect')==='black-white-mix-v1')return normalizeBlackWhiteMixEffectV1(value);
	return field(input,'type','native shared effect') === 'chroma-v1' ? normalizeChromaDevelopEffectV1(value) : normalizeGlobalDevelopEffectV1(value);
}
function author(effects: readonly ReturnType<typeof normalizeEffect>[], width: number, height: number) {
	let project = createFramescaperProjectFinishing(PROFILE, { id: 'native-global-project', title: 'Native global', now: '2026-10-09T00:00:00.000Z',
		sources: [createVideoSource({ id: 'video-source', name: 'Fixture', storageKey: 'fixture', mimeType: 'video/mp4', contentSha256: '12'.repeat(32),
			frameCount: 48_000, sampleFrameCount: 48_000, sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width, height })],
		clips: [{ kind: 'video', id: 'video-clip', sourceId: 'video-source', title: 'Fixture', sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null }],
		tracks: [createVideoTrack({ id: 'video-track', name: 'Video', clipIds: ['video-clip'], locked: false })],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['video-track'] }], primarySequenceId: 'main-sequence' });
	const view = () => project as unknown as VideoEffectProject, generation = new EditorProjectGeneration(); generation.activate(view().id);
	const service = createVideoEffectService({ state: { selectedClipId: 'video-clip', readOnly: false, videoEffectGestures: new Map() },
		copy: { projectReadOnly: 'Read only' }, getProject: view, captureProject: () => generation.capture(view().id),
		assertProject: token => { generation.assertCurrent(token); }, editingBlocked: () => false,
		commit: command => { project = applyFramescaperProjectCommandFinishing(PROFILE, project, command); return view(); }, publishDocumentSnapshot() {} });
	for (const effect of effects) service.addVideoClipEffect('video-clip', effect.type, { id: effect.id, enabled: effect.enabled, params: effect.params });
	const persisted = cloneFramescaperProjectFinishing(PROFILE, project) as unknown as VideoEffectProject;
	return persisted.clips.find(clip => clip.id === 'video-clip')?.videoEffects ?? [];
}

async function render(mode: Mode, pixels: Uint8Array<ArrayBuffer>, width: number, height: number, effects: readonly unknown[], signal: AbortSignal): Promise<RenderResult> {
	if (mode === 'frame' || mode === 'frame-spatial' || mode === 'frame-cancel') {
		const mixed = [...effects, mode === 'frame-spatial' ? createVideoEffect('pixelate', { id: 'legacy-spatial', params: { blockSize: 2 } })
			: createVideoEffect('color-adjust', { id: 'legacy-neutral' })];
		const output = await applyVideoExactBrowserEffectsFinishing({ width, height, pixels }, mixed, signal);
		const legacyPresentation = mode === 'frame-spatial' ? await render('presentation', pixels, width, height, mixed, signal) : null;
		return { pixels: Array.from(output.pixels), legacyPresentationPixels: legacyPresentation?.pixels,
			authoredTypes: mixed.map(value => field(record(value, 'authored effect', ['id', 'type', 'enabled', 'params']), 'type', 'authored effect')) };
	}
	const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
	const compositor = new VideoPreviewCompositor(canvas) as unknown as Compositor, gl = compositor.gl;
	let texture: WebGLTexture | null = null;
	try {
		compositor.resizeToDisplaySize({ outputWidth: width, outputHeight: height });
		const globalProgramLinks = [18, 19].filter(index => gl.getProgramParameter(compositor.programs[index], gl.LINK_STATUS) === true).length;
		const curveProgramLinks = [24, 25].filter(index => gl.getProgramParameter(compositor.programs[index], gl.LINK_STATUS) === true).length;
		const wheelsProgramLinked = gl.getProgramParameter(compositor.programs[26], gl.LINK_STATUS) === true;
		const chromaProgramLinked = gl.getProgramParameter(compositor.programs[21],gl.LINK_STATUS) === true;
		const blackWhiteProgramLinked = gl.getProgramParameter(compositor.programs[22],gl.LINK_STATUS) === true;
		const hslProgramLinked = gl.getProgramParameter(compositor.programs[23],gl.LINK_STATUS) === true;
		const detailProgramLinked = gl.getProgramParameter(compositor.programs[27],gl.LINK_STATUS) === true;
		const clarityProgramLinked = gl.getProgramParameter(compositor.programs[29],gl.LINK_STATUS) === true;
		if (mode === 'presentation') {
			const drawable = new ImageData(new Uint8ClampedArray(pixels), width, height);
			const report = compositor.render([{ entries: [{ clipId: 'native-global', video: { drawable, videoWidth: width, videoHeight: height,
				readyState: 4, currentTime: 0, pause() {} }, effects, opacity: 1 }] }],
			{ outputWidth: width, outputHeight: height, referenceWidth: width, referenceHeight: height, backgroundColor: '#00000000', outputColorModel: 'rgba' });
			if (report.status !== 'rendered' || report.renderedEntryCount !== 1 || report.effects.omitted.length || report.effects.fallbackRendered.length) {
				throw new Error('Native presentation omitted authored effects.');
			}
			gl.finish(); const output = compositor.captureEvaluatedRgba(); if (!output) throw new Error('Native presentation was not captured.');
			return { pixels: Array.from(output.rgba), globalProgramLinks, curveProgramLinks, wheelsProgramLinked, chromaProgramLinked, blackWhiteProgramLinked, hslProgramLinked, glError: gl.getError() };
		}
		texture = gl.createTexture(); if (!texture) throw new Error('Native source texture allocation failed.');
		gl.bindTexture(gl.TEXTURE_2D, texture);
		for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.NEAREST);
		for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		const passes = compositor.passesForEffects(effects, { x: 1, y: 1 });
		const target = applyVideoPreviewEntryEffects(compositor, texture, passes, { x: 0, y: 0, width, height }, undefined, 'native-global') as Target;
		const output = new Uint8Array(pixels.length); gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.finish();
		gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, output);
		return { pixels: Array.from(output), globalProgramLinks, curveProgramLinks, wheelsProgramLinked, detailProgramLinked, clarityProgramLinked, chromaProgramLinked, blackWhiteProgramLinked, hslProgramLinked, glError: gl.getError() };
	} finally { if (texture) gl.deleteTexture(texture); compositor.dispose(); canvas.remove(); }
}
