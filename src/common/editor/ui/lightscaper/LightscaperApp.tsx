/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';

import { otherProductIds, productIdentity } from '../../../product-identities.js';
import { productHref } from '../../../product-web-links.js';
import { useLightscaperEditorCopy as useSiteCopy } from './use-lightscaper-editor-copy.ts';
import type { CreatePhotoLibrarySessionV1 } from '../../photo-library-session-port-v1.ts';
import { PhotoLibraryDefinitionReader } from '../../controller/shared/photo-library-definition-reader.ts';
import PhotoLibraryPanel from './PhotoLibraryPanel.tsx';
import type { PhotoPreviewPresentationViewV1 } from './PhotoPreviewPresentation.tsx';
import { DEFAULT_PHOTO_LIBRARY_QUERY_V1, usePhotoLibraryWorkflow, type LoadPhotoLibraryBackupSaveRuntimeV1 } from './use-photo-library-workflow.ts';
import { usePhotoLibrarySelection } from './use-photo-library-selection.ts';
import { usePhotoCompare } from './use-photo-compare.ts';
import { usePhotoSurvey } from './use-photo-survey.ts';
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
const PhotoOriginalRecoveryDialog = lazy(() => import('./PhotoOriginalRecoveryDialog.tsx'));
const PhotoCompareDialog = lazy(() => import('./PhotoCompareDialog.tsx'));
const PhotoSurveyDialog = lazy(() => import('./PhotoSurveyDialog.tsx'));

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
	const [originalRecoveryVisible, setOriginalRecoveryVisible] = useState(false);
	const [previewActivated, setPreviewActivated] = useState(false);
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
	const compareGeneration = useMemo(() => Object.freeze({ createSession, loadBackupSaveRuntime }), [createSession, loadBackupSaveRuntime]);
	const compare = usePhotoCompare({ generation: compareGeneration, queryIdentity: library.query, page: library.page,
		enabled: libraryVisible, busy: library.busy, autoAdvance, setRating: library.setRating, applyAttributes: library.applyAttributes });
	const survey = usePhotoSurvey({ generation: compareGeneration, queryIdentity: library.query, page: library.page,
		enabled: libraryVisible, busy: library.busy, autoAdvance, setRating: library.setRating, applyAttributes: library.applyAttributes });
	const reviewing = compare.visible || survey.visible;
	const reviewAdmission = useRef<typeof compareGeneration | null>(null);
	if (reviewAdmission.current !== null && (reviewAdmission.current !== compareGeneration
		|| (!reviewing && !compare.snapshot.open && !survey.snapshot.open && compare.snapshot.pendingPhotoId === null
			&& survey.snapshot.pendingPhotoId === null && compare.notice === null && survey.notice === null))) reviewAdmission.current = null;
	const reviewMenu = useRef({ generation: compareGeneration, queryIdentity: library.query, compare, survey,
		libraryVisible, busy: library.busy, pendingPhotoId: photoSelection.pendingPhotoId, selectedIds: photoSelection.snapshot.selectedIds });
	reviewMenu.current = { generation: compareGeneration, queryIdentity: library.query, compare, survey,
		libraryVisible, busy: library.busy, pendingPhotoId: photoSelection.pendingPhotoId, selectedIds: photoSelection.snapshot.selectedIds };
	const comparePair: readonly [string, string] | null = compare.visible && compare.snapshot.referenceId !== null && compare.snapshot.candidateId !== null
		? [compare.snapshot.referenceId, compare.snapshot.candidateId] : null;
	const { readPage } = library;
	const flags = { unflagged: copy.photoUnflagged, pick: copy.photoPick, reject: copy.photoReject };
	const colorLabels = { none: copy.photoColorNone, red: copy.photoColorRed, yellow: copy.photoColorYellow,
		green: copy.photoColorGreen, blue: copy.photoColorBlue, purple: copy.photoColorPurple };
	const selection = library.page?.rows.find(row => row.id === photoSelection.snapshot.primaryId) ?? null;
	useEffect(() => {
		setOrganizerVisible(false); setMembershipsVisible(false); setMetadataVisible(false); setImportVisible(false); setBatchRenameVisible(false); setBackupVisible(false); setOriginalRecoveryVisible(false);
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
	const openReview = (kind: 'compare' | 'survey', event: MouseEvent<HTMLButtonElement>) => {
		const active = reviewMenu.current;
		if (active.generation !== compareGeneration || active.queryIdentity !== library.query || !active.libraryVisible
			|| active.busy || active.pendingPhotoId !== null || active.selectedIds.length < 2
			|| active.compare.visible || active.survey.visible || reviewAdmission.current !== null) return;
		reviewAdmission.current = compareGeneration;
		closeMenu(event); setPreviewActivated(true);
		try { active[kind].open(Object.freeze([...active.selectedIds])); }
		catch (error) { reviewAdmission.current = null; throw error; }
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
	const renderScene = (preview?: PhotoPreviewPresentationViewV1) => <>
		{libraryVisible && renderLibrary(reviewing ? undefined : preview)}
		{compare.visible && preview && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoCompareDialog generation={compareGeneration} snapshot={compare.snapshot} rows={library.page?.rows ?? []}
				previewTargets={preview.snapshot.targets.filter(target => target.tier === 'fit-screen')}
				renderFitScreen={preview.renderFitScreen} copy={copy} flags={flags} colorLabels={colorLabels}
				busy={library.busy || compare.snapshot.pendingPhotoId !== null} error={library.error} notice={compare.notice}
				onPrevious={compare.previous} onNext={compare.next} onSwap={compare.swap} onPromote={compare.promote}
				onRate={(id, rating) => { void compare.rate(id, rating); }} onFlag={(id, flag) => { void compare.flag(id, flag); }}
				onColorLabel={(id, label) => { void compare.label(id, label); }} onClose={() => { void compare.close(); }} />
		</Suspense>}
		{survey.visible && preview && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoSurveyDialog generation={compareGeneration} snapshot={survey.snapshot} rows={library.page?.rows ?? []}
				previewTargets={preview.snapshot.targets} renderThumbnail={preview.renderThumbnail} renderFitScreen={preview.renderFitScreen}
				copy={copy} flags={flags} colorLabels={colorLabels} busy={library.busy || survey.snapshot.pendingPhotoId !== null}
				error={library.error} notice={survey.notice} onFocus={survey.focus} onPrevious={survey.previous} onNext={survey.next}
				onRemove={survey.remove} onRestoreRemoved={survey.restoreRemoved}
				onRate={(id, rating) => { void survey.rate(id, rating); }} onFlag={(id, flag) => { void survey.flag(id, flag); }}
				onColorLabel={(id, label) => { void survey.label(id, label); }} onClose={() => { void survey.close(); }} />
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
						<button type="button" data-photo-original-recovery-menu disabled={!createSession || (library.busy && !library.originalRecoveryActive)} onClick={event => {
							closeMenu(event); setOriginalRecoveryVisible(true);
							if (!library.originalInspectionPage && !library.busy) void library.inspectOriginals();
						}}>{copy.photoOriginalRecoveryTitle}</button>
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
							closeMenu(event); setPreviewActivated(true); setThumbnailsVisible(visible => !visible);
						}}>{thumbnailsVisible ? copy.photoHideThumbnails : copy.photoShowThumbnails}</button>
						<button type="button" disabled={!libraryVisible} aria-pressed={filmstripVisible} onClick={event => {
							closeMenu(event); setFilmstripVisible(visible => !visible);
						}}>{filmstripVisible ? copy.photoHideFilmstrip : copy.photoShowFilmstrip}</button>
						<button type="button" disabled={!libraryVisible || !selection} aria-pressed={loupeVisible} onClick={event => {
							closeMenu(event); setPreviewActivated(true); setLoupeVisible(visible => !visible);
						}}>{loupeVisible ? copy.photoHideLoupe : copy.photoShowLoupe}</button>
						<button type="button" data-photo-compare-menu disabled={!libraryVisible || photoSelection.snapshot.selectedIds.length < 2 || library.busy || photoSelection.pendingPhotoId !== null || reviewing}
							onClick={event => { openReview('compare', event); }}>{copy.photoCompareTitle}</button>
						<button type="button" data-photo-survey-menu disabled={!libraryVisible || photoSelection.snapshot.selectedIds.length < 2 || library.busy || photoSelection.pendingPhotoId !== null || reviewing}
							onClick={event => { openReview('survey', event); }}>{copy.photoSurveyTitle}</button>
						<button type="button" disabled={library.busy || !libraryVisible} onClick={event => { closeMenu(event); void library.readPage(); }}>{copy.photoFirstPage}</button>
						<button type="button" disabled={library.busy || !libraryVisible || !library.page?.cursor} onClick={event => { closeMenu(event); void library.readPage(library.page?.cursor); }}>{copy.photoNextPage}</button>
					</div>
				</details>

			</nav>
		</header>
		{previewActivated
			? <Suspense fallback={libraryVisible ? renderLibrary() : null}><PhotoPreviewPresentation readPreview={library.readPreview}
				photoIds={libraryVisible ? library.page?.rows.map(row => row.id) ?? [] : []} thumbnailsVisible={libraryVisible && thumbnailsVisible && !reviewing}
				fitScreenPhotoId={libraryVisible && loupeVisible && !reviewing ? selection?.id ?? null : null}
				comparePhotoIds={comparePair} surveyPhotoIds={survey.visible ? survey.snapshot.photoIds : null}
				surveyFocusedPhotoId={survey.snapshot.focusedPhotoId}>{renderScene}</PhotoPreviewPresentation></Suspense>
			: renderScene()}
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
		{originalRecoveryVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoOriginalRecoveryDialog generation={createSession} copy={copy} page={library.originalInspectionPage}
				receipt={library.originalRestorationReceipt} notice={library.originalRestorationNotice} cancelled={library.originalRecoveryCancelled}
				busy={library.busy} active={library.originalRecoveryActive} error={library.error}
				onInspect={library.inspectOriginals} onRestore={library.restoreOriginalBody} onCancel={library.cancel}
				onClose={() => { if (factory.current === createSession) setOriginalRecoveryVisible(false); }} />
		</Suspense>}
	</section>;
}
