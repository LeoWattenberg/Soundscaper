/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	type DeliveryPreset,
	type DeliveryPresetKind,
} from '../delivery-preset.ts';
import {
	type DeliveryPresetState,
	applyDeliveryPreset,
	createDeliveryPresetState,
	deleteDeliveryPreset,
	exportDeliveryPreset,
	importDeliveryPresets,
	listDeliveryPresets,
	saveDeliveryPresetToState,
} from '../delivery-preset-store.ts';

/**
 * Controller surface for delivery presets.
 *
 * Mirrors the effect-preset service: every mutation normalizes, writes the
 * session state, persists under its own setting key, and publishes. Following
 * that shape means the export dialog can reuse the effect-preset controls
 * without either side special-casing the other.
 */

export const DELIVERY_PRESETS_SETTING_KEY = 'audio-editor-delivery-presets-v1';

export interface DeliveryPresetServiceRuntime {
	readonly state: { deliveryPresets?: unknown };
	readonly persistSetting: (
		key: string,
		value: unknown,
		options?: Readonly<Record<string, unknown>>,
	) => Promise<unknown> | unknown;
	readonly publishDocumentSnapshot?: () => void;
	readonly createId?: (prefix: string) => string;
}

export function createDeliveryPresetService(runtime: DeliveryPresetServiceRuntime) {
	if (!runtime?.state) throw new TypeError('A delivery preset service requires controller state.');
	const idFactory = () => runtime.createId?.('delivery-preset') ?? `delivery-preset-${Math.random().toString(36).slice(2)}`;

	async function persist(next: DeliveryPresetState): Promise<DeliveryPresetState> {
		const normalized = createDeliveryPresetState(next);
		runtime.state.deliveryPresets = normalized;
		await runtime.persistSetting(DELIVERY_PRESETS_SETTING_KEY, normalized, { policy: 'required' });
		runtime.publishDocumentSnapshot?.();
		return normalized;
	}

	return Object.freeze({
		list: (kind: DeliveryPresetKind | null = null): readonly DeliveryPreset[] =>
			listDeliveryPresets(runtime.state.deliveryPresets, kind),
		apply: (presetId: string): DeliveryPreset =>
			applyDeliveryPreset(runtime.state.deliveryPresets, presetId),
		async save(options: {
			id?: string;
			label: string;
			kind: DeliveryPresetKind;
			format: string;
			settings?: Readonly<Record<string, unknown>>;
		}): Promise<DeliveryPreset> {
			const result = saveDeliveryPresetToState(runtime.state.deliveryPresets, {
				...options,
				idFactory,
			});
			await persist(result.state);
			return result.preset;
		},
		async delete(presetId: string): Promise<true> {
			await persist(deleteDeliveryPreset(runtime.state.deliveryPresets, presetId));
			return true;
		},
		async import(input: unknown): Promise<readonly DeliveryPreset[]> {
			await persist(importDeliveryPresets(runtime.state.deliveryPresets, input, { idFactory }));
			return listDeliveryPresets(runtime.state.deliveryPresets);
		},
		export: (presetId: string): string =>
			exportDeliveryPreset(runtime.state.deliveryPresets, presetId),
	});
}
