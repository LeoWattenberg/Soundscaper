/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { PhotoLibraryCompareSnapshotV1 } from '../../controller/shared/photo-library-compare-v1.ts';
import type { PixelPreviewTargetStatusV1 } from '../../controller/shared/pixel-preview-presentation-v1.ts';
import type { PhotoLibraryRowV1 } from '../../photo-library-session-port-v1.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import './photo-compare.css';

export interface PhotoCompareDialogCopyV1 {
	readonly photoCompareTitle: string;
	readonly photoCompareDescription: string;
	readonly photoCompareReference: string;
	readonly photoCompareCandidate: string;
	readonly photoComparePrevious: string;
	readonly photoCompareNext: string;
	readonly photoCompareSwap: string;
	readonly photoComparePromote: string;
	readonly photoCompareKeys: string;
	readonly photoCompareEmpty: string;
	readonly photoCompareUnavailable: string;
	readonly photoCompareRefreshFailed: string;
	readonly photoRating: string;
	readonly photoFlag: string;
	readonly photoColorLabel: string;
	readonly photoCloseMetadata: string;
	readonly photoWorking: string;
	readonly photoPreviewUnavailable: string;
}
export interface PhotoCompareDialogPropsV1 {
	readonly generation: unknown;
	readonly snapshot: Readonly<PhotoLibraryCompareSnapshotV1> | null;
	readonly rows: readonly PhotoLibraryRowV1[];
	readonly previewTargets: readonly Readonly<Pick<PixelPreviewTargetStatusV1, 'photoId' | 'status' | 'error'>>[];
	readonly renderFitScreen: (photoId: string, label: string) => ReactNode;
	readonly copy: PhotoCompareDialogCopyV1;
	readonly flags: Readonly<Record<PhotoLibraryRowV1['flag'], string>>;
	readonly colorLabels: Readonly<Record<PhotoLibraryRowV1['colorLabel'], string>>;
	readonly busy: boolean;
	readonly error: string | null;
	readonly notice: 'refresh-failed' | null;
	readonly onPrevious: () => void;
	readonly onNext: () => void;
	readonly onSwap: () => void;
	readonly onPromote: () => void;
	readonly onRate: (photoId: string, rating: number) => void;
	readonly onFlag: (photoId: string, flag: PhotoLibraryRowV1['flag']) => void;
	readonly onColorLabel: (photoId: string, color: PhotoLibraryRowV1['colorLabel']) => void;
	readonly onClose: () => void;
}
type Side = 'reference' | 'candidate';
const FLAGS = ['unflagged', 'pick', 'reject'] as const;
const COLORS = ['none', 'red', 'yellow', 'green', 'blue', 'purple'] as const;

/** Scalar modal presentation; the injected owners retain all writes and pixel lifetimes. */
export default function PhotoCompareDialog(props: PhotoCompareDialogPropsV1) {
	const id = useId(), current = useRef(props); current.current = props;
	const live = useRef(true), candidate = useRef<HTMLElement>(null);
	const focused = useRef<Readonly<{ generation: unknown; element: HTMLElement }> | null>(null);
	const [closed, setClosed] = useState(false), pair = readPair(props);
	const focusId = pair?.candidate.id;
	useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	useLayoutEffect(() => {
		const target = candidate.current;
		if (closed || focusId === undefined || !target || (focused.current?.element === target && focused.current.generation === props.generation)) return;
		target.focus({ preventScroll: true });
		if (target.ownerDocument.activeElement === target) focused.current = { generation: props.generation, element: target };
	}, [closed, focusId, props.generation]);
	const isCurrent = () => live.current && current.current.generation === props.generation
		&& current.current.snapshot === props.snapshot && current.current.rows === props.rows;
	const locked = () => current.current.busy || current.current.snapshot?.pendingPhotoId != null;
	const allowed = () => isCurrent() && !locked() && readPair(current.current) !== null;
	const close = () => {
		if (!isCurrent()) return;
		live.current = false; focused.current = null; setClosed(true); props.onClose();
	};
	const previous = canNavigate(props.snapshot, -1), next = canNavigate(props.snapshot, 1);
	const move = (direction: -1 | 1) => {
		if (!allowed() || !canNavigate(current.current.snapshot, direction)) return;
		if (direction === -1) props.onPrevious(); else props.onNext();
	};
	const action = (kind: 'swap' | 'promote') => {
		if (!allowed()) return;
		if (kind === 'swap') props.onSwap(); else props.onPromote();
	};
	const rate = (row: PhotoLibraryRowV1, value: number) => {
		if (allowed() && Number.isInteger(value) && value >= 0 && value <= 5) props.onRate(row.id, value);
	};
	const flag = (row: PhotoLibraryRowV1, value: string) => {
		if (allowed() && FLAGS.some(item => item === value)) props.onFlag(row.id, value as PhotoLibraryRowV1['flag']);
	};
	const color = (row: PhotoLibraryRowV1, value: string) => {
		if (allowed() && COLORS.some(item => item === value)) props.onColorLabel(row.id, value as PhotoLibraryRowV1['colorLabel']);
	};
	const keyDown = (event: KeyboardEvent<HTMLElement>, row: PhotoLibraryRowV1) => {
		// Focusable descendants keep their own native/editing shortcuts.
		if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey || !allowed()) return;
		const key = event.key.toLowerCase();
		if (/^[0-5]$/u.test(key)) { event.preventDefault(); rate(row, Number(key)); }
		else if (key === 'p' || key === 'x' || key === 'u') { event.preventDefault(); flag(row, key === 'p' ? 'pick' : key === 'x' ? 'reject' : 'unflagged'); }
		else if (key === 'arrowleft' || key === 'arrowright') { event.preventDefault(); move(key === 'arrowleft' ? -1 : 1); }
		else if (key === 's' || key === 'enter') { event.preventDefault(); action(key === 's' ? 'swap' : 'promote'); }
	};
	const { copy } = props, disabled = props.busy || props.snapshot?.pendingPhotoId != null || !pair;
	const side = (name: Side, row: PhotoLibraryRowV1) => {
		const label = name === 'reference' ? copy.photoCompareReference : copy.photoCompareCandidate;
		const target = props.previewTargets.find(item => item.photoId === row.id), pending = !target || target.status === 'pending';
		return <section key={name} ref={name === 'candidate' ? candidate : undefined} className="lightscaper-compare-side"
			data-compare-side={name} role="group" aria-label={`${label}: ${row.fileName}`} tabIndex={0}
			onKeyDown={event => { keyDown(event, row); }}>
			<h3>{label}</h3><strong className="lightscaper-compare-file">{row.fileName}</strong>
			<div className="lightscaper-compare-fit" aria-busy={pending}>{props.renderFitScreen(row.id, `${label}: ${row.fileName}`)}</div>
			{pending && <p role="status">{copy.photoWorking}</p>}
			{(target?.status === 'missing' || target?.status === 'failed') && <p role="status" data-compare-preview-unavailable>{copy.photoPreviewUnavailable}</p>}
			<p className="lightscaper-compare-facts">{copy.photoRating}: {row.rating} · {copy.photoFlag}: {props.flags[row.flag]} · {copy.photoColorLabel}: {props.colorLabels[row.colorLabel]}</p>
			<div className="lightscaper-compare-controls">
				<label>{copy.photoRating}<select data-compare-rating={name} value={row.rating} disabled={disabled}
					onChange={event => { rate(row, Number(event.currentTarget.value)); }}>{[0, 1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
				<label>{copy.photoFlag}<select data-compare-flag={name} value={row.flag} disabled={disabled}
					onChange={event => { flag(row, event.currentTarget.value); }}>{FLAGS.map(value => <option key={value} value={value}>{props.flags[value]}</option>)}</select></label>
				<label>{copy.photoColorLabel}<select data-compare-label={name} value={row.colorLabel} disabled={disabled}
					onChange={event => { color(row, event.currentTarget.value); }}>{COLORS.map(value => <option key={value} value={value}>{props.colorLabels[value]}</option>)}</select></label>
			</div>
		</section>;
	};
	return <AudioEditorDialogShell isOpen={!closed} title={copy.photoCompareTitle} onClose={close}
		className="lightscaper-dialog lightscaper-compare-dialog" overlayClassName="lightscaper-dialog-backdrop"
		width="min(72rem, calc(100vw - 2rem))" closeOnOutside={false} initialFocus={'[data-compare-side="candidate"]'}
		ariaDescribedBy={`${id}-description ${id}-keys`}>
		<div className="lightscaper-compare" data-photo-compare-dialog>
			<p id={`${id}-description`}>{copy.photoCompareDescription}</p>
			{props.error && <p role="alert" data-compare-error>{props.error}</p>}
			{props.notice === 'refresh-failed' && <p role="status" data-compare-notice>{copy.photoCompareRefreshFailed}</p>}
			{props.busy && <p role="status">{copy.photoWorking}</p>}
			{pair ? <div className="lightscaper-compare-pair">{side('reference', pair.reference)}{side('candidate', pair.candidate)}</div>
				: <p role="status">{props.snapshot?.open ? copy.photoCompareUnavailable : copy.photoCompareEmpty}</p>}
			<p id={`${id}-keys`} className="lightscaper-compare-keys">{copy.photoCompareKeys}</p>
			<div className="lightscaper-compare-actions">
				<button type="button" data-compare-previous disabled={disabled || !previous} onClick={() => { move(-1); }}>{copy.photoComparePrevious}</button>
				<button type="button" data-compare-next disabled={disabled || !next} onClick={() => { move(1); }}>{copy.photoCompareNext}</button>
				<button type="button" data-compare-swap disabled={disabled} onClick={() => { action('swap'); }}>{copy.photoCompareSwap}</button>
				<button type="button" data-compare-promote disabled={disabled} onClick={() => { action('promote'); }}>{copy.photoComparePromote}</button>
				<button type="button" data-compare-close onClick={close}>{copy.photoCloseMetadata}</button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}

function readPair(props: PhotoCompareDialogPropsV1): Readonly<{ reference: PhotoLibraryRowV1; candidate: PhotoLibraryRowV1 }> | null {
	const snapshot = props.snapshot;
	if (!snapshot?.open || props.rows.length > 64 || snapshot.photoIds.length > 64 || props.previewTargets.length > 2
		|| snapshot.referenceId === null || snapshot.candidateId === null || snapshot.referenceId === snapshot.candidateId
		|| !snapshot.photoIds.includes(snapshot.referenceId) || !snapshot.photoIds.includes(snapshot.candidateId)) return null;
	const reference = props.rows.find(row => row.id === snapshot.referenceId), candidate = props.rows.find(row => row.id === snapshot.candidateId);
	return reference && candidate ? { reference, candidate } : null;
}
function canNavigate(snapshot: Readonly<PhotoLibraryCompareSnapshotV1> | null, direction: -1 | 1): boolean {
	if (!snapshot?.open || snapshot.photoIds.length > 64) return false;
	const index = snapshot.photoIds.indexOf(snapshot.candidateId ?? '');
	if (index < 0) return false;
	for (let next = index + direction; next >= 0 && next < snapshot.photoIds.length; next += direction) {
		if (snapshot.photoIds[next] !== snapshot.referenceId) return true;
	}
	return false;
}
