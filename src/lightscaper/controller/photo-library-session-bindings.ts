/* SPDX-License-Identifier: AGPL-3.0-only */

import { capturePhotoManagedImportPortsV2 } from '../import/managed-import-ports-v2.ts';
import type { PhotoDevelopPresetSettingsPortV1 } from '../storage/photo-develop-presets-v1.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';

/** Fixed current composition pins receiver authority before initialization or recovery can yield. */
export function capturePhotoLibrarySessionPorts(ports: PhotoLibrarySessionPortsV2): Readonly<PhotoLibrarySessionPortsV2> {
	const catalog = ports.catalog, media = ports.media, journal = ports.journal, stacks = ports.stacks, smart = ports.smartCollections;
	const settings = ports.settings, presetSettings = ports.developPresetSettings, exportPresets = ports.exportPresetSettings, inspection = ports.originalInspection,
		restoration = ports.originalRestoration, backup = ports.backup;
	const initialize = ports.initialize, closeResources = ports.closeResources, exclusive = ports.exclusive,
		verifyResources = ports.verifyResources, cubeLutResources = ports.cubeLutResources, maskRasterResources = ports.maskRasterResources, createPreviewScheduler = ports.createPreviewScheduler,
		prepare = ports.prepare, importPhotos = ports.importPhotos, createId = ports.createId, now = ports.now;
	const managed = capturePhotoManagedImportPortsV2({ catalog, media, journal,
		...(exclusive === undefined ? {} : { exclusive }), ...(verifyResources === undefined ? {} : { verifyResources }) });
	return Object.freeze<PhotoLibrarySessionPortsV2>({
		catalog: Object.freeze({ ...managed.catalog, savePhoto: pin(catalog.savePhoto, catalog), saveCatalog: pin(catalog.saveCatalog, catalog),
			readSummaryPage: pin(catalog.readSummaryPage, catalog), readQueryPage: pin(catalog.readQueryPage, catalog),
			rebuildQueryIndexPage: pin(catalog.rebuildQueryIndexPage, catalog),
			...optional(catalog, 'readQueryPageV2'), ...optional(catalog, 'rebuildQueryIndexPageV2'), ...optional(catalog, 'readCullingDestinationPage'),
		}), media: managed.media, journal: managed.journal, exclusive: managed.exclusive,
		...(managed.verifyResources === undefined ? {} : { verifyResources: managed.verifyResources }),
		initialize: pin(initialize, ports), closeResources: pin(closeResources, ports),
		...(settings === undefined ? {} : { settings: captureSettings(settings) }),
		...(presetSettings === undefined ? {} : { developPresetSettings: captureSettings(presetSettings) }),
		...(ports.exportJournalSettings === undefined ? {} : { exportJournalSettings: Object.freeze({ ...captureSettings(ports.exportJournalSettings), ...optional(ports.exportJournalSettings, 'deleteIfCurrent') }) }),
		...(exportPresets === undefined ? {} : { exportPresetSettings: captureSettings(exportPresets) }),
		...(stacks === undefined ? {} : { stacks: Object.freeze({ readSnapshot: pin(stacks.readSnapshot, stacks),
			readStackState: pin(stacks.readStackState, stacks), loadStack: pin(stacks.loadStack, stacks),
			readStackMembershipPage: pin(stacks.readStackMembershipPage, stacks), readStackMemberPage: pin(stacks.readStackMemberPage, stacks),
			readStackPage: pin(stacks.readStackPage, stacks), saveStack: pin(stacks.saveStack, stacks), dissolveStack: pin(stacks.dissolveStack, stacks),
			readStackQueryPage: pin(stacks.readStackQueryPage, stacks), ...optional(stacks, 'readStackQueryPageV2'),
		}) }),
		...(smart === undefined ? {} : { smartCollections: Object.freeze({ readSmartCollectionPage: pin(smart.readSmartCollectionPage, smart),
			readSmartCollectionSnapshotV1: pin(smart.readSmartCollectionSnapshotV1, smart), readSmartCollectionQueryPageV1: pin(smart.readSmartCollectionQueryPageV1, smart),
			readSmartCollectionStackQueryPageV1: pin(smart.readSmartCollectionStackQueryPageV1, smart), saveSmartCollection: pin(smart.saveSmartCollection, smart),
			deleteSmartCollection: pin(smart.deleteSmartCollection, smart),
		}) }),
		...(inspection === undefined ? {} : { originalInspection: { inspect: pin(inspection.inspect, inspection) } }),
		...(restoration === undefined ? {} : { originalRestoration: { restoreCatalogOriginalBody: pin(restoration.restoreCatalogOriginalBody, restoration) } }),
		...(backup === undefined ? {} : { backup: Object.freeze({ readSnapshot: pin(backup.readSnapshot, backup),
			captureSmartCollectionArchiveV1: pin(backup.captureSmartCollectionArchiveV1, backup), loadOriginal: pin(backup.loadOriginal, backup) }) }),
		...(cubeLutResources === undefined ? {} : { cubeLutResources: pin(cubeLutResources, ports) }),
		...(maskRasterResources === undefined ? {} : { maskRasterResources: pin(maskRasterResources, ports) }),
		...(createPreviewScheduler === undefined ? {} : { createPreviewScheduler: pin(createPreviewScheduler, ports) }),
		...(prepare === undefined ? {} : { prepare: pin(prepare, ports) }),
		...(importPhotos === undefined ? {} : { importPhotos: pin(importPhotos, ports) }),
		...(createId === undefined ? {} : { createId: pin(createId, ports) }), ...(now === undefined ? {} : { now: pin(now, ports) }),
	});
}
function captureSettings(settings: PhotoDevelopPresetSettingsPortV1): PhotoDevelopPresetSettingsPortV1 {
	return Object.freeze({ get: pin(settings.get, settings), putIfAbsent: pin(settings.putIfAbsent, settings),
		replaceIfCurrent: pin(settings.replaceIfCurrent, settings), ...optional(settings, 'readEntry') });
}
function optional<Port extends object, Key extends keyof Port>(port: Port, key: Key): Partial<Pick<Port, Key>> {
	const value = port[key];
	if (value === undefined) return {};
	return { [key]: pin(value as (...args: never[]) => unknown, port) } as Partial<Pick<Port, Key>>;
}
function pin<Method extends (...args: never[]) => unknown>(method: Method, receiver: unknown): Method {
	if (typeof method !== 'function') throw new TypeError('Current photo Session requires callable selected capabilities.');
	return ((...args: unknown[]) => Reflect.apply(method, receiver, args)) as unknown as Method;
}
