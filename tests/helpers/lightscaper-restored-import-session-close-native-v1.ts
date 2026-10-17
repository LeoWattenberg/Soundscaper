/* SPDX-License-Identifier: AGPL-3.0-only */

import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PhotoLibraryImportItemV1 } from '../../src/common/editor/photo-library-session-port-v1.ts';
import { KeyValueRepository } from '../../src/common/editor/storage/key-value-repository.ts';
import { MediaCatalogOriginalRepositoryV1 } from '../../src/common/editor/storage/media-catalog-original-repository.ts';
import { catalogOriginalReferences, type CatalogOriginalReferenceV1 } from '../../src/common/editor/storage/media-catalog-original-schema.ts';
import { MediaRepository } from '../../src/common/editor/storage/media-repository.ts';
import { OpfsSyncRepositoryBridge } from '../../src/common/editor/storage/opfs-sync-repository-bridge.ts';
import { normalizePhotoDocumentV1OrV2 } from '../../src/lightscaper/catalog/photo-document-v2.ts';
import { PhotoCatalogRepositoryV2 } from '../../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { photoImportIntentKeyV1 } from '../../src/lightscaper/import/import-intent-v1.ts';
import { createPhotoLibraryRestoreRuntimeV2 } from '../../src/lightscaper/photo-library-restore-runtime-v2.ts';
import { createPhotoLibrarySessionV3 } from '../../src/lightscaper/photo-library-session-runtime-v3.ts';
import type { PhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { PHOTO_LIBRARY_DEFAULT_CATALOG_DATABASE_NAME_V2 as DEFAULT_CATALOG } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
import { PHOTO_MEDIA_NAMESPACES_V1 as NAMES } from '../../src/lightscaper/storage/photo-media-store.ts';
import { nativeCheckV1 as check, nativeDigestV1 as digest, nativeOutcomeV1 as settle, nativeSameV1 as same,
	readRestoredImportSelectionNativeV1, readRestoredImportSnapshotNativeV1, RESTORED_IMPORT_CUBE_V1 as CUBE,
	RESTORED_IMPORT_PRIOR_PNG_V1 as PRIOR_PNG, RESTORED_IMPORT_CURRENT_PNG_V1 as CURRENT_PNG,
	RESTORED_IMPORT_CURRENT_SHA256_V1 as CURRENT_SHA256, RESTORED_IMPORT_SETTINGS_V1 as SETTINGS,
	type NativeOutcomeV1, type RestoredImportLedgerV1, type RestoredImportSnapshotV1 } from './lightscaper-restored-import-snapshot-native-v1.ts';

type Phase = 'intent' | 'original' | 'stage' | 'publish' | 'promote' | 'retire';
export type PhotoRestoredImportSessionCloseCutV1 = `${Phase}-${'mutation-success' | 'completed-ack'}`;
type Session = Awaited<ReturnType<typeof createPhotoLibrarySessionV3>>;
type Photo = ReturnType<typeof normalizePhotoDocumentV1OrV2>;
export interface PhotoRestoredImportSessionCloseNativeResultV1 {
	readonly schemaVersion: 1; readonly cut: PhotoRestoredImportSessionCloseCutV1; readonly selectedRestoredProfile: true;
	readonly allocation: { readonly namespaceToken: string; readonly catalogDatabaseName: string; readonly mediaDatabaseName: string; readonly committedPointer: true };
	readonly close: { readonly samePromise: boolean; readonly newWorkRefused: boolean; readonly heldPending: boolean; readonly fulfilled: boolean;
		readonly resourceClosesWhileHeld: number; readonly resourceClosesBeforeTerminal: number; readonly selectedResourceClosesAfterRelease: { readonly catalog: number; readonly media: number } };
	readonly transaction: { readonly phase: Phase; readonly mutationSuccesses: readonly string[]; readonly complete: number; readonly abort: number; readonly terminalBeforeResources: boolean };
	readonly import: { readonly fulfilled: boolean; readonly receiptCount: number; readonly importedReceiptCount: number; readonly acknowledgedCount: number;
		readonly acknowledgedPhotoId: string | null; readonly returnedPhotoId: string | null };
	readonly afterCut: RestoredImportLedgerV1; readonly recovered: RestoredImportLedgerV1; readonly reopened: { readonly idempotent: boolean; readonly pagePhotoCount: number };
	readonly original: { readonly photoExact: boolean; readonly metadataExact: boolean; readonly recordExact: boolean; readonly contentTokenExact: boolean;
		readonly custodyExact: boolean; readonly bytesExact: boolean; readonly sha256: string };
	readonly donor: { readonly catalogExact: boolean; readonly photoExact: boolean; readonly originalMetadataExact: boolean; readonly originalRecordExact: boolean;
		readonly custodyExact: boolean; readonly bytesExact: boolean; readonly cacheExact: boolean };
	readonly resources: { readonly developPresetExact: boolean; readonly disabledLutBodyExact: boolean; readonly disabledLutReferenceExact: boolean };
	readonly current: { readonly bodySha256: string | null; readonly contentToken: string | null; readonly storage: 'indexeddb-blob' | null; readonly path: null;
		readonly photoSchemaVersion: 2 | null; readonly processVersion: 2 | null; readonly photoAndRecipeExact: boolean; readonly metadataOptionsExact: boolean;
		readonly bytesExact: boolean; readonly custodyExact: boolean };
	readonly allocatedOriginalNativeWriterOpens: number;
}
const PHASES: readonly Phase[] = ['intent', 'original', 'stage', 'publish', 'promote', 'retire'];
const CUTS = PHASES.flatMap(phase => (['mutation-success', 'completed-ack'] as const).map(boundary => ({ phase, boundary, cut: `${phase}-${boundary}` as const })));

/** Current selected runtime3 performs real native preparation and publication after an actual V5 restore. */
export async function qualifyPhotoRestoredImportSessionCloseNativeV1(cutValue: unknown): Promise<PhotoRestoredImportSessionCloseNativeResultV1> {
	const admitted = CUTS.find(value => value.cut === cutValue);
	if (!admitted) throw new RangeError('Unsupported restored import Close cut.');
	const { phase: target, boundary, cut } = admitted, nativeFactory = indexedDB, root = await navigator.storage.getDirectory();
	const existing = new Set((await nativeFactory.databases()).map(row => row.name));
	check(!existing.has(NAMES.databaseName) && !existing.has(DEFAULT_CATALOG), 'Qualification requires an absent default donor library.');
	try { await root.getDirectoryHandle(NAMES.opfsDirectoryName); throw new Error('Qualification may not remove a preexisting original directory.'); }
	catch (error) { if (!notFound(error)) throw error; }
	const candidate = (globalThis as typeof globalThis & { __assertNativeOpfsWorkerExecution?: () => Promise<void> }).__assertNativeOpfsWorkerExecution;
	check(typeof candidate === 'function', 'Ordinary native donor worker companion is missing.'); const companion = candidate;
	const priorBytes = decode(PRIOR_PNG), currentBytes = decode(CURRENT_PNG);
	check(currentBytes.length === 85 && await digest(currentBytes) === CURRENT_SHA256 && await digest(priorBytes) !== CURRENT_SHA256, 'Distinct literal originals changed.');
	const entered = deferred(), outcomeReady = deferred(), release = deferred(), restores: (() => void)[] = [], ownedNames = new Set<string>();
	let donorSession: Session | null = null, session: Session | null = null, reopened: Session | null = null;
	let restoreRuntime: ReturnType<typeof createPhotoLibraryRestoreRuntimeV2> | null = null;
	let selection: Readonly<PhotoLibrarySessionLocationV2> | null = null, importing: Promise<NativeOutcomeV1<readonly PhotoLibraryImportItemV1[]>> | null = null;
	let closing: Promise<NativeOutcomeV1<void>> | null = null, mode: 'setup' | 'armed' | 'verify' = 'setup', fired = false, released = false, closeSettled = false;
	let targetEntered = false, samePromise = false, complete = 0, abort = 0, currentKey = '', outcomeHeld = false, jobSignal: AbortSignal | undefined, publishedCandidate: Photo | null = null;
	let currentReference: Readonly<CatalogOriginalReferenceV1> | null = null;
	let resourceClosesWhileHeld = 0, resourceClosesBeforeTerminal = 0, allocatedOriginalNativeWriterOpens = 0;
	const selectedResourceClosesAfterRelease = { catalog: 0, media: 0 }, mutationSuccesses: string[] = [], acknowledgements: PhotoLibraryImportItemV1[] = [];
	let qualified: PhotoRestoredImportSessionCloseNativeResultV1 | null = null, primaryFailed = false, primary: unknown;
	const factory = observeFactory(nativeFactory);
	try {
		observeOwners(); donorSession = await createPhotoLibrarySessionV3({ name: 'Restored import Close donor', indexedDB: factory, locks: navigator.locks });
		check((await donorSession.readPage()).totalCount === 0, 'Actual default donor catalog must begin empty.');
		const seeded = await donorSession.importFiles([new File([priorBytes], 'restored-import-prior.png', { type: 'image/png', lastModified: 0 })]);
		const priorIdValue = seeded[0]?.photoId; check(seeded.length === 1 && seeded[0]?.status === 'imported' && typeof priorIdValue === 'string', 'Actual ordinary donor import must acknowledge one Photo.');
		const priorId: string = priorIdValue;
		const donorSelection = await readRestoredImportSelectionNativeV1(nativeFactory);
		check(donorSelection.allocation === null && donorSelection.pointer.schemaVersion === 1, 'Donor must use the real default profile.');
		const lut = (await donorSession.cubeLuts.importFile(new Blob([CUBE], { type: 'text/plain' }))).reference;
		const develop = donorSession.develop, presets = develop.presets, settings = develop.settings;
		check(presets !== undefined && settings !== undefined, 'Actual current selected Develop preset facade is missing.');
		const recipe = { ...defaultImageDevelopStateV2(), effects: [{ id: 'restored-disabled-profile', type: 'cube-lut-profile-v1' as const, enabled: false, params: { lut } }] };
		const preset = presets.create({ schemaVersion: 2, id: 'restored-import-preset', name: 'Restored disabled LUT', settings: settings.copy({ schemaVersion: 2, develop: recipe,
			selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }) });
		await presets.write({ schemaVersion: 2, catalogId: donorSelection.location.catalogId, command: { type: 'save', expectedRevision: 0, preset } });
		await donorSession.applyImportPreset({ type: 'save', expectedRevision: 0, id: 'restored-import-settings', name: 'Restored import metadata', settings: SETTINGS });
		const backup = await donorSession.backupCatalog(); check(backup.blob !== undefined && backup.blob !== null && backup.blob.size > 0 && backup.blob.size <= 1024 * 1024, 'Actual mixed-resource V5 backup exceeds its fixture bound.');
		const donorBefore = await snapshot(donorSelection); await companion(); await donorSession.close(); donorSession = null;
		restoreRuntime = createPhotoLibraryRestoreRuntimeV2({ name: 'Restored import Close donor', indexedDB: factory, locks: navigator.locks });
		const restored = await restoreRuntime.restoreArchive(backup.blob); await restoreRuntime.close(); restoreRuntime = null;
		selection = await readRestoredImportSelectionNativeV1(nativeFactory);
		check(selection.pointer.schemaVersion === 2 && selection.allocation !== null && selection.location.namespaceToken !== null && restored.catalogId === selection.location.catalogId
			&& restored.photoCount === 1 && restored.originalCount === 1, 'Actual V5 restore must publish its complete committed allocated selection.');
		const before = await snapshot(selection); check(same(before.prior, donorBefore.prior) && same(before.presetRow, donorBefore.presetRow), 'V5 restore changed the full donor Photo or preset.');
		session = await createPhotoLibrarySessionV3({ name: 'Restored import Close donor', indexedDB: factory, locks: navigator.locks });
		check((await session.readPage()).totalCount === 1, 'Current runtime3 must select the actual restored catalog.');
		const choices = await session.developImport.listPresets(), importSettings = await session.readImportPresets();
		check(choices.presets.length === 1 && choices.presets[0]?.id === preset.identity.id && choices.revision === before.presetRow.revision
			&& importSettings.presets.length === 1 && same(importSettings.presets[0]?.settings, SETTINGS), 'Actual selected preset/settings readers differ from saved public setup.');
		mode = 'armed'; importing = settle(session.developImport.importFiles([new File([currentBytes], 'restored-import-current.png', { type: 'image/png', lastModified: 0 })], {
			schemaVersion: 2, developPreset: { schemaVersion: 2, catalogId: selection.location.catalogId, presetId: preset.identity.id, expectedRevision: choices.revision },
			settings: importSettings.presets[0]!.settings, onAcknowledged: item => { acknowledgements.push(item); } }));
		await Promise.race([entered.promise, importing.then(result => { if (!fired) { if (!result.ok) throw result.error; throw new Error('Actual import settled before its declared cut.'); } })]);
		await Promise.race([outcomeReady.promise, importing.then(value => { if (!outcomeHeld) { if (!value.ok) throw value.error; throw new Error('Actual import returned without the held native outcome witness.'); } })]);
		check(fired && complete + abort === 1, 'Held owner outcome must follow one genuine native transaction terminal.');
		const refused = await settle(session.readPage()); check(!refused.ok, 'Closed selected Session accepted new work.');
		for (let turn = 0; turn < 3; turn++) { check(!closeSettled && resourceClosesWhileHeld === 0, 'Close retired resources before the settled owner delivery joined.');
			await new Promise<void>(resolve => { requestAnimationFrame(() => { resolve(); }); }); }
		const heldPending = !closeSettled; released = true; release.resolve(); const result = await importing, closeResult = await closingWitness();
		check(closeResult.ok && selectedResourceClosesAfterRelease.catalog === 1 && selectedResourceClosesAfterRelease.media === 1, 'Joined Close must retire real selected catalog/media once.');
		if (!result.ok && jobSignal !== undefined) check(jobSignal.aborted && Object.is(result.error, jobSignal.reason), 'Import lost the exact admitted native cancellation reason.');
		check(result.ok === (target === 'retire'), 'Only final retired-intent acknowledgement may fulfill after Close.');
		session = null; mode = 'verify'; const after = await snapshot(selection), expected = expectedLedger();
		check(same(after.ledger, expected) && mutationSuccesses.length === 1, 'Independent interrupted native ledger differs from the phase-specific cut.');
		const aborted = boundary === 'mutation-success' && ['stage', 'publish', 'promote'].includes(target);
		check(complete === Number(!aborted) && abort === Number(aborted) && resourceClosesBeforeTerminal === 0 && allocatedOriginalNativeWriterOpens === 0,
			'Actual terminal/selected profile differs from the independent publication plan.');
		check(acknowledgements.length === Number(expected.photo), 'Publication ACK observation differs from durable Photo publication.');
		reopened = await createPhotoLibrarySessionV3({ name: 'Restored import Close donor', indexedDB: factory, locks: navigator.locks });
		const firstPage = await reopened.readPage(); await reopened.close(); reopened = null; const recovered = await snapshot(selection);
		check(same(recovered.ledger, { ...expected, staged: false, retained: expected.photo, journal: false }), 'Actual Session readiness failed to settle custody and retire intent.');
		reopened = await createPhotoLibrarySessionV3({ name: 'Restored import Close donor', indexedDB: factory, locks: navigator.locks });
		const secondPage = await reopened.readPage(); await reopened.close(); reopened = null; const final = await snapshot(selection), donorAfter = await snapshot(donorSelection);
		check(firstPage.totalCount === Number(expected.photo) + 1 && secondPage.totalCount === firstPage.totalCount && same(final.stateJson, recovered.stateJson), 'Second actual Session recovery must be idempotent.');
		check(same(after.currentToken, final.currentToken) && same(after.currentBody, final.currentBody) && after.currentImmutableRecordJson === final.currentImmutableRecordJson
			&& same(after.currentMetadata, final.currentMetadata), 'Recovery changed or deleted immutable new original metadata/record/body facts.');
		for (const value of [after, recovered, final]) check(value.catalogRevision === before.catalogRevision + Number(expected.photo) && value.indexRevision === before.indexRevision + Number(expected.photo)
			&& value.build1.ready === before.build1.ready && value.build2.ready === before.build2.ready, 'Atomic catalog/index revision or query readiness differs from the pre-import restored context.');
		const original = priorProof(before, final), donor = donorProof(donorBefore, donorAfter);
		check(Object.values(original).every(value => value === true || typeof value === 'string') && Object.values(donor).every(value => value === true), 'Preexisting selected/default original ledger changed.');
		const fullPhotoExact = final.current === null ? !expected.photo : publishedCandidate !== null && same(final.current, publishedCandidate)
			&& final.current.schemaVersion === 2 && same(final.current.versions[0]?.develop, recipe);
		const metadataOptionsExact = final.current === null ? !expected.photo : final.current.metadata.fileName === 'received-007.png'
			&& final.current.original.name === 'restored-import-current.png' && Object.entries(SETTINGS.metadata).every(([key, value]) => Reflect.get(final.current!.metadata, key) === value);
		check(fullPhotoExact && metadataOptionsExact, 'Actual current publication changed the full captured Photo, preset recipe or authored settings.');
		const resources = { developPresetExact: same(before.presetRow, final.presetRow), disabledLutBodyExact: final.lutSha256 === lut.sha256,
			disabledLutReferenceExact: final.presetRow.presets[0]?.settings.develop.effects[0]?.enabled === false
				&& final.presetRow.presets[0]?.settings.develop.effects[0]?.type === 'cube-lut-profile-v1' && same(final.presetRow.presets[0]?.settings.develop.effects[0]?.params, { lut }) };
		check(Object.values(resources).every(value => value === true), 'Full selected preset/disabled resource closure changed.');
		const returned = result.ok ? result.value : [];
		qualified = { schemaVersion: 1, cut, selectedRestoredProfile: true, allocation: { namespaceToken: selection.location.namespaceToken,
			catalogDatabaseName: selection.location.catalogDatabaseName, mediaDatabaseName: selection.location.mediaDatabaseName, committedPointer: true },
			close: { samePromise, newWorkRefused: true, heldPending, fulfilled: closeResult.ok, resourceClosesWhileHeld, resourceClosesBeforeTerminal, selectedResourceClosesAfterRelease },
			transaction: { phase: target, mutationSuccesses, complete, abort, terminalBeforeResources: resourceClosesBeforeTerminal === 0 },
			import: { fulfilled: result.ok, receiptCount: returned.length, importedReceiptCount: returned.filter(item => item.status === 'imported').length,
				acknowledgedCount: acknowledgements.length, acknowledgedPhotoId: acknowledgements[0]?.photoId ?? null, returnedPhotoId: returned[0]?.photoId ?? null },
			afterCut: after.ledger, recovered: recovered.ledger, reopened: { idempotent: true, pagePhotoCount: secondPage.totalCount }, original, donor, resources,
			current: { bodySha256: final.currentBody?.sha256 ?? null, contentToken: final.currentToken, storage: final.currentBody ? 'indexeddb-blob' : null, path: null,
				photoSchemaVersion: final.current ? 2 : null, processVersion: final.current ? 2 : null, photoAndRecipeExact: fullPhotoExact, metadataOptionsExact,
				bytesExact: !expected.body || final.currentBody?.sha256 === CURRENT_SHA256, custodyExact: same(final.ledger, recovered.ledger) }, allocatedOriginalNativeWriterOpens };
		function snapshot(location: Readonly<PhotoLibrarySessionLocationV2>) { return readRestoredImportSnapshotNativeV1(nativeFactory, location, priorId, priorBytes, currentBytes, lut, companion, currentReference); }
	} catch (error) { primaryFailed = true; primary = error; }
	released = true; release.resolve(); mode = 'verify'; const cleanup: unknown[] = [];
	if (importing) await importing; if (fired) { const value = await closingWitness(); if (!value.ok) cleanup.push(value.error); }
	for (const owner of [session, donorSession, reopened, restoreRuntime]) { try { await owner?.close(); } catch (error) { cleanup.push(error); } }
	try { await companion(); } catch (error) { cleanup.push(error); }
	for (const restore of restores.reverse()) { try { restore(); } catch (error) { cleanup.push(error); } }
	for (const name of ownedNames) { try { await removeDatabase(name); } catch (error) { cleanup.push(error); } }
	try { await root.removeEntry(NAMES.opfsDirectoryName, { recursive: true }); } catch (error) { if (!notFound(error)) cleanup.push(error); }
	priorBytes.fill(0); currentBytes.fill(0);
	if (cleanup.length) throw new AggregateError([...(primaryFailed ? [primary] : []), ...cleanup], 'Restored import qualification cleanup failed.', primaryFailed ? { cause: primary } : undefined);
	if (primaryFailed) throw primary; check(qualified !== null, 'Restored import qualification did not produce a result.'); return Object.freeze(qualified);

	function expectedLedger(): RestoredImportLedgerV1 {
		const index = PHASES.indexOf(target), committed = boundary === 'completed-ack';
		return { body: index >= 1, photo: index >= 4 || index === 3 && committed,
			staged: index === 2 && committed || index === 3 || index === 4 && !committed, retained: index >= 5 || index === 4 && committed, journal: index < 5 };
	}
	function fire(): void {
		if (fired) return; fired = true; check(session !== null, 'Selected Session is missing at the native cut.');
		const task = session.close(); samePromise = session.close() === task; closing = settle(task).then(value => { closeSettled = true; return value; }); entered.resolve();
	}
	function closingWitness(): Promise<NativeOutcomeV1<void>> { check(closing !== null, 'Selected Close was not started.'); return closing; }
	async function intercept<Value>(at: Phase, operation: () => Promise<Value>, signal?: AbortSignal): Promise<Value> {
		if (mode === 'armed' && signal !== undefined) jobSignal = signal;
		if (mode !== 'armed' || at !== target) return operation(); check(!targetEntered, 'Target native owner was entered more than once.'); targetEntered = true;
		const value = await settle(operation()); check(complete + abort === 1, 'Native owner outcome preceded transaction completion/abort.');
		if (boundary === 'completed-ack') { check(value.ok && complete === 1, 'Completed-ACK cut requires the real successful owner outcome.'); fire(); }
		if (fired) { outcomeHeld = true; outcomeReady.resolve(); await release.promise; } if (!value.ok) throw value.error; return value.value;
	}
	function observeOwners(): void {
		const intent = KeyValueRepository.prototype.putIfAbsent;
		replace(KeyValueRepository.prototype, 'putIfAbsent', function(this: KeyValueRepository, ...args: Parameters<typeof intent>) {
			return isJournal(args[0]) ? intercept('intent', () => Reflect.apply(intent, this, args) as ReturnType<typeof intent>) : Reflect.apply(intent, this, args) as ReturnType<typeof intent>;
		});
		const retire = KeyValueRepository.prototype.deleteIfCurrent;
		replace(KeyValueRepository.prototype, 'deleteIfCurrent', function(this: KeyValueRepository, ...args: Parameters<typeof retire>) {
			return isJournal(args[0]) ? intercept('retire', () => Reflect.apply(retire, this, args) as ReturnType<typeof retire>) : Reflect.apply(retire, this, args) as ReturnType<typeof retire>;
		});
		const original = MediaRepository.prototype.writeAsset;
		replace(MediaRepository.prototype, 'writeAsset', function(this: MediaRepository, ...args: Parameters<typeof original>) {
			if (mode === 'armed' && args[2]?.name === 'restored-import-current.png') { currentKey = args[0]; return intercept('original', () => Reflect.apply(original, this, args) as ReturnType<typeof original>, args[3]?.signal); }
			return Reflect.apply(original, this, args) as ReturnType<typeof original>;
		});
		const stage = MediaCatalogOriginalRepositoryV1.prototype.stage;
		replace(MediaCatalogOriginalRepositoryV1.prototype, 'stage', function(this: MediaCatalogOriginalRepositoryV1, ...args: Parameters<typeof stage>) {
			if (isCatalog(args[0])) { const references = catalogOriginalReferences(args[2]); check(references.length === 1 && references[0] !== undefined, 'Actual current stage must carry one complete original reference.'); currentReference = references[0]; }
			return isCatalog(args[0]) ? intercept('stage', () => Reflect.apply(stage, this, args) as ReturnType<typeof stage>, args[3]?.signal) : Reflect.apply(stage, this, args) as ReturnType<typeof stage>;
		});
		const publish = PhotoCatalogRepositoryV2.prototype.publishPhotos;
		replace(PhotoCatalogRepositoryV2.prototype, 'publishPhotos', function(this: PhotoCatalogRepositoryV2, ...args: Parameters<typeof publish>) {
			if (isCatalog(args[0])) { check(args[2].length === 1, 'Current publication must contain one actual prepared Photo.'); publishedCandidate = normalizePhotoDocumentV1OrV2(args[2][0]);
				return intercept('publish', () => Reflect.apply(publish, this, args) as ReturnType<typeof publish>, args[3]?.signal); }
			return Reflect.apply(publish, this, args) as ReturnType<typeof publish>;
		});
		const promote = MediaCatalogOriginalRepositoryV1.prototype.promote;
		replace(MediaCatalogOriginalRepositoryV1.prototype, 'promote', function(this: MediaCatalogOriginalRepositoryV1, ...args: Parameters<typeof promote>) {
			return isCatalog(args[0]) ? intercept('promote', () => Reflect.apply(promote, this, args) as ReturnType<typeof promote>, args[3]?.signal) : Reflect.apply(promote, this, args) as ReturnType<typeof promote>;
		});
		const writer = OpfsSyncRepositoryBridge.prototype.openWriter;
		replace(OpfsSyncRepositoryBridge.prototype, 'openWriter', function(this: OpfsSyncRepositoryBridge, ...args: Parameters<typeof writer>) {
			if (mode === 'armed') allocatedOriginalNativeWriterOpens++; return Reflect.apply(writer, this, args) as ReturnType<typeof writer>;
		});
	}
	function isCatalog(value: string): boolean { return mode === 'armed' && value === selection?.location.catalogId; }
	function isJournal(value: string): boolean { return selection !== null && isCatalog(selection.location.catalogId) && value === photoImportIntentKeyV1(selection.location.catalogId); }
	function replace(owner: object, key: string, value: unknown): void { const previous = Object.getOwnPropertyDescriptor(owner, key); check(previous !== undefined, 'Native observation descriptor missing.');
		Object.defineProperty(owner, key, { ...previous, value }); restores.push(() => Object.defineProperty(owner, key, previous)); }
	function observeFactory(native: IDBFactory): IDBFactory {
		const open = native.open.bind(native), remove = native.deleteDatabase.bind(native), cmp = native.cmp.bind(native), facades = new WeakMap<IDBDatabase, IDBDatabase>();
		return forward(native, key => key === 'open' ? (...args: Parameters<IDBFactory['open']>) => {
			if (!existing.has(args[0]) && (args[0] === NAMES.databaseName || args[0] === DEFAULT_CATALOG || /^lightscaper-photo-(?:media|catalog)-restore-[a-f0-9]{32}$/u.test(args[0]))) ownedNames.add(args[0]);
			const opening = open(...args); return forward(opening, property => { if (property !== 'result') return undefined; const database = opening.result;
				let facade = facades.get(database); if (!facade) { facade = observeDatabase(database); facades.set(database, facade); } return facade; });
		} : key === 'deleteDatabase' ? remove : key === 'cmp' ? cmp : undefined);
	}
	function observeDatabase(database: IDBDatabase): IDBDatabase {
		const transaction = database.transaction.bind(database), close = database.close.bind(database); let closed = false;
		return forward(database, key => key === 'close' ? () => {
			const selectedConnection = mode === 'armed' && fired && (database.name === selection?.location.catalogDatabaseName || database.name === selection?.location.mediaDatabaseName);
			if (selectedConnection) { if (!released) resourceClosesWhileHeld++; if (complete + abort === 0) resourceClosesBeforeTerminal++; }
			close(); if (selectedConnection && !closed && released && complete + abort === 1) { if (database.name === selection?.location.catalogDatabaseName) selectedResourceClosesAfterRelease.catalog++;
				else selectedResourceClosesAfterRelease.media++; } closed = true;
		} : key !== 'transaction' ? undefined : (...args: Parameters<IDBDatabase['transaction']>) => {
			const native = transaction(...args), selectedName = target === 'publish' ? selection?.location.catalogDatabaseName : selection?.location.mediaDatabaseName;
			if (mode !== 'armed' || !targetEntered || database.name !== selectedName || native.mode !== 'readwrite') return native;
			let targeted = false; native.addEventListener('complete', () => { if (targeted) complete++; }, { once: true }); native.addEventListener('abort', () => { if (targeted) abort++; }, { once: true });
			return forward(native, property => property !== 'objectStore' ? undefined : (name: string) => {
				const actual = native.objectStore(name), method = target === 'original' ? 'add' : target === 'retire' ? 'delete' : 'put';
				const writing = actual[method].bind(actual); return forward(actual, key => key !== method ? undefined : (...values: Parameters<IDBObjectStore['put']>) => {
					const request = Reflect.apply(writing, actual, values) as IDBRequest<unknown>, value: unknown = values[0];
					if (matchesMutation(name, value)) { targeted = true; request.addEventListener('success', () => { mutationSuccesses.push(`${name}.${method}`); if (boundary === 'mutation-success') fire(); }, { once: true }); }
					return request;
				});
			});
		});
	}
	function matchesMutation(name: string, value: unknown): boolean {
		if (target === 'intent') return name === 'settings' && value !== null && typeof value === 'object' && (value as { key?: unknown }).key === photoImportIntentKeyV1(selection!.location.catalogId);
		if (target === 'retire') return name === 'settings' && value === photoImportIntentKeyV1(selection!.location.catalogId);
		if (value === null || typeof value !== 'object') return false;
		if (target === 'original') return name === 'mediaAssets' && (value as { sha256?: unknown }).sha256 === CURRENT_SHA256;
		if (target === 'publish') return name === 'photos' && (value as { document?: Photo }).document?.original.contentSha256 === CURRENT_SHA256;
		const row = value as { assetId?: unknown; importId?: unknown }; return name === 'catalogOriginalRoots' && row.assetId === currentKey && (target === 'stage' ? typeof row.importId === 'string' : row.importId === null);
	}
	function removeDatabase(name: string): Promise<void> { return new Promise((resolve, reject) => { const request = nativeFactory.deleteDatabase(name);
		request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Owned native database cleanup blocked.')); }); }
}

function priorProof(before: RestoredImportSnapshotV1, after: RestoredImportSnapshotV1) {
	return { photoExact: same(before.prior, after.prior), metadataExact: same(before.priorMetadata, after.priorMetadata), recordExact: before.priorRecordJson === after.priorRecordJson,
		contentTokenExact: before.priorToken === after.priorToken, custodyExact: before.priorRootsJson === after.priorRootsJson, bytesExact: same(before.priorBody, after.priorBody), sha256: after.priorBody.sha256 };
}
function donorProof(before: RestoredImportSnapshotV1, after: RestoredImportSnapshotV1) {
	const proof = priorProof(before, after); return { catalogExact: before.catalogJson === after.catalogJson, photoExact: proof.photoExact, originalMetadataExact: proof.metadataExact,
		originalRecordExact: proof.recordExact, custodyExact: proof.custodyExact, bytesExact: proof.bytesExact, cacheExact: before.cacheJson === after.cacheJson };
}
function forward<Value extends object>(value: Value, replacement: (key: PropertyKey) => unknown): Value {
	return new Proxy(value, { get(target, key) { const changed = replacement(key); if (changed !== undefined) return changed;
		const actual: unknown = Reflect.get(target, key, target); return typeof actual === 'function' ? actual.bind(target) as unknown : actual; },
		set(target, key, next: unknown) { return Reflect.set(target, key, next, target); } });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept; }); return { promise, resolve }; }
function decode(base64: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(base64), value => value.charCodeAt(0)); }
function notFound(error: unknown): boolean { try { return Reflect.apply(Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')!.get!, error, []) === 'NotFoundError'; } catch { return false; } }
