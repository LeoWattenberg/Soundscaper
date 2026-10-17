/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';

import { otherProductIds, productIdentity } from '../../../product-identities.js';
import { productHref } from '../../../product-web-links.js';
import { useLightscaperEditorCopy as useSiteCopy } from './use-lightscaper-editor-copy.ts';
import type { CreatePhotoLibrarySessionV1 } from '../../photo-library-session-port-v1.ts';
import type { LoadPhotoLibraryRestoreRuntimeV1 } from '../../photo-library-restore-port-v1.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV1 } from '../../photo-library-develop-proxy-port-v1.ts';
import { photoDevelopMenuLabel } from '../../../i18n/lightscaper-develop-menu-copy.ts';
import { usePhotoDevelopEntry } from './use-photo-develop-entry.ts';
import { usePhotoDevelopSettings } from './use-photo-develop-settings.ts';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import { lightscaperRestoreCopy } from '../../../i18n/lightscaper-restore-copy.ts';
import { usePhotoLibraryRestore } from './use-photo-library-restore.ts';
import { PhotoLibraryDefinitionReader } from '../../controller/shared/photo-library-definition-reader.ts';
import PhotoLibraryPanel from './PhotoLibraryPanel.tsx';
import type { PhotoPreviewPresentationViewV1 } from './PhotoPreviewPresentation.tsx';
import { DEFAULT_PHOTO_LIBRARY_QUERY_V2, usePhotoLibraryWorkflow, type LoadPhotoLibraryBackupSaveRuntimeV1 } from './use-photo-library-workflow.ts';
import type { LoadPhotoMetadataQueryRuntimeV2 } from '../../photo-library-query-port-v2.ts';
import type { LoadPhotoSavedFilterRuntimeV1 } from '../../photo-library-saved-filter-runtime-v1.ts';
import { usePhotoSavedFilters } from './use-photo-saved-filters.ts';
import { usePhotoLibrarySelection } from './use-photo-library-selection.ts';
import { usePhotoCompare } from './use-photo-compare.ts';
import { usePhotoSurvey } from './use-photo-survey.ts';
import { usePhotoStacks } from './use-photo-stacks.ts';
import '../../../../../vendor/audacity-design-system/components/src/ApplicationHeader/ApplicationHeader.css';
import './lightscaper.css';
import './photo-culling.css';

export interface LightscaperAppProps {
	readonly locale: string;
	readonly createSession?: CreatePhotoLibrarySessionV1;
	readonly loadBackupSaveRuntime?: LoadPhotoLibraryBackupSaveRuntimeV1;
	readonly loadMetadataQueryRuntime?: LoadPhotoMetadataQueryRuntimeV2;
	readonly loadSavedFilterRuntime?: LoadPhotoSavedFilterRuntimeV1;
	readonly loadRestoreRuntime?: LoadPhotoLibraryRestoreRuntimeV1;
	readonly loadDevelopProxyRuntime?: LoadPhotoLibraryDevelopProxyRuntimeV1;
}

const PhotoImportDialog = lazy(() => import('./PhotoImportDialog.tsx'));
const PhotoMetadataDialog = lazy(() => import('./PhotoMetadataDialog.tsx'));
const PhotoPreviewPresentation = lazy(() => import('./PhotoPreviewPresentation.tsx'));
const PhotoQueryDialog = lazy(() => import('./PhotoQuerySurface.tsx'));
const PhotoCatalogOrganizerDialog = lazy(() => import('./PhotoCatalogOrganizerDialog.tsx'));
const PhotoMembershipDialog = lazy(() => import('./PhotoMembershipDialog.tsx'));
const PhotoBatchRenameDialog = lazy(() => import('./PhotoBatchRenameDialog.tsx'));
const PhotoBatchRenameResults = lazy(() => import('./PhotoBatchRenameResults.tsx'));
const PhotoCatalogBackupDialog = lazy(() => import('./PhotoCatalogBackupDialog.tsx'));
const PhotoCatalogRestoreDialog = lazy(() => import('./PhotoCatalogRestoreDialog.tsx'));
const PhotoOriginalRecoveryDialog = lazy(() => import('./PhotoOriginalRecoveryDialog.tsx'));
const PhotoCompareDialog = lazy(() => import('./PhotoCompareDialog.tsx'));
const PhotoSurveyDialog = lazy(() => import('./PhotoSurveyDialog.tsx'));
const PhotoStackDialog = lazy(() => import('./PhotoStackDialog.tsx'));
const PhotoSavedFiltersSurface = lazy(() => import('./PhotoSavedFiltersSurface.tsx'));
const PhotoDevelopWorkspace = lazy(() => import('./PhotoDevelopWorkspace.tsx'));

const unavailableQueryRuntime: LoadPhotoMetadataQueryRuntimeV2 = async () => { throw new Error('Photo query controls are unavailable.'); };
const unavailableSavedFilterRuntime: LoadPhotoSavedFilterRuntimeV1 = async () => { throw new Error('Saved photo filters are unavailable.'); };
const unavailableDevelopProxyRuntime: LoadPhotoLibraryDevelopProxyRuntimeV1 = async () => { throw new Error('Photo develop proxy is unavailable.'); };
export default function LightscaperApp({ locale, createSession: suppliedCreateSession, loadBackupSaveRuntime, loadMetadataQueryRuntime = unavailableQueryRuntime,
	loadSavedFilterRuntime = unavailableSavedFilterRuntime, loadRestoreRuntime, loadDevelopProxyRuntime = unavailableDevelopProxyRuntime }: LightscaperAppProps) {
	const copy = useSiteCopy(locale);
	const restoreCopy = lightscaperRestoreCopy(locale), [sessionEpoch, setSessionEpoch] = useState(0);
	const createSession = useMemo(() => suppliedCreateSession ? () => { void sessionEpoch; return suppliedCreateSession(); } : undefined, [suppliedCreateSession, sessionEpoch]);
	const app = useRef<HTMLElement>(null);
	const definitionReader = useRef<PhotoLibraryDefinitionReader | null>(null);
	definitionReader.current ??= new PhotoLibraryDefinitionReader();
	const [libraryVisible, setLibraryVisible] = useState(false);
	const [importVisible, setImportVisible] = useState(false);
	const [metadataVisible, setMetadataVisible] = useState(false);
	const [thumbnailsVisible, setThumbnailsVisible] = useState(false);
	const [loupeVisible, setLoupeVisible] = useState(false);
	const [queryVisible, setQueryVisible] = useState(false);
	const queryAdmission = useRef(false); queryAdmission.current = queryVisible;
	const [filmstripVisible, setFilmstripVisible] = useState(false);
	const [autoAdvance, setAutoAdvance] = useState(false);
	const [organizerVisible, setOrganizerVisible] = useState(false);
	const [membershipsVisible, setMembershipsVisible] = useState(false);
	const [batchRenameVisible, setBatchRenameVisible] = useState(false);
	const [backupVisible, setBackupVisible] = useState(false);
	const [restoreVisible, setRestoreVisible] = useState(false);
	const [originalRecoveryVisible, setOriginalRecoveryVisible] = useState(false);
	const [previewActivated, setPreviewActivated] = useState(false);
	const library = usePhotoLibraryWorkflow(createSession, loadBackupSaveRuntime);
	const previewRetirement = useRef<(() => Promise<void>) | null>(null), previewDrain = useRef<Promise<void> | null>(null);
	const registerPreviewRetirement = useCallback((retire: () => Promise<void>) => {
		previewRetirement.current = retire;
		return () => {
			const draining = joinPhotoLibraryRetirementV1([previewDrain.current, retire()]);
			previewDrain.current = draining; void draining.catch(() => undefined);
			if (previewRetirement.current === retire) previewRetirement.current = null;
		};
	}, []);
	const borrowedReadPreview = library.readPreview;
	const readPreviewAfterDrain = useCallback(async (...args: Parameters<typeof borrowedReadPreview>) => {
		await previewDrain.current; return borrowedReadPreview(...args);
	}, [borrowedReadPreview]);
	const restore = usePhotoLibraryRestore({ loadRuntime: loadRestoreRuntime, retireAndJoin: () => {
		const presentation = joinPhotoLibraryRetirementV1([previewDrain.current, previewRetirement.current?.() ?? null]);
		void presentation.catch(() => undefined);
		const retiring = library.retireAndJoin(presentation);
		setLibraryVisible(false); setPreviewActivated(false); return retiring;
	}, onSettled: () => { setSessionEpoch(epoch => epoch + 1); } });
	const savedGeneration = useMemo(() => Object.freeze({ createSession, loadBackupSaveRuntime, loadSavedFilterRuntime }), [createSession, loadBackupSaveRuntime, loadSavedFilterRuntime]);
	const developGeneration = useMemo(() => Object.freeze({ createSession, loadBackupSaveRuntime, loadDevelopProxyRuntime }), [createSession, loadBackupSaveRuntime, loadDevelopProxyRuntime]);
	const developSurface = usePhotoDevelopEntry(developGeneration), developEntry = developSurface.entry, developVisible = developEntry !== null;
	const developSettings = usePhotoDevelopSettings({ generation: developGeneration, execute: library.executeDevelop });
	const savedFilters = usePhotoSavedFilters({ generation: savedGeneration, execute: library.executeSavedFilters });
	const [savedEntry, setSavedEntry] = useState<Readonly<{ generation: typeof savedGeneration; mode: 'create' | 'manage' }> | null>(null);
	const savedVisible = savedEntry?.generation === savedGeneration;
	const savedAdmission = useRef<typeof savedGeneration | null>(null), savedBusy = useRef(savedFilters.busy); savedBusy.current = savedFilters.busy;
	const savedLatest = useRef(savedGeneration); savedLatest.current = savedGeneration;
	const savedCancel = useRef(library.cancel); savedCancel.current = library.cancel;
	useEffect(() => () => {
		if (savedAdmission.current !== savedGeneration) return;
		if (savedBusy.current) savedCancel.current();
		savedAdmission.current = null;
	}, [savedGeneration]);
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
	const compare = usePhotoCompare({ generation: compareGeneration, queryIdentity: library.queryIdentity, page: library.page,
		enabled: libraryVisible, busy: library.busy, autoAdvance, setRating: library.setRating, applyAttributes: library.applyAttributes });
	const survey = usePhotoSurvey({ generation: compareGeneration, queryIdentity: library.queryIdentity, page: library.page,
		enabled: libraryVisible, busy: library.busy, autoAdvance, setRating: library.setRating, applyAttributes: library.applyAttributes });
	const stacks = usePhotoStacks({ generation: compareGeneration, queryIdentity: library.queryIdentity, pageIdentity: library.page,
		rows: library.page?.rows ?? [], execute: library.executeStack });
	const reviewing = compare.visible || survey.visible;
	const stackMenu = useRef({ generation: compareGeneration, query: library.queryIdentity, page: library.page,
		libraryVisible, busy: library.busy, reviewing, pending: photoSelection.pendingPhotoId, selectedIds: photoSelection.snapshot.selectedIds,
		primaryId: photoSelection.snapshot.primaryId, stacks });
	stackMenu.current = { generation: compareGeneration, query: library.queryIdentity, page: library.page, libraryVisible, busy: library.busy,
		reviewing, pending: photoSelection.pendingPhotoId, selectedIds: photoSelection.snapshot.selectedIds,
		primaryId: photoSelection.snapshot.primaryId, stacks };
	const reviewAdmission = useRef<typeof compareGeneration | null>(null);
	if (reviewAdmission.current !== null && (reviewAdmission.current !== compareGeneration
		|| (!reviewing && !compare.snapshot.open && !survey.snapshot.open && compare.snapshot.pendingPhotoId === null
			&& survey.snapshot.pendingPhotoId === null && compare.notice === null && survey.notice === null && !stacks.visible && !stacks.busy))) reviewAdmission.current = null;
	const reviewMenu = useRef({ generation: compareGeneration, queryIdentity: library.queryIdentity, compare, survey,
		libraryVisible, busy: library.busy, pendingPhotoId: photoSelection.pendingPhotoId, selectedIds: photoSelection.snapshot.selectedIds });
	reviewMenu.current = { generation: compareGeneration, queryIdentity: library.queryIdentity, compare, survey,
		libraryVisible, busy: library.busy, pendingPhotoId: photoSelection.pendingPhotoId, selectedIds: photoSelection.snapshot.selectedIds };
	const comparePair: readonly [string, string] | null = compare.visible && compare.snapshot.referenceId !== null && compare.snapshot.candidateId !== null
		? [compare.snapshot.referenceId, compare.snapshot.candidateId] : null;
	const { readPage } = library;
	const flags = { unflagged: copy.photoUnflagged, pick: copy.photoPick, reject: copy.photoReject };
	const colorLabels = { none: copy.photoColorNone, red: copy.photoColorRed, yellow: copy.photoColorYellow,
		green: copy.photoColorGreen, blue: copy.photoColorBlue, purple: copy.photoColorPurple };
	const selection = library.page?.rows.find(row => row.id === photoSelection.snapshot.primaryId) ?? null;
	useEffect(() => {
		setOrganizerVisible(false); setMembershipsVisible(false); setMetadataVisible(false); setImportVisible(false); setBatchRenameVisible(false); setBackupVisible(false); setOriginalRecoveryVisible(false); setQueryVisible(false); queryAdmission.current = false;
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
		if (active.generation !== compareGeneration || active.queryIdentity !== library.queryIdentity || !active.libraryVisible
			|| active.busy || active.pendingPhotoId !== null || active.selectedIds.length < 2
			|| active.compare.visible || active.survey.visible || stackMenu.current.stacks.visible || stackMenu.current.stacks.busy || reviewAdmission.current !== null || savedAdmission.current !== null || developSurface.isAdmitted() || queryAdmission.current) return;
		reviewAdmission.current = compareGeneration;
		closeMenu(event); setPreviewActivated(true);
		try { active[kind].open(Object.freeze([...active.selectedIds])); }
		catch (error) { reviewAdmission.current = null; throw error; }
	};
	const toggleStackView = (event: MouseEvent<HTMLButtonElement>) => {
		const current = stackMenu.current;
		if (current.generation !== compareGeneration || current.query !== library.queryIdentity || current.page !== library.page
			|| !current.libraryVisible || current.busy || current.reviewing || current.pending !== null || current.stacks.busy
			|| current.stacks.visible || reviewAdmission.current !== null || savedAdmission.current !== null || developSurface.isAdmitted()) return;
		closeMenu(event); void library.setStackCollapsed(!library.stackCollapsed);
	};
	const openStack = (kind: 'create' | 'edit', event: MouseEvent<HTMLButtonElement>) => {
		const current = stackMenu.current;
		if (current.generation !== compareGeneration || current.query !== library.queryIdentity || current.page !== library.page
			|| !current.libraryVisible || current.busy || current.reviewing || current.pending !== null || current.stacks.busy
			|| current.stacks.visible || reviewAdmission.current !== null || savedAdmission.current !== null || developSurface.isAdmitted() || queryAdmission.current || (kind === 'create' ? current.selectedIds.length < 2 : current.primaryId === null)) return;
		reviewAdmission.current = compareGeneration; closeMenu(event);
		if (kind === 'create') void current.stacks.openCreate(Object.freeze([...current.selectedIds]));
		else if (current.primaryId) void current.stacks.openEdit(current.primaryId);
	};
	const openSavedFilters = (mode: 'create' | 'manage', event: MouseEvent<HTMLButtonElement>) => {
		const current = stackMenu.current;
		if (savedLatest.current !== savedGeneration || !createSession || current.busy || current.pending !== null
			|| current.reviewing || current.stacks.visible || current.stacks.busy || reviewAdmission.current !== null || savedAdmission.current !== null || developSurface.isAdmitted() || queryAdmission.current) return;
		savedAdmission.current = savedGeneration; closeMenu(event); setSavedEntry({ generation: savedGeneration, mode });
	};
	const closeSavedFilters = () => {
		if (savedLatest.current !== savedGeneration) return;
		if (savedFilters.busy) library.cancel();
		savedAdmission.current = null; setSavedEntry(null);
	};
	const openDevelop = (event: MouseEvent<HTMLButtonElement>) => {
		const current = stackMenu.current;
		if (!developSurface.isCurrent() || !selection || current.primaryId !== selection.id || factory.current !== createSession || !current.libraryVisible || current.busy
			|| current.pending !== null || current.reviewing || current.stacks.visible || current.stacks.busy || restore.busy
			|| reviewAdmission.current !== null || savedAdmission.current !== null || developSurface.isAdmitted() || queryAdmission.current) return;
		closeMenu(event); developSurface.begin(selection.id, selection.fileName, () => {
			const beforePresent = joinPhotoLibraryRetirementV1([previewDrain.current, previewRetirement.current?.() ?? null]);
			previewDrain.current = beforePresent; void beforePresent.catch(() => undefined); return beforePresent;
		});
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
						<button type="button" disabled={restore.busy || library.busy} onClick={event => { closeMenu(event); setImportVisible(true); }}>{copy.photoImportPhotos}</button>
						<button type="button" disabled={restore.busy || library.busy} onClick={event => { closeMenu(event); setOrganizerVisible(true); }}>{copy.photoOrganizerTitle}</button>
						<button type="button" data-photo-backup-menu disabled={restore.busy} onClick={event => {
							closeMenu(event); setBackupVisible(true); void library.prepareBackupSave();
						}}>{copy.photoBackupTitle}</button>
						<button type="button" data-photo-restore-menu disabled={!restore.ready} onClick={event => { closeMenu(event); setRestoreVisible(true); }}>{restoreCopy.title}</button>
						<button type="button" data-photo-original-recovery-menu disabled={restore.busy || !createSession || (library.busy && !library.originalRecoveryActive)} onClick={event => {
							closeMenu(event); setOriginalRecoveryVisible(true);
							if (!library.originalInspectionPage && !library.busy) void library.inspectOriginals();
						}}>{copy.photoOriginalRecoveryTitle}</button>
						{library.busy && <button type="button" onClick={event => { closeMenu(event); library.cancel(); }}>{copy.photoCancelAction}</button>}
						<details className="lightscaper-photo-submenu" onKeyDown={menuKeyDown} onBlur={menuBlur}>
							<summary className="application-header__menu-item">{copy.photoPhotoMenu}</summary>
							<div className="lightscaper-menu-items">
								<button type="button" data-photo-develop-menu disabled={restore.busy || !selection || library.busy || reviewing || stacks.visible || stacks.busy || developVisible || developSurface.closing}
									onClick={openDevelop}>{photoDevelopMenuLabel(locale)}</button>
								<button type="button" disabled={restore.busy || !libraryVisible || !library.page?.rows.length} onClick={event => {
									closeMenu(event); photoSelection.selectAll();
								}}>{copy.photoSelectAll}</button>
								<button type="button" disabled={restore.busy || photoSelection.snapshot.selectedIds.length === 0} onClick={event => {
									closeMenu(event); photoSelection.clear();
								}}>{copy.photoClearSelection}</button>
								<button type="button" disabled={restore.busy || library.busy || photoSelection.pendingPhotoId !== null} aria-pressed={autoAdvance} onClick={event => {
									closeMenu(event); setAutoAdvance(value => !value);
								}}>{copy.photoAutoAdvance}</button>
								<button type="button" disabled={restore.busy || !selection || library.busy} onClick={event => {
									closeMenu(event); if (selection) { setMetadataVisible(true); void library.readMetadata(selection.id); }
								}}>{copy.photoEditMetadata}</button>
								<button type="button" disabled={restore.busy || !selection || library.busy} onClick={event => {
									closeMenu(event); if (selection) { setMembershipsVisible(true); void library.readMemberships(selection.id); }
								}}>{copy.photoMembershipTitle}</button>
								<button type="button" disabled={restore.busy || !libraryVisible || photoSelection.snapshot.selectedIds.length === 0 || library.busy || photoSelection.pendingPhotoId !== null}
									onClick={event => {
										closeMenu(event); setBatchRenameVisible(true);
										void library.readBatchRenameSelection(Object.freeze([...photoSelection.snapshot.selectedIds]));
									}}>{copy.photoBatchRenameTitle}</button>
								<button type="button" disabled={restore.busy || !libraryVisible || !library.batchRenameUndo || library.busy || photoSelection.pendingPhotoId !== null}
									onClick={event => {
										closeMenu(event); if (library.batchRenameUndo) void library.undoBatchRename(library.batchRenameUndo);
									}}>{copy.photoBatchRenameUndo}</button>
								<button type="button" data-photo-stack-create-menu disabled={restore.busy || !libraryVisible || photoSelection.snapshot.selectedIds.length < 2
									|| library.busy || stacks.busy || stacks.visible || reviewing || photoSelection.pendingPhotoId !== null}
									onClick={event => { openStack('create', event); }}>{copy.photoStackCreate}</button>
								<button type="button" data-photo-stack-edit-menu disabled={restore.busy || !libraryVisible || !selection || library.busy || stacks.busy
									|| stacks.visible || reviewing || photoSelection.pendingPhotoId !== null}
									onClick={event => { openStack('edit', event); }}>{copy.photoStackEdit}</button>
								{[0, 1, 2, 3, 4, 5].map(rating => <button key={rating} type="button" disabled={restore.busy || !selection || library.busy}
									onClick={event => { closeMenu(event); if (selection) void photoSelection.cull(selection.id, signal => library.setRating(selection.id, rating, { signal })); }}>
									{copy.photoRateStars.replace('{count}', String(rating))}
								</button>)}
								{(['unflagged', 'pick', 'reject'] as const).map(flag => <button key={flag} type="button" disabled={restore.busy || !selection || library.busy}
									aria-pressed={selection?.flag === flag} onClick={event => { closeMenu(event); if (selection) void photoSelection.cull(selection.id, signal => library.applyAttributes(selection.id, { flag }, { signal })); }}>
									{copy.photoFlag}: {flags[flag]}
								</button>)}
								{(['none', 'red', 'yellow', 'green', 'blue', 'purple'] as const).map(colorLabel => <button key={colorLabel} type="button" disabled={restore.busy || !selection || library.busy}
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
						<button type="button" disabled={restore.busy} aria-pressed={libraryVisible} onClick={toggleLibrary}>
							{libraryVisible ? copy.photoHideLibrary : copy.photoShowLibrary}
						</button>
						<button type="button" disabled={restore.busy || library.busy || savedVisible || queryVisible || reviewing || stacks.visible || stacks.busy} onClick={event => {
							if (savedAdmission.current !== null || developSurface.isAdmitted() || queryAdmission.current || reviewAdmission.current !== null
								|| stackMenu.current.reviewing || stackMenu.current.stacks.visible || stackMenu.current.stacks.busy) return;
							queryAdmission.current = true; closeMenu(event); setQueryVisible(true); void library.probeQuery();
						}}>{copy.photoQueryTitle}</button>
						<button type="button" data-photo-save-filter-menu disabled={restore.busy || !createSession || library.busy || savedVisible || queryVisible || stacks.visible || stacks.busy || reviewing || photoSelection.pendingPhotoId !== null}
							onClick={event => { openSavedFilters('create', event); }}>{copy.photoSaveCurrentFilter}</button>
						<button type="button" data-photo-saved-filters-menu disabled={restore.busy || !createSession || library.busy || savedVisible || queryVisible || stacks.visible || stacks.busy || reviewing || photoSelection.pendingPhotoId !== null}
							onClick={event => { openSavedFilters('manage', event); }}>{copy.photoSavedFiltersTitle}</button>
						<button type="button" disabled={restore.busy || !libraryVisible} aria-pressed={thumbnailsVisible} onClick={event => {
							closeMenu(event); setPreviewActivated(true); setThumbnailsVisible(visible => !visible);
						}}>{thumbnailsVisible ? copy.photoHideThumbnails : copy.photoShowThumbnails}</button>
						<button type="button" disabled={restore.busy || !libraryVisible} aria-pressed={filmstripVisible} onClick={event => {
							closeMenu(event); setFilmstripVisible(visible => !visible);
						}}>{filmstripVisible ? copy.photoHideFilmstrip : copy.photoShowFilmstrip}</button>
						<button type="button" disabled={restore.busy || !libraryVisible || !selection} aria-pressed={loupeVisible} onClick={event => {
							closeMenu(event); setPreviewActivated(true); setLoupeVisible(visible => !visible);
						}}>{loupeVisible ? copy.photoHideLoupe : copy.photoShowLoupe}</button>
						<button type="button" data-photo-compare-menu disabled={restore.busy || !libraryVisible || photoSelection.snapshot.selectedIds.length < 2 || library.busy || photoSelection.pendingPhotoId !== null || reviewing || stacks.visible || stacks.busy}
							onClick={event => { openReview('compare', event); }}>{copy.photoCompareTitle}</button>
						<button type="button" data-photo-survey-menu disabled={restore.busy || !libraryVisible || photoSelection.snapshot.selectedIds.length < 2 || library.busy || photoSelection.pendingPhotoId !== null || reviewing || stacks.visible || stacks.busy}
							onClick={event => { openReview('survey', event); }}>{copy.photoSurveyTitle}</button>
						<button type="button" data-photo-stack-view-menu aria-pressed={library.stackCollapsed} disabled={restore.busy || !libraryVisible
							|| library.busy || stacks.visible || stacks.busy || reviewing || photoSelection.pendingPhotoId !== null}
							onClick={toggleStackView}>{library.stackCollapsed ? copy.photoStackExpandView : copy.photoStackCollapseView}</button>
						<button type="button" disabled={restore.busy || library.busy || !libraryVisible} onClick={event => { closeMenu(event); void library.readPage(); }}>{copy.photoFirstPage}</button>
						<button type="button" disabled={restore.busy || library.busy || !libraryVisible || !library.page?.cursor} onClick={event => { closeMenu(event); void library.readPage(library.page?.cursor); }}>{copy.photoNextPage}</button>
					</div>
				</details>

			</nav>
		</header>
		{!restore.busy && (previewActivated && !developVisible
			? <Suspense fallback={libraryVisible ? renderLibrary() : null}><PhotoPreviewPresentation readPreview={readPreviewAfterDrain}
				photoIds={libraryVisible ? library.page?.rows.map(row => row.id) ?? [] : []} thumbnailsVisible={libraryVisible && thumbnailsVisible && !reviewing}
				fitScreenPhotoId={libraryVisible && loupeVisible && !reviewing ? selection?.id ?? null : null}
				comparePhotoIds={comparePair} surveyPhotoIds={survey.visible ? survey.snapshot.photoIds : null}
				surveyFocusedPhotoId={survey.snapshot.focusedPhotoId} registerRetirement={registerPreviewRetirement}>{renderScene}</PhotoPreviewPresentation></Suspense>
			: renderScene())}
		{!restore.busy && developVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoDevelopWorkspace locale={locale} photoId={developEntry.photoId} label={developEntry.label} generation={developGeneration}
					selectedIds={photoSelection.snapshot.selectedIds} settings={developSettings}
					execute={library.executeDevelop} readPreview={library.readPreview} withOriginalFrame={library.withOriginalFrame} loadProxy={loadDevelopProxyRuntime}
					beforePresent={developEntry.beforePresent} beforeOpen={developEntry.beforeOpen} registerDemandRetirement={developSurface.register}
					registerRetirement={registerPreviewRetirement} onClose={() => {
						developSurface.close(joinPhotoLibraryRetirementV1([previewDrain.current, previewRetirement.current?.() ?? null]));
					}} />
		</Suspense>}
		{restoreVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoCatalogRestoreDialog locale={locale} copy={restoreCopy} ready={restore.ready} busy={restore.busy} cancelling={restore.cancelling}
				cancelled={restore.cancelled} receipt={restore.receipt} error={restore.error} onRestore={restore.restore}
				onCancel={restore.cancel} onClose={() => { setRestoreVisible(false); }} />
		</Suspense>}
		{!restore.busy && queryVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoQueryDialog query={library.query ?? DEFAULT_PHOTO_LIBRARY_QUERY_V2} copy={copy} flags={flags} colorLabels={colorLabels}
				loadMetadataQueryRuntime={loadMetadataQueryRuntime}
				busy={library.busy} error={library.error} needsIndex={library.needsQueryIndex} indexProgress={library.queryIndexProgress}
				readDefinitions={library.readDefinitions} onClose={() => { library.cancel(); queryAdmission.current = false; setQueryVisible(false); }}
				onApply={query => { setLibraryVisible(true); void library.applyQuery(query); }} onBuild={() => { void library.buildQueryIndex(); }} />
		</Suspense>}
		{!restore.busy && savedVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoSavedFiltersSurface generation={savedGeneration} initialMode={savedEntry.mode} initialQuery={library.query ?? DEFAULT_PHOTO_LIBRARY_QUERY_V2}
				initialCollectionId={library.savedCollectionId} activeCollectionId={library.savedCollectionId} savedFilters={savedFilters}
				loadSavedFilterRuntime={loadSavedFilterRuntime} readDefinitions={library.readDefinitions} copy={copy} flags={flags} colorLabels={colorLabels}
				busy={library.busy || savedFilters.busy} error={savedFilters.error ?? library.error} onClose={closeSavedFilters}
				onUse={() => { if (savedLatest.current === savedGeneration) setLibraryVisible(true); }}
				onCancel={() => { if (savedLatest.current === savedGeneration && savedFilters.busy) library.cancel(); }} />
		</Suspense>}
		{!restore.busy && metadataVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoMetadataDialog locale={locale} snapshot={library.metadata} busy={library.busy} error={library.error}
				onClose={() => { setMetadataVisible(false); }} onSave={(photoId, revision, changes) => { void library.applyMetadata(photoId, revision, changes); }} />
		</Suspense>}
		{!restore.busy && organizerVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoCatalogOrganizerDialog copy={copy} busy={library.busy} error={library.error} readDefinitions={library.readDefinitions}
				readDefinition={library.readDefinition} onApply={library.applyDefinition} createId={() => crypto.randomUUID()}
				onClose={() => { setOrganizerVisible(false); }} />
		</Suspense>}
		{!restore.busy && membershipsVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoMembershipDialog copy={copy} snapshot={library.memberships} busy={library.busy} error={library.error}
				readDefinitions={library.readDefinitions} readDefinition={library.readDefinition}
				definitionReader={definitionReader.current}
				onApply={(photoId, revision, changes) => { void library.applyMemberships(photoId, revision, changes); }}
				onClose={() => { setMembershipsVisible(false); }} />
		</Suspense>}
		{!restore.busy && importVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoImportDialog locale={locale} title={copy.photoImportPhotos} filesLabel={copy.photoChooseFiles} importLabel={copy.photoImportAction}
				cancelLabel={copy.photoCancelAction} failureLabel={copy.photoImportFailed} busy={library.busy} error={library.error} copy={copy}
				readPresets={library.readImportPresets} applyPreset={library.applyImportPreset} createId={createPresetId}
				readDevelopPresets={library.readImportDevelopPresets}
				readDefinitions={library.readDefinitions} readDefinition={library.readDefinition} definitionReader={definitionReader.current}
				onClose={closeImport} onImport={onImport} />
		</Suspense>}
		{!restore.busy && batchRenameVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoBatchRenameDialog snapshot={library.batchRenameSnapshot} busy={library.busy} error={library.error} copy={copy}
				onPlan={library.planBatchRename} onApply={library.renamePhotos} onClose={closeBatchRename} />
		</Suspense>}
		{!restore.busy && backupVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoCatalogBackupDialog locale={locale} copy={copy} ready={library.backupReady}
				maximumStreamingBytes={library.maximumBackupStreamingBytes} busy={library.busy} error={library.error}
				receipt={library.backupReceipt} onSave={onBackup} onClose={closeBackup} />
		</Suspense>}
		{!restore.busy && stacks.visible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoStackDialog generation={compareGeneration} copy={copy} mode={stacks.mode} snapshot={stacks.snapshot}
				selectedIds={stacks.selectedIds} members={stacks.members} busy={library.busy || stacks.busy}
				error={stacks.error ?? library.error} receipt={stacks.receipt} notice={stacks.notice}
				onReadMembers={stacks.readMembers} onApply={stacks.apply} onReload={stacks.reload} onCancel={library.cancel} onClose={stacks.close} />
		</Suspense>}
		{!restore.busy && originalRecoveryVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoOriginalRecoveryDialog generation={createSession} copy={copy} page={library.originalInspectionPage}
				receipt={library.originalRestorationReceipt} notice={library.originalRestorationNotice} cancelled={library.originalRecoveryCancelled}
				busy={library.busy} active={library.originalRecoveryActive} error={library.error}
				onInspect={library.inspectOriginals} onRestore={library.restoreOriginalBody} onCancel={library.cancel}
				onClose={() => { if (factory.current === createSession) setOriginalRecoveryVisible(false); }} />
		</Suspense>}
	</section>;
}
