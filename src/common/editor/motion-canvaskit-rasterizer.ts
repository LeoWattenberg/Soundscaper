/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CanvasKit } from 'canvaskit-wasm';
import type { MotionFontProviderOwner } from './motion-canvaskit-font-owner.ts';
import { verifyMotionAssetBody, type MotionAsset } from './motion-asset.ts';
import type { MotionTextDocument } from './motion-composition.ts';
import type { MotionCompositionFrame, MotionEvaluatedLayer } from './motion-composition-evaluation.ts';
import type { MotionRasterizer } from './motion-composition-renderer.ts';
import { motionLocalSourceBounds, motionSourceRasterMatrix, type MotionLocalRaster } from './motion-local-raster.ts';
import { assertMotionWorkingBudget, MOTION_DEFAULT_WORKING_BYTES } from './motion-render-budget.ts';
import { estimateMotionMaskWorkingBytes, type MotionMaskRasterizer } from './motion-mask-rendering.ts';
import { rasterMotionCanvasKitMask } from './motion-canvaskit-mask.ts';
import { motionCanvasKitPath } from './motion-canvaskit-path.ts';
import { rasterMotionCanvasKitSurface } from './motion-canvaskit-surface.ts';
import { estimateMotionEffectWorkingBytes, MOTION_EFFECT_TYPES, type MotionEffectRasterizer } from './motion-effect-rendering.ts';
import { rasterMotionCanvasKitEffect } from './motion-canvaskit-effect.ts';
import type { EvaluatedMotionState } from './motion-property-evaluation.ts';
import type { Rational } from './timeline-time.ts';
import { createMotionParagraph, type MotionFontBytes, type MotionShapedText } from './motion-canvaskit-text.ts';
import { withMotionCanvasKitPaint as paint } from './motion-canvaskit-paint.ts';
import { motionTextAnimationBounds } from './motion-text-animation.ts';
import { drawMotionAnimatedParagraph } from './motion-canvaskit-text-animation.ts';
import { drawMotionCanvasKitShapes } from './motion-canvaskit-shape-operators.ts';
import { rasterMotionCornerPinEffect } from './motion-corner-pin-raster.ts';
import { planMotionShapeOperators } from './motion-shape-operator-plan.ts';
import { assertMotion2DMatrix, createMotionSurface, motionSurfaceFromRgba8, motionSurfaceLength, transformMotionSurface, validateMotionSurface, type MotionSurface } from './motion-surface.ts';

export interface MotionRasterResources {
	readonly fontProviders?: MotionFontProviderOwner;
	readonly assets: readonly MotionAsset[];
	readonly loadAsset: (asset: MotionAsset, signal?: AbortSignal) => Promise<Uint8Array>;
	readonly fallbackFonts: readonly MotionFontBytes[];
	readonly decodeFootage?: (asset: Extract<MotionAsset, { kind: 'footage' }>, sourceTime: Rational, signal?: AbortSignal) => Promise<MotionSurface>;
}
export interface CanvasKitMotionRasterizer extends MotionRasterizer {
	shapeText(document: EvaluatedMotionState<MotionTextDocument>, signal?: AbortSignal): Promise<MotionShapedText>;
	rasterizeSource(layer: MotionEvaluatedLayer, target: MotionCompositionFrame, signal?: AbortSignal): Promise<MotionLocalRaster>;
	estimateMaskWorkingBytes: MotionMaskRasterizer['estimateMaskWorkingBytes'];
	rasterizeMask: MotionMaskRasterizer['rasterizeMask'];
	estimateEffectWorkingBytes: MotionEffectRasterizer['estimateEffectWorkingBytes'];
	rasterizeEffect: MotionEffectRasterizer['rasterizeEffect'];
}

/** CanvasKit supplies coverage and paragraph shaping; float channels remain in the document's linear working space. */
export function createCanvasKitMotionRasterizer(kit: CanvasKit, resources: MotionRasterResources): CanvasKitMotionRasterizer {
	const assets = new Map(resources.assets.map((asset) => [asset.id, asset]));
	const fontsFor = async (document: EvaluatedMotionState<MotionTextDocument>, signal?: AbortSignal): Promise<readonly MotionFontBytes[]> => {
		const fonts: MotionFontBytes[] = [];
		for (const id of new Set(document.runs.map((run) => run.fontAssetId))) {
			const asset = assets.get(id);
			if (asset?.kind !== 'font') throw new Error(`Missing motion font asset ${id}.`);
			fonts.push({ id, bytes: await verifiedBytes(asset, signal) });
		}
		return fonts;
	};
	async function verifiedBytes(asset: MotionAsset, signal?: AbortSignal): Promise<Uint8Array> {
		signal?.throwIfAborted();
		const bytes = await resources.loadAsset(asset, signal);
		signal?.throwIfAborted(); verifyMotionAssetBody(asset, bytes);
		return bytes;
	}
	const rasterizer: CanvasKitMotionRasterizer = {
		supportedSourceOperations: ['text-animator', 'shape-operator'],
		supportedEffectTypes: MOTION_EFFECT_TYPES,
		estimateEffectWorkingBytes: estimateMotionEffectWorkingBytes,
		async rasterizeEffect(effect, source, signal) { return effect.type === 'corner-pin' ? rasterMotionCornerPinEffect(effect, source, signal) : rasterMotionCanvasKitEffect(kit, effect, source, signal); },
		estimateMaskWorkingBytes: estimateMotionMaskWorkingBytes,
		async rasterizeMask(mask, target, signal) { rasterMotionCanvasKitMask(kit, mask, target, signal); },
		estimateSourceWorkingBytes(layer, target) {
			assertSourceAuthoringReady(layer.state);
			const bounds = motionLocalSourceBounds(layer.state, assets);
			return Math.max(rasterizer.estimateWorkingBytes!(layer, { ...target, width: bounds.width, height: bounds.height }),
				layer.state.masks.length ? estimateMotionMaskWorkingBytes(bounds.width, bounds.height, layer.state.masks) : 0,
				layer.state.effects.some((effect) => effect.enabled) ? estimateMotionEffectWorkingBytes(bounds.width, bounds.height, layer.state.effects, bounds.origin) : 0);
		},
		async rasterizeSource(layer, target, signal) {
			signal?.throwIfAborted();
			const bounds = motionLocalSourceBounds(layer.state, assets);
			assertMotionWorkingBudget(rasterizer.estimateSourceWorkingBytes!(layer, target), MOTION_DEFAULT_WORKING_BYTES);
			const surface = bounds.empty ? createMotionSurface(1, 1) : await rasterizer.rasterize({ ...layer, worldMatrix: motionSourceRasterMatrix(bounds.origin) },
				{ ...target, width: bounds.width, height: bounds.height }, signal);
			signal?.throwIfAborted();
			return { surface, origin: bounds.origin };
		},
		estimateWorkingBytes(layer, target) {
			assertSourceAuthoringReady(layer.state);
			const output = motionSurfaceLength(target.width, target.height) * 4;
			const state = layer.state;
			if (state.kind === 'image' || state.kind === 'footage') {
				const asset = assets.get(state.assetId);
				if (asset?.kind === 'image' || asset?.kind === 'footage') return output + motionSurfaceLength(asset.width, asset.height) * 8 + (asset.kind === 'image' ? asset.byteLength : 0);
			}
			const fontBytes = state.kind === 'text' ? [...new Set(state.document.runs.map((run) => run.fontAssetId))].reduce((sum, id) => sum + (assets.get(id)?.byteLength ?? 0), 0)
				+ resources.fallbackFonts.reduce((sum, font) => sum + font.bytes.length, 0) : 0;
			const textWorking = state.kind === 'text' ? state.document.runs.reduce((sum, run) => sum + run.text.length, 0) * (1 + (state.document.animators?.filter((item) => item.enabled).length ?? 0)) * 256 : 0;
			return output * (state.kind === 'text' ? 4 : 2) + fontBytes * 4 + textWorking + (state.kind === 'shapes' ? planMotionShapeOperators(state).workingBytes : 0);
		},
		async shapeText(document, signal) {
			const paragraph = createMotionParagraph(kit, document, await fontsFor(document, signal), resources.fallbackFonts, resources.fontProviders);
			try { signal?.throwIfAborted(); return paragraph.metrics; } finally { paragraph.dispose(); }
		},
		async rasterize(layer, target, signal) {
			signal?.throwIfAborted(); assertMotion2DMatrix(layer.worldMatrix);
			const state = layer.state;
			assertSourceAuthoringReady(state);
			if (state.kind === 'image' || state.kind === 'footage') {
				const asset = assets.get(state.assetId);
				if (!asset || asset.kind !== state.kind) throw new Error(`Missing motion ${state.kind} asset ${state.assetId}.`);
				let source: MotionSurface;
				if (asset.kind === 'footage') {
					if (!resources.decodeFootage) throw new Error('Motion footage decoding is unavailable.');
					source = await resources.decodeFootage(asset, layer.sourceTime, signal);
					validateMotionSurface(source);
				} else source = decodeImage(kit, await verifiedBytes(asset, signal), asset);
				if (source.width !== asset.width || source.height !== asset.height) throw new Error(`Motion asset ${asset.id} decoded dimensions differ from its retained metadata.`);
				signal?.throwIfAborted(); return transformMotionSurface(source, target.width, target.height, layer.worldMatrix);
			}
			if (state.kind !== 'solid' && state.kind !== 'shapes' && state.kind !== 'text') throw new Error(`Unsupported motion raster source ${state.kind}.`);
			const paragraph = state.kind === 'text' ? createMotionParagraph(kit, state.document, await fontsFor(state.document, signal), resources.fallbackFonts, resources.fontProviders) : null;
			try {
				return rasterMotionCanvasKitSurface(kit, target.width, target.height, (canvas) => {
					const m = layer.worldMatrix;
					canvas.concat([m[0], m[4], m[12], m[1], m[5], m[13], 0, 0, 1]);
					if (state.kind === 'text' && paragraph) {
						drawMotionAnimatedParagraph(kit, canvas, paragraph.shapedLines, state.document, signal);
					} else if (state.kind === 'solid') {
						if (state.size.some((value) => !Number.isFinite(value) || value < 0 || value > 32768)) throw new RangeError('Motion solid dimensions are outside the rendering range.');
						paint(kit, state.color, (brush) => canvas.drawRect(kit.XYWHRect(0, 0, ...state.size), brush));
					} else if (state.kind === 'shapes') {
						if (state.operators?.some((operator) => operator.enabled)) { drawMotionCanvasKitShapes(kit, canvas, state, signal); return; }
						for (const shape of state.shapes) {
							const path = motionCanvasKitPath(kit, shape.path);
							try {
								if (shape.fill) paint(kit, shape.fill, (brush) => canvas.drawPath(path, brush));
								if (shape.stroke) {
									const stroke = shape.stroke;
									if (!Number.isFinite(stroke.width) || stroke.width < 0 || stroke.width > 32768) throw new RangeError('Motion stroke width is outside the rendering range.');
									if (stroke.width > 0) paint(kit, stroke.color, (brush) => {
										brush.setStyle(kit.PaintStyle.Stroke); brush.setStrokeWidth(stroke.width); brush.setStrokeMiter(4);
										brush.setStrokeCap({ butt: kit.StrokeCap.Butt, round: kit.StrokeCap.Round, square: kit.StrokeCap.Square }[stroke.lineCap]);
										brush.setStrokeJoin({ miter: kit.StrokeJoin.Miter, round: kit.StrokeJoin.Round, bevel: kit.StrokeJoin.Bevel }[stroke.lineJoin]);
										canvas.drawPath(path, brush);
									});
								}
							} finally { path.delete(); }
						}
					}
				});
			} finally { paragraph?.dispose(); }
		},
	};
	return rasterizer;
}

function assertSourceAuthoringReady(state: MotionEvaluatedLayer['state']): void {
	if (state.kind === 'shapes') planMotionShapeOperators(state);
	if (state.kind === 'text' && state.document.animators?.some((animator) => animator.enabled)) motionTextAnimationBounds(state.document);
}

function decodeImage(kit: CanvasKit, bytes: Uint8Array, asset: Extract<MotionAsset, { kind: 'image' }>): MotionSurface {
	const image = kit.MakeImageFromEncoded(bytes);
	if (!image) throw new Error('Motion image format could not be decoded.');
	try {
		if (image.width() !== asset.width || image.height() !== asset.height) throw new Error(`Motion asset ${asset.id} decoded dimensions differ from its retained metadata.`);
		motionSurfaceLength(image.width(), image.height());
		const pixels = image.readPixels(0, 0, { width: image.width(), height: image.height(), colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB });
		if (!(pixels instanceof Uint8Array)) throw new Error('Motion image pixel decoding failed.');
		return motionSurfaceFromRgba8(image.width(), image.height(), pixels, 'srgb');
	} finally { image.delete(); }
}
