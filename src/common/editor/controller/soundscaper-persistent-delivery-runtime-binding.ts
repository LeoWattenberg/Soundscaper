/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DeliveryReport } from '../delivery-report.ts';

export interface SoundscaperPersistentDeliveryExportRuntime {
	readonly exportService: Readonly<{
		derivePersistentAudioDeliveryPlan: (
			settings: Readonly<Record<string, unknown>>,
		) => PromiseLike<Readonly<{
			settings: Readonly<Record<string, unknown>>;
			exportPlan: Readonly<Record<string, unknown>>;
		}>>;
		executePersistentAudioDeliveryPlan: (value: Readonly<{
			settings: Readonly<Record<string, unknown>>;
			exportPlan: Readonly<Record<string, unknown>>;
			destination: unknown;
		}>) => PromiseLike<unknown>;
		persistentAudioDeliveryAvailable: () => PromiseLike<boolean> | boolean;
		whenPersistentAudioDeliveryAvailable: () => PromiseLike<void>;
	}>;
	readonly getProject: () => Readonly<{
		id?: unknown; revision?: unknown; title?: unknown;
	}> | null | undefined;
	readonly getSaveState: () => unknown;
	readonly captureProjectGeneration: () => unknown;
	readonly assertProjectGeneration: (token: unknown) => void;
	readonly deliveryReport: () => DeliveryReport | null;
	readonly cancelExport: () => PromiseLike<unknown> | unknown;
	readonly publishDocumentSnapshot: () => void;
}

interface SoundscaperPersistentDeliveryRuntimeOptions {
	readonly bindSoundscaperPersistentDeliveryRuntime?: (
		runtime: SoundscaperPersistentDeliveryExportRuntime,
	) => void;
}

/** Close the common composition seam while leaving product ownership outside it. */
export function bindSoundscaperPersistentDeliveryRuntime(
	options: SoundscaperPersistentDeliveryRuntimeOptions | unknown,
	runtime: SoundscaperPersistentDeliveryExportRuntime,
): void {
	if (!options || typeof options !== 'object' || Array.isArray(options)) return;
	const descriptor = Object.getOwnPropertyDescriptor(options, 'bindSoundscaperPersistentDeliveryRuntime');
	if (!descriptor) return;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'function') {
		throw new TypeError('The Soundscaper persistent delivery runtime binder must be an own function.');
	}
	assertRuntime(runtime);
	descriptor.value(Object.freeze({ ...runtime }));
}

function assertRuntime(runtime: SoundscaperPersistentDeliveryExportRuntime): void {
	if (!runtime || typeof runtime !== 'object' || !runtime.exportService
		|| typeof runtime.exportService.derivePersistentAudioDeliveryPlan !== 'function'
		|| typeof runtime.exportService.executePersistentAudioDeliveryPlan !== 'function'
		|| typeof runtime.exportService.persistentAudioDeliveryAvailable !== 'function'
		|| typeof runtime.exportService.whenPersistentAudioDeliveryAvailable !== 'function'
		|| typeof runtime.getProject !== 'function' || typeof runtime.getSaveState !== 'function'
		|| typeof runtime.captureProjectGeneration !== 'function'
		|| typeof runtime.assertProjectGeneration !== 'function'
		|| typeof runtime.deliveryReport !== 'function' || typeof runtime.cancelExport !== 'function'
		|| typeof runtime.publishDocumentSnapshot !== 'function') {
		throw new TypeError('The Soundscaper persistent delivery export runtime is incomplete.');
	}
}
