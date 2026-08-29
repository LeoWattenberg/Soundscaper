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
	readonly fileService?: {
		saveFile?: (request: Readonly<Record<string, unknown>>) => unknown;
	} | null;
}

export function createDeliveryPresetService(runtime: DeliveryPresetServiceRuntime) {
	if (!runtime?.state) throw new TypeError('A delivery preset service requires controller state.');
	const idFactory = () => runtime.createId?.('delivery-preset') ?? `delivery-preset-${Math.random().toString(36).slice(2)}`;
	let mutationTail: Promise<void> = Promise.resolve();

	function enqueueMutation<Result>(operation: () => Promise<Result>): Promise<Result> {
		const result = mutationTail.then(operation);
		mutationTail = result.then(() => undefined, () => undefined);
		return result;
	}

	async function commit(next: DeliveryPresetState): Promise<DeliveryPresetState> {
		const normalized = createDeliveryPresetState(next);
		await runtime.persistSetting(DELIVERY_PRESETS_SETTING_KEY, normalized, { policy: 'required' });
		runtime.state.deliveryPresets = normalized;
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
			licensingRowId?: string | null;
			fallbackPresetId?: string | null;
			now?: string;
		}): Promise<DeliveryPreset> {
			const snapshot = Object.freeze({
				id: options.id,
				label: options.label,
				kind: options.kind,
				format: options.format,
				settings: options.settings === undefined ? undefined : structuredClone(options.settings),
				licensingRowId: options.licensingRowId,
				fallbackPresetId: options.fallbackPresetId,
				now: options.now,
			});
			return await enqueueMutation(async () => {
				const result = saveDeliveryPresetToState(runtime.state.deliveryPresets, {
					...snapshot,
					idFactory,
				});
				await commit(result.state);
				return result.preset;
			});
		},
		async delete(presetId: string): Promise<true> {
			const id = presetId;
			return await enqueueMutation(async () => {
				await commit(deleteDeliveryPreset(runtime.state.deliveryPresets, id));
				return true as const;
			});
		},
		async import(input: unknown): Promise<readonly DeliveryPreset[]> {
			const snapshot = importDeliveryPresets(createDeliveryPresetState(), input);
			return await enqueueMutation(async () => {
				await commit(importDeliveryPresets(runtime.state.deliveryPresets, snapshot, { idFactory }));
				return listDeliveryPresets(runtime.state.deliveryPresets);
			});
		},
		export: (presetId: string): string =>
			exportDeliveryPreset(runtime.state.deliveryPresets, presetId),
		/** Write one preset out through the reserved 'preset' purpose. */
		async saveToFile(presetId: string): Promise<string> {
			const preset = applyDeliveryPreset(runtime.state.deliveryPresets, presetId);
			const text = exportDeliveryPreset(runtime.state.deliveryPresets, presetId);
			await runtime.fileService?.saveFile?.({
				purpose: 'preset',
				suggestedName: `${preset.label.replaceAll(/[^a-z0-9_-]+/giu, '-') || 'delivery-preset'}.json`,
				mimeType: 'application/json',
				text,
			});
			return text;
		},
	});
}
