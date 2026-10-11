/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionComposition, MotionLayer } from '../common/editor/motion-composition.ts';
import { motionLayerDependencyIds, remapMotionLayerLinks, replaceMotionLayerProperty } from '../common/editor/motion-layer-links.ts';
import { motionExpressionAssetIds, remapMotionExpressionAssets } from '../common/editor/motion-expression-assets.ts';
import { motionLayerProperties } from '../common/editor/motion-project-graph.ts';
import { retimeMotionLayer } from '../common/editor/motion-layer-retiming.ts';
import { normalizeMotionLayer } from '../common/editor/motion-layer-validation.ts';
import { compareRationals, divideRationals, multiplyRationals, subtractRationals, type Rational } from '../common/editor/timeline-time.ts';
import { freezeMotionValue, motionArray, motionId, motionInteger, motionRational, motionRecord } from '../common/editor/motion-values.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import { applyMotionscaperCommands, type MotionscaperProjectCommand } from './editor-project-commands.ts';

export interface MotionscaperLayerClipboard { readonly schemaVersion: 1; readonly project: MotionscaperProject }
export interface MotionscaperLayerPaste {
	readonly commands: readonly MotionscaperProjectCommand[];
	/** Bodies absent from the destination's retained digest closure; prepare these before session.edit. */
	readonly requiredAssets: readonly MotionAsset[];
	readonly layerIds: readonly string[];
}

/** Portable typed intent contains only the copied layer, nested-composition and media metadata closure. */
export function copyMotionscaperLayers(options: Readonly<{ project: unknown; compositionId: string; layerIds: readonly string[]; includeDependencies?: boolean }>): MotionscaperLayerClipboard {
	const project = normalizeMotionscaperProject(options.project); const source = requireComposition(project, options.compositionId);
	const ids = motionArray(options.layerIds, 4096, 'copied motion layers', 1).map((id) => motionId(id)); const selected = new Set(ids);
	if (selected.size !== ids.length) throw new RangeError('Copied motion layers contain duplicate identities.');
	const layers = new Map(source.layers.map((layer) => [layer.id, layer]));
	const pending = [...selected];
	for (let index = 0; index < pending.length; index += 1) {
		const layer = layers.get(pending[index]!); if (!layer) throw new ReferenceError('A copied motion layer is missing.');
		for (const dependency of motionLayerDependencyIds(layer)) if (!selected.has(dependency)) {
			if (!options.includeDependencies) throw new RangeError(`Include dependent motion layer ${dependency} in the clipboard selection.`);
			selected.add(dependency); pending.push(dependency);
		}
	}
	const root = { ...source, layers: source.layers.filter(({ id }) => selected.has(id)), audio: [] };
	return freezeMotionValue({ schemaVersion: 1, project: closeProject(project, root) });
}

/** Fresh identities are caller-supplied; all edits validate together before any history publication. */
export function pasteMotionscaperLayers(options: Readonly<{
	project: unknown; compositionId: string; clipboard: unknown; index: number; atFrame?: Rational;
	createId: (kind: 'layer' | 'composition' | 'asset', sourceId: string) => string;
}>): MotionscaperLayerPaste {
	const project = normalizeMotionscaperProject(options.project); const destination = requireComposition(project, options.compositionId);
	const clipboard = readClipboard(options.clipboard); const source = requireComposition(clipboard.project, clipboard.project.primaryCompositionId);
	const index = motionInteger(options.index, 'pasted layer insertion index', 0, destination.layers.length);
	const commands: MotionscaperProjectCommand[] = []; const assets = new Map<string, string>(); const compositions = new Map<string, string>(); const layerIds = new Map<string, string>();
	const assetNames = new Set(project.assets.map(({ id }) => id)); const compositionNames = new Set(project.compositions.map(({ id }) => id));
	const layerNames = new Set([...destination.layers, ...destination.audio].map(({ id }) => id));
	const allocate = (kind: 'layer' | 'composition' | 'asset', sourceId: string, used: Set<string>) => {
		const id = motionId(options.createId(kind, sourceId)); if (used.has(id)) throw new RangeError(`Pasted ${kind} identity ${id} is already used.`); used.add(id); return id;
	};
	const descriptorIds = new Map(project.assets.map((asset) => [assetDescriptor(asset), asset.id]));
	const retainedDigests = new Set(project.assets.map(({ sha256 }) => sha256)); const requiredAssets: MotionAsset[] = [];
	for (const asset of clipboard.project.assets) {
		const descriptor = assetDescriptor(asset); const existing = descriptorIds.get(descriptor);
		if (existing) { assets.set(asset.id, existing); continue; }
		const added = { ...asset, id: allocate('asset', asset.id, assetNames) }; assets.set(asset.id, added.id); descriptorIds.set(descriptor, added.id);
		commands.push({ type: 'asset/add', asset: added });
		if (!retainedDigests.has(added.sha256)) { requiredAssets.push(added); retainedDigests.add(added.sha256); }
	}
	for (const composition of clipboard.project.compositions) if (composition.id !== source.id) compositions.set(composition.id, allocate('composition', composition.id, compositionNames));
	for (const layer of source.layers) layerIds.set(layer.id, allocate('layer', layer.id, layerNames));
	for (const composition of clipboard.project.compositions) if (composition.id !== source.id) commands.push({ type: 'composition/add', composition: {
		...composition, id: compositions.get(composition.id)!, layers: composition.layers.map((layer) => remapMedia(layer, assets, compositions)),
		audio: composition.audio.map((placement) => ({ ...placement, assetId: assets.get(placement.assetId)!, gain: { ...placement.gain, expression: remapMotionExpressionAssets(placement.gain.expression, assets) } })),
	} });
	const ratio = divideRationals(destination.frameRate, source.frameRate);
	const origin = source.layers.reduce((at, layer) => compareRationals(layer.inFrame, at) < 0 ? layer.inFrame : at, source.layers[0]!.inFrame);
	const offset = options.atFrame === undefined ? { num: 0, den: 1 } : subtractRationals(motionRational(options.atFrame, 'pasted selection frame'), multiplyRationals(origin, ratio));
	const pasted = source.layers.map((layer) => normalizeMotionLayer({
		...remapMotionLayerLinks(retimeMotionLayer(remapMedia(layer, assets, compositions), ratio, offset), layerIds), id: layerIds.get(layer.id)!,
	}));
	commands.push({ type: 'composition/replace', composition: { ...destination, layers: [...destination.layers.slice(0, index), ...pasted, ...destination.layers.slice(index)] } });
	applyMotionscaperCommands(project, commands);
	return freezeMotionValue({ commands, requiredAssets, layerIds: pasted.map(({ id }) => id) });
}

function requireComposition(project: MotionscaperProject, idValue: string): MotionComposition {
	const id = motionId(idValue); const composition = project.compositions.find((item) => item.id === id);
	if (!composition) throw new ReferenceError(`Motion composition ${id} is missing.`); return composition;
}
function layerAssets(layer: MotionLayer): readonly string[] {
	if (layer.kind === 'image' || layer.kind === 'footage') return [layer.assetId];
	return layer.kind === 'text' ? layer.document.runs.map(({ fontAssetId }) => fontAssetId) : [];
}
function closeProject(project: MotionscaperProject, root: MotionComposition): MotionscaperProject {
	const available = new Map(project.compositions.map((composition) => [composition.id, composition]));
	const compositions = [root]; const seen = new Set([root.id]); const assets = new Set<string>();
	for (let index = 0; index < compositions.length; index += 1) {
		const composition = compositions[index]!;
		if (composition.tracking?.length || composition.trackingApplications?.length) throw new RangeError('Tracking composition clipboard transfer requires explicit analysis rebinding; copy is unavailable.');
		for (const layer of composition.layers) {
			for (const id of layerAssets(layer)) assets.add(id);
			for (const { property } of motionLayerProperties(layer)) for (const id of motionExpressionAssetIds(property.expression)) assets.add(id);
			if (layer.kind === 'precomp' && !seen.has(layer.compositionId)) { seen.add(layer.compositionId); compositions.push(available.get(layer.compositionId)!); }
		}
		for (const audio of composition.audio) { assets.add(audio.assetId); for (const id of motionExpressionAssetIds(audio.gain.expression)) assets.add(id); }
	}
	const availableAssets = new Set(project.assets.map(({ id }) => id));
	for (const id of assets) if (!availableAssets.has(id)) throw new ReferenceError(`Clipboard dependency asset ${id} is missing.`);
	return normalizeMotionscaperProject({ ...project, primaryCompositionId: root.id, compositions, assets: project.assets.filter(({ id }) => assets.has(id)) });
}
function readClipboard(value: unknown): MotionscaperLayerClipboard {
	const record = motionRecord(value, ['schemaVersion', 'project'], 'motion layer clipboard');
	if (record.schemaVersion !== 1) throw new RangeError('Unsupported motion layer clipboard version.');
	const project = normalizeMotionscaperProject(record.project); const root = requireComposition(project, project.primaryCompositionId);
	if (root.layers.length === 0 || root.audio.length > 0) throw new RangeError('Motion layer clipboard must contain selected visual layers only.');
	const closure = closeProject(project, root);
	if (closure.compositions.length !== project.compositions.length || closure.assets.length !== project.assets.length) throw new RangeError('Motion layer clipboard contains data outside its required closure.');
	return { schemaVersion: 1, project: closure };
}
function remapMedia(original: MotionLayer, assets: ReadonlyMap<string, string>, compositions: ReadonlyMap<string, string>): MotionLayer {
	let layer = original;
	for (const { path, property } of motionLayerProperties(original)) {
		const expression = remapMotionExpressionAssets(property.expression, assets);
		if (expression !== property.expression) layer = replaceMotionLayerProperty(layer, path, { ...property, expression });
	}
	if (layer.kind === 'image' || layer.kind === 'footage') return { ...layer, assetId: assets.get(layer.assetId)! };
	if (layer.kind === 'text') return { ...layer, document: { ...layer.document, runs: layer.document.runs.map((run) => ({ ...run, fontAssetId: assets.get(run.fontAssetId)! })) } };
	if (layer.kind === 'precomp') return { ...layer, compositionId: compositions.get(layer.compositionId)! };
	return layer;
}
function assetDescriptor(asset: MotionAsset): string { const { id: _id, name: _name, ...descriptor } = asset; return JSON.stringify(descriptor); }
