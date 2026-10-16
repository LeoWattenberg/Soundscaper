/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useRef, useState, type MouseEvent } from 'react';
import { imageHdrMergeCopy } from '../../../i18n/image-hdr-merge-copy.ts';
import type { ImageHdrMergeAuthoringPortCurrentV1 } from '../../image-hdr-merge-authoring-port-current-v1.ts';
import type { PhotoLibraryImportItemV1 } from '../../photo-library-session-port-v1.ts';
import type { ImageHdrMergeDialogPropsCurrentV1 } from '../dialogs/ImageHdrMergeDialogCurrentV1.tsx';

type PhotoDialogProps = ImageHdrMergeDialogPropsCurrentV1<PhotoLibraryImportItemV1>;
const Dialog = lazy(() => import('../dialogs/ImageHdrMergeDialogCurrentV1.tsx').then(({ default: SharedDialog }) => ({
	default: function PhotoHdrMergeDialog(props: PhotoDialogProps) { return <SharedDialog<PhotoLibraryImportItemV1> {...props} />; },
})));
interface Options {
	readonly generation: object;
	readonly locale: string;
	readonly disabled: boolean;
	readonly selectedIds: readonly string[];
	readonly queryIdentity: unknown;
	readonly page: unknown;
	readonly closeMenu: (event: MouseEvent<HTMLButtonElement>) => boolean;
	readonly capture: (ids: readonly string[], isSelected: () => boolean) => Readonly<ImageHdrMergeAuthoringPortCurrentV1<PhotoLibraryImportItemV1>>;
	readonly beforeOpen: () => Promise<void>;
	readonly registerRetirement: (retire: () => Promise<void>) => () => void;
	readonly onAcknowledged?: (value: Readonly<PhotoLibraryImportItemV1>) => void;
}
interface Entry {
	readonly generation: object; readonly key: string; readonly ids: readonly string[];
	readonly queryIdentity: unknown; readonly page: unknown;
	readonly port: Readonly<ImageHdrMergeAuthoringPortCurrentV1<PhotoLibraryImportItemV1>>;
	readonly before: Promise<void>; readonly state: { acknowledged: boolean; closing: boolean };
}

/** Menu gesture capture only. Native ownership and queueing stay in the shared
 * controller and the existing selected library workflow. */
export function usePhotoHdrMergeEntryCurrentV1(options: Options) {
	const latest = useRef(options); latest.current = options;
	const retained = useRef<Entry | null>(null), [stored, setStored] = useState<Entry | null>(null);
	const entry = stored?.generation === options.generation ? stored : null;
	const pending = () => retained.current !== null && retained.current.generation === latest.current.generation;
	const selected = (value: Pick<Entry, 'generation' | 'ids' | 'queryIdentity' | 'page' | 'state'>) => {
		const current = latest.current;
		return current.generation === value.generation && (value.state.acknowledged || current.page === value.page && current.queryIdentity === value.queryIdentity
			&& current.selectedIds.length === value.ids.length && current.selectedIds.every((id, index) => id === value.ids[index]));
	};
	const open = (event: MouseEvent<HTMLButtonElement>) => {
		const current = latest.current;
		if (current !== options || current.disabled || current.generation !== options.generation || pending() || current.selectedIds.length < 2 || current.selectedIds.length > 9) return;
		if (!current.closeMenu(event) || latest.current !== current) return;
		const ids = Object.freeze([...current.selectedIds]), state = { acknowledged: false, closing: false };
		const captured = { generation: current.generation, ids, page: current.page, queryIdentity: current.queryIdentity, state };
		const port = current.capture(ids, () => selected(captured));
		// Install synchronous admission before starting the culling drain, which
		// may trigger retained browser or menu callbacks during cancellation.
		const marker = { ...captured, key: crypto.randomUUID(), port, before: Promise.resolve() };
		retained.current = marker;
		let before: Promise<void>;
		try { before = current.beforeOpen(); } catch (error) { before = Promise.reject(error); }
		void before.catch(() => undefined);
		const next = Object.freeze({ ...marker, before }); retained.current = next; setStored(next);
	};
	const close = (value: Entry) => {
		if (retained.current !== value || latest.current.generation !== value.generation) return;
		value.state.closing = true; retained.current = null; setStored(null);
	};
	const copy = imageHdrMergeCopy(options.locale);
	return {
		pending,
		menu: <button type="button" data-photo-hdr-merge-menu disabled={options.disabled || options.selectedIds.length < 2 || options.selectedIds.length > 9 || pending()} onClick={open}>{copy.menu}</button>,
		surface: entry ? <Suspense fallback={<p role="status">{copy.working}</p>}><Dialog key={entry.key} port={entry.port} locale={options.locale} beforeOpen={entry.before}
			isCurrent={() => retained.current === entry && !entry.state.closing && selected(entry)} registerRetirement={options.registerRetirement}
			onAcknowledged={value => {
				if (retained.current !== entry) return;
				entry.state.acknowledged = true;
				if (latest.current.generation === entry.generation) latest.current.onAcknowledged?.(value);
			}} onClose={() => { close(entry); }} /></Suspense> : null,
	};
}
