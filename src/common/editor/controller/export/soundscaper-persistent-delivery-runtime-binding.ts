/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectToken } from '../shared/lifecycle.ts';

import { isDeliveryReport, type DeliveryReport } from '../../delivery-report.ts';

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
		persistentAudioDeliveryAvailable: () => boolean;
		whenPersistentAudioDeliveryAvailable: () => PromiseLike<void>;
	}>;
	readonly getProject: () => Readonly<{
		id?: unknown; revision?: unknown; title?: unknown;
	}> | null | undefined;
	readonly getSaveState: () => unknown;
	readonly captureProjectGeneration: () => EditorProjectToken;
	readonly assertProjectGeneration: (token: EditorProjectToken) => void;
	readonly deliveryReport: () => DeliveryReport | null;
	readonly cancelExport: () => PromiseLike<unknown> | unknown;
	readonly publishDocumentSnapshot: () => void;
}

type PersistentDeliveryRuntimeInput = Omit<SoundscaperPersistentDeliveryExportRuntime, 'deliveryReport'>
	& Readonly<{ deliveryReport: () => unknown }>;

interface SoundscaperPersistentDeliveryRuntimeOptions {
	readonly bindSoundscaperPersistentDeliveryRuntime?: (
		runtime: SoundscaperPersistentDeliveryExportRuntime,
	) => void;
}

/** Close the common composition seam while leaving product ownership outside it. */
export function bindSoundscaperPersistentDeliveryRuntime(
	options: SoundscaperPersistentDeliveryRuntimeOptions | unknown,
	runtime: PersistentDeliveryRuntimeInput,
): void {
	if (!options || typeof options !== 'object' || Array.isArray(options)) return;
	const descriptor = Object.getOwnPropertyDescriptor(options, 'bindSoundscaperPersistentDeliveryRuntime');
	if (!descriptor) return;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
		|| typeof descriptor.value !== 'function') {
		throw new TypeError('The Soundscaper persistent delivery runtime binder must be an own function.');
	}
	assertRuntime(runtime);
	descriptor.value(Object.freeze({ ...runtime, deliveryReport: () => {
		const report = runtime.deliveryReport();
		return isDeliveryReport(report) ? report : null;
	} }));
}

function assertRuntime(runtime: PersistentDeliveryRuntimeInput): void {
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
