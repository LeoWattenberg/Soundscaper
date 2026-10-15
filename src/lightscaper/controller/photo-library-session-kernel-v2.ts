/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryAttributePatchV1, PhotoLibraryImportItemV1, PhotoLibraryMetadataPatchV1, PhotoLibraryMetadataSnapshotV1, PhotoLibraryDefinitionPageRequestV1, PhotoLibraryDefinitionPageV1, PhotoLibraryQueryBuildProgressV1, PhotoLibraryQueryStepV1, PhotoLibraryQueryV1, PhotoLibraryPreviewOutcomeV1, PhotoLibraryPreviewTierV1, PhotoLibraryPageV1, PhotoLibraryRowV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryDefinitionAcknowledgementV1, PhotoLibraryDefinitionCommandV1, PhotoLibraryDefinitionReadRequestV1, PhotoLibraryDefinitionSnapshotV1,
	PhotoLibraryMembershipAcknowledgementV1, PhotoLibraryMembershipPatchV1, PhotoLibraryMembershipSnapshotV1 } from '../../common/editor/photo-library-organization-port-v1.ts';
import type { PhotoLibraryImportPresetCommandV1, PhotoLibraryImportPresetSnapshotV1, PhotoLibraryImportRequestOptionsV1 } from '../../common/editor/photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryDevelopImportPortV2, PhotoLibraryDevelopImportRequestV2 } from '../../common/editor/photo-library-develop-import-port-v2.ts';
import type { PhotoLibraryBackupOptionsV1, PhotoLibraryBackupResultV1 } from '../../common/editor/photo-library-backup-port-v1.ts';
import type { PhotoLibraryOriginalInspectionFailureV1, PhotoLibraryOriginalInspectionPageV1,
	PhotoLibraryOriginalRestoreTargetV1, PhotoLibraryOriginalRestorationOptionsV1, PhotoLibraryOriginalRestorationReceiptV1 } from '../../common/editor/photo-library-original-recovery-port-v1.ts';
import type { PhotoLibraryBatchRenameRequestV1, PhotoLibraryBatchRenamePlanV1,
	PhotoLibraryBatchRenameUndoV1, PhotoLibraryBatchRenameReceiptV1, PhotoLibraryBatchRenameSnapshotV1 } from '../../common/editor/photo-library-batch-rename-port-v1.ts';
import { createPhotoLibraryBatchRenameSessionCurrentV1 } from './photo-library-batch-rename-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { PhotoCommandOwnerCurrentV1 } from './photo-command-owner-current-v1.ts';
import { createPhotoLibraryDevelopSessionV3 } from './photo-library-develop-session-v3.ts';
import { createPhotoDevelopPresetChildrenCurrentV1 } from './photo-library-develop-presets-host-current-v1.ts';
import { readPhotoLibraryMetadataSnapshotCurrentV1 } from './photo-library-metadata-current-v1.ts';
import { readPhotoLibraryMembershipsCurrentV1, applyPhotoLibraryMembershipsCurrentV1 } from './photo-library-memberships-current-v1.ts';
import { readPhotoLibraryOriginalInspectionPageCurrentV1 } from './photo-library-original-inspection-current-v1.ts';
import { restorePhotoLibraryOriginalBodyCurrentV1 } from './photo-library-original-restoration-current-v1.ts';
import { recoverManagedPhotoImportCurrentV1 } from '../import/photo-import-recovery-current-v1.ts';
import type { PhotoManagedImportPortsCurrentV1 } from '../import/managed-import-ports-current-v1.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { field, id, integer, oneOf, record } from '../catalog/value-validation.ts';
import { withPhotoCatalogWriteLockV1 } from '../import/catalog-write-lock-v1.ts';
import { recoverManagedPhotoImportV2 } from '../import/managed-import-v2.ts';
import type { PhotoManagedImportPortsV2 } from '../import/managed-import-ports-v2.ts';
import { applyPhotoImportPresetV1, normalizePhotoImportPresetCommandV1, readPhotoImportPresetsV1 } from '../storage/photo-import-presets-v1.ts';
import { PhotoCommandOwnerV2 } from './photo-command-owner-v2.ts';
import { normalizePhotoLibraryAttributesV1 } from './photo-library-attributes.ts';
import { normalizePhotoLibraryMetadataPatchV1 } from './photo-library-metadata.ts';
import { readPhotoLibraryMetadataSnapshotV2 } from './photo-library-metadata-v2.ts';
import { admitPhotoLibraryQueryBuildRequestV1 } from './photo-library-query-v1.ts';
import { createPhotoLibraryQuerySessionV2 } from './photo-library-query-session-v2.ts';
import { createPhotoLibrarySavedCollectionsSessionV1 } from './photo-library-saved-collections-session-v1.ts';
import { admitPhotoLibraryDefinitionPageRequestV1, readPhotoLibraryDefinitionPageV1 } from './photo-library-definition-pages-v1.ts';
import { normalizePhotoLibraryDefinitionReadRequestV1, normalizePhotoLibraryDefinitionMutationV1,
	readPhotoLibraryDefinitionV1, applyPhotoLibraryDefinitionV1 } from './photo-library-organizer-v1.ts';
import { normalizePhotoLibraryMembershipReadV1, normalizePhotoLibraryMembershipMutationV1,
	} from './photo-library-memberships-v1.ts';
import { readPhotoLibraryMembershipsV2, applyPhotoLibraryMembershipsV2 } from './photo-library-memberships-v2.ts';
import type { PhotoLibraryPreviewSchedulerPortV2, PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';
import { admitPhotoLibraryImportRequestV1 } from './photo-library-import-request.ts';
import { createPhotoLibraryDevelopImportSessionV2 } from './photo-library-develop-import-session-v2.ts';
import { planPhotoLibraryBatchRenameV2, readPhotoLibraryBatchRenameSelectionV2, renamePhotoLibraryBatchV2,
	undoPhotoLibraryBatchRenameV2, type PhotoBatchRenameSessionPortsV2 } from './photo-library-batch-rename-v2.ts';
import { admitPhotoLibraryOriginalInspectionRequestV1, photoOriginalInspectionFailureV1, readPhotoLibraryOriginalInspectionPageV2 } from './photo-library-original-inspection-v2.ts';
import { admitPhotoLibraryOriginalRestorationRequestV1, restorePhotoLibraryOriginalBodyV2 } from './photo-library-original-restoration-v2.ts';
import type { PhotoLibraryStackOptionsV1, PhotoLibraryStackBindingV1, PhotoLibraryStackCommandV1, PhotoLibraryStackAcknowledgementV1 } from '../../common/editor/photo-library-stack-port-v1.ts';
import { admitPhotoLibraryStackCommandV1, admitPhotoLibraryStackReadV1, admitPhotoLibraryStackMembersV1, admitPhotoLibraryStackSummaryV1,
	readPhotoLibraryStackMembershipsV1, readPhotoLibraryStackSnapshotV1, readPhotoLibraryStackMembersV1, readPhotoLibraryStackSummaryPageV1,
	applyPhotoLibraryStackV1, type PhotoLibraryStackRepositoryV1 } from './photo-library-stacks-v1.ts';
import { readPhotoStackSignalOptionsV1 } from '../catalog/photo-stack-repository-v1.ts';
import type { PhotoLibraryQueryV2, PhotoLibraryQueryBuildProgressV2 } from '../../common/editor/photo-library-query-port-v2.ts';
import { createPhotoLibraryDevelopSessionV2 } from './photo-library-develop-session-v2.ts';
import { createPhotoLibraryCullingNavigationSessionV1 } from './photo-library-culling-navigation-session-v1.ts';

import { readPhotoLibrarySessionExportSidecarForProfileV1, createPhotoLibrarySessionExportJournalPortV1 } from './photo-library-session-export-sidecar.ts';
import type { PhotoLibraryExportSidecarRequest, PhotoLibrarySessionPortV2, PhotoLibraryExportJournalPort } from '../../common/editor/photo-library-session-port-v2.ts';
import type { PhotoLibraryCubeLutPortV1 } from '../../common/editor/photo-library-cube-lut-port-v1.ts';
import type { PhotoLibraryImageHandoffPortV1, PhotoLibraryImageHandoffRequestV1, PhotoLibraryImageHandoffViewV1 } from '../../common/editor/photo-library-image-handoff-port-v1.ts';
import type { PhotoLibraryCollectionHandoffPortV1, PhotoLibraryCollectionHandoffRequestV1, PhotoLibraryCollectionHandoffViewV1 } from '../../common/editor/photo-library-collection-handoff-port-v1.ts';
import type { CubeLutSourcePortV1 } from '../../common/editor/imaging/cube-lut-source-port-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../common/editor/imaging/mask-raster-source-port-v1.ts';
import { normalizeVideoColorGradeV1 } from '../../common/editor/video-color-management-v27.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { PhotoLibrarySessionLifetime } from './photo-library-session-lifetime.ts';
import { createPhotoLibraryImageReceiveSessionV1 } from './photo-library-image-receive-session.ts';
import { createPhotoLibrarySessionImageChildrenCurrentV1 } from './photo-library-session-image-children-current-v1.ts';
import { createPhotoLibrarySessionImport } from './photo-library-session-import.ts';
import { createPhotoLibrarySessionImportChildCurrentV1, type PhotoLibrarySessionImportChildHostCurrentV1 } from './photo-library-session-import-child-current-v1.ts';
import { createPhotoLibrarySessionImportCurrentV1 } from './photo-library-session-import-current-v1.ts';
import { backupPhotoLibrarySession } from './photo-library-session-backup.ts';
import { backupPhotoLibrarySessionCurrentV1 } from './photo-library-session-backup-current-v1.ts';
import { capturePhotoLibrarySessionPorts, capturePhotoLibrarySessionPortsCurrentV1, legacyPhotoLibrarySessionPortsV1, legacyPhotoCommandOwnerV1, readPhotoLibraryPageCursorV1 } from './photo-library-session-bindings.ts';
import { createPhotoLibraryMaskRasterSourceV1 } from './photo-library-mask-raster-session-v1.ts';
import { createPhotoLibraryDevelopMaskRasterSessionV1 } from './photo-library-develop-mask-raster-session-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** Product session owns lifetime, bounded presentation pages and a single writer. */
export class PhotoLibrarySessionKernelV2 {
	readonly batchRenameCurrent?: ReturnType<typeof createPhotoLibraryBatchRenameSessionCurrentV1>;
	readonly savedCollections: ReturnType<typeof createPhotoLibrarySavedCollectionsSessionV1>;
	readonly develop: ReturnType<typeof createPhotoLibraryDevelopSessionV2> | ReturnType<typeof createPhotoLibraryDevelopSessionV3>;
	readonly legacyDevelop?: ReturnType<typeof createPhotoLibraryDevelopSessionV2>;
	readonly developImport: Readonly<PhotoLibraryDevelopImportPortV2>;
	readonly developImportCurrent?: ReturnType<typeof createPhotoLibrarySessionImportChildCurrentV1>;
	readonly #ports: PhotoLibrarySessionPortsCurrentV1;
	readonly #legacyPorts: PhotoLibrarySessionPortsV2;
	readonly #current: boolean;
	readonly #developPresetSettings: PhotoLibrarySessionPortsV2['developPresetSettings'];
	readonly #queries: ReturnType<typeof createPhotoLibraryQuerySessionV2>;
	readonly #lifetime = new PhotoLibrarySessionLifetime();
	readonly #imports: ReturnType<typeof createPhotoLibrarySessionImport>;
	readonly #currentImports?: ReturnType<typeof createPhotoLibrarySessionImportCurrentV1>;
	readonly cubeLuts: Readonly<PhotoLibraryCubeLutPortV1>;
	readonly maskRasterSource: Readonly<MaskRasterSourcePortV1>;
	readonly imageReceive: ReturnType<typeof createPhotoLibraryImageReceiveSessionV1>;
	readonly imageHandoff: Readonly<PhotoLibraryImageHandoffPortV1>;
	readonly imageHandoffCurrent?: ReturnType<typeof createPhotoLibrarySessionImageChildrenCurrentV1>['imageHandoffCurrent'];
	readonly imageReceiveCurrent?: ReturnType<typeof createPhotoLibrarySessionImageChildrenCurrentV1>['imageReceiveCurrent'];
	readonly collectionHandoff: Readonly<PhotoLibraryCollectionHandoffPortV1>;
	readonly collectionHandoffCurrent?: ReturnType<typeof createPhotoLibrarySessionImageChildrenCurrentV1>['collectionHandoffCurrent'];
	readonly cullingNavigation?: PhotoLibrarySessionPortV2['cullingNavigation'];
	readonly exportJournal?: Readonly<PhotoLibraryExportJournalPort>;
	readonly exportJournalCurrent?: Readonly<PhotoLibraryExportJournalPort>;
	readonly exportPresets?: PhotoLibrarySessionPortV2['exportPresets'];
	#catalog: Promise<string> | null = null;
	#photo: PhotoCommandOwnerV2 | PhotoCommandOwnerCurrentV1 | null = null;
	#previews: Promise<PhotoLibraryPreviewSchedulerPortV2> | null = null;
	#presetActive = false;
	#startupFailure: PhotoLibraryOriginalInspectionFailureV1 | null = null;

	protected constructor(profile: 'legacy2' | 'current3', value: PhotoLibrarySessionPortsV2 | PhotoLibrarySessionPortsCurrentV1) {
		if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed photo Session profile.');
		this.#current = profile === 'current3';
		const ports = this.#current ? capturePhotoLibrarySessionPortsCurrentV1(value as PhotoLibrarySessionPortsCurrentV1)
			: capturePhotoLibrarySessionPorts(value as PhotoLibrarySessionPortsV2) as PhotoLibrarySessionPortsCurrentV1;
		this.#ports = ports; this.#legacyPorts = this.#current ? legacyPhotoLibrarySessionPortsV1(ports) : ports as PhotoLibrarySessionPortsV2;
		const legacy = this.#legacyPorts;
		this.maskRasterSource = createPhotoLibraryMaskRasterSourceV1({ resources: ports.maskRasterResources, ready: () => this.#ready(),
			operation: (run, signal, admit) => this.#operation(run, signal, admit) });
		if (ports.catalog.readCullingDestinationPage) this.cullingNavigation = createPhotoLibraryCullingNavigationSessionV1({
			repository: { readCullingDestinationPage: ports.catalog.readCullingDestinationPage }, ready: () => this.#ready(), operation: (run, signal) => this.#operation(run, signal) });
		this.imageReceive = createPhotoLibraryImageReceiveSessionV1({ ports: legacy, managed: this.#legacyManagedPorts(),
			mutate: (run, signal) => this.#mutation(run, signal), resetReady: () => { this.#catalog = null; } });
		if (this.#current) {
			this.batchRenameCurrent = createPhotoLibraryBatchRenameSessionCurrentV1({ repository: ports.catalog,
				mutate: (run, signal) => this.#mutation(run, signal), withPhoto: (catalogId, key, signal, run) =>
					this.#withPhoto(catalogId, key, signal, (owner, admitted) => run(owner as PhotoCommandOwnerCurrentV1, admitted)) }, () => this.#lifetime.assertAccepting());
			const children = createPhotoLibrarySessionImageChildrenCurrentV1({ ports, managed: this.#managedPorts(), ready: () => this.#ready(),
				operation: (run, signal, admit) => this.#operation(run, signal, admit), mutate: (run, signal) => this.#mutation(run, signal), resetReady: () => { this.#catalog = null; } });
			this.imageHandoffCurrent = children.imageHandoffCurrent; this.imageReceiveCurrent = children.imageReceiveCurrent;
			this.collectionHandoffCurrent = children.collectionHandoffCurrent;
		}
		this.imageHandoff = Object.freeze({ withCapture: async <Result>(value: Readonly<PhotoLibraryImageHandoffRequestV1>,
			consume: (view: Readonly<PhotoLibraryImageHandoffViewV1>) => Result | Promise<Result>, options: Readonly<{ signal?: AbortSignal }> = {}) => {
			const { signal } = readPhotoDevelopSignalOptionsV2(options); let binding!: Readonly<PhotoLibraryImageHandoffRequestV1>;
			return this.#operation(async admitted => {
				const { withPhotoLibraryImageHandoff } = await import('./photo-library-image-handoff-session.ts');
				check(admitted); const catalogId = await this.#ready(); check(admitted);
				return withPhotoLibraryImageHandoff(legacy, catalogId, binding, consume, admitted);
			}, signal, () => {
				if (typeof consume !== 'function') throw new TypeError('Image handoff requires a callable consumer.');
				const request = record(value, 'image handoff request', ['catalogId', 'photoId', 'versionId', 'expectedRevision']);
				binding = Object.freeze({ catalogId: id(field(request, 'catalogId'), 'handoff catalog ID'), photoId: id(field(request, 'photoId'), 'handoff photo ID'),
					versionId: id(field(request, 'versionId'), 'handoff version ID'), expectedRevision: integer(field(request, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'handoff revision') });
			});
		} });
		this.collectionHandoff = Object.freeze({ withCapture: async <Result>(value: Readonly<PhotoLibraryCollectionHandoffRequestV1>,
			consume: (view: Readonly<PhotoLibraryCollectionHandoffViewV1>) => Result | Promise<Result>, options: Readonly<{ signal?: AbortSignal }> = {}) => {
			const { signal } = readPhotoDevelopSignalOptionsV2(options); let binding!: Readonly<PhotoLibraryCollectionHandoffRequestV1>;
			return this.#operation(async admitted => {
				const { withPhotoLibraryCollectionHandoffV1 } = await import('./photo-library-collection-handoff-session.ts');
				check(admitted); const catalogId = await this.#ready(); check(admitted);
				return withPhotoLibraryCollectionHandoffV1(legacy, catalogId, binding, consume, admitted);
			}, signal, () => {
				if (typeof consume !== 'function') throw new TypeError('Collection handoff requires a callable consumer.');
				const request = record(value, 'collection handoff request', ['catalogId', 'collectionId', 'scope', 'expectedCatalogRevision', 'expectedDefinitionRevision'], ['catalogId', 'collectionId', 'scope', 'expectedCatalogRevision']);
				const scope = oneOf(field(request, 'scope'), ['catalog', 'saved-query'] as const, 'collection scope');
				if (scope === 'catalog' && Object.hasOwn(request, 'expectedDefinitionRevision')) throw new TypeError('Root collection uses its catalog revision.');
				binding = Object.freeze({ catalogId: id(field(request, 'catalogId'), 'collection catalog ID'), collectionId: id(field(request, 'collectionId'), 'collection ID'), scope,
					expectedCatalogRevision: integer(field(request, 'expectedCatalogRevision'), 0, Number.MAX_SAFE_INTEGER, 'collection catalog revision'),
					...(scope === 'saved-query' ? { expectedDefinitionRevision: integer(field(request, 'expectedDefinitionRevision'), 0, Number.MAX_SAFE_INTEGER, 'collection definition revision') } : {}) });
			});
		} });
		if (ports.exportPresetSettings) this.exportPresets = Object.freeze({ open: (options = {}) => {
			const { signal } = readPhotoDevelopSignalOptionsV2(options);
			return this.#operation(async admitted => {
				const { openPhotoLibraryExportPresetsSession } = await import('./photo-library-export-presets-session.ts'); check(admitted);
				return openPhotoLibraryExportPresetsSession({ settings: ports.exportPresetSettings!, ready: () => this.#ready(),
					operation: (run, caller, admit) => this.#operation(run, caller, admit), mutate: (run, caller) => this.#mutation(run, caller) }, { signal: admitted });
			}, signal);
		} });
		if (ports.exportJournalSettings) {
			const host = { settings: ports.exportJournalSettings, ready: () => this.#ready(), loadOriginal: ports.backup?.loadOriginal,
				operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, caller?: AbortSignal, admit?: () => void) => this.#operation(run, caller, admit) };
			this.exportJournal = createPhotoLibrarySessionExportJournalPortV1('legacy2', { ...host, catalog: legacy.catalog, verifyResources: legacy.verifyResources });
			if (this.#current) this.exportJournalCurrent = createPhotoLibrarySessionExportJournalPortV1('current3', { ...host, catalog: ports.catalog, verifyResources: ports.verifyResources });
		}
		const presetSettings = ports.developPresetSettings ?? ports.settings; this.#developPresetSettings = presetSettings;
		this.developImport = createPhotoLibraryDevelopImportSessionV2({ settings: presetSettings, ready: () => this.#ready(),
			operation: (run, signal) => this.#operation(run, signal), importFiles: (files, request) => this.#importFiles(files, request) });
		const maskRasters = ports.maskRasterResources ? createPhotoLibraryDevelopMaskRasterSessionV1({ source: this.maskRasterSource,
			resources: ports.maskRasterResources, mutate: (run, signal, admit) => this.#mutation(run, signal, false, admit) }) : undefined;
		const legacyDevelop = createPhotoLibraryDevelopSessionV2({ repository: legacy.catalog, ready: () => this.#ready(),
			...(maskRasters ? { maskRasters } : {}),
			originalSource: ports.backup ? { loadOriginal: ports.backup.loadOriginal } : undefined,
			presetStorage: presetSettings ? { settings: presetSettings, catalog: legacy.catalog,
				verifyResources: async (preset, signal) => { if (!ports.cubeLutResources) throw new Error('Selected LUT resources are unavailable.');
					await (await ports.cubeLutResources()).verifyPreset(preset, signal); } } : undefined,
			operation: (run, signal) => this.#operation(run, signal), edit: (key, run, signal) => this.#editPhoto(key, (owner, admitted) => run(legacyPhotoCommandOwnerV1(owner), admitted), signal),
			mutate: (run, signal) => this.#mutation(run, signal), withPhoto: (catalogId, key, signal, run) => this.#withPhoto(catalogId, key, signal, (owner, admitted) => run(legacyPhotoCommandOwnerV1(owner), admitted)) });
		this.legacyDevelop = this.#current ? legacyDevelop : undefined;
		const currentChildren = this.#current ? createPhotoDevelopPresetChildrenCurrentV1({ ports: this.#ports, presetSettings,
			ready: () => this.#ready(), operation: (run, signal) => this.#operation(run, signal), mutate: (run, signal) => this.#mutation(run, signal),
			withPhoto: (catalogId, key, signal, run) => this.#withPhoto(catalogId, key, signal, (owner, admitted) => run(owner as PhotoCommandOwnerCurrentV1, admitted)) }) : undefined;
		this.develop = this.#current ? createPhotoLibraryDevelopSessionV3({ repository: ports.catalog, ready: () => this.#ready(), maskRasters,
			...currentChildren,
			originalSource: ports.backup ? { loadOriginal: ports.backup.loadOriginal } : undefined,
			operation: (run, signal) => this.#operation(run, signal), edit: (key, run, signal) => this.#editPhoto(key, (owner, admitted) => run(owner as PhotoCommandOwnerCurrentV1, admitted), signal) }) : legacyDevelop;
		this.#imports = createPhotoLibrarySessionImport({ ports: legacy, managed: this.#legacyManagedPorts(), presetSettings,
			mutate: (run, signal) => this.#mutation(run, signal), resetReady: () => { this.#catalog = null; } });
		if (this.#current) { const host: PhotoLibrarySessionImportChildHostCurrentV1 = { ports, managed: this.#managedPorts(), presetSettings, ready: () => this.#ready(),
			operation: (run, signal) => this.#operation(run, signal), mutate: (run, signal) => this.#mutation(run, signal), resetReady: () => { this.#catalog = null; } };
			this.#currentImports = createPhotoLibrarySessionImportCurrentV1(host); this.developImportCurrent = createPhotoLibrarySessionImportChildCurrentV1(host);
		}
		const resources = ports.cubeLutResources;
		const selectedResources = async () => { if (!resources) throw new Error('Selected LUT resources are unavailable.'); return Reflect.apply(resources, ports, []); };
		this.cubeLuts = Object.freeze<PhotoLibraryCubeLutPortV1>({ schemaVersion: 1,
			source: Object.freeze({ withBytes: <Result>(...args: Parameters<CubeLutSourcePortV1['withBytes']>) => {
				const [input, consume, options] = args, { signal } = readPhotoDevelopSignalOptionsV2(options === undefined ? {} : options);
				let reference!: Readonly<VideoCubeLutReferenceV1>;
				return this.#operation(async admitted => { await this.#ready(); check(admitted);
					return (await selectedResources()).source.withBytes(reference, consume, { signal: admitted }) as Promise<Result>;
				}, signal, () => {
					const detached = normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), lut: input }).lut;
					if (!detached) throw new TypeError('Selected LUT bytes require an exact reference.');
					if (typeof consume !== 'function') throw new TypeError('Selected LUT bytes require a callable consumer.');
					reference = detached;
				});
			} }),
			importFile: (file, options) => { const { signal } = readPhotoDevelopSignalOptionsV2(options === undefined ? {} : options);
				return this.#mutation(async (_catalogId, admitted) => (await selectedResources()).importFile(file, { signal: admitted }), signal); },
		});
		this.#queries = createPhotoLibraryQuerySessionV2({ repositories: ports,
			operation: (run, signal) => this.#operation(run, signal), ready: () => this.#ready() });
		this.savedCollections = createPhotoLibrarySavedCollectionsSessionV1({ repositories: ports,
			operation: (run, signal) => this.#operation(run, signal), mutation: (run, signal) => this.#mutation(run, signal),
			ready: () => this.#ready(), createId: () => (this.#ports.createId ?? (() => crypto.randomUUID()))() });
	}

	async readStackMemberships(photoIds: readonly string[], options: PhotoLibraryStackOptionsV1 = {}) {
		const request = admitPhotoLibraryStackReadV1(photoIds, options);
		return this.#stackRead((repository, catalogId, signal) => readPhotoLibraryStackMembershipsV1(repository, catalogId, request.photoIds, signal), request.signal);
	}
	async readStackSnapshot(photoId: string, options: PhotoLibraryStackOptionsV1 = {}) {
		const request = admitPhotoLibraryStackReadV1([photoId], options);
		return this.#stackRead((repository, catalogId, signal) => readPhotoLibraryStackSnapshotV1(repository, catalogId, request.photoIds[0]!, signal), request.signal);
	}
	async readStackMembers(binding: PhotoLibraryStackBindingV1, photoIds: readonly string[], options: PhotoLibraryStackOptionsV1 = {}) {
		const request = admitPhotoLibraryStackMembersV1(binding, photoIds, options);
		return this.#stackRead((repository, catalogId, signal) => readPhotoLibraryStackMembersV1(repository, catalogId, request.binding, request.photoIds, signal), request.signal);
	}
	async readStackSummaryPage(options: Readonly<{ cursor?: string | null; signal?: AbortSignal }> = {}) {
		const request = admitPhotoLibraryStackSummaryV1(options);
		return this.#stackRead((repository, catalogId, signal) => readPhotoLibraryStackSummaryPageV1(repository, catalogId, request.continuation, signal), request.signal);
	}
	async applyStack(value: PhotoLibraryStackCommandV1, options: PhotoLibraryStackOptionsV1 = {}): Promise<PhotoLibraryStackAcknowledgementV1> {
		const command = admitPhotoLibraryStackCommandV1(value), request = readPhotoStackSignalOptionsV1(options), repository = this.#stackRepository();
		const completed: { result: PhotoLibraryStackAcknowledgementV1 | null } = { result: null };
		try {
			return await this.#mutation(async (catalogId, signal) => {
				completed.result = await applyPhotoLibraryStackV1(repository, catalogId, command, this.#ports.createId ?? (() => crypto.randomUUID()), signal);
				return completed.result;
			}, request.signal);
		} catch (error) {
			if (completed.result === null) throw error;
			return Object.freeze({ ...completed.result, notices: Object.freeze(['cleanup-failed'] as const) });
		}
	}
	#stackRepository(): PhotoLibraryStackRepositoryV1 {
		if (!this.#ports.stacks) throw new Error('Photo stacks are unavailable.');
		return this.#ports.stacks;
	}
	#stackRead<Result>(run: (repository: PhotoLibraryStackRepositoryV1, catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
		const repository = this.#stackRepository();
		return this.#operation(async admitted => { const catalogId = await this.#ready(); check(admitted); return run(repository, catalogId, admitted); }, signal);
	}

	async restoreOriginalBody(target: PhotoLibraryOriginalRestoreTargetV1, selected: Blob,
		options: PhotoLibraryOriginalRestorationOptionsV1 = {}): Promise<PhotoLibraryOriginalRestorationReceiptV1> {
		const request = admitPhotoLibraryOriginalRestorationRequestV1(target, options), originalRestoration = this.#ports.originalRestoration;
		if (!originalRestoration) throw new Error('Photo original restoration is unavailable.');
		const completed: { result: PhotoLibraryOriginalRestorationReceiptV1 | null } = { result: null };
		try {
			return await this.#mutation(async (catalogId, signal) => {
				const result = await (this.#current ? restorePhotoLibraryOriginalBodyCurrentV1 : restorePhotoLibraryOriginalBodyV2)(catalogId, { ...this.#ports, originalRestoration }, request.target, selected, signal);
				completed.result = result; this.#catalog = null; return result;
			}, request.signal, true);
		} catch (error) {
			if (completed.result === null) throw error;
			return Object.freeze({ ...completed.result, notices: Object.freeze(['cleanup-failed'] as const) });
		}
	}

	async inspectOriginals(options: Readonly<{ cursor?: string | null; signal?: AbortSignal }> = {}): Promise<PhotoLibraryOriginalInspectionPageV1> {
		const request = admitPhotoLibraryOriginalInspectionRequestV1(options), originalInspection = this.#ports.originalInspection;
		if (!originalInspection) throw new Error('Photo original inspection is unavailable.');
		return this.#mutation((catalogId, signal) => (this.#current ? readPhotoLibraryOriginalInspectionPageCurrentV1 : readPhotoLibraryOriginalInspectionPageV2)(catalogId,
			{ ...this.#ports, originalInspection }, request.cursor, this.#startupFailure, signal), request.signal, true);
	}


	readBatchRenameSelection(photoIds: readonly string[], options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryBatchRenameSnapshotV1> { return readPhotoLibraryBatchRenameSelectionV2(this.#batchRenamePorts(), photoIds, options); }

	planBatchRename(request: PhotoLibraryBatchRenameRequestV1): PhotoLibraryBatchRenamePlanV1 {
		this.#lifetime.assertAccepting();
		return planPhotoLibraryBatchRenameV2(request);
	}

	renamePhotos(plan: PhotoLibraryBatchRenamePlanV1, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryBatchRenameReceiptV1> { return renamePhotoLibraryBatchV2(this.#batchRenamePorts(), plan, options); }

	undoBatchRename(undo: PhotoLibraryBatchRenameUndoV1, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryBatchRenameReceiptV1> { return undoPhotoLibraryBatchRenameV2(this.#batchRenamePorts(), undo, options); }

	#batchRenamePorts(): PhotoBatchRenameSessionPortsV2 {
		return { repository: this.#legacyPorts.catalog, mutate: (run, signal) => this.#mutation(run, signal),
			withPhoto: (catalogId, photoId, signal, run) => this.#withPhoto(catalogId, photoId, signal, (owner, admitted) => run(legacyPhotoCommandOwnerV1(owner), admitted)) };
	}

	async readQueryStep(options: Readonly<{ query: PhotoLibraryQueryV1; cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryQueryStepV1> { return this.#queries.readQueryStep(options); }
	async readQueryStepV2(options: Readonly<{ query: PhotoLibraryQueryV2; cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryQueryStepV1> { return this.#queries.readQueryStepV2(options); }
	async rebuildQueryStepV2(options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryQueryBuildProgressV2> { return this.#queries.rebuildQueryStepV2(options); }
	async readStackQueryStep(options: Readonly<{ query: PhotoLibraryQueryV1; cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryQueryStepV1> { return this.#queries.readStackQueryStep(options); }
	async readStackQueryStepV2(options: Readonly<{ query: PhotoLibraryQueryV2; cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryQueryStepV1> { return this.#queries.readStackQueryStepV2(options); }
	async rebuildQueryStep(options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryQueryBuildProgressV1> { return this.#queries.rebuildQueryStep(options); }

	async readDefinitionPage(options: PhotoLibraryDefinitionPageRequestV1): Promise<PhotoLibraryDefinitionPageV1> {
		const request = admitPhotoLibraryDefinitionPageRequestV1(options);
		return this.#operation(async signal => {
			const catalogId = await this.#ready(); check(signal);
			return readPhotoLibraryDefinitionPageV1(this.#ports.catalog, catalogId, { ...request, signal });
		}, request.signal);
	}

	async readDefinition(options: PhotoLibraryDefinitionReadRequestV1): Promise<PhotoLibraryDefinitionSnapshotV1> {
		const request = normalizePhotoLibraryDefinitionReadRequestV1(options);
		return this.#operation(async signal => {
			const catalogId = await this.#ready(); check(signal);
			return readPhotoLibraryDefinitionV1(this.#ports.catalog, catalogId, { ...request, signal });
		}, request.signal);
	}

	async applyDefinition(expectedRootRevision: number, command: PhotoLibraryDefinitionCommandV1,
		options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryDefinitionAcknowledgementV1> {
		const request = normalizePhotoLibraryDefinitionMutationV1(expectedRootRevision, command, options);
		return this.#mutation((catalogId, signal) => applyPhotoLibraryDefinitionV1(this.#ports.catalog, catalogId,
			request.expectedRootRevision, request.command, { signal }), request.signal);
	}

	async readMemberships(photoId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryMembershipSnapshotV1> {
		const request = normalizePhotoLibraryMembershipReadV1(photoId, options);
		return this.#editPhoto(request.photoId, async (owner, signal) => this.#current ? readPhotoLibraryMembershipsCurrentV1(owner as PhotoCommandOwnerCurrentV1, request.photoId, { signal }) : readPhotoLibraryMembershipsV2(legacyPhotoCommandOwnerV1(owner), request.photoId, { signal }), request.signal);
	}

	async applyMemberships(photoId: string, expectedRevision: number, changes: PhotoLibraryMembershipPatchV1,
		options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryMembershipAcknowledgementV1> {
		const request = normalizePhotoLibraryMembershipMutationV1(photoId, expectedRevision, changes, options);
		return this.#editPhoto(request.photoId, (owner, signal) => this.#current ? applyPhotoLibraryMembershipsCurrentV1(owner as PhotoCommandOwnerCurrentV1, request.photoId, request.expectedRevision, request.changes, { signal })
			: applyPhotoLibraryMembershipsV2(legacyPhotoCommandOwnerV1(owner), request.photoId, request.expectedRevision, request.changes, { signal }), request.signal);
	}

	async readPreview(photoId: string, tier: PhotoLibraryPreviewTierV1,
		options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryPreviewOutcomeV1> {
		const key = id(photoId, 'photo ID'), admittedTier = oneOf(tier, ['thumbnail', 'fit-screen'] as const, 'preview tier');
		return this.#operation(async signal => {
			const catalogId = await this.#ready(); check(signal);
			if (!this.#ports.createPreviewScheduler) throw new Error('Photo preview is unavailable.');
			if (!this.#previews) {
				const pending = this.#ports.createPreviewScheduler(catalogId);
				this.#previews = pending;
				void pending.catch(() => { if (this.#previews === pending) this.#previews = null; });
			}
			const scheduler = await this.#previews; check(signal);
			const result = await scheduler.request({ photoId: key, tier: admittedTier, signal });
			check(signal);
			if (result.outcome !== 'ready') return Object.freeze({ outcome: result.outcome });
			const notices: Array<'persistence-failed' | 'cleanup-failed'> = [];
			if (result.cache === 'transient' || result.persistenceError !== undefined) notices.push('persistence-failed');
			if (result.cleanupErrors?.length) notices.push('cleanup-failed');
			return Object.freeze({ outcome: 'ready', cache: result.cache, notices: Object.freeze(notices),
				preview: Object.freeze({ photoId: key, tier: admittedTier, descriptor: result.preview.descriptor,
					byteLength: result.preview.byteLength, outputSha256: result.preview.outputSha256, body: result.preview.body }) });
		}, options.signal);
	}

	async readPage(options: Readonly<{ cursor?: string | null; signal?: AbortSignal }> = {}): Promise<PhotoLibraryPageV1> {
		const continuation = readPhotoLibraryPageCursorV1(options.cursor);
		return this.#operation(async signal => {
			const catalogId = await this.#ready(); check(signal);
			const root = await this.#ports.catalog.loadCatalog(catalogId);
			if (!root) throw new ReferenceError('Photo catalog is missing.');
			const page = await this.#ports.catalog.readSummaryPage(catalogId, { continuation, signal });
			check(signal);
			return Object.freeze({ catalogName: root.name, totalCount: root.photoCount,
				rows: Object.freeze(page.items.map(row => Object.freeze({ id: row.photoId, fileName: row.fileName,
					width: row.width, height: row.height, rating: row.rating, flag: row.flag, colorLabel: row.colorLabel }))),
				cursor: page.continuation === null ? null : JSON.stringify(page.continuation) });
		}, options.signal);
	}

	async readImportPresets(options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryImportPresetSnapshotV1> {
		const request = admitPhotoLibraryQueryBuildRequestV1(options), settings = this.#ports.settings;
		if (!settings) throw new Error('Photo import presets are unavailable.');
		return this.#presetOperation(() => this.#operation(async signal => {
			const catalogId = await this.#ready(); check(signal);
			return readPhotoImportPresetsV1(settings, catalogId, { signal });
		}, request.signal));
	}

	async applyImportPreset(command: PhotoLibraryImportPresetCommandV1,
		options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryImportPresetSnapshotV1> {
		const request = admitPhotoLibraryQueryBuildRequestV1(options), admitted = normalizePhotoImportPresetCommandV1(command), settings = this.#ports.settings;
		if (!settings) throw new Error('Photo import presets are unavailable.');
		return this.#presetOperation(() => this.#mutation(async (catalogId, signal) => {
			const root = await this.#ports.catalog.loadCatalog(catalogId); check(signal);
			if (!root) throw new ReferenceError('Photo catalog is missing.');
			return applyPhotoImportPresetV1(settings, root, admitted, { signal });
		}, request.signal));
	}

	async importFiles(files: readonly File[], options: PhotoLibraryImportRequestOptionsV1 = {}): Promise<readonly PhotoLibraryImportItemV1[]> {
		return this.#importFiles(files, admitPhotoLibraryImportRequestV1(options));
	}


	async setRating(photoId: string, rating: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryRowV1> {
		return this.applyAttributes(photoId, { rating }, options);
	}

	async applyAttributes(photoId: string, changes: PhotoLibraryAttributePatchV1, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryRowV1> {
		const key = id(photoId, 'photo ID'), patch = normalizePhotoLibraryAttributesV1(changes);
		return this.#editPhoto(key, async (owner, signal) => {
			const photo = await owner.execute({ type: 'set-attributes', changes: patch }, { signal });
			return Object.freeze({ id: photo.id, fileName: photo.metadata.fileName, rating: photo.rating,
				flag: photo.flag, colorLabel: photo.colorLabel, width: photo.original.width, height: photo.original.height });
		}, options.signal);
	}

	readExportSidecar(value: Readonly<PhotoLibraryExportSidecarRequest>, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<string> {
		return readPhotoLibrarySessionExportSidecarForProfileV1('legacy2', { catalog: this.#ports.catalog, ready: () => this.#ready(),
			operation: (run, signal, admit) => this.#operation(run, signal, admit) }, value, options);
	}
	async readExportSidecarCurrent(value: Readonly<PhotoLibraryExportSidecarRequest>, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<string> {
		if (!this.#current) return Promise.reject(new TypeError('Current sidecars require the genuine Current Session.'));
		return readPhotoLibrarySessionExportSidecarForProfileV1('current3', { catalog: this.#ports.catalog, ready: () => this.#ready(),
			operation: (run, signal, admit) => this.#operation(run, signal, admit) }, value, options);
	}

	async readMetadata(photoId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryMetadataSnapshotV1> {
		const key = id(photoId, 'photo ID');
		return this.#operation(async signal => {
			const catalogId = await this.#ready(); check(signal);
			const photo = await this.#ports.catalog.loadPhoto(catalogId, key);
			check(signal);
			if (!photo) throw new ReferenceError('The photo is missing.');
			return (this.#current ? readPhotoLibraryMetadataSnapshotCurrentV1 : readPhotoLibraryMetadataSnapshotV2)(photo);
		}, options.signal);
	}

	async applyMetadata(photoId: string, expectedRevision: number, changes: PhotoLibraryMetadataPatchV1,
		options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoLibraryMetadataSnapshotV1> {
		const key = id(photoId, 'photo ID'), revision = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'expected photo revision');
		const patch = normalizePhotoLibraryMetadataPatchV1(changes);
		return this.#editPhoto(key, async (owner, signal) => {
			if (owner.history.present.revision !== revision) throw new PhotoCatalogRevisionConflictError('photo');
			return (this.#current ? readPhotoLibraryMetadataSnapshotCurrentV1 : readPhotoLibraryMetadataSnapshotV2)(await owner.execute({ type: 'set-metadata', changes: patch }, { signal }));
		}, options.signal);
	}

	async #editPhoto<Result>(key: string, run: (owner: PhotoCommandOwnerV2 | PhotoCommandOwnerCurrentV1, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
		return this.#mutation((catalogId, admitted) => this.#withPhoto(catalogId, key, admitted, run), signal);
	}

	async #withPhoto<Result>(catalogId: string, key: string, admitted: AbortSignal,
		run: (owner: PhotoCommandOwnerV2 | PhotoCommandOwnerCurrentV1, signal: AbortSignal) => Promise<Result>): Promise<Result> {
		if (this.#photo?.history.present.id !== key) {
			await this.#photo?.close(); this.#photo = null;
			this.#photo = this.#current ? await PhotoCommandOwnerCurrentV1.open(this.#ports.catalog, catalogId, key) : await PhotoCommandOwnerV2.open(this.#legacyPorts.catalog, catalogId, key);
		} else {
			const raw = await this.#ports.catalog.loadPhoto(catalogId, key);
			const current = raw === null ? null : (this.#current ? normalizePhotoDocumentCurrentV1(raw) : normalizePhotoDocumentV1OrV2(raw));
			check(admitted);
			if (!current) { await this.#photo.close(); this.#photo = null; throw new ReferenceError('The photo is missing.'); }
			if (current.revision !== this.#photo.history.present.revision) await this.#photo.reload({ signal: admitted });
		}
		try { check(admitted); return await run(this.#photo, admitted); }
		catch (error) { await this.#photo.close(); this.#photo = null; throw error; }
	}

	close(): Promise<void> {
		return this.#lifetime.close(async () => {
			const errors: unknown[] = [];
			try { await (await this.#previews)?.close(); } catch (error) { errors.push(error); }
			try { await this.#photo?.close(); } catch (error) { errors.push(error); }
			try { await this.#ports.closeResources(); } catch (error) { errors.push(error); }
			if (errors.length === 1) throw errors[0];
			if (errors.length > 1) throw new AggregateError(errors, 'Photo library cleanup failed.');
		});
	}

	#ready(): Promise<string> {
		if (this.#catalog) return this.#catalog;
		const attempt = (async () => {
			const root = await this.#ports.initialize(this.#lifetime.signal);
			check(this.#lifetime.signal);
			if (this.#current) await recoverManagedPhotoImportCurrentV1(root.id, this.#managedPorts(), { signal: this.#lifetime.signal });
			else await recoverManagedPhotoImportV2(root.id, this.#legacyManagedPorts(), { signal: this.#lifetime.signal });
			this.#startupFailure = null;
			return root.id;
		})();
		this.#catalog = attempt;
		void attempt.catch(error => { if (this.#catalog === attempt) { this.#catalog = null; this.#startupFailure = photoOriginalInspectionFailureV1(error); } });
		return attempt;
	}

	#managedPorts(): PhotoManagedImportPortsCurrentV1 {
		return { catalog: this.#ports.catalog, media: this.#ports.media, journal: this.#ports.journal,
			...(this.#ports.exclusive ? { exclusive: this.#ports.exclusive } : {}),
			...(this.#ports.verifyResources ? { verifyResources: this.#ports.verifyResources } : {}) };
	}

	#legacyManagedPorts(): PhotoManagedImportPortsV2 { return { ...this.#managedPorts(), catalog: this.#legacyPorts.catalog, verifyResources: this.#legacyPorts.verifyResources }; }

	async #presetOperation<Result>(run: () => Promise<Result>): Promise<Result> {
		if (this.#presetActive) throw new Error('A photo import preset operation is already pending.');
		this.#presetActive = true;
		try { return await run(); }
		finally { this.#presetActive = false; }
	}

	#mutation<Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal, preReady = false, admit?: () => void): Promise<Result> {
		return this.#lifetime.mutation(async admitted => {
			let catalogId: string;
			try { catalogId = preReady ? id((await this.#ports.initialize(admitted)).id, 'catalog ID') : await this.#ready(); }
			catch (error) { check(admitted); throw error; }
			check(admitted);
			return (this.#ports.exclusive ?? withPhotoCatalogWriteLockV1)(catalogId, leaseSignal => run(catalogId, leaseSignal ?? admitted), admitted);
		}, signal, admit);
	}
	#operation<Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal, admit?: () => void): Promise<Result> {
		return this.#lifetime.operation(run, signal, admit);
	}
	#importFiles(files: readonly File[], request: PhotoLibraryImportRequestOptionsV1 | PhotoLibraryDevelopImportRequestV2): Promise<readonly PhotoLibraryImportItemV1[]> {
		return this.#currentImports && !('developPreset' in request) ? this.#currentImports(files, request) : this.#imports(files, request);
	}
	backupCatalog(options: PhotoLibraryBackupOptionsV1 = {}): Promise<PhotoLibraryBackupResultV1> {
		return this.#current ? backupPhotoLibrarySessionCurrentV1({ ports: this.#ports, presetSettings: this.#developPresetSettings,
			mutate: (run, signal) => this.#mutation(run, signal) }, options) : backupPhotoLibrarySession({ ports: this.#legacyPorts, presetSettings: this.#developPresetSettings,
			mutate: (run, signal) => this.#mutation(run, signal) }, options);
	}

}
