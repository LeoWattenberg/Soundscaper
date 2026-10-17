/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { PhotoLibraryOriginalInspectionPageV1, PhotoLibraryOriginalRestorationReceiptV1,
	PhotoLibraryOriginalRestoreTargetV1 } from '../../photo-library-original-recovery-port-v1.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { takeSelectedFile } from '../file-input-selection.ts';
import './photo-original-recovery.css';

export interface PhotoOriginalRecoveryDialogCopyV1 {
	readonly photoOriginalRecoveryTitle: string;
	readonly photoOriginalRecoveryDescription: string;
	readonly photoOriginalInspect: string;
	readonly photoOriginalVerified: string;
	readonly photoOriginalMissing: string;
	readonly photoOriginalCorrupt: string;
	readonly photoOriginalUnsupported: string;
	readonly photoOriginalChooseFile: string;
	readonly photoOriginalRestore: string;
	readonly photoOriginalRestored: string;
	readonly photoOriginalCleanupFailed: string;
	readonly photoOriginalRefreshFailed: string;
	readonly photoOriginalCancelled: string;
	readonly photoOriginalPageSummary: string;
	readonly photoOriginalEmpty: string;
	readonly photoOriginalStartupFailure: string;
	readonly photoNextPage: string;
	readonly photoCloseMetadata: string;
	readonly photoCancelAction: string;
	readonly photoWorking: string;
}
export interface PhotoOriginalRecoveryDialogPropsV1 {
	readonly generation: unknown;
	readonly copy: PhotoOriginalRecoveryDialogCopyV1;
	readonly page: PhotoLibraryOriginalInspectionPageV1 | null;
	readonly receipt: PhotoLibraryOriginalRestorationReceiptV1 | null;
	readonly notice: 'refresh-failed' | null;
	readonly busy: boolean;
	readonly active: boolean;
	readonly cancelled: boolean;
	readonly error: string | null;
	readonly onInspect: (cursor?: string | null) => Promise<void>;
	readonly onRestore: (target: PhotoLibraryOriginalRestoreTargetV1, file: File) => Promise<PhotoLibraryOriginalRestorationReceiptV1 | null>;
	readonly onCancel: () => void;
	readonly onClose: () => void;
}
type Row = PhotoLibraryOriginalInspectionPageV1['rows'][number];
interface Selection {
	readonly page: PhotoLibraryOriginalInspectionPageV1;
	readonly generation: unknown;
	readonly row: Row;
	readonly target: PhotoLibraryOriginalRestoreTargetV1;
}
interface PickedFile { readonly selection: Selection; readonly file: File }

/** Bounded scalar presentation. The injected workflow owns task cancellation and settlement. */
export default function PhotoOriginalRecoveryDialog(props: PhotoOriginalRecoveryDialogPropsV1) {
	const id = useId(), current = useRef(props); current.current = props;
	const live = useRef(true), pending = useRef<object | null>(null);
	const selection = useRef<Selection | null>(null), picker = useRef<Selection | null>(null);
	const selectedFile = useRef<PickedFile | null>(null), input = useRef<HTMLInputElement>(null);
	const inspectButton = useRef<HTMLButtonElement>(null), initiallyFocused = useRef(false);
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);
	const [waiting, setWaiting] = useState(false), [closed, setClosed] = useState(false);
	useLayoutEffect(() => {
		live.current = true;
		return () => { live.current = false; selection.current = null; picker.current = null; selectedFile.current = null; };
	}, []);
	useLayoutEffect(() => {
		selection.current = null; picker.current = null; selectedFile.current = null;
		setSelectedIndex(null); setFileName(null);
	}, [props.page, props.generation]);
	useLayoutEffect(() => {
		const element = input.current, page = props.page, generation = props.generation;
		if (!element) return undefined;
		const cancel = () => {
			if (live.current && current.current.page === page && current.current.generation === generation
				&& input.current === element) picker.current = null;
		};
		element.addEventListener('cancel', cancel);
		return () => { element.removeEventListener('cancel', cancel); };
	}, [props.page, props.generation]);
	useLayoutEffect(() => {
		const button = inspectButton.current;
		if (initiallyFocused.current || props.busy || waiting || !button || button.disabled) return;
		button.focus({ preventScroll: true });
		if (button.ownerDocument.activeElement === button) initiallyFocused.current = true;
	}, [props.busy, waiting]);

	const isCurrent = (source: PhotoOriginalRecoveryDialogPropsV1) => live.current
		&& source.page === current.current.page && source.generation === current.current.generation;
	const locked = () => current.current.busy || current.current.active || pending.current !== null;
	const clearFile = () => { selectedFile.current = null; setFileName(null); };
	const close = () => {
		if (!live.current) return;
		live.current = false; selection.current = null; picker.current = null; clearFile(); setClosed(true);
		current.current.onClose();
	};
	// This latch prevents duplicate presentation callbacks; resource lifetime remains external.
	const invoke = (call: () => Promise<unknown>, after?: () => void) => {
		const job = {}; pending.current = job; setWaiting(true);
		let operation: Promise<unknown>;
		try { operation = call(); } catch { operation = Promise.reject(); }
		void operation.catch(() => undefined).finally(() => {
			if (pending.current !== job) return;
			pending.current = null;
			if (live.current) { after?.(); setWaiting(false); }
		});
	};
	const inspect = (cursor: string | null) => {
		if (!isCurrent(props) || locked()) return;
		picker.current = null; clearFile();
		invoke(() => current.current.onInspect(cursor));
	};
	const restore = () => {
		const picked = selectedFile.current;
		if (!isCurrent(props) || locked() || !picked || picked.selection !== selection.current
			|| picked.selection.page !== props.page || picked.selection.generation !== props.generation) return;
		picker.current = null;
		invoke(() => current.current.onRestore(picked.selection.target, picked.file), () => {
			if (selectedFile.current === picked) clearFile();
		});
	};
	const select = (row: Row, index: number) => {
		const page = props.page;
		if (!isCurrent(props) || locked() || !page || page.rows.length > 64 || !restorable(row)) return;
		picker.current = null; clearFile(); setSelectedIndex(index);
		selection.current = { page, generation: props.generation, row,
			target: Object.freeze({ schemaVersion: 1, catalogRevision: page.revision, activeImportId: page.activeImportId,
				photoRevision: row.revision, binding: row.binding }) };
	};
	const { copy, page, receipt } = props, invalidPage = page !== null && page.rows.length > 64;
	const rows = invalidPage ? [] : page?.rows ?? [], disabled = props.busy || props.active || waiting;
	return <AudioEditorDialogShell isOpen={!closed} title={copy.photoOriginalRecoveryTitle} onClose={close}
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}
		initialFocus="[data-original-inspect]" ariaDescribedBy={`${id}-description`}>
		<div className="lightscaper-original-recovery" data-photo-original-recovery-dialog>
			<p id={`${id}-description`}>{copy.photoOriginalRecoveryDescription}</p>
			{page?.startupFailure && <p>{copy.photoOriginalStartupFailure.replace('{message}', page.startupFailure.message)}</p>}
			{props.error && <p role="alert">{props.error}</p>}
			{invalidPage && <p role="alert">{copy.photoOriginalUnsupported}</p>}
			{disabled && <p role="status">{copy.photoWorking}</p>}
			{props.cancelled && <p role="status">{copy.photoOriginalCancelled}</p>}
			{receipt && <div role="status" data-original-receipt>
				<p>{copy.photoOriginalRestored}</p>
				{receipt.notices.includes('cleanup-failed') && <p>{copy.photoOriginalCleanupFailed}</p>}
			</div>}
			{props.notice === 'refresh-failed' && <p role="status">{copy.photoOriginalRefreshFailed}</p>}
			{page && !invalidPage && <>
				<p>{copy.photoOriginalPageSummary.replace('{count}', String(rows.length))}</p>
				{rows.length === 0 ? <p>{copy.photoOriginalEmpty}</p> : <fieldset disabled={disabled} aria-label={copy.photoOriginalRecoveryTitle}>
					<ul className="lightscaper-original-recovery-list">{rows.map((row, index) => <li key={row.photoId} data-original-row>
						<label><input type="radio" name={`${id}-target`} data-original-target={index}
							checked={selectedIndex === index} disabled={disabled || !restorable(row)} onChange={() => { select(row, index); }} />
							<span>{row.fileName}</span><span className="lightscaper-original-recovery-status">{status(row, copy)}</span>
						</label>
					</li>)}</ul>
				</fieldset>}
			</>}
			<label className="lightscaper-original-recovery-file">{copy.photoOriginalChooseFile}
				<input ref={input} type="file" data-original-file disabled={disabled || selectedIndex === null || invalidPage}
					onClick={event => {
						if (!isCurrent(props) || locked() || !selection.current) { event.preventDefault(); return; }
						picker.current = selection.current;
					}}
					onChange={event => {
						const file = takeSelectedFile(event.currentTarget), captured = picker.current;
						if (!isCurrent(props) || event.currentTarget !== input.current) return;
						picker.current = null;
						if (locked() || !file || !captured || captured !== selection.current
							|| captured.page !== props.page || captured.generation !== props.generation) return;
						selectedFile.current = { selection: captured, file }; setFileName(file.name.slice(0, 512));
					}} />
			</label>
			{fileName !== null && <p data-original-selected-file>{fileName}</p>}
			<div className="lightscaper-original-recovery-actions">
				<button ref={inspectButton} type="button" data-original-inspect disabled={disabled} onClick={() => { inspect(null); }}>{copy.photoOriginalInspect}</button>
				<button type="button" data-original-next disabled={disabled || !page?.cursor || invalidPage}
					onClick={() => { if (page?.cursor) inspect(page.cursor); }}>{copy.photoNextPage}</button>
				<button type="button" data-original-restore disabled={disabled || fileName === null} onClick={restore}>{copy.photoOriginalRestore}</button>
				{props.active && <button type="button" data-original-cancel onClick={() => { if (isCurrent(props) && current.current.active) current.current.onCancel(); }}>{copy.photoCancelAction}</button>}
				<button type="button" data-original-close onClick={close}>{copy.photoCloseMetadata}</button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}

function restorable(row: Row): boolean { return row.inspection.status === 'missing' || row.inspection.status === 'corrupt'; }
function status(row: Row, copy: PhotoOriginalRecoveryDialogCopyV1): string {
	switch (row.inspection.status) {
		case 'present': return copy.photoOriginalVerified;
		case 'missing': return copy.photoOriginalMissing;
		case 'corrupt': return copy.photoOriginalCorrupt;
		case 'unsupported': return copy.photoOriginalUnsupported;
	}
}
