/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import type { PhotoCommandOwnerV2 } from './photo-command-owner-v2.ts';
import type { PhotoCommandOwnerCurrentV1 } from './photo-command-owner-current-v1.ts';
import { field, id, integer, record } from '../catalog/value-validation.ts';
import type { PhotoCatalogContinuationV1 } from '../catalog/repository-types.ts';
import type { PhotoManagedImportPortsV2 } from '../import/managed-import-ports-v2.ts';
import type { PhotoManagedImportPortsCurrentV1 } from '../import/managed-import-ports-current-v1.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import { capturePhotoManagedImportPortsForProfileV1 } from '../import/managed-import-ports-v2.ts';
import type { PhotoDevelopPresetSettingsPortV1 } from '../storage/photo-develop-presets-v1.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';

/** Fixed current composition pins receiver authority before initialization or recovery can yield. */
export function capturePhotoLibrarySessionPorts(ports: PhotoLibrarySessionPortsV2): Readonly<PhotoLibrarySessionPortsV2> {
	return capturePhotoLibrarySessionPortsForProfileV1(ports);
}
export function capturePhotoLibrarySessionPortsCurrentV1(ports: PhotoLibrarySessionPortsCurrentV1): Readonly<PhotoLibrarySessionPortsCurrentV1> {
	return capturePhotoLibrarySessionPortsForProfileV1(ports, true);
}
function capturePhotoLibrarySessionPortsForProfileV1<Ports extends PhotoLibrarySessionPortsV2 | PhotoLibrarySessionPortsCurrentV1>(ports: Ports, current = false): Readonly<Ports> {
	const catalog = ports.catalog, media = ports.media, journal = ports.journal, stacks = ports.stacks, smart = ports.smartCollections;
	const settings = ports.settings, presetSettings = ports.developPresetSettings, exportPresets = ports.exportPresetSettings, inspection = ports.originalInspection,
		restoration = ports.originalRestoration, backup = ports.backup;
	const initialize = ports.initialize, closeResources = ports.closeResources, exclusive = ports.exclusive,
		verifyResources = ports.verifyResources, cubeLutResources = ports.cubeLutResources, maskRasterResources = ports.maskRasterResources, createPreviewScheduler = ports.createPreviewScheduler,
		prepare = ports.prepare, importPhotos = ports.importPhotos, createId = ports.createId, now = ports.now;
	const managed = capturePhotoManagedImportPortsForProfileV1({ catalog, media, journal,
		...(exclusive === undefined ? {} : { exclusive }), ...(verifyResources === undefined ? {} : { verifyResources }) } as PhotoManagedImportPortsV2 | PhotoManagedImportPortsCurrentV1);
	return Object.freeze({
		catalog: Object.freeze({ ...managed.catalog, savePhoto: pin(catalog.savePhoto, catalog), saveCatalog: pin(catalog.saveCatalog, catalog),
			...(current ? optional(catalog as PhotoLibrarySessionPortsCurrentV1['catalog'], 'publishDerivedPhotoCurrentV1') : {}),
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
	}) as unknown as Readonly<Ports>;
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

/** Unported transport owners receive only fully admitted legacy documents.
 * The true Current catalog is never projected into a fictitious Photo2. */
export function legacyPhotoLibrarySessionPortsV1(ports: PhotoLibrarySessionPortsCurrentV1): Readonly<PhotoLibrarySessionPortsV2> {
	const catalog = ports.catalog;
	return Object.freeze<PhotoLibrarySessionPortsV2>({ ...ports, catalog: Object.freeze({ ...catalog,
		loadPhoto: async (...args: Parameters<typeof catalog.loadPhoto>) => { const value = await catalog.loadPhoto(...args); return value === null ? null : normalizePhotoDocumentV1OrV2(value); },
		savePhoto: async (value: unknown, revision: number, options?: Readonly<{ signal?: AbortSignal }>) => {
			const photo = normalizePhotoDocumentV1OrV2(value); return normalizePhotoDocumentV1OrV2(await catalog.savePhoto(photo, revision, options)); },
		publishPhotos: (catalogId: string, revision: number, values: readonly unknown[], options?: Readonly<{ signal?: AbortSignal }>) =>
			catalog.publishPhotos(catalogId, revision, values.map(normalizePhotoDocumentV1OrV2), options),
	}), ...(ports.verifyResources ? { verifyResources: (value, signal) => ports.verifyResources!(normalizePhotoDocumentV1OrV2(value), signal) } : {}) });
}
export function legacyPhotoCommandOwnerV1(owner: PhotoCommandOwnerV2 | PhotoCommandOwnerCurrentV1): PhotoCommandOwnerV2 {
	normalizePhotoDocumentV1OrV2(owner.history.present);
	// Both named owners share the same command kernel. Full strict2 admission
	// above is required before an unported helper may borrow its commands.
	return owner as PhotoCommandOwnerV2;
}
export function readPhotoLibraryPageCursorV1(value: string | null | undefined): PhotoCatalogContinuationV1 | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 1_024) throw new RangeError('Photo page cursor exceeds its scalar bound.');
	const input: unknown = JSON.parse(value), cursor = record(input, 'photo page cursor', ['catalogId', 'indexRevision', 'scope', 'afterKey']);
	const scope = field(cursor, 'scope'), afterKey = field(cursor, 'afterKey');
	if (typeof scope !== 'string' || typeof afterKey !== 'string') throw new TypeError('Photo page cursor requires its indexed scope.');
	return { catalogId: id(field(cursor, 'catalogId'), 'cursor catalog ID'),
		indexRevision: integer(field(cursor, 'indexRevision'), 0, Number.MAX_SAFE_INTEGER, 'cursor revision'), scope, afterKey };
}
