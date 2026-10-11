/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionAeLayerBlend } from '../common/editor/motion-ae-layer-blend.ts';
import { normalizeMotionAeExchange } from '../common/editor/motion-ae-exchange.ts';
import type { MotionAeComposition, MotionAeExchange, MotionAeLayer, MotionAeReportEntry } from '../common/editor/motion-ae-exchange-types.ts';
import { motionAeRenderedSequence } from '../common/editor/motion-ae-render-sequence.ts';
import { motionAeBoundedClock } from '../common/editor/motion-ae-property-conversion.ts';
import { convertMotionAeTransform } from '../common/editor/motion-ae-transform-conversion.ts';
import { convertMotionAeSceneLayer, type MotionAeSceneConversion, type MotionAeSceneReview } from '../common/editor/motion-ae-scene-conversion.ts';
import { convertMotionAeShapes } from '../common/editor/motion-ae-shape-conversion.ts';
import { convertMotionAeMasks } from '../common/editor/motion-ae-mask-conversion.ts';
import { convertMotionAeTextLayer, rebaseMotionAeTextLayer, type MotionAeProjectTextImport } from '../common/editor/motion-ae-text-layer.ts';
import { normalizeMotionAeFontBindings } from '../common/editor/motion-ae-text-fonts.ts';
import { convertMotionAeMattes } from '../common/editor/motion-ae-matte-conversion.ts';
import { normalizeMotionAsset, type MotionAsset } from '../common/editor/motion-asset.ts';
import { type MotionComposition, type MotionLayer, type MotionLayerContent } from '../common/editor/motion-composition.ts';
import { freezeMotionValue, motionId } from '../common/editor/motion-values.ts';
import { motionScalar } from '../common/editor/motion-property.ts';
import type { MotionAeExpressionReview } from '../common/editor/motion-ae-expression-conversion.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import { createMotionLayer, type MotionscaperProject } from './editor-project.ts';

export interface MotionAeMediaBinding { readonly footageId: string; readonly asset: MotionAsset }
export interface MotionscaperAeConversion {
	readonly project: MotionscaperProject; readonly exchange: MotionAeExchange;
	readonly report: readonly MotionAeReportEntry[]; readonly requiresAcknowledgement: true;
}
/** Pure draft preparation. The import controller must verify every retained body before publication. */
export function convertMotionscaperAeExchange(input: unknown, options: Readonly<{
	projectId: string; allocateId: () => string; bindings: readonly MotionAeMediaBinding[]; primaryCompositionId?: string;
} & MotionAeProjectTextImport & MotionAeExpressionReview & MotionAeSceneReview>): MotionscaperAeConversion {
	const exchange = normalizeMotionAeExchange(input), projectId = motionId(options.projectId);
	if (!exchange.compositions.length) throw new Error('The AE exchange contains no compositions.');
	const report: MotionAeReportEntry[] = [...exchange.report];
	const issue = (scopeId: string, code: string, message: string) => { report.push({ scopeId, propertyPath: '', status: 'unsupported', code, message }); };
	issue(exchange.transferId, 'qualification', 'This development conversion is not qualified against installed AE. Review every unsupported entry and compare the imported result before use.');
	issue(exchange.transferId, 'color-conversion', 'Motion uses linear Rec.709/sRGB composition rendering. AE working-space, blending, bit-depth and footage-interpretation parity remain unqualified; retain the original or render a reference composition in AE.');
	const used = new Set([projectId]), ids = new Map<string, string>(), media = new Map<string, MotionAsset>(), assets: MotionAsset[] = [];
	if (options.bindings.length > 4096) throw new RangeError('AE media binding budget exceeded.');
	for (const binding of options.bindings) {
		const source = exchange.footage.find((item) => item.id === binding.footageId), asset = normalizeMotionAsset(binding.asset);
		if (!source || source.path === null || source.byteLength !== asset.byteLength || (source.sha256 !== null && source.sha256 !== asset.sha256) || asset.kind === 'font'
			|| (source.hasVideo && source.still !== (asset.kind === 'image')) || media.has(binding.footageId) || (source.hasVideo && (asset.kind === 'audio' || asset.width !== source.width || asset.height !== source.height))) throw new Error('AE media binding does not match retained source metadata.');
		if (used.has(asset.id)) throw new Error('AE media destination identity is duplicated.'); used.add(asset.id);
		media.set(binding.footageId, asset); assets.push(asset);
	}
	for (const binding of normalizeMotionAeFontBindings(options.fonts ?? [])) {
		if (used.has(binding.asset.id)) throw new Error('AE font destination identity is duplicated.');
		used.add(binding.asset.id); assets.push(binding.asset);
	}
	const sceneLayers = new Map<string, MotionAeSceneConversion>();
	const textOffsets = new Map<string, readonly [number, number]>();
	for (const composition of exchange.compositions) for (const source of [composition, ...composition.layers]) {
		const id = motionId(options.allocateId()); if (used.has(id)) throw new Error('AE destination identity is duplicated.');
		used.add(id); ids.set(source.id, id);
	}
	const clock = (value: number, scope: string) => {
		const converted = motionAeBoundedClock(value);
		if (converted.quantized) report.push({ scopeId: scope, propertyPath: '', status: 'sampled', code: 'clock-quantization', message: 'AE floating timing was rounded to the bounded one-millionth clock. Original timing remains in the exchange.' });
		return converted.value;
	};
	function content(layer: MotionAeLayer, siblings: readonly MotionAeLayer[], frameRate: MotionComposition['frameRate']): MotionLayerContent {
		if (layer.kind === 'camera' || layer.kind === 'light') {
			const scene = convertMotionAeSceneLayer(layer, frameRate, options, report); if (scene) { sceneLayers.set(layer.id, scene); return scene.content; } return { kind: 'null' };
		}
		if (layer.threeD || layer.adjustment) { issue(layer.id, 'layer-kind', 'AE 3D, camera/light and adjustment intent requires a qualified mapping or a complete AE-rendered composition. A named null placeholder preserves hierarchy.'); return { kind: 'null' }; }
		if (layer.kind === 'shape') return convertMotionAeShapes(layer, frameRate, () => { const id = motionId(options.allocateId()); if (used.has(id)) throw new Error('AE destination identity is duplicated.'); used.add(id); return id; }, report) ?? { kind: 'null' };
		if (layer.kind === 'text') {
			const text = convertMotionAeTextLayer(layer, options, report);
			if (!text) return { kind: 'null' };
			if (text.offset.some(value => value !== 0) && siblings.some(child => child.parentId === layer.id)) {
				issue(layer.id, 'text-parent-origin', 'This paragraph box needs a local origin rebase, but the layer has children. Child coordinate compensation needs an explicit mapping; retain the original or render a reference.'); return { kind: 'null' };
			}
			textOffsets.set(layer.id, text.offset); return { kind: 'text', document: text.document };
		}
		if (layer.kind === 'null') return { kind: 'null' };
		if (layer.kind === 'composition') return { kind: 'precomp', compositionId: ids.get(layer.sourceId!)! };
		if (layer.kind === 'footage') {
			const asset = media.get(layer.sourceId!), source = exchange.footage.find((item) => item.id === layer.sourceId)!;
			if (!asset) { issue(layer.id, 'missing-media', 'Select and verify the original package media before importing this layer. A named null placeholder is retained.'); return { kind: 'null' }; }
			if (source.pixelAspect !== 1 || asset.kind === 'audio') { issue(layer.id, 'media-interpretation', 'Non-square-pixel and audio-only AE layer interpretation is not yet mapped. Render or convert this source explicitly.'); return { kind: 'null' }; }
			if (asset.kind === 'image') return { kind: 'image', assetId: asset.id };
			if (asset.kind === 'footage') {
				if (asset.hasAudio) issue(layer.id, 'audio-mapping', 'AE audio enable/level intent is not yet captured. This partial footage import is muted; retain the source or render its audio in AE.');
				return { kind: 'footage', assetId: asset.id, audioEnabled: false, audioGain: motionScalar(1) };
			}
		}
		issue(layer.id, 'layer-kind', 'This AE layer kind is preserved in the exchange and represented by a named null. Use a complete AE-rendered composition to retain its appearance.');
		return { kind: 'null' };
	}
	function composition(source: MotionAeComposition): MotionComposition {
		const frameRate = clock(source.frameRate, source.id), frequency = frameRate.num / frameRate.den;
		const duration = clock(source.duration * frequency, source.id);
		const durationFrames = Math.max(1, Math.ceil(duration.num / duration.den));
		if (source.pixelAspect !== 1) issue(source.id, 'pixel-aspect', 'This composition uses non-square pixels; the partial Motion document uses square pixels. Render a square-pixel reference in AE.');
		if (durationFrames !== source.duration * frequency) report.push({ scopeId: source.id, propertyPath: '', status: 'sampled', code: 'duration-rounding', message: 'Composition duration was rounded outward to a whole Motion frame.' });
		if (source.displayStartTime !== 0) issue(source.id, 'display-time', 'AE display start time remains in the exchange; the Motion timeline starts at zero.');
		if (source.background.some((value) => value !== 0)) issue(source.id, 'viewer-background', 'AE composition viewer background is retained in the exchange. The Motion document keeps transparent composition output.');
		const sequence = motionAeRenderedSequence(exchange, source, media);
		if (sequence) issue(source.id, 'render-sequence-audio', 'The complete AE-rendered image sequence replaces the authored layer appearance. It carries no audio; original layer intent and media remain in custody. Alpha/color reference fidelity is unqualified.');
		const layers: MotionLayer[] = sequence ? sequence.map((asset, frame) => {
			const id = motionId(options.allocateId()); if (used.has(id)) throw new Error('AE destination identity is duplicated.'); used.add(id);
			const layer = createMotionLayer({ id, name: name(asset.name, 'Rendered frame'), durationFrames, content: { kind: 'image', assetId: asset.id } });
			return { ...layer, inFrame: { num: frame, den: 1 }, outFrame: { num: frame + 1, den: 1 } };
		}) : source.layers.map((layer) => {
			const base = createMotionLayer({ id: ids.get(layer.id)!, name: name(layer.name, 'Layer'), durationFrames, content: content(layer, source.layers, frameRate) });
			const admittedBlend = motionAeLayerBlend(layer), blendMode = admittedBlend ?? 'normal';
			if (admittedBlend === null) issue(layer.id, 'blend-mode', 'This blend mode, source compositing switches or layer geometry are not admitted; normal blending is used in the partial draft. Original intent remains in custody; use a complete rendered fallback.');
			if (admittedBlend && admittedBlend !== 'normal') report.push({ scopeId: layer.id, propertyPath: 'blendMode', status: 'editable', code: 'blend-mode', message: 'Named blend mode is structurally mapped with captured neutral AV switches. Installed AE color, alpha and blend-space parity remain unqualified.' });
			const timeScale = 100 / layer.stretch;
			const scene = sceneLayers.get(layer.id);
			const mapped: MotionLayer = { ...base, is3D: Boolean(scene), enabled: layer.enabled, parentId: layer.parentId === null ? null : ids.get(layer.parentId)!,
				inFrame: clock(layer.inPoint * frequency, layer.id), outFrame: clock(layer.outPoint * frequency, layer.id),
				// All imported property keys use composition frames. Rebase source timing explicitly to the same origin.
				sourceStart: clock(-layer.startTime * timeScale, layer.id), timeScale: clock(timeScale, layer.id),
				transform: scene?.transform ?? convertMotionAeTransform(layer, frameRate, base.transform, report, durationFrames, options), blendMode,
				masks: convertMotionAeMasks(layer, frameRate, () => { const id = motionId(options.allocateId()); if (used.has(id)) throw new Error('AE destination identity is duplicated.'); used.add(id); return id; }, report),
				matte: layer.matte === null ? null : { layerId: ids.get(layer.matte.layerId)!, mode: layer.matte.type } };
			const offset = textOffsets.get(layer.id);
			return offset ? rebaseMotionAeTextLayer(mapped, offset, layer.id, report) : mapped;
		});
		return { id: ids.get(source.id)!, name: name(source.name, 'Composition'), width: source.width, height: source.height, frameRate, durationFrames,
			background: [0, 0, 0, 0], color: { workingSpace: 'linear-rec709-d65', outputSpace: 'srgb', alphaMode: 'premultiplied' },
			layers: sequence ? layers : convertMotionAeMattes(source.layers, layers, () => { const id = motionId(options.allocateId()); if (used.has(id)) throw new Error('AE destination identity is duplicated.'); used.add(id); return id; }, report), audio: [] };
	}
	const renderedPrimary = exchange.report.find(entry => entry.code === 'composition-render-frame' && entry.status === 'rendered')?.scopeId;
	const primary = options.primaryCompositionId ?? renderedPrimary ?? exchange.compositions[0]!.id;
	if (!exchange.compositions.some((entry) => entry.id === primary)) throw new Error('Choose a composition present in this AE exchange.');
	const project = normalizeMotionscaperProject({ schemaFamily: 'motionscaper', schemaVersion: 1, id: projectId, title: name(exchange.source.name, 'AE import'),
		revision: 0, sampleRate: 48000, primaryCompositionId: ids.get(primary), compositions: exchange.compositions.map(composition), assets });
	return freezeMotionValue({ project, exchange, report, requiresAcknowledgement: true as const });
}
function name(value: string, fallback: string): string { return value.normalize('NFC').slice(0, 512) || fallback; }
