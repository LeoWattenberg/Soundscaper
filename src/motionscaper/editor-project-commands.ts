/* SPDX-License-Identifier: AGPL-3.0-only */

import { stabilizeMotionExpressionReferences } from '../common/editor/motion-expression-links.ts';
import { compareRationals, type Rational } from '../common/editor/timeline-time.ts';
import { normalizeMotionAsset, type MotionAsset } from '../common/editor/motion-asset.ts';
import type { MotionComposition, MotionLayer } from '../common/editor/motion-composition.ts';
import { normalizeMotionLayer } from '../common/editor/motion-layer-validation.ts';
import { freezeMotionValue, motionArray, motionEnum, motionId, motionInteger, motionRational, motionRecord, motionString } from '../common/editor/motion-values.ts';
import { normalizeMotionComposition, normalizeMotionscaperProject } from './editor-project-validation.ts';
import type { MotionscaperProject } from './editor-project-types.ts';

export type MotionscaperProjectCommand =
	| { readonly type: 'project/rename'; readonly title: string }
	| { readonly type: 'composition/add' | 'composition/replace'; readonly composition: MotionComposition }
	| { readonly type: 'composition/remove' | 'composition/set-primary'; readonly compositionId: string }
	| { readonly type: 'asset/add'; readonly asset: MotionAsset }
	| { readonly type: 'asset/remove'; readonly assetId: string }
	| { readonly type: 'layer/add'; readonly compositionId: string; readonly layer: MotionLayer; readonly index: number }
	| { readonly type: 'layer/replace'; readonly compositionId: string; readonly layer: MotionLayer }
	| { readonly type: 'layer/remove'; readonly compositionId: string; readonly layerId: string }
	| { readonly type: 'layer/reorder'; readonly compositionId: string; readonly layerIds: readonly string[] }
	| { readonly type: 'layer/trim'; readonly compositionId: string; readonly layerId: string; readonly inFrame: Rational; readonly outFrame: Rational }
	| { readonly type: 'layer/split'; readonly compositionId: string; readonly layerId: string; readonly atFrame: Rational; readonly newLayerId: string };

const COMMAND_FIELDS = {
	'project/rename': ['title'], 'composition/add': ['composition'], 'composition/replace': ['composition'],
	'composition/remove': ['compositionId'], 'composition/set-primary': ['compositionId'],
	'asset/add': ['asset'], 'asset/remove': ['assetId'],
	'layer/add': ['compositionId', 'layer', 'index'], 'layer/replace': ['compositionId', 'layer'],
	'layer/remove': ['compositionId', 'layerId'], 'layer/reorder': ['compositionId', 'layerIds'],
	'layer/trim': ['compositionId', 'layerId', 'inFrame', 'outFrame'],
	'layer/split': ['compositionId', 'layerId', 'atFrame', 'newLayerId'],
} as const;

/** All commands publish together, after final relationship validation; failure publishes nothing. */
export function applyMotionscaperCommands(projectValue: unknown, commandsValue: unknown): MotionscaperProject {
	const project = normalizeMotionscaperProject(projectValue);
	const commands = motionArray(commandsValue, 4096, 'motion command transaction', 1);
	let candidate = project;
	for (const value of commands) candidate = applyCommand(candidate, value);
	return normalizeMotionscaperProject({ ...stabilizeMotionExpressionReferences(project, candidate), revision: project.revision + 1 });
}

function applyCommand(project: MotionscaperProject, value: unknown): MotionscaperProject {
	const candidate = motionRecord(value, ['type', ...new Set(Object.values(COMMAND_FIELDS).flat())], 'motion command', ['type']);
	const type = motionEnum(candidate.type, Object.keys(COMMAND_FIELDS) as (keyof typeof COMMAND_FIELDS)[], 'motion command type');
	const command = motionRecord(candidate, ['type', ...COMMAND_FIELDS[type]], 'motion command');
	if (type === 'project/rename') return { ...project, title: motionString(command.title, 'project title') };
	if (type === 'asset/add') return { ...project, assets: [...project.assets, normalizeMotionAsset(command.asset)] };
	if (type === 'asset/remove') {
		const id = motionId(command.assetId);
		requireIdentity(project.assets, id, 'asset');
		return { ...project, assets: project.assets.filter((asset) => asset.id !== id) };
	}
	if (type === 'composition/add') return { ...project, compositions: [...project.compositions, normalizeMotionComposition(command.composition)] };
	if (type === 'composition/replace') {
		const composition = normalizeMotionComposition(command.composition);
		requireIdentity(project.compositions, composition.id, 'composition');
		return { ...project, compositions: project.compositions.map((item) => item.id === composition.id ? composition : item) };
	}
	const compositionId = motionId(command.compositionId);
	const composition = requireIdentity(project.compositions, compositionId, 'composition');
	if (type === 'composition/remove') return { ...project, compositions: project.compositions.filter((item) => item.id !== compositionId) };
	if (type === 'composition/set-primary') return { ...project, primaryCompositionId: compositionId };
	const layers = editLayers(composition.layers, type, command);
	return { ...project, compositions: project.compositions.map((item) => item.id === compositionId ? { ...item, layers } : item) };
}

function editLayers(layers: readonly MotionLayer[], type: keyof typeof COMMAND_FIELDS, command: Readonly<Record<string, unknown>>): readonly MotionLayer[] {
	if (type === 'layer/add') {
		const index = motionInteger(command.index, 'layer insertion index', 0, layers.length);
		return [...layers.slice(0, index), normalizeMotionLayer(command.layer), ...layers.slice(index)];
	}
	if (type === 'layer/replace') {
		const layer = normalizeMotionLayer(command.layer);
		requireIdentity(layers, layer.id, 'layer');
		return layers.map((item) => item.id === layer.id ? layer : item);
	}
	if (type === 'layer/reorder') {
		const ids = motionArray(command.layerIds, 4096, 'layer order').map((id) => motionId(id));
		if (ids.length !== layers.length || new Set(ids).size !== ids.length) throw new RangeError('Layer order must contain every layer exactly once.');
		return ids.map((id) => requireIdentity(layers, id, 'layer'));
	}
	const layerId = motionId(command.layerId);
	const layer = requireIdentity(layers, layerId, 'layer');
	if (type === 'layer/remove') return layers.filter((item) => item.id !== layerId);
	if (type === 'layer/trim') {
		const trimmed = normalizeMotionLayer({ ...layer, inFrame: motionRational(command.inFrame, 'trim in frame'), outFrame: motionRational(command.outFrame, 'trim out frame') });
		return layers.map((item) => item.id === layerId ? trimmed : item);
	}
	if (type === 'layer/split') return splitLayer(layers, layer, command);
	throw new RangeError('Unsupported motion layer operation.');
}

function splitLayer(layers: readonly MotionLayer[], layer: MotionLayer, command: Readonly<Record<string, unknown>>): readonly MotionLayer[] {
	const atFrame = motionRational(command.atFrame, 'split frame');
	if (compareRationals(atFrame, layer.inFrame) <= 0 || compareRationals(atFrame, layer.outFrame) >= 0) throw new RangeError('A split must be strictly inside the layer range.');
	if (layers.some((item) => item.matte?.layerId === layer.id)) throw new RangeError('Precompose a matte source before splitting it so its dependent layers retain one complete matte.');
	const newLayerId = motionId(command.newLayerId);
	return layers.flatMap((item): readonly MotionLayer[] => {
		if (item.id === layer.id) return [normalizeMotionLayer({ ...item, outFrame: atFrame }), normalizeMotionLayer({ ...item, id: newLayerId, inFrame: atFrame })];
		if (item.kind === 'adjustment' && item.targetLayerIds.includes(layer.id)) return [{ ...item, targetLayerIds: [...item.targetLayerIds, newLayerId] }];
		return [item];
	});
}

function requireIdentity<T extends { readonly id: string }>(values: readonly T[], id: string, name: string): T {
	const result = values.find((item) => item.id === id);
	if (!result) throw new ReferenceError(`Motion ${name} ${id} is missing.`);
	return result;
}

export interface MotionscaperHistorySnapshot {
	readonly project: MotionscaperProject; readonly canUndo: boolean; readonly canRedo: boolean;
}
export interface MotionscaperHistoryTransition {
	readonly project: MotionscaperProject;
	/** Accept only after external retention succeeds; any intervening history edit invalidates this transition. */
	accept(): MotionscaperProject;
}
export interface MotionscaperHistory {
	snapshot(): MotionscaperHistorySnapshot;
	commit(commands: unknown): MotionscaperProject;
	undo(): boolean; redo(): boolean;
	prepareUndo(): MotionscaperHistoryTransition | null; prepareRedo(): MotionscaperHistoryTransition | null;
	prepareReplacement(value: unknown): MotionscaperHistoryTransition;
	retainedAssetDigests(): readonly string[];
}

export function createMotionscaperHistory(initial: unknown, options: Readonly<{ maximumEntries?: number }> = {}): MotionscaperHistory {
	const maximumEntries = motionInteger(options.maximumEntries ?? 100, 'history capacity', 1, 1000);
	let project = normalizeMotionscaperProject(initial);
	const past: MotionscaperProject[] = [];
	const future: MotionscaperProject[] = [];
	const publish = (next: MotionscaperProject, destination: MotionscaperProject[]): void => {
		destination.push(project);
		if (destination.length > maximumEntries) destination.shift();
		project = next;
	};
	const prepare = (source: MotionscaperProject[], destination: MotionscaperProject[]): MotionscaperHistoryTransition | null => {
		const target = source.at(-1); if (!target) return null;
		const original = project; const candidate = normalizeMotionscaperProject({ ...target, revision: project.revision + 1 });
		return Object.freeze({ project: candidate, accept() {
			if (project !== original) throw new Error('The prepared history transition is stale because history changed.');
			source.pop(); publish(candidate, destination); return project;
		} });
	};
	return Object.freeze({
		snapshot: () => Object.freeze({ project, canUndo: past.length > 0, canRedo: future.length > 0 }),
		commit(commands: unknown) {
			const next = applyMotionscaperCommands(project, commands);
			publish(next, past); future.length = 0;
			return project;
		},
		prepareUndo: () => prepare(past, future), prepareRedo: () => prepare(future, past),
		prepareReplacement(value: unknown) {
			const incoming = normalizeMotionscaperProject(value); const original = project;
			if (incoming.id !== project.id) throw new Error('A replacement draft must retain its local project identity.');
			const candidate = normalizeMotionscaperProject({ ...incoming, revision: Math.max(project.revision, incoming.revision) + 1 });
			return Object.freeze({ project: candidate, accept() {
				if (project !== original) throw new Error('The prepared replacement is stale because history changed.');
				publish(candidate, past); future.length = 0; return project;
			} });
		},
		undo() { const transition = prepare(past, future); if (!transition) return false; transition.accept(); return true; },
		redo() { const transition = prepare(future, past); if (!transition) return false; transition.accept(); return true; },
		retainedAssetDigests() {
			return freezeMotionValue([...new Set([project, ...past, ...future].flatMap((snapshot) => snapshot.assets.map((asset) => asset.sha256)))].sort());
		},
	});
}
