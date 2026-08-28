/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../../code-unit-order.ts';
import type { ProductVideoVisualPreviewFrame } from './product-video-visual-preview-runtime.ts';

type Data = Readonly<Record<string, unknown>>;

/** Snapshot effects represented by media entries or active adjustment targets. */
export function collectProductVideoVisualPreviewEffectIds(
	mediaLayersValue: readonly unknown[],
	frame: ProductVideoVisualPreviewFrame,
): readonly string[] {
	if (!Array.isArray(mediaLayersValue)) throw new TypeError('Exact preview media layers must be an array.');
	const layers = mediaLayersValue.map((value, index) => record(value, `exact media layer ${String(index)}`));
	const activeTrackIds = new Set(layers.map((layer) => stableId(layer.trackId, 'exact media track ID')));
	const result = new Set<string>();
	for (const layer of layers) {
		if (!Array.isArray(layer.entries)) throw new TypeError('Exact preview media entries must be an array.');
		for (const entryValue of layer.entries) {
			const entry = record(entryValue, 'exact preview media entry');
			collectEffects(entry.effects, result);
		}
	}
	for (const adjustment of frame.adjustments) {
		if (!adjustment.targetTrackIds.some((trackId) => activeTrackIds.has(trackId))) continue;
		collectEffects(adjustment.effects, result);
	}
	return Object.freeze([...result].sort(compareCodeUnits));
}

function collectEffects(value: unknown, result: Set<string>): void {
	if (value === undefined) return;
	if (!Array.isArray(value)) throw new TypeError('Exact preview effects must be an array.');
	for (const effectValue of value) {
		const effect = record(effectValue, 'exact preview effect');
		if (effect.enabled !== false) result.add(stableId(effect.id, 'exact preview effect ID'));
	}
}

function record(value: unknown, name: string): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Data;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 160) {
		throw new TypeError(`${name} must be bounded text.`);
	}
	return value;
}
