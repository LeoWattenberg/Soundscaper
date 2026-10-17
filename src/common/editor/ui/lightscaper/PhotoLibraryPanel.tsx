/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyboardEvent, ReactNode } from 'react';
import type { PhotoLibraryImportItemV1, PhotoLibraryPageV1, PhotoLibraryRowV1 } from '../../photo-library-session-port-v1.ts';
import type { usePhotoLibrarySelection } from './use-photo-library-selection.ts';

interface Props {
	readonly title: string;
	readonly empty: string;
	readonly loading: string;
	readonly ratingLabel: string;
	readonly flags: Readonly<Record<PhotoLibraryRowV1['flag'], string>>;
	readonly colorLabels: Readonly<Record<PhotoLibraryRowV1['colorLabel'], string>>;
	readonly importedLabel: string;
	readonly failedLabel: string;
	readonly metadataNotice: string;
	readonly page: PhotoLibraryPageV1 | null;
	readonly receipts: readonly PhotoLibraryImportItemV1[];
	readonly selected: string | null;
	readonly selection?: Pick<ReturnType<typeof usePhotoLibrarySelection>, 'snapshot' | 'select' | 'focus' | 'navigate' | 'selectAll' | 'clear' | 'attach'>;
	readonly layout?: 'grid' | 'filmstrip';
	readonly cullingNotice?: string | null;
	readonly busy: boolean;
	readonly error: string | null;
	readonly renderPreview?: (row: PhotoLibraryRowV1) => ReactNode;
	readonly onSelect: (photoId: string) => void;
	readonly onRate: (photoId: string, rating: number) => void;
}

export default function PhotoLibraryPanel(props: Props) {
	const rows = props.page?.rows ?? [];
	const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		const photoId = rows[index]!.id;
		const modifiers = { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey };
		if (props.selection) {
			if (modifiers.toggle && event.key.toLowerCase() === 'a') {
				event.preventDefault(); props.selection.selectAll(); return;
			}
			if (event.key === 'Escape') { event.preventDefault(); props.selection.clear(); return; }
			if (event.key === ' ' && (modifiers.toggle || modifiers.range)) {
				event.preventDefault(); props.selection.select(photoId, modifiers); return;
			}
			if (props.selection.navigate(photoId, event.key, modifiers) !== null) { event.preventDefault(); return; }
		}
		if (/^[0-5]$/u.test(event.key)) {
			event.preventDefault(); if (!props.busy) props.onRate(photoId, Number(event.key)); return;
		}
		const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? Math.min(rows.length - 1, index + 1)
			: event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? Math.max(0, index - 1)
				: event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null;
		if (next === null) return;
		event.preventDefault(); props.onSelect(rows[next]!.id);
		event.currentTarget.closest('ul')?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
	};
	return <section className="lightscaper-library" data-photo-library="true" data-photo-layout={props.layout ?? 'grid'} aria-label={props.title} aria-busy={props.busy}>
		<h3>{props.title}</h3>
		{props.error && <p role="alert">{props.error}</p>}
		{props.busy && <p role="status">{props.loading}</p>}
		{props.cullingNotice && <p role="status">{props.cullingNotice}</p>}
		{!props.busy && !props.error && rows.length === 0 && <p role="status">{props.empty}</p>}
		{props.page && <p data-photo-count={props.page.totalCount}>{props.page.catalogName}: {props.page.totalCount}</p>}
		<ul className="lightscaper-photo-grid">
			{rows.map((row, index) => <li key={row.id}>
				<button type="button" data-photo-id={row.id} data-photo-flag={row.flag} data-photo-color-label={row.colorLabel}
					aria-pressed={props.selection ? props.selection.snapshot.selectedIds.includes(row.id) : props.selected === row.id}
					ref={button => { props.selection?.attach(row.id, button); }}
					onClick={event => {
						if (props.selection) props.selection.select(row.id, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
						else props.onSelect(row.id);
					}}
					onFocus={() => { if (props.selection) props.selection.focus(row.id); else props.onSelect(row.id); }} onKeyDown={event => { navigate(event, index); }}>
					{props.renderPreview?.(row)}
					<strong>{row.fileName}</strong>
					<span>{row.width} × {row.height}</span>
					<span>{props.ratingLabel}: {row.rating}</span>
					{row.flag !== 'unflagged' && <span>{props.flags[row.flag]}</span>}
					{row.colorLabel !== 'none' && <span>{props.colorLabels[row.colorLabel]}</span>}
				</button>
			</li>)}
		</ul>
		{props.receipts.length > 0 && <ul className="lightscaper-import-results" aria-live="polite">
			{props.receipts.map(receipt => <li key={receipt.index} data-photo-import-status={receipt.status}>
				{receipt.fileName}: {receipt.status === 'imported' ? props.importedLabel : props.failedLabel}
				{receipt.message && <span> — {receipt.message}</span>}
				{receipt.hasMetadataNotices && <span> — {props.metadataNotice}</span>}
			</li>)}
		</ul>}
	</section>;
}
