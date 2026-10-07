/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';

import { otherProductIds, productIdentity } from '../../../product-identities.js';
import { productHref } from '../../../product-web-links.js';
import { useLightscaperEditorCopy as useSiteCopy } from './use-lightscaper-editor-copy.ts';
import type { CreatePhotoLibrarySessionV1 } from '../../photo-library-session-port-v1.ts';
import PhotoLibraryPanel from './PhotoLibraryPanel.tsx';
import { usePhotoLibraryWorkflow } from './use-photo-library-workflow.ts';
import '../../../../../vendor/audacity-design-system/components/src/ApplicationHeader/ApplicationHeader.css';
import './lightscaper.css';

export interface LightscaperAppProps {
	readonly locale: string;
	readonly createSession?: CreatePhotoLibrarySessionV1;
}

const PhotoImportDialog = lazy(() => import('./PhotoImportDialog.tsx'));
const PhotoMetadataDialog = lazy(() => import('./PhotoMetadataDialog.tsx'));

export default function LightscaperApp({ locale, createSession }: LightscaperAppProps) {
	const copy = useSiteCopy(locale);
	const app = useRef<HTMLElement>(null);
	const [libraryVisible, setLibraryVisible] = useState(false);
	const [importVisible, setImportVisible] = useState(false);
	const [metadataVisible, setMetadataVisible] = useState(false);
	const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
	const library = usePhotoLibraryWorkflow(createSession);
	const { readPage } = library;
	const flags = { unflagged: copy.photoUnflagged, pick: copy.photoPick, reject: copy.photoReject };
	const colorLabels = { none: copy.photoColorNone, red: copy.photoColorRed, yellow: copy.photoColorYellow,
		green: copy.photoColorGreen, blue: copy.photoColorBlue, purple: copy.photoColorPurple };
	const selection = library.page?.rows.find(row => row.id === selectedPhoto) ?? null;
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

	return <section ref={app} className="lightscaper-app" data-lightscaper-bound="true" aria-label={copy.lightscaperTitle}>
		<header className="lightscaper-header application-header">
			<h2>{copy.lightscaperTitle}</h2>
			<nav className="lightscaper-menus" aria-label={copy.photoMenuLabel}>
				<details name="lightscaper-application-menu" onKeyDown={menuKeyDown} onBlur={menuBlur}>
					<summary className="application-header__menu-item">{copy.photoFileMenu}</summary>
					<div className="lightscaper-menu-items">
						<button type="button" disabled={library.busy} onClick={event => { closeMenu(event); setImportVisible(true); }}>{copy.photoImportPhotos}</button>
						{library.busy && <button type="button" onClick={event => { closeMenu(event); library.cancel(); }}>{copy.photoCancelAction}</button>}
						<details className="lightscaper-photo-submenu" onKeyDown={menuKeyDown} onBlur={menuBlur}>
							<summary className="application-header__menu-item">{copy.photoPhotoMenu}</summary>
							<div className="lightscaper-menu-items">
								<button type="button" disabled={!selection || library.busy} onClick={event => {
									closeMenu(event); if (selection) { setMetadataVisible(true); void library.readMetadata(selection.id); }
								}}>{copy.photoEditMetadata}</button>
								{[0, 1, 2, 3, 4, 5].map(rating => <button key={rating} type="button" disabled={!selection || library.busy}
									onClick={event => { closeMenu(event); if (selection) void library.setRating(selection.id, rating); }}>
									{copy.photoRateStars.replace('{count}', String(rating))}
								</button>)}
								{(['unflagged', 'pick', 'reject'] as const).map(flag => <button key={flag} type="button" disabled={!selection || library.busy}
									aria-pressed={selection?.flag === flag} onClick={event => { closeMenu(event); if (selection) void library.applyAttributes(selection.id, { flag }); }}>
									{copy.photoFlag}: {flags[flag]}
								</button>)}
								{(['none', 'red', 'yellow', 'green', 'blue', 'purple'] as const).map(colorLabel => <button key={colorLabel} type="button" disabled={!selection || library.busy}
									aria-pressed={selection?.colorLabel === colorLabel} onClick={event => { closeMenu(event); if (selection) void library.applyAttributes(selection.id, { colorLabel }); }}>
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
						<button type="button" disabled={library.busy || !libraryVisible} onClick={event => { closeMenu(event); void library.readPage(); }}>{copy.photoFirstPage}</button>
						<button type="button" disabled={library.busy || !libraryVisible || !library.page?.cursor} onClick={event => { closeMenu(event); void library.readPage(library.page?.cursor); }}>{copy.photoNextPage}</button>
					</div>
				</details>

			</nav>
		</header>
		{libraryVisible && <PhotoLibraryPanel title={copy.workspacePhoto} empty={copy.photoEmptyLibrary} loading={copy.photoWorking}
			ratingLabel={copy.photoRating} flags={flags} colorLabels={colorLabels} importedLabel={copy.photoImported} failedLabel={copy.photoImportFailed} metadataNotice={copy.photoMetadataNotice}
			page={library.page} receipts={library.receipts} selected={selection?.id ?? null} busy={library.busy} error={library.error}
			onSelect={setSelectedPhoto} onRate={(photoId, rating) => { void library.setRating(photoId, rating); }} />}
		{metadataVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoMetadataDialog locale={locale} snapshot={library.metadata} busy={library.busy} error={library.error}
				onClose={() => { setMetadataVisible(false); }} onSave={(photoId, revision, changes) => { void library.applyMetadata(photoId, revision, changes); }} />
		</Suspense>}
		{importVisible && <Suspense fallback={<p role="status">{copy.photoWorking}</p>}>
			<PhotoImportDialog title={copy.photoImportPhotos} filesLabel={copy.photoChooseFiles} importLabel={copy.photoImportAction}
				cancelLabel={copy.photoCancelAction} busy={library.busy} onClose={closeImport} onImport={files => {
					setImportVisible(false); setLibraryVisible(true); void library.importFiles(files);
				}} />
		</Suspense>}
	</section>;
}
