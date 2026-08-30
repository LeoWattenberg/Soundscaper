/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createExportSnapshotRenderer,
	type ExportSnapshotRendererRuntime,
} from './export-snapshot-renderer.ts';

export type DeferredEditorExportModule = typeof import('./export-service.ts');
type EditorExportService = ReturnType<DeferredEditorExportModule['createEditorExportService']>;
type RuntimeValue = unknown;

export type DeferredEditorExportLoader = () => Promise<DeferredEditorExportModule>;

const DEFAULT_LOADER: DeferredEditorExportLoader = () => import('./export-service.ts');

/** Keep shared snapshot rendering eager while loading delivery execution on demand. */
export function createDeferredEditorExportService(
	runtime: ExportSnapshotRendererRuntime & Readonly<Record<string, RuntimeValue>>,
	loadModule: DeferredEditorExportLoader = DEFAULT_LOADER,
) {
	const exportSnapshotRenderer = createExportSnapshotRenderer(runtime);
	let servicePromise: Promise<EditorExportService> | null = null;
	const loadService = () => {
		servicePromise ??= Promise.resolve()
			.then(loadModule)
			.then((module) => module.createEditorExportService({
				...runtime,
				exportSnapshotRenderer,
			}));
		return servicePromise;
	};
	return Object.freeze({
		derivePersistentAudioDeliveryPlan: async (
			...args: Parameters<EditorExportService['derivePersistentAudioDeliveryPlan']>
		) => (await loadService()).derivePersistentAudioDeliveryPlan(...args),
		cancelPersistentAudioDelivery: async (
			...args: Parameters<EditorExportService['cancelPersistentAudioDelivery']>
		) => (await loadService()).cancelPersistentAudioDelivery(...args),
		persistentAudioDeliveryAvailable: async () => (
			(await loadService()).persistentAudioDeliveryAvailable()
		),
		whenPersistentAudioDeliveryAvailable: async () => (
			(await loadService()).whenPersistentAudioDeliveryAvailable()
		),
		executePersistentAudioDeliveryPlan: async (
			...args: Parameters<EditorExportService['executePersistentAudioDeliveryPlan']>
		) => (await loadService()).executePersistentAudioDeliveryPlan(...args),
		exportVideo: async (...args: Parameters<EditorExportService['exportVideo']>) => (
			(await loadService()).exportVideo(...args)
		),
		handleExportAction: async (...args: Parameters<EditorExportService['handleExportAction']>) => (
			(await loadService()).handleExportAction(...args)
		),
		renderSnapshot: exportSnapshotRenderer.renderSnapshot,
	});
}
