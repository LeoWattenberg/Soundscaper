/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDeferredModuleFacade } from './deferred-module-facade.ts';
import {
	createExportSnapshotRenderer,
	type ExportSnapshotRendererRuntime,
} from './export-snapshot-renderer.ts';

export type DeferredEditorExportModule = typeof import('./export-service.ts');
type EditorExportService = ReturnType<DeferredEditorExportModule['createEditorExportService']>;
type RuntimeValue = unknown;

export type DeferredEditorExportLoader = () => Promise<DeferredEditorExportModule>;

const DEFAULT_LOADER: DeferredEditorExportLoader = () => import('./export-service.ts');

const DEFERRED_EXPORT_METHOD_NAMES = [
	'derivePersistentAudioDeliveryPlan',
	'cancelPersistentAudioDelivery',
	'executePersistentAudioDeliveryPlan',
	'exportVideo',
	'handleExportAction',
] as const satisfies readonly (keyof EditorExportService)[];

/**
 * Keep shared snapshot rendering eager while loading delivery execution on demand.
 *
 * `persistentAudioDeliveryAvailable` stays synchronous, as it is on the real
 * service, by answering from state this facade holds eagerly: until something
 * has asked for the delivery module there is no export in flight, so delivery
 * is available, and once the module has loaded the real predicate answers.
 * The window in between - a load requested but not settled - reports busy,
 * which is the conservative reading and matches what the service will say the
 * moment it exists. Waiting is answered the same way, so a queue worker polling
 * for an idle exporter never pulls the delivery slice into the boot path.
 */
export function createDeferredEditorExportService(
	runtime: ExportSnapshotRendererRuntime & Readonly<Record<string, RuntimeValue>>,
	loadModule: DeferredEditorExportLoader = DEFAULT_LOADER,
) {
	const exportSnapshotRenderer = createExportSnapshotRenderer(runtime);
	let servicePromise: Promise<EditorExportService> | null = null;
	let loadedService: EditorExportService | null = null;
	const loadService = (): Promise<EditorExportService> => {
		servicePromise ??= Promise.resolve()
			.then(loadModule)
			.then((module) => {
				const service = module.createEditorExportService({ ...runtime, exportSnapshotRenderer });
				loadedService = service;
				return service;
			})
			.catch((error: unknown) => {
				servicePromise = null;
				throw error;
			});
		return servicePromise;
	};
	return createDeferredModuleFacade(loadService, DEFERRED_EXPORT_METHOD_NAMES, {
		eager: {
			persistentAudioDeliveryAvailable: ((): boolean => (
				loadedService ? loadedService.persistentAudioDeliveryAvailable() : servicePromise === null
			)) satisfies EditorExportService['persistentAudioDeliveryAvailable'],
			whenPersistentAudioDeliveryAvailable: (async (): Promise<void> => {
				if (!servicePromise) return;
				await (await loadService()).whenPersistentAudioDeliveryAvailable();
			}) satisfies EditorExportService['whenPersistentAudioDeliveryAvailable'],
			renderSnapshot: exportSnapshotRenderer.renderSnapshot satisfies
				EditorExportService['renderSnapshot'],
		},
	});
}
