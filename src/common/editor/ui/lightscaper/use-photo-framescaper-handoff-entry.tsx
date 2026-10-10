/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useRef, useState, type MouseEvent } from 'react';
import { photoFramescaperHandoffMenuLabel } from '../../../i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import type { PreparePhotoFramescaperHandoff } from '../../../../lightscaper/controller/photo-framescaper-handoff-download.ts';
import type { PhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';

const Dialog = lazy(() => import('./PhotoFramescaperHandoffDialog.tsx'));
interface Options {
	readonly generation: object; readonly locale: string; readonly workingLabel: string; readonly disabled: boolean;
	readonly selection: Readonly<{ id: string; fileName: string }> | null; readonly selectedCount: number;
	readonly closeMenu: (event: MouseEvent<HTMLButtonElement>) => boolean;
	readonly capture: () => PreparePhotoFramescaperHandoff; readonly prepareSave: () => Promise<void>;
	readonly saveRuntime: PhotoLibraryBackupSaveRuntimeV1 | null;
	readonly registerDestination: (cancelAndJoin: () => Promise<void>) => () => void;
}
interface Entry { readonly generation: object; readonly key: string; readonly photoId: string; readonly fileName: string; readonly prepare: PreparePhotoFramescaperHandoff; }

/** Menu-only scalar capture. The archive, native decoder and full copy remain behind the dialog. */
export function usePhotoFramescaperHandoffEntry(options: Options) {
	const latest = useRef(options); latest.current = options;
	const [stored, setStored] = useState<Entry | null>(null);
	const isSelected = (entry: Entry) => latest.current.generation === entry.generation && latest.current.selectedCount === 1 && latest.current.selection?.id === entry.photoId;
	const entry = stored && isSelected(stored) ? stored : null;
	const disabled = options.disabled || !options.selection || options.selectedCount !== 1 || entry !== null;
	const open = (event: MouseEvent<HTMLButtonElement>) => {
		const current = latest.current;
		if (current.generation !== options.generation || current.disabled || !current.selection || current.selectedCount !== 1 || entry || !current.closeMenu(event)) return;
		const prepare = current.capture();
		setStored(Object.freeze({ generation: current.generation, key: crypto.randomUUID(), photoId: current.selection.id, fileName: current.selection.fileName, prepare }));
		void current.prepareSave();
	};
	return {
		menu: <button type="button" data-photo-framescaper-handoff-menu disabled={disabled} onClick={open}>{photoFramescaperHandoffMenuLabel(options.locale)}</button>,
		surface: entry ? <Suspense fallback={<p role="status">{options.workingLabel}</p>}><Dialog key={entry.key} photoId={entry.photoId} fileName={entry.fileName} locale={options.locale}
			prepare={entry.prepare} isSelected={() => isSelected(entry)} saveRuntime={options.saveRuntime} registerDestination={options.registerDestination}
			onClose={() => { if (latest.current.generation === entry.generation) setStored(null); }} /></Suspense> : null,
	};
}
