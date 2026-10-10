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
	const latest = useRef(options); latest.current = options;
	const entry = stored?.generation === options.generation ? stored : null;
	const occupied = entry !== null && (entry.mode === 'single' || !entry.settled);
	const admit = (event: MouseEvent<HTMLButtonElement>, format: 'png' | 'jpeg' | 'batch') => {
		const current = latest.current;
		if (current.disabled || occupied || !current.closeMenu(event)) return;
		const base = { key: crypto.randomUUID(), generation: current.generation, visible: true, settled: false };
		if (format === 'batch') {
			if (!current.selected.length) return;
			const selection = Object.freeze(current.selected.map(row => Object.freeze({ photoId: row.id, fileName: row.fileName })));
			setStored(Object.freeze({ ...base, mode: 'batch', selection }));
		} else {
			if (!current.selection) return;
			setStored(Object.freeze({ ...base, mode: 'single', format, photoId: current.selection.id, fileName: current.selection.fileName }));
		}
		void current.prepareSave();
	};
	const update = (change: (value: PhotoRasterExportEntry) => PhotoRasterExportEntry | null) => {
		setStored(value => value && value.generation === latest.current.generation ? change(value) : value);
	};
	const copy = photoBatchExportMenuCopy(options.locale);
	const menus = [
		...(['png', 'jpeg'] as const).map(format => ({ key: format, label: format === 'png' ? photoPngExportMenuLabel(options.locale) : photoJpegExportMenuLabel(options.locale),
			disabled: options.disabled || occupied || !options.selection, onClick: (event: MouseEvent<HTMLButtonElement>) => { admit(event, format); } })),
		{ key: 'batch', label: copy.downloadSelected, disabled: options.disabled || occupied || options.selected.length === 0,
			onClick: (event: MouseEvent<HTMLButtonElement>) => { admit(event, 'batch'); } },
		{ key: 'queue', label: copy.queue, disabled: entry?.mode === 'single' || options.disabled && entry?.mode !== 'batch', onClick: (event: MouseEvent<HTMLButtonElement>) => {
			const current = latest.current;
			if (entry?.mode === 'single' || (current.disabled && entry?.mode !== 'batch') || !current.closeMenu(event)) return;
			if (entry?.mode === 'batch' && !entry.settled) update(value => Object.freeze({ ...value, visible: true }));
			else { setStored(Object.freeze({ key: crypto.randomUUID(), generation: current.generation, visible: true, settled: false, mode: 'batch',
				selection: Object.freeze(current.selected.map(row => Object.freeze({ photoId: row.id, fileName: row.fileName }))) })); void current.prepareSave(); }
		} },
	];
	return { entry, menus, close: () => { update(() => null); }, hide: () => { update(value => Object.freeze({ ...value, visible: false })); },
		settled: () => { update(value => Object.freeze({ ...value, settled: true })); } };
}
