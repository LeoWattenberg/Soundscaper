/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { PhotoLibrarySurveySnapshotV1 } from '../../controller/shared/photo-library-survey-v1.ts';
import type { PixelPreviewTargetStatusV1 } from '../../controller/shared/pixel-preview-presentation-v1.ts';
import type { PhotoLibraryRowV1 } from '../../photo-library-session-port-v1.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import './photo-survey.css';

export interface PhotoSurveyDialogCopyV1 {
	readonly photoSurveyTitle: string;
	readonly photoSurveyDescription: string;
	readonly photoSurveyPrevious: string;
	readonly photoSurveyNext: string;
	readonly photoSurveyRemove: string;
	readonly photoSurveyRestore: string;
	readonly photoSurveyKeys: string;
	readonly photoSurveyEmpty: string;
	readonly photoSurveyUnavailable: string;
	readonly photoSurveyRefreshFailed: string;
	readonly photoSurveyFocused: string;
	readonly photoSurveyPhoto: string;
	readonly photoRating: string;
	readonly photoFlag: string;
	readonly photoColorLabel: string;
	readonly photoCloseMetadata: string;
	readonly photoWorking: string;
	readonly photoPreviewUnavailable: string;
}
export interface PhotoSurveyDialogPropsV1 {
	readonly generation: unknown;
	readonly snapshot: Readonly<PhotoLibrarySurveySnapshotV1> | null;
	readonly rows: readonly PhotoLibraryRowV1[];
	readonly previewTargets: readonly Readonly<Pick<PixelPreviewTargetStatusV1, 'photoId' | 'tier' | 'status' | 'error'>>[];
	readonly renderThumbnail: (photoId: string, label: string) => ReactNode;
	readonly renderFitScreen: (photoId: string, label: string) => ReactNode;
	readonly copy: PhotoSurveyDialogCopyV1;
	readonly flags: Readonly<Record<PhotoLibraryRowV1['flag'], string>>;
	readonly colorLabels: Readonly<Record<PhotoLibraryRowV1['colorLabel'], string>>;
	readonly busy: boolean;
	readonly error: string | null;
	readonly notice: 'refresh-failed' | null;
	readonly onFocus: (photoId: string) => void;
	readonly onPrevious: () => void;
	readonly onNext: () => void;
	readonly onRemove: (photoId: string) => void;
	readonly onRestoreRemoved: () => void;
	readonly onRate: (photoId: string, rating: number) => void;
	readonly onFlag: (photoId: string, flag: PhotoLibraryRowV1['flag']) => void;
	readonly onColorLabel: (photoId: string, color: PhotoLibraryRowV1['colorLabel']) => void;
	readonly onClose: () => void;
}
const FLAGS = ['unflagged', 'pick', 'reject'] as const;
const COLORS = ['none', 'red', 'yellow', 'green', 'blue', 'purple'] as const;

/** Presents scalar review state and injected previews; all resource and write ownership stays external. */
export default function PhotoSurveyDialog(props: PhotoSurveyDialogPropsV1) {
	const id = useId(), current = useRef(props); current.current = props;
	const live = useRef(true), tiles = useRef(new Map<string, HTMLElement>());
	const focused = useRef<Readonly<{ generation: unknown; element: HTMLElement }> | null>(null);
	const [closed, setClosed] = useState(false), view = readView(props);
	const focusId = view ? props.snapshot?.focusedPhotoId : null;
	useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	useLayoutEffect(() => {
		const target = focusId ? tiles.current.get(focusId) : undefined;
		if (closed || !target || (focused.current?.element === target && Object.is(focused.current.generation, props.generation))) return;
		const active = target.ownerDocument.activeElement;
		// A control which acquired focus in this tile keeps its native focus when the scalar selection follows it.
		if (!active || !target.contains(active) || (focused.current !== null && !Object.is(focused.current.generation, props.generation))) {
			target.focus({ preventScroll: true });
		}
		if (target.contains(target.ownerDocument.activeElement)) focused.current = { generation: props.generation, element: target };
	}, [closed, focusId, props.generation]);
	const isCurrent = () => live.current && Object.is(current.current.generation, props.generation)
		&& current.current.snapshot === props.snapshot && current.current.rows === props.rows;
	const locked = () => current.current.busy || current.current.snapshot?.pendingPhotoId != null;
	const allowed = () => isCurrent() && !locked() && readView(current.current) !== null;
	const contains = (row: PhotoLibraryRowV1) => allowed() && current.current.snapshot?.photoIds.includes(row.id) === true;
	const close = () => {
		if (!isCurrent()) return;
		live.current = false; focused.current = null; setClosed(true); props.onClose();
	};
	const move = (direction: -1 | 1) => {
		if (!allowed() || !canNavigate(current.current.snapshot, direction)) return;
		if (direction === -1) props.onPrevious(); else props.onNext();
	};
	const focus = (row: PhotoLibraryRowV1) => {
		if (contains(row) && current.current.snapshot?.focusedPhotoId !== row.id) props.onFocus(row.id);
	};
	const remove = (row: PhotoLibraryRowV1) => { if (contains(row)) props.onRemove(row.id); };
	const restore = () => {
		if (allowed() && current.current.snapshot!.removedPhotoIds.length > 0) props.onRestoreRemoved();
	};
	const rate = (row: PhotoLibraryRowV1, value: number) => {
		if (contains(row) && Number.isInteger(value) && value >= 0 && value <= 5) props.onRate(row.id, value);
	};
	const flag = (row: PhotoLibraryRowV1, value: string) => {
		if (contains(row) && FLAGS.some(item => item === value)) props.onFlag(row.id, value as PhotoLibraryRowV1['flag']);
	};
	const color = (row: PhotoLibraryRowV1, value: string) => {
		if (contains(row) && COLORS.some(item => item === value)) props.onColorLabel(row.id, value as PhotoLibraryRowV1['colorLabel']);
	};
	const keyDown = (event: KeyboardEvent<HTMLElement>, row: PhotoLibraryRowV1) => {
		if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey
			|| !contains(row) || current.current.snapshot?.focusedPhotoId !== row.id) return;
		const key = event.key.toLowerCase();
		if (/^[0-5]$/u.test(key)) { event.preventDefault(); rate(row, Number(key)); }
		else if (key === 'p' || key === 'x' || key === 'u') { event.preventDefault(); flag(row, key === 'p' ? 'pick' : key === 'x' ? 'reject' : 'unflagged'); }
		else if (key === 'arrowleft' || key === 'arrowright') { event.preventDefault(); move(key === 'arrowleft' ? -1 : 1); }
		else if (key === 'delete') { event.preventDefault(); remove(row); }
	};
	const { copy } = props, disabled = props.busy || props.snapshot?.pendingPhotoId != null || view === null;
	const tile = (row: PhotoLibraryRowV1) => {
		const isFocused = row.id === focusId, tier = isFocused ? 'fit-screen' : 'thumbnail';
		const label = `${isFocused ? copy.photoSurveyFocused : copy.photoSurveyPhoto}: ${row.fileName}`;
		const target = props.previewTargets.find(item => item.photoId === row.id && item.tier === tier);
		const pending = !target || target.status === 'pending';
		return <section key={row.id} ref={element => { if (element) tiles.current.set(row.id, element); else tiles.current.delete(row.id); }}
			className="lightscaper-survey-tile" data-survey-photo={row.id} data-survey-focused={isFocused ? 'true' : 'false'}
			role="group" aria-label={label} tabIndex={0} onFocus={() => { focus(row); }} onKeyDown={event => { keyDown(event, row); }}>
			<strong className="lightscaper-survey-file">{row.fileName}</strong>
			<div className="lightscaper-survey-preview" aria-busy={pending}>
				{isFocused ? props.renderFitScreen(row.id, label) : props.renderThumbnail(row.id, label)}
			</div>
			{pending && <p role="status">{copy.photoWorking}</p>}
			{(target?.status === 'missing' || target?.status === 'failed') && <p role="status" data-survey-preview-unavailable>{copy.photoPreviewUnavailable}</p>}
			<p className="lightscaper-survey-facts">{copy.photoRating}: {row.rating} · {copy.photoFlag}: {props.flags[row.flag]} · {copy.photoColorLabel}: {props.colorLabels[row.colorLabel]}</p>
			<div className="lightscaper-survey-controls">
				<label>{copy.photoRating}<select data-survey-rating={row.id} value={row.rating} disabled={disabled}
					onChange={event => { rate(row, Number(event.currentTarget.value)); }}>{[0, 1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
				<label>{copy.photoFlag}<select data-survey-flag={row.id} value={row.flag} disabled={disabled}
					onChange={event => { flag(row, event.currentTarget.value); }}>{FLAGS.map(value => <option key={value} value={value}>{props.flags[value]}</option>)}</select></label>
				<label>{copy.photoColorLabel}<select data-survey-label={row.id} value={row.colorLabel} disabled={disabled}
					onChange={event => { color(row, event.currentTarget.value); }}>{COLORS.map(value => <option key={value} value={value}>{props.colorLabels[value]}</option>)}</select></label>
			</div>
			<button type="button" data-survey-remove={row.id} disabled={disabled} onClick={() => { remove(row); }}>{copy.photoSurveyRemove}</button>
		</section>;
	};
	return <AudioEditorDialogShell isOpen={!closed} title={copy.photoSurveyTitle} onClose={close}
		className="lightscaper-dialog lightscaper-survey-dialog" overlayClassName="lightscaper-dialog-backdrop"
		width="min(76rem, calc(100vw - 2rem))" closeOnOutside={false} initialFocus={'[data-survey-focused="true"]'}
		ariaDescribedBy={`${id}-description ${id}-keys`}>
		<div className="lightscaper-survey" data-photo-survey-dialog>
			<p id={`${id}-description`}>{copy.photoSurveyDescription}</p>
			{props.error && <p role="alert" data-survey-error>{props.error}</p>}
			{props.notice === 'refresh-failed' && <p role="status" data-survey-notice>{copy.photoSurveyRefreshFailed}</p>}
			{props.busy && <p role="status">{copy.photoWorking}</p>}
			{view && view.length > 0 ? <div className="lightscaper-survey-mosaic">{view.map(tile)}</div>
				: <p role="status">{view ? copy.photoSurveyEmpty : copy.photoSurveyUnavailable}</p>}
			<p id={`${id}-keys`} className="lightscaper-survey-keys">{copy.photoSurveyKeys}</p>
			<div className="lightscaper-survey-actions">
				<button type="button" data-survey-previous disabled={disabled || !canNavigate(props.snapshot, -1)} onClick={() => { move(-1); }}>{copy.photoSurveyPrevious}</button>
				<button type="button" data-survey-next disabled={disabled || !canNavigate(props.snapshot, 1)} onClick={() => { move(1); }}>{copy.photoSurveyNext}</button>
				<button type="button" data-survey-restore disabled={disabled || !props.snapshot?.removedPhotoIds.length} onClick={restore}>{copy.photoSurveyRestore}</button>
				<button type="button" data-survey-close onClick={close}>{copy.photoCloseMetadata}</button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}

function readView(props: PhotoSurveyDialogPropsV1): readonly PhotoLibraryRowV1[] | null {
	const snapshot = props.snapshot;
	if (!snapshot?.open || props.rows.length > 64 || props.previewTargets.length > 64 || snapshot.capturedPhotoIds.length > 64
		|| snapshot.photoIds.length > 64 || snapshot.removedPhotoIds.length > 64
		|| new Set(snapshot.capturedPhotoIds).size !== snapshot.capturedPhotoIds.length
		|| new Set(snapshot.photoIds).size !== snapshot.photoIds.length || new Set(snapshot.removedPhotoIds).size !== snapshot.removedPhotoIds.length
		|| snapshot.photoIds.some(id => !snapshot.capturedPhotoIds.includes(id))
		|| snapshot.removedPhotoIds.some(id => !snapshot.capturedPhotoIds.includes(id) || snapshot.photoIds.includes(id))
		|| (snapshot.photoIds.length === 0 ? snapshot.focusedPhotoId !== null : !snapshot.photoIds.includes(snapshot.focusedPhotoId ?? ''))
		|| new Set(props.rows.map(row => row.id)).size !== props.rows.length) return null;
	const rows: PhotoLibraryRowV1[] = [];
	for (const id of snapshot.photoIds) {
		const row = props.rows.find(item => item.id === id);
		if (!row) return null;
		rows.push(row);
	}
	return rows;
}
function canNavigate(snapshot: Readonly<PhotoLibrarySurveySnapshotV1> | null, direction: -1 | 1): boolean {
	if (!snapshot?.open || snapshot.photoIds.length > 64) return false;
	const index = snapshot.photoIds.indexOf(snapshot.focusedPhotoId ?? '');
	return index >= 0 && index + direction >= 0 && index + direction < snapshot.photoIds.length;
}
