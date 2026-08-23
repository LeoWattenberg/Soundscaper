/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProductVideoVisualPreviewFrame,
} from './product-video-visual-preview-runtime.ts';

type Data = Readonly<Record<string, unknown>>;

export interface ProductVideoVisualPreviewCompositorLayer extends Data {
	readonly trackId: string;
	readonly trackIndex: number;
	readonly entries: readonly Data[];
	readonly effects?: readonly unknown[];
}

/** Merge selected product visuals with maintained media layers without hiding an omission. */
export function composeProductVideoVisualPreviewLayers(
	mediaLayersValue: readonly unknown[],
	frame: ProductVideoVisualPreviewFrame | null,
): readonly ProductVideoVisualPreviewCompositorLayer[] {
	const mediaLayers = mediaLayersValue.map((value, index) => layer(value, `media layer ${String(index)}`));
	if (frame === null) return Object.freeze(mediaLayers);
	assertExactLedger(frame);
	const layers = [...mediaLayers];
	const byTrackId = new Map<string, ProductVideoVisualPreviewCompositorLayer>();
	for (const candidate of layers) claimTrack(byTrackId, candidate);
	for (const [index, value] of frame.layers.entries()) {
		const candidate = layer(value, `visual layer ${String(index)}`);
		claimTrack(byTrackId, candidate);
		layers.push(candidate);
	}
	const activeEffectIds = new Set<string>();
	for (const adjustment of frame.adjustments) {
		if (adjustment.opacity !== 1 || adjustment.blendMode !== 'normal' || adjustment.maskIds.length !== 0) {
			throw new Error(`Visual adjustment ${adjustment.nodeId} has an unconsumed presentation.`);
		}
		for (const targetTrackId of adjustment.targetTrackIds) {
			const target = byTrackId.get(targetTrackId);
			if (!target) continue;
			const effects = [...(target.effects ?? [])];
			const adjustmentEffectIds = new Set<string>();
			for (const effectValue of adjustment.effects) {
				const effect = record(effectValue, `visual adjustment ${adjustment.nodeId} effect`);
				const effectId = stableId(effect.id, 'visual adjustment effect ID');
				if (activeEffectIds.has(effectId)) {
					throw new RangeError(`Visual adjustment effect ${effectId} is active more than once.`);
				}
				activeEffectIds.add(effectId);
				adjustmentEffectIds.add(effectId);
				effects.push(effect);
			}
			const entries = target.entries.map((entry) => Object.freeze({
				...entry,
				effects: Object.freeze(entryEffects(entry).filter((effect) => (
					!adjustmentEffectIds.has(stableId(effect.id, 'media clip effect ID'))
				))),
			}));
			const replaced = Object.freeze({
				...target, entries: Object.freeze(entries), effects: Object.freeze(effects),
			});
			byTrackId.set(targetTrackId, replaced);
			layers[layers.indexOf(target)] = replaced;
		}
	}
	layers.sort((left, right) => right.trackIndex - left.trackIndex
		|| compareText(left.trackId, right.trackId));
	return Object.freeze(layers);
}

function entryEffects(entry: Data): Data[] {
	if (entry.effects === undefined) return [];
	if (!Array.isArray(entry.effects)) throw new TypeError('Media clip effects must be an array.');
	return entry.effects.map((effect, index) => record(effect, `media clip effect ${String(index)}`));
}

function assertExactLedger(frame: ProductVideoVisualPreviewFrame): void {
	const requested = exactIds(frame.ledger.requestedNodeIds, 'requested visual nodes');
	const consumed = exactIds(frame.ledger.consumedNodeIds, 'consumed visual nodes');
	const omitted = exactIds(frame.ledger.omittedNodeIds, 'omitted visual nodes');
	if (omitted.length !== 0 || requested.length !== consumed.length
		|| requested.some((id, index) => id !== consumed[index])) {
		throw new Error(`Product visual preview has unexplained omissions: ${omitted.join(', ') || 'ledger mismatch'}.`);
	}
}

function claimTrack(
	byTrackId: Map<string, ProductVideoVisualPreviewCompositorLayer>,
	layerValue: ProductVideoVisualPreviewCompositorLayer,
): void {
	if (byTrackId.has(layerValue.trackId)) {
		throw new RangeError(`Product visual preview track ${layerValue.trackId} has ambiguous active layers.`);
	}
	byTrackId.set(layerValue.trackId, layerValue);
}

function layer(value: unknown, name: string): ProductVideoVisualPreviewCompositorLayer {
	const input = record(value, name);
	const trackId = stableId(input.trackId, `${name} track ID`);
	if (!Number.isSafeInteger(input.trackIndex) || Number(input.trackIndex) < 0) {
		throw new RangeError(`${name} track index must be non-negative.`);
	}
	if (!Array.isArray(input.entries)) throw new TypeError(`${name} entries must be an array.`);
	const entries = input.entries.map((entry, index) => record(entry, `${name} entry ${String(index)}`));
	const effects = input.effects;
	if (effects !== undefined && !Array.isArray(effects)) throw new TypeError(`${name} effects must be an array.`);
	return Object.freeze({
		...input,
		trackId,
		trackIndex: Number(input.trackIndex),
		entries: Object.freeze(entries),
		...(effects === undefined ? {} : { effects: Object.freeze([...effects]) }),
	});
}

function exactIds(value: unknown, name: string): string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	const result = value.map((id) => stableId(id, name));
	if (new Set(result).size !== result.length || result.some((id, index) => index > 0 && result[index - 1]! >= id)) {
		throw new RangeError(`${name} must be unique and sorted.`);
	}
	return result;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
