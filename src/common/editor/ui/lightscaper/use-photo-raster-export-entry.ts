/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState, type MouseEvent } from 'react';
import { photoPngExportMenuLabel } from '../../../i18n/lightscaper-photo-png-export-menu-copy.ts';
import { photoJpegExportMenuLabel } from '../../../i18n/lightscaper-photo-jpeg-export-menu-copy.ts';
import { photoBatchExportMenuCopy } from '../../../i18n/lightscaper-photo-batch-export-menu-copy.ts';
import type { PhotoRasterBatchSelection } from '../../../../lightscaper/controller/photo-raster-export-batch-selection.ts';

export type PhotoRasterExportEntry = Readonly<{ key: string; generation: unknown; visible: boolean; settled: boolean } & (
	{ mode: 'single'; format: 'png' | 'jpeg'; photoId: string; fileName: string }
	| { mode: 'batch'; selection: readonly Readonly<PhotoRasterBatchSelection>[] })>;

/** Scalar menu admission only. Renderers, encoders and the queue stay lazy. */
export function usePhotoRasterExportEntry(options: {
	readonly generation: unknown; readonly locale: string; readonly disabled: boolean;
	readonly selection: Readonly<{ id: string; fileName: string }> | null;
	readonly selected: readonly Readonly<{ id: string; fileName: string }>[];
	readonly closeMenu: (event: MouseEvent<HTMLButtonElement>) => boolean;
	readonly prepareSave: () => Promise<unknown>;
}) {
	const [stored, setStored] = useState<PhotoRasterExportEntry | null>(null);
	const retained = useRef<PhotoRasterExportEntry | null>(null);
	const latest = useRef(options); latest.current = options;
	const generation = options.generation;
	const entry = stored?.generation === generation ? stored : null;
	const currentEntry = () => retained.current?.generation === latest.current.generation ? retained.current : null;
	const replace = (value: PhotoRasterExportEntry | null) => { retained.current = value; setStored(value); };
	const currentMenu = () => latest.current === options && latest.current.generation === generation && currentEntry() === entry;
	const occupied = (value: PhotoRasterExportEntry | null) => value !== null && (value.mode === 'single' || !value.settled);
	const admit = (event: MouseEvent<HTMLButtonElement>, format: 'png' | 'jpeg' | 'batch') => {
		const current = latest.current;
		if (!currentMenu() || current.disabled || occupied(currentEntry())) return;
		if (format === 'batch' ? !current.selected.length : !current.selection) return;
		if (!current.closeMenu(event) || !currentMenu()) return;
		const base = { key: crypto.randomUUID(), generation, visible: true, settled: false };
		if (format === 'batch') {
			const selection = Object.freeze(current.selected.map(row => Object.freeze({ photoId: row.id, fileName: row.fileName })));
			replace(Object.freeze({ ...base, mode: 'batch', selection }));
		} else {
			const selection = current.selection!;
			replace(Object.freeze({ ...base, mode: 'single', format, photoId: selection.id, fileName: selection.fileName }));
		}
		void current.prepareSave();
	};
	// Delivery callbacks may survive visibility changes, but never a different
	// queue entry or library generation. Read the synchronous current value.
	const update = (change: (value: PhotoRasterExportEntry) => PhotoRasterExportEntry | null) => {
		const value = currentEntry();
		if (!entry || !value || latest.current.generation !== generation || value.key !== entry.key) return;
		replace(change(value));
	};
	const copy = photoBatchExportMenuCopy(options.locale);
	const menus = [
		...(['png', 'jpeg'] as const).map(format => ({ key: format, label: format === 'png' ? photoPngExportMenuLabel(options.locale) : photoJpegExportMenuLabel(options.locale),
			disabled: options.disabled || occupied(entry) || !options.selection, onClick: (event: MouseEvent<HTMLButtonElement>) => { admit(event, format); } })),
		{ key: 'batch', label: copy.downloadSelected, disabled: options.disabled || occupied(entry) || options.selected.length === 0,
			onClick: (event: MouseEvent<HTMLButtonElement>) => { admit(event, 'batch'); } },
		{ key: 'queue', label: copy.queue, disabled: options.disabled && entry === null, onClick: (event: MouseEvent<HTMLButtonElement>) => {
			const current = latest.current, value = currentEntry();
			if (!currentMenu() || current.disabled && value === null || !current.closeMenu(event) || !currentMenu()) return;
			if (value && (value.mode === 'single' || !value.settled)) replace(Object.freeze({ ...value, visible: true }));
			else {
				replace(Object.freeze({ key: crypto.randomUUID(), generation, visible: true, settled: false, mode: 'batch',
					selection: Object.freeze(current.selected.map(row => Object.freeze({ photoId: row.id, fileName: row.fileName }))) }));
				void current.prepareSave();
			}
		} },
	];
	return { entry, menus, close: () => { update(() => null); }, hide: () => { update(value => Object.freeze({ ...value, visible: false })); },
		settled: () => { update(value => Object.freeze({ ...value, settled: true })); } };
}
