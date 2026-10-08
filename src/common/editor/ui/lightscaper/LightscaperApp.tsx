/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';

import { otherProductIds, productIdentity } from '../../../product-identities.js';
import { productHref } from '../../../product-web-links.js';
import { useLightscaperEditorCopy as useSiteCopy } from './use-lightscaper-editor-copy.ts';
import type { CreatePhotoLibrarySessionV1 } from '../../photo-library-session-port-v1.ts';
import { PhotoLibraryDefinitionReader } from '../../controller/shared/photo-library-definition-reader.ts';
import PhotoLibraryPanel from './PhotoLibraryPanel.tsx';
import type { PhotoPreviewPresentationViewV1 } from './PhotoPreviewPresentation.tsx';
import { DEFAULT_PHOTO_LIBRARY_QUERY_V1, usePhotoLibraryWorkflow, type LoadPhotoLibraryBackupSaveRuntimeV1 } from './use-photo-library-workflow.ts';
import { usePhotoLibrarySelection } from './use-photo-library-selection.ts';
import '../../../../../vendor/audacity-design-system/components/src/ApplicationHeader/ApplicationHeader.css';
import './lightscaper.css';
import './photo-culling.css';

export interface LightscaperAppProps {
	readonly locale: string;
	readonly createSession?: CreatePhotoLibrarySessionV1;
	readonly loadBackupSaveRuntime?: LoadPhotoLibraryBackupSaveRuntimeV1;
}

const PhotoImportDialog = lazy(() => import('./PhotoImportDialog.tsx'));
const PhotoMetadataDialog = lazy(() => import('./PhotoMetadataDialog.tsx'));
const PhotoPreviewPresentation = lazy(() => import('./PhotoPreviewPresentation.tsx'));
const PhotoQueryDialog = lazy(() => import('./PhotoQueryDialog.tsx'));
const PhotoCatalogOrganizerDialog = lazy(() => import('./PhotoCatalogOrganizerDialog.tsx'));
const PhotoMembershipDialog = lazy(() => import('./PhotoMembershipDialog.tsx'));
const PhotoBatchRenameDialog = lazy(() => import('./PhotoBatchRenameDialog.tsx'));
const PhotoBatchRenameResults = lazy(() => import('./PhotoBatchRenameResults.tsx'));
const PhotoCatalogBackupDialog = lazy(() => import('./PhotoCatalogBackupDialog.tsx'));

export default function LightscaperApp({ locale, createSession, loadBackupSaveRuntime }: LightscaperAppProps) {
	const copy = useSiteCopy(locale);
	const app = useRef<HTMLElement>(null);
	const definitionReader = useRef<PhotoLibraryDefinitionReader | null>(null);
	definitionReader.current ??= new PhotoLibraryDefinitionReader();
	const [libraryVisible, setLibraryVisible] = useState(false);
	const [importVisible, setImportVisible] = useState(false);
	const [metadataVisible, setMetadataVisible] = useState(false);
	const [thumbnailsVisible, setThumbnailsVisible] = useState(false);
	const [loupeVisible, setLoupeVisible] = useState(false);
	const [queryVisible, setQueryVisible] = useState(false);
	const [filmstripVisible, setFilmstripVisible] = useState(false);
	const [autoAdvance, setAutoAdvance] = useState(false);
	const [organizerVisible, setOrganizerVisible] = useState(false);
	const [membershipsVisible, setMembershipsVisible] = useState(false);
	const [batchRenameVisible, setBatchRenameVisible] = useState(false);
	const [backupVisible, setBackupVisible] = useState(false);
	const library = usePhotoLibraryWorkflow(createSession, loadBackupSaveRuntime);
	const factory = useRef(createSession); factory.current = createSession;
	const { importFiles } = library;
	const onImport = useCallback(async (...parameters: Parameters<typeof importFiles>) => {
		const receipt = await importFiles(...parameters);
		if (factory.current === createSession && receipt.outcome === 'acknowledged') setLibraryVisible(true);
		return receipt;
	}, [createSession, importFiles]);
	const createPresetId = useCallback(() => crypto.randomUUID(), []);
	const { saveBackup } = library;
	const backupName = library.page?.catalogName ?? copy.workspacePhoto;
	const onBackup = useCallback(() => {
		if (factory.current !== createSession) return Promise.resolve(null);
		return saveBackup({ catalogName: backupName, fileTypeDescription: copy.photoBackupFileType });
	}, [createSession, saveBackup, backupName, copy.photoBackupFileType]);
	const photoSelection = usePhotoLibrarySelection({ photoIds: library.page?.rows.map(row => row.id) ?? [],
		generation: createSession, pageIdentity: library.page, autoAdvance });
	const { readPage } = library;
	const flags = { unflagged: copy.photoUnflagged, pick: copy.photoPick, reject: copy.photoReject };
	const colorLabels = { none: copy.photoColorNone, red: copy.photoColorRed, yellow: copy.photoColorYellow,
		green: copy.photoColorGreen, blue: copy.photoColorBlue, purple: copy.photoColorPurple };
	const selection = library.page?.rows.find(row => row.id === photoSelection.snapshot.primaryId) ?? null;
	useEffect(() => {
		setOrganizerVisible(false); setMembershipsVisible(false); setMetadataVisible(false); setImportVisible(false); setBatchRenameVisible(false); setBackupVisible(false);
	}, [createSession, loadBackupSaveRuntime]);
	useEffect(() => {
		const dismiss = (event: PointerEvent) => {
			for (const menu of app.current?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? []) {
				if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
			}
		};
		document.addEventListener('pointerdown', dismiss);
		return () => { document.removeEventListener('pointerdown', dismiss); };
	}, []);
	useEffect(() => {
		const publish = () => window.dispatchEvent(new CustomEvent('scape:workspace-state', {
			detail: {
				productId: 'lightscaper', activeId: 'photo-library',
				workspaces: [{ id: 'photo-library', name: copy.workspacePhoto }],
			},
		}));
		const request = (event: Event) => {
			const detail: unknown = (event as CustomEvent<unknown>).detail;
			if (!detail || typeof detail !== 'object') return;
			if (Reflect.get(detail, 'productId') === 'lightscaper'
				&& Reflect.get(detail, 'workspaceId') === 'photo-library') { setLibraryVisible(true); void readPage(); }
		};
		publish();
		window.addEventListener('scape:workspace-ready', publish);
		window.addEventListener('scape:workspace-request', request);
		return () => {
			window.removeEventListener('scape:workspace-ready', publish);
			window.removeEventListener('scape:workspace-request', request);
		};
	}, [copy.workspacePhoto, readPage]);

	const toggleLibrary = (event: MouseEvent<HTMLButtonElement>) => {
		if (!libraryVisible) void library.readPage();
		setLibraryVisible((visible) => !visible);
		closeMenu(event);
	};
	const closeMenu = (event: MouseEvent<HTMLButtonElement>) => {
		const menu = event.currentTarget.closest<HTMLDetailsElement>('details[name="lightscaper-application-menu"]');
		if (menu) {
			menu.open = false;
			for (const submenu of menu.querySelectorAll<HTMLDetailsElement>('details[open]')) submenu.open = false;
		}
		menu?.querySelector('summary')?.focus();
	};
	const closeImport = () => { setImportVisible(false); };
	const closeBatchRename = () => {
		if (factory.current !== createSession) return;
		library.cancel(); setBatchRenameVisible(false);
	};
	const closeBackup = () => {
		if (factory.current !== createSession) return;
		library.cancelBackup(); setBackupVisible(false);
	};
	const menuKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
		if (event.key !== 'Escape' || !event.currentTarget.open) return;
		event.preventDefault(); event.stopPropagation();
		event.currentTarget.open = false;
		event.currentTarget.querySelector('summary')?.focus();
	};
	const menuBlur = (event: FocusEvent<HTMLDetailsElement>) => {
		if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
			event.currentTarget.open = false;
		}
	};

	const renderLibrary = (preview?: PhotoPreviewPresentationViewV1) => <>
		{library.importReceipt?.outcome === 'acknowledged' && library.importReceipt.completion !== 'finished' && <p role="status" data-photo-import-completion={library.importReceipt.completion}>
			{library.importReceipt.completion === 'cancelled' ? copy.photoImportCancelled : copy.photoImportInterrupted}
		</p>}
		<PhotoLibraryPanel title={copy.workspacePhoto} empty={copy.photoEmptyLibrary} loading={copy.photoWorking}
			ratingLabel={copy.photoRating} flags={flags} colorLabels={colorLabels} importedLabel={copy.photoImported} failedLabel={copy.photoImportFailed} metadataNotice={copy.photoMetadataNotice}
			page={library.page} receipts={library.receipts} selected={selection?.id ?? null} busy={library.busy} error={library.error}
			selection={photoSelection} layout={filmstripVisible ? 'filmstrip' : 'grid'}
			cullingNotice={photoSelection.notice === 'refresh-failed' ? copy.photoCullRefreshFailed : null}
			renderPreview={preview ? row => preview.renderThumbnail(row.id, row.fileName) : undefined}
			onSelect={photoSelection.select} onRate={(photoId, rating) => {
				void photoSelection.cull(photoId, signal => library.setRating(photoId, rating, { signal }));
			}} />
		{loupeVisible && selection && preview && <section data-photo-loupe="true" className="lightscaper-library" aria-label={copy.photoLoupe}>
			<h3>{selection.fileName}</h3>{preview.renderLoupe(selection.fileName)}
		</section>}
		{preview?.snapshot.targets.some(target => target.status === 'failed' || target.status === 'missing') && <p role="alert">{copy.photoPreviewUnavailable}</p>}
		{preview?.snapshot.targets.some(target => target.notices.length > 0) && <p role="status">{copy.photoPreviewTemporary}</p>}
		{!batchRenameVisible && library.batchRenameReceipt && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoBatchRenameResults receipt={library.batchRenameReceipt.receipt} notice={library.batchRenameReceipt.notice} copy={copy} />
		</Suspense>}
	</>;

	return <section ref={app} className="lightscaper-app" data-lightscaper-bound="true" aria-label={copy.lightscaperTitle}>
		<header className="lightscaper-header application-header">
			<h2>{copy.lightscaperTitle}</h2>
			<nav className="lightscaper-menus" aria-label={copy.photoMenuLabel}>
				<details name="lightscaper-application-menu" onKeyDown={menuKeyDown} onBlur={menuBlur}>
					<summary className="application-header__menu-item">{copy.photoFileMenu}</summary>
					<div className="lightscaper-menu-items">
						<button type="button" disabled={library.busy} onClick={event => { closeMenu(event); setImportVisible(true); }}>{copy.photoImportPhotos}</button>
						<button type="button" disabled={library.busy} onClick={event => { closeMenu(event); setOrganizerVisible(true); }}>{copy.photoOrganizerTitle}</button>
						<button type="button" data-photo-backup-menu onClick={event => {
							closeMenu(event); setBackupVisible(true); void library.prepareBackupSave();
						}}>{copy.photoBackupTitle}</button>
						{library.busy && <button type="button" onClick={event => { closeMenu(event); library.cancel(); }}>{copy.photoCancelAction}</button>}
						<details className="lightscaper-photo-submenu" onKeyDown={menuKeyDown} onBlur={menuBlur}>
							<summary className="application-header__menu-item">{copy.photoPhotoMenu}</summary>
							<div className="lightscaper-menu-items">
								<button type="button" disabled={!libraryVisible || !library.page?.rows.length} onClick={event => {
									closeMenu(event); photoSelection.selectAll();
								}}>{copy.photoSelectAll}</button>
								<button type="button" disabled={photoSelection.snapshot.selectedIds.length === 0} onClick={event => {
									closeMenu(event); photoSelection.clear();
								}}>{copy.photoClearSelection}</button>
								<button type="button" disabled={library.busy || photoSelection.pendingPhotoId !== null} aria-pressed={autoAdvance} onClick={event => {
									closeMenu(event); setAutoAdvance(value => !value);
								}}>{copy.photoAutoAdvance}</button>
								<button type="button" disabled={!selection || library.busy} onClick={event => {
									closeMenu(event); if (selection) { setMetadataVisible(true); void library.readMetadata(selection.id); }
								}}>{copy.photoEditMetadata}</button>
								<button type="button" disabled={!selection || library.busy} onClick={event => {
									closeMenu(event); if (selection) { setMembershipsVisible(true); void library.readMemberships(selection.id); }
								}}>{copy.photoMembershipTitle}</button>
								<button type="button" disabled={!libraryVisible || photoSelection.snapshot.selectedIds.length === 0 || library.busy || photoSelection.pendingPhotoId !== null}
									onClick={event => {
										closeMenu(event); setBatchRenameVisible(true);
										void library.readBatchRenameSelection(Object.freeze([...photoSelection.snapshot.selectedIds]));
									}}>{copy.photoBatchRenameTitle}</button>
								<button type="button" disabled={!libraryVisible || !library.batchRenameUndo || library.busy || photoSelection.pendingPhotoId !== null}
									onClick={event => {
										closeMenu(event); if (library.batchRenameUndo) void library.undoBatchRename(library.batchRenameUndo);
									}}>{copy.photoBatchRenameUndo}</button>
								{[0, 1, 2, 3, 4, 5].map(rating => <button key={rating} type="button" disabled={!selection || library.busy}
									onClick={event => { closeMenu(event); if (selection) void photoSelection.cull(selection.id, signal => library.setRating(selection.id, rating, { signal })); }}>
									{copy.photoRateStars.replace('{count}', String(rating))}
								</button>)}
								{(['unflagged', 'pick', 'reject'] as const).map(flag => <button key={flag} type="button" disabled={!selection || library.busy}
									aria-pressed={selection?.flag === flag} onClick={event => { closeMenu(event); if (selection) void photoSelection.cull(selection.id, signal => library.applyAttributes(selection.id, { flag }, { signal })); }}>
									{copy.photoFlag}: {flags[flag]}
								</button>)}
								{(['none', 'red', 'yellow', 'green', 'blue', 'purple'] as const).map(colorLabel => <button key={colorLabel} type="button" disabled={!selection || library.busy}
									aria-pressed={selection?.colorLabel === colorLabel} onClick={event => { closeMenu(event); if (selection) void photoSelection.cull(selection.id, signal => library.applyAttributes(selection.id, { colorLabel }, { signal })); }}>
									{copy.photoColorLabel}: {colorLabels[colorLabel]}
								</button>)}
							</div>
						</details>
						{otherProductIds('lightscaper').map((id) => <a key={id} href={productHref(id, locale, { builtProductId: 'lightscaper' })}>
							{productIdentity(id).name}
						</a>)}
					</div>
				</details>
				<details name="lightscaper-application-menu" onKeyDown={menuKeyDown} onBlur={menuBlur}>
					<summary className="application-header__menu-item">{copy.photoViewMenu}</summary>
					<div className="lightscaper-menu-items">
						<button type="button" aria-pressed={libraryVisible} onClick={toggleLibrary}>
							{libraryVisible ? copy.photoHideLibrary : copy.photoShowLibrary}
						</button>
						<button type="button" disabled={library.busy} onClick={event => {
							closeMenu(event); setQueryVisible(true); void library.probeQuery();
						}}>{copy.photoQueryTitle}</button>
						<button type="button" disabled={!libraryVisible} aria-pressed={thumbnailsVisible} onClick={event => {
							closeMenu(event); setThumbnailsVisible(visible => !visible);
						}}>{thumbnailsVisible ? copy.photoHideThumbnails : copy.photoShowThumbnails}</button>
						<button type="button" disabled={!libraryVisible} aria-pressed={filmstripVisible} onClick={event => {
							closeMenu(event); setFilmstripVisible(visible => !visible);
						}}>{filmstripVisible ? copy.photoHideFilmstrip : copy.photoShowFilmstrip}</button>
						<button type="button" disabled={!libraryVisible || !selection} aria-pressed={loupeVisible} onClick={event => {
							closeMenu(event); setLoupeVisible(visible => !visible);
						}}>{loupeVisible ? copy.photoHideLoupe : copy.photoShowLoupe}</button>
						<button type="button" disabled={library.busy || !libraryVisible} onClick={event => { closeMenu(event); void library.readPage(); }}>{copy.photoFirstPage}</button>
						<button type="button" disabled={library.busy || !libraryVisible || !library.page?.cursor} onClick={event => { closeMenu(event); void library.readPage(library.page?.cursor); }}>{copy.photoNextPage}</button>
					</div>
				</details>

			</nav>
		</header>
		{libraryVisible && (thumbnailsVisible || loupeVisible
			? <Suspense fallback={renderLibrary()}><PhotoPreviewPresentation readPreview={library.readPreview}
				photoIds={library.page?.rows.map(row => row.id) ?? []} thumbnailsVisible={thumbnailsVisible}
				fitScreenPhotoId={loupeVisible ? selection?.id ?? null : null}>{renderLibrary}</PhotoPreviewPresentation></Suspense>
			: renderLibrary())}
		{queryVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoQueryDialog query={library.query ?? DEFAULT_PHOTO_LIBRARY_QUERY_V1} copy={copy} flags={flags} colorLabels={colorLabels}
				busy={library.busy} error={library.error} needsIndex={library.needsQueryIndex} indexProgress={library.queryIndexProgress}
				readDefinitions={library.readDefinitions} onClose={() => { library.cancel(); setQueryVisible(false); }}
				onApply={query => { setLibraryVisible(true); void library.applyQuery(query); }} onBuild={() => { void library.buildQueryIndex(); }} />
		</Suspense>}
		{metadataVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoMetadataDialog locale={locale} snapshot={library.metadata} busy={library.busy} error={library.error}
				onClose={() => { setMetadataVisible(false); }} onSave={(photoId, revision, changes) => { void library.applyMetadata(photoId, revision, changes); }} />
		</Suspense>}
		{organizerVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoCatalogOrganizerDialog copy={copy} busy={library.busy} error={library.error} readDefinitions={library.readDefinitions}
				readDefinition={library.readDefinition} onApply={library.applyDefinition} createId={() => crypto.randomUUID()}
				onClose={() => { setOrganizerVisible(false); }} />
		</Suspense>}
		{membershipsVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoMembershipDialog copy={copy} snapshot={library.memberships} busy={library.busy} error={library.error}
				readDefinitions={library.readDefinitions} readDefinition={library.readDefinition}
				definitionReader={definitionReader.current}
				onApply={(photoId, revision, changes) => { void library.applyMemberships(photoId, revision, changes); }}
				onClose={() => { setMembershipsVisible(false); }} />
		</Suspense>}
		{importVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoImportDialog title={copy.photoImportPhotos} filesLabel={copy.photoChooseFiles} importLabel={copy.photoImportAction}
				cancelLabel={copy.photoCancelAction} failureLabel={copy.photoImportFailed} busy={library.busy} error={library.error} copy={copy}
				readPresets={library.readImportPresets} applyPreset={library.applyImportPreset} createId={createPresetId}
				readDefinitions={library.readDefinitions} readDefinition={library.readDefinition} definitionReader={definitionReader.current}
				onClose={closeImport} onImport={onImport} />
		</Suspense>}
		{batchRenameVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoBatchRenameDialog snapshot={library.batchRenameSnapshot} busy={library.busy} error={library.error} copy={copy}
				onPlan={library.planBatchRename} onApply={library.renamePhotos} onClose={closeBatchRename} />
		</Suspense>}
		{backupVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoCatalogBackupDialog locale={locale} copy={copy} ready={library.backupReady}
				maximumStreamingBytes={library.maximumBackupStreamingBytes} busy={library.busy} error={library.error}
				receipt={library.backupReceipt} onSave={onBackup} onClose={closeBackup} />
		</Suspense>}
	</section>;
}
