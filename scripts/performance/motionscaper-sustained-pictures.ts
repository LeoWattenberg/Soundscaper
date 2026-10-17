/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type CanvasKitInit from 'canvaskit-wasm';
import type { CanvasKit } from 'canvaskit-wasm';
import manifest from '../../config/motionscaper-raster-runtime.json';
import { verifyMotionAssetBody, type MotionAsset } from '../../src/common/editor/motion-asset.ts';
import { createMotionFontProviderOwner, type MotionFontProviderOwner } from '../../src/common/editor/motion-canvaskit-font-owner.ts';
import { createCanvasKitMotionRasterizer } from '../../src/common/editor/motion-canvaskit-rasterizer.ts';
import { renderMotionCompositionFrame, motionCpuCompositor } from '../../src/common/editor/motion-composition-renderer.ts';
import { createMotionExpressionAudioPreparation, motionProjectUsesAudioAmplitude, type MotionExpressionAudioPreparation } from '../../src/common/editor/motion-expression-audio-preparation.ts';
import { createMotionMediaProvider, type MotionMediaProvider } from '../../src/common/editor/motion-media-provider.ts';
import type { MotionscaperProject } from '../../src/common/editor/motion-project-types.ts';
import { encodeMotionChannel, motionSurfaceToRgba8, validateMotionSurface, type MotionSurface } from '../../src/common/editor/motion-surface.ts';
import { admitMotionTemporalWork, planMotionTemporalSamples } from '../../src/common/editor/motion-temporal-sampling.ts';
import { renderMotionTemporalSamples } from '../../src/common/editor/motion-temporal-rendering.ts';
import { compileMotionscaperProject } from '../../src/motionscaper/editor-project-evaluation.ts';
import { createMotionscaperRevision } from '../../src/motionscaper/editor-project-revision.ts';
import { decodeMotionPngPixels } from '../../tests/browser/helpers/motion-png-pixels.ts';
import { MOTION_SUSTAINED_PLAN as plan } from './motionscaper-sustained-plan.ts';

export interface MotionSustainedPicture {
	readonly index: number; readonly surface: MotionSurface;
	readonly previewRgba: Uint8ClampedArray; readonly webmRgba: Uint8Array;
}
function geometry(surface: MotionSurface): void {
	if (surface.width !== plan.width || surface.height !== plan.height) throw new Error('Sustained reference geometry differs.');
	validateMotionSurface(surface);
}
/** Full-frame comparison at the declared straight-sRGB canvas boundary; alpha remains exact. */
export function compareMotionSustainedRgba(actual: Uint8Array | Uint8ClampedArray, reference: MotionSurface) {
	geometry(reference); const expected = motionSurfaceToRgba8(reference, 'srgb');
	if (!(actual instanceof Uint8Array || actual instanceof Uint8ClampedArray) || actual.length !== expected.length) throw new Error('Sustained RGBA geometry differs.');
	let maximumPremultipliedError = 0;
	for (let at = 0; at < actual.length; at += 4) {
		if (actual[at + 3] !== expected[at + 3]) throw new Error(`Sustained alpha differs at pixel ${at / 4}.`);
		for (let channel = 0; channel < 3; channel++) maximumPremultipliedError = Math.max(maximumPremultipliedError, Math.abs(actual[at + channel]! - expected[at + channel]!) * expected[at + 3]! / 255);
	}
	if (maximumPremultipliedError > plan.maximumPreviewPremultipliedError) throw new Error(`Sustained premultiplied code error exceeds its declared bound: ${maximumPremultipliedError}.`);
	return { maximumPremultipliedError, alphaExact: true as const };
}
/** Native decoder returns straight, nonlinear Rec709 Float32 RGBA, with normalized source-depth alpha. */
export function compareMotionSustainedNative(actual: Float32Array, reference: MotionSurface) {
	geometry(reference);
	if (!(actual instanceof Float32Array) || actual.length !== reference.pixels.length) throw new Error('Sustained native geometry differs.');
	let maximumColorError = 0, maximumAlphaError = 0;
	for (let at = 0; at < actual.length; at += 4) {
		for (let channel = 0; channel < 4; channel++) if (!Number.isFinite(actual[at + channel]) || actual[at + channel]! < 0 || actual[at + channel]! > 1) throw new Error('Sustained native channels must be finite normalized values.');
		const alpha = reference.pixels[at + 3]!, decodedAlpha = actual[at + 3]!;
		if ((alpha === 0 || alpha === 1) && decodedAlpha !== alpha) throw new Error('Sustained native alpha endpoint differs.');
		maximumAlphaError = Math.max(maximumAlphaError, Math.abs(decodedAlpha - alpha));
		if (alpha) for (let channel = 0; channel < 3; channel++) maximumColorError = Math.max(maximumColorError,
			Math.abs(actual[at + channel]! - encodeMotionChannel(Math.min(1, reference.pixels[at + channel]! / alpha), 'rec709')));
	}
	if (maximumColorError > plan.maximumNativeColorError) throw new Error(`Sustained native color error exceeds its declared bound: ${maximumColorError}.`);
	if (maximumAlphaError > plan.maximumNativeAlphaError) throw new Error(`Sustained native alpha error exceeds its declared bound: ${maximumAlphaError}.`);
	return { maximumColorError, maximumAlphaError, alphaEndpointsExact: true as const };
}
/** Black matte is applied in premultiplied linear light BEFORE Rec709 encoding. No encoded-space alpha multiply. */
export function motionSustainedWebmReference(surface: MotionSurface): Uint8Array {
	geometry(surface); const bytes = new Uint8Array(surface.pixels.length);
	for (let at = 0; at < bytes.length; at += 4) {
		for (let channel = 0; channel < 3; channel++) bytes[at + channel] = Math.round(255 * encodeMotionChannel(Math.min(1, surface.pixels[at + channel]!), 'rec709'));
		bytes[at + 3] = 255;
	}
	return bytes;
}
/** Decode only admitted selected PNGs; the caller owns the already authenticated runtime. */
export function decodeMotionSustainedPng(kit: CanvasKit, bytes: Uint8Array): Uint8Array {
	if (bytes.byteLength < 33 || bytes.byteLength > plan.width * plan.height * 6 + 65536) throw new Error('Sustained PNG byte admission differs.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(16) !== plan.width || view.getUint32(20) !== plan.height) throw new Error('Sustained PNG geometry differs.');
	const header = decodeMotionPngPixels(bytes);
	if (header.width !== plan.width || header.height !== plan.height) throw new Error('Sustained PNG geometry differs.');
	const image = kit.MakeImageFromEncoded(bytes); if (!image) throw new Error('Sustained CanvasKit PNG decode failed.');
	try {
		if (image.width() !== plan.width || image.height() !== plan.height) throw new Error('Sustained CanvasKit PNG geometry differs.');
		const pixels = image.readPixels(0, 0, { width: plan.width, height: plan.height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB });
		if (!(pixels instanceof Uint8Array) || pixels.length !== plan.width * plan.height * 4) throw new Error('Sustained CanvasKit PNG pixel layout differs.');
		return new Uint8Array(pixels);
	} finally { image.delete(); }
}
async function pinnedRuntime(root: string) {
	async function pinned(id: string) {
		const pin = manifest.assets.find(value => value.id === id); if (!pin) throw new Error('Missing sustained raster runtime pin.');
		const path = join(root, 'node_modules', pin.source), before = await stat(path);
		if (!before.isFile() || before.size !== pin.byteLength) throw new Error(`Sustained raster runtime size differs: ${id}.`);
		const bytes = new Uint8Array(await readFile(path));
		if (bytes.byteLength !== pin.byteLength || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw new Error(`Sustained raster runtime digest differs: ${id}.`);
		return { id, bytes };
	}
	await pinned('loader'); const wasm = await pinned('wasm');
	const fallbackFonts = [];
	for (const asset of manifest.assets) if (asset.id.startsWith('inter-')) fallbackFonts.push(await pinned(asset.id));
	const initialize = createRequire(join(root, 'package.json'))(join(root, 'node_modules/canvaskit-wasm/bin/canvaskit.js')) as typeof CanvasKitInit;
	const kit = await initialize({ wasmBinary: wasm.bytes, locateFile: () => join(root, 'node_modules/canvaskit-wasm/bin/canvaskit.wasm') } as Parameters<typeof CanvasKitInit>[0] & { wasmBinary: Uint8Array });
	return { kit, fallbackFonts };
}
/** Called only after immutable plan approval; imports alone do not initialize CanvasKit or render anything.
 * One private runtime/font owner renders exactly three selected frames at authored shutter/lens quality.
 * dispose deletes native font providers and drops the runtime reference; it does not claim WASM heap reclamation.
 */
export async function prepareMotionSustainedPictures(options: {
	project: MotionscaperProject; bodies: ReadonlyMap<string, Uint8Array>; frames: 300 | 1200; root: string;
}) {
	if (!plan.runs.includes(options.frames)) throw new Error('Sustained reference range differs.');
	const revision = createMotionscaperRevision(options.project), project = revision.project;
	const composition = project.compositions.find(value => value.id === project.primaryCompositionId);
	if (!composition || composition.width !== plan.width || composition.height !== plan.height || composition.frameRate.num !== plan.fps || composition.frameRate.den !== 1
		|| composition.durationFrames < options.frames) throw new Error('Sustained reference geometry or range differs.');
	if (project.assets.length > 32 || options.bodies.size !== project.assets.length || project.assets.some(asset => asset.kind === 'footage')) throw new Error('Sustained reference retained asset admission differs.');
	const bodies = new Map<string, Uint8Array>(); let total = 0;
	for (const asset of project.assets) {
		total += asset.byteLength; if (total > 64 * 1024 * 1024) throw new Error('Sustained reference asset bytes exceed admission.');
		const body = options.bodies.get(asset.id); if (!body) throw new Error('Missing sustained reference original.');
		verifyMotionAssetBody(asset, body); bodies.set(asset.id, new Uint8Array(body));
	}
	admitMotionTemporalWork(project, composition.id);
	const runtime = await pinnedRuntime(options.root), kit = runtime.kit;
	let fonts: MotionFontProviderOwner | null = null, media: MotionMediaProvider | null = null, expressionAudio: MotionExpressionAudioPreparation | undefined;
	try {
		fonts = createMotionFontProviderOwner(kit); media = createMotionMediaProvider({ loadAsset });
		expressionAudio = motionProjectUsesAudioAmplitude(project) ? createMotionExpressionAudioPreparation({ project, provider: media }) : undefined;
		const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: project.assets, fallbackFonts: runtime.fallbackFonts, fontProviders: fonts, loadAsset });
		const evaluator = compileMotionscaperProject(project), pictures: MotionSustainedPicture[] = [];
		for (const index of [0, options.frames / 2, options.frames - 1]) {
			const surface = await renderMotionTemporalSamples({ evaluator, plan: planMotionTemporalSamples(composition, { num: index, den: plan.fps }), expressionAudio,
				render: (frame, quality) => renderMotionCompositionFrame(frame, { rasterizer, compositor: motionCpuCompositor, ...quality }) });
			geometry(surface); pictures.push({ index, surface, previewRgba: motionSurfaceToRgba8(surface, 'srgb'), webmRgba: motionSustainedWebmReference(surface) });
		}
		return pictureLease(pictures, kit, fonts);
	} catch (error) { fonts?.dispose(); throw error; }
	finally { expressionAudio?.dispose(); media?.dispose(); bodies.clear(); }
	function loadAsset(asset: MotionAsset): Promise<Uint8Array> {
		const bytes = bodies.get(asset.id); if (!bytes) throw new Error('Sustained reference original is unavailable.'); return Promise.resolve(bytes);
	}
}

/** Keep returned closures separate from rasterizer/evaluator/media locals, which must not survive preparation. */
function pictureLease(pictures: MotionSustainedPicture[], runtime: CanvasKit, fontOwner: MotionFontProviderOwner) {
	const held: { kit: CanvasKit | null; fonts: MotionFontProviderOwner | null } = { kit: runtime, fonts: fontOwner };
	return { pictures: Object.freeze(pictures), decodePng(bytes: Uint8Array): Uint8Array {
		if (!held.kit) throw new Error('Sustained picture lease is disposed.'); return decodeMotionSustainedPng(held.kit, bytes);
	}, dispose() { held.fonts?.dispose(); held.fonts = null; held.kit = null; } };
}
