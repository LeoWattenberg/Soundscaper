/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useRef, useState, type MouseEvent } from 'react';
import { photoFramescaperCollectionHandoffMenuLabel, photoFramescaperHandoffMenuLabel, photoFramescaperReceiveMenuLabel } from '../../../i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import type { PreparePhotoFramescaperHandoffSelectedV1 } from '../../../../lightscaper/controller/photo-framescaper-handoff-download-current-v1.ts';
import type { PhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { CapturedPhotoImageReceive } from './photo-library-workflow-image-receive.ts';
import type { CapturedPhotoCollectionHandoff } from './photo-library-workflow-collection-handoff.ts';

const Dialog = lazy(() => import('./PhotoFramescaperHandoffDialog.tsx'));
const ReceiveDialog = lazy(() => import('./PhotoFramescaperReceiveDialog.tsx'));
const CollectionDialog = lazy(() => import('./PhotoFramescaperCollectionHandoffDialog.tsx'));
interface Options {
	readonly generation: object; readonly locale: string; readonly workingLabel: string; readonly disabled: boolean;
	readonly selection: Readonly<{ id: string; fileName: string }> | null; readonly selectedCount: number;
	readonly closeMenu: (event: MouseEvent<HTMLButtonElement>) => boolean;
	readonly capture: () => PreparePhotoFramescaperHandoffSelectedV1; readonly prepareSave: () => Promise<void>;
	readonly saveRuntime: PhotoLibraryBackupSaveRuntimeV1 | null;
	readonly registerDestination: (cancelAndJoin: () => Promise<void>) => () => void;
	readonly receive: Readonly<{ disabled: boolean; capture: () => Readonly<CapturedPhotoImageReceive>; onImported: () => void }>;
	readonly collection: Readonly<{ disabled: boolean; capture: () => Readonly<CapturedPhotoCollectionHandoff> }>;
}
interface Entry { readonly generation: object; readonly key: string; readonly photoId: string; readonly fileName: string; readonly prepare: PreparePhotoFramescaperHandoffSelectedV1; }

/** Menu-only scalar capture. The archive, native decoder and full copy remain behind the dialog. */
export function usePhotoFramescaperHandoffEntry(options: Options) {
	const latest = useRef(options); latest.current = options;
	const [stored, setStored] = useState<Entry | null>(null);
	const [storedReceive, setStoredReceive] = useState<Readonly<{ generation: object; key: string; capture: Readonly<CapturedPhotoImageReceive> }> | null>(null);
	const [storedCollection, setStoredCollection] = useState<Readonly<{ generation: object; key: string; capture: Readonly<CapturedPhotoCollectionHandoff> }> | null>(null);
	const receiveEntry = storedReceive?.generation === options.generation ? storedReceive : null;
	const collectionEntry = storedCollection?.generation === options.generation ? storedCollection : null;
	const isSelected = (entry: Entry) => latest.current.generation === entry.generation && latest.current.selectedCount === 1 && latest.current.selection?.id === entry.photoId;
	const entry = stored && isSelected(stored) ? stored : null;
	const disabled = options.disabled || !options.selection || options.selectedCount !== 1 || entry !== null || receiveEntry !== null || collectionEntry !== null;
	const open = (event: MouseEvent<HTMLButtonElement>) => {
		const current = latest.current;
		if (current.generation !== options.generation || current.disabled || !current.selection || current.selectedCount !== 1 || entry || receiveEntry || collectionEntry || !current.closeMenu(event)) return;
		const prepare = current.capture();
		setStored(Object.freeze({ generation: current.generation, key: crypto.randomUUID(), photoId: current.selection.id, fileName: current.selection.fileName, prepare }));
		void current.prepareSave();
	};
	const openReceive = (event: MouseEvent<HTMLButtonElement>) => {
		const current = latest.current;
		if (current.generation !== options.generation || current.receive.disabled || receiveEntry || entry || collectionEntry || !current.closeMenu(event)) return;
		setStoredReceive(Object.freeze({ generation: current.generation, key: crypto.randomUUID(), capture: current.receive.capture() }));
	};
	const openCollection = (event: MouseEvent<HTMLButtonElement>) => {
		const current = latest.current;
		if (current.generation !== options.generation || current.collection.disabled || collectionEntry || receiveEntry || entry || !current.closeMenu(event)) return;
		setStoredCollection(Object.freeze({ generation: current.generation, key: crypto.randomUUID(), capture: current.collection.capture() }));
		void current.prepareSave();
	};
	return {
		menu: <button type="button" data-photo-framescaper-handoff-menu disabled={disabled} onClick={open}>{photoFramescaperHandoffMenuLabel(options.locale)}</button>,
		receiveMenu: <button type="button" data-photo-framescaper-receive-menu disabled={options.receive.disabled || entry !== null || receiveEntry !== null || collectionEntry !== null} onClick={openReceive}>{photoFramescaperReceiveMenuLabel(options.locale)}</button>,
		collectionMenu: <button type="button" data-photo-framescaper-collection-handoff-menu disabled={options.collection.disabled || entry !== null || receiveEntry !== null || collectionEntry !== null} onClick={openCollection}>{photoFramescaperCollectionHandoffMenuLabel(options.locale)}</button>,
		collectionSurface: collectionEntry ? <Suspense fallback={<p role="status">{options.workingLabel}</p>}><CollectionDialog key={collectionEntry.key} locale={options.locale} capture={collectionEntry.capture}
			isCurrent={() => latest.current.generation === collectionEntry.generation} saveRuntime={options.saveRuntime} registerDestination={options.registerDestination}
			onClose={() => { if (latest.current.generation === collectionEntry.generation) setStoredCollection(null); }} /></Suspense> : null,
		receiveSurface: receiveEntry ? <Suspense fallback={<p role="status">{options.workingLabel}</p>}><ReceiveDialog key={receiveEntry.key} locale={options.locale} capture={receiveEntry.capture}
			isCurrent={() => latest.current.generation === receiveEntry.generation} registerDestination={options.registerDestination}
			onImported={() => { if (latest.current.generation === receiveEntry.generation) latest.current.receive.onImported(); }}
			onClose={() => { if (latest.current.generation === receiveEntry.generation) setStoredReceive(null); }} /></Suspense> : null,
		surface: entry ? <Suspense fallback={<p role="status">{options.workingLabel}</p>}><Dialog key={entry.key} photoId={entry.photoId} fileName={entry.fileName} locale={options.locale}
			prepare={entry.prepare} isSelected={() => isSelected(entry)} saveRuntime={options.saveRuntime} registerDestination={options.registerDestination}
			onClose={() => { if (latest.current.generation === entry.generation) setStored(null); }} /></Suspense> : null,
	};
}
