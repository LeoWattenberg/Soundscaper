/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionAsset } from './motion-asset.ts';
import type { MotionLayer, MotionAudioPlacement } from './motion-composition.ts';
import type { MotionProperty } from './motion-property.ts';
import { uniqueMotionIds } from './motion-values.ts';
import type { MotionscaperProject } from './motion-project-types.ts';

/** Relationships are composition-local; composition and asset identity are project-local. */
export function validateMotionscaperProjectGraph(project: MotionscaperProject): void {
	const compositions = uniqueMotionIds(project.compositions, 'project compositions');
	const assets = uniqueMotionIds(project.assets, 'project assets');
	if (!compositions.has(project.primaryCompositionId)) throw new ReferenceError('The primary composition is missing.');
	const digestLengths = new Map<string, number>();
	for (const asset of assets.values()) {
		const previous = digestLengths.get(asset.sha256);
		if (previous !== undefined && previous !== asset.byteLength) throw new RangeError('A content digest cannot name conflicting byte lengths.');
		digestLengths.set(asset.sha256, asset.byteLength);
	}
	const compositionEdges = new Map<string, readonly string[]>();
	let layerCount = 0;
	for (const composition of compositions.values()) {
		layerCount += composition.layers.length + composition.audio.length;
		if (layerCount > 100_000) throw new RangeError('Project layers exceed the maintained budget.');
		const layers = uniqueMotionIds(composition.layers, 'composition layers');
		const edges = new Map<string, readonly string[]>();
		const precomps: string[] = [];
		for (const layer of layers.values()) {
			const dependencies = [layer.parentId, layer.matte?.layerId].filter((id): id is string => id !== null && id !== undefined);
			for (const id of dependencies) if (!layers.has(id)) throw new ReferenceError(`Layer ${layer.id} has missing parent/matte ${id}.`);
			edges.set(layer.id, dependencies);
			if (layer.kind === 'footage' || layer.kind === 'image') requireAsset(assets, layer.assetId, layer.kind);
			if (layer.kind === 'text') for (const run of layer.document.runs) requireAsset(assets, run.fontAssetId, 'font');
			if (layer.kind === 'precomp') {
				if (!compositions.has(layer.compositionId)) throw new ReferenceError(`Missing precomposition ${layer.compositionId}.`);
				precomps.push(layer.compositionId);
			}
			if (layer.kind === 'adjustment') for (const id of layer.targetLayerIds) {
				if (id === layer.id || !layers.has(id)) throw new ReferenceError(`Adjustment ${layer.id} has invalid target ${id}.`);
			}
		}
		for (const audio of composition.audio) requireAsset(assets, audio.assetId, 'audio');
		assertMotionAcyclic(edges, 'parent/matte', 128);
		validatePropertyLinks([...layers.values(), ...composition.audio]);
		compositionEdges.set(composition.id, precomps);
	}
	assertMotionAcyclic(compositionEdges, 'precomposition', 32);
}

function requireAsset(assets: ReadonlyMap<string, MotionAsset>, id: string, kind: MotionAsset['kind']): void {
	const asset = assets.get(id);
	if (!asset) throw new ReferenceError(`Missing ${kind} asset ${id}.`);
	if (asset.kind !== kind) throw new TypeError(`Asset ${id} has the wrong kind for ${kind}.`);
}

/** This traverses only already-normalized inert intent. */
export interface MotionPropertyAddress { readonly path: string; readonly stablePath: string; readonly property: MotionProperty }
export function motionLayerProperties(layer: MotionLayer | MotionAudioPlacement): readonly MotionPropertyAddress[] {
	const result: MotionPropertyAddress[] = [];
	const walk = (value: unknown, path: string, stablePath: string): void => {
		if (!value || typeof value !== 'object') return;
		if (!Array.isArray(value)) {
			const record = value as Record<string, unknown>;
			if (['scalar', 'vector2', 'vector3', 'color', 'path'].includes(String(record.kind)) && Object.hasOwn(record, 'expression')) {
				result.push({ path, stablePath, property: record as unknown as MotionProperty }); return;
			}
		}
		for (const [key, item] of Object.entries(value)) {
			const id = Array.isArray(value) && item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>).id : undefined;
			const token = typeof id === 'string' ? `@${encodeURIComponent(id).replaceAll('.', '%2E')}` : key;
			walk(item, path ? `${path}.${key}` : key, stablePath ? `${stablePath}.${token}` : token);
		}
	};
	walk(layer, '', '');
	return Object.freeze(result.map((entry) => Object.freeze(entry)));
}

function validatePropertyLinks(layers: readonly (MotionLayer | MotionAudioPlacement)[]): void {
	const properties = layers.flatMap((layer) => motionLayerProperties(layer).map((entry) => ({ ...entry, layerId: layer.id })));
	const aliases = new Map<string, string>();
	for (const entry of properties) {
		const canonical = `${entry.layerId}/${entry.stablePath}`;
		aliases.set(`${entry.layerId}/${entry.path}`, canonical); aliases.set(canonical, canonical);
	}
	const edges = new Map<string, readonly string[]>();
	for (const entry of properties) {
		const dependencies = (entry.property.expression?.references ?? []).map((reference) => {
			const key = `${reference.layerId}/${reference.propertyPath}`; const canonical = aliases.get(key);
			if (!canonical) throw new ReferenceError(`Expression property reference ${key} is missing.`); return canonical;
		});
		edges.set(`${entry.layerId}/${entry.stablePath}`, entry.property.expression?.enabled ? dependencies : []);
	}
	assertMotionAcyclic(edges, 'expression property', 128);
}

export function assertMotionAcyclic(edges: ReadonlyMap<string, readonly string[]>, name: string, maximumDepth: number): void {
	const states = new Map<string, 1 | 2>();
	const heights = new Map<string, number>();
	const visit = (id: string, depth: number): number => {
		if (states.get(id) === 1) throw new RangeError(`${name} graph contains a cycle.`);
		if (depth > maximumDepth) throw new RangeError(`${name} graph exceeds its depth budget.`);
		if (states.get(id) === 2) {
			const height = heights.get(id)!;
			if (depth + height > maximumDepth) throw new RangeError(`${name} graph exceeds its depth budget.`);
			return height;
		}
		states.set(id, 1);
		let height = 0;
		for (const child of edges.get(id) ?? []) height = Math.max(height, 1 + visit(child, depth + 1));
		states.set(id, 2); heights.set(id, height);
		return height;
	};
	for (const id of edges.keys()) visit(id, 0);
}
