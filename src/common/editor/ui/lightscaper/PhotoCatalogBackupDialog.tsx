/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, useState } from 'react';
import type { PhotoLibraryBackupSaveReceiptV1 } from '../../controller/shared/photo-library-backup-save-v1.ts';
import { SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES } from '../../scape-blob-budget.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import './photo-catalog-backup.css';

export interface PhotoCatalogBackupDialogCopyV1 {
	readonly photoBackupTitle: string;
	readonly photoBackupDescription: string;
	readonly photoBackupSave: string;
	readonly photoBackupClose: string;
	readonly photoBackupPreparing: string;
	readonly photoBackupStreamingLimit: string;
	readonly photoBackupDownloadLimit: string;
	readonly photoBackupSaved: string;
	readonly photoBackupDownloadStarted: string;
	readonly photoBackupCancelled: string;
	readonly photoBackupFailed: string;
	readonly photoBackupCleanupFailed: string;
	readonly photoBackupSummary: string;
	readonly photoWorking: string;
}
export interface PhotoCatalogBackupDialogPropsV1 {
	readonly locale: string;
	readonly copy: PhotoCatalogBackupDialogCopyV1;
	readonly ready: boolean;
	readonly maximumStreamingBytes: number | null;
	readonly busy: boolean;
	readonly error: string | null;
	readonly receipt: PhotoLibraryBackupSaveReceiptV1 | null;
	readonly onSave: () => Promise<PhotoLibraryBackupSaveReceiptV1 | null>;
	readonly onClose: () => void;
}

/** Scalar presentation only. The workflow owns the picker, archive and final destination. */
export default function PhotoCatalogBackupDialog(props: PhotoCatalogBackupDialogPropsV1) {
	const current = useRef(props); current.current = props;
	const live = useRef(true), pending = useRef(false), initiallyFocused = useRef(false);
	const saveButton = useRef<HTMLButtonElement>(null);
	const [saving, setSaving] = useState(false), [failed, setFailed] = useState(false);
	useLayoutEffect(() => {
		live.current = true;
		return () => { live.current = false; };
	}, []);
	useLayoutEffect(() => {
		const button = saveButton.current;
		if (initiallyFocused.current || !props.ready || props.busy || saving || !button || button.disabled) return;
		button.focus({ preventScroll: true });
		if (button.ownerDocument.activeElement === button) initiallyFocused.current = true;
	}, [props.ready, props.busy, saving]);
	const close = () => { if (live.current) { live.current = false; current.current.onClose(); } };
	const save = () => {
		const source = current.current;
		if (!live.current || !source.ready || source.busy || pending.current) return;
		pending.current = true; setSaving(true); setFailed(false);
		// Calling before Promise.resolve preserves the original click's user activation.
		let operation: ReturnType<PhotoCatalogBackupDialogPropsV1['onSave']>;
		try { operation = source.onSave(); } catch { operation = Promise.reject(new Error('Save invocation failed.')); }
		void operation.catch(() => { if (live.current) setFailed(true); }).finally(() => {
			pending.current = false; if (live.current) setSaving(false);
		});
	};
	const { copy, receipt } = props, number = new Intl.NumberFormat(props.locale);
	return <AudioEditorDialogShell title={copy.photoBackupTitle} onClose={close} initialFocus="[data-photo-backup-save]"
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-backup-dialog className="lightscaper-catalog-backup">
			<p>{copy.photoBackupDescription}</p>
			{props.maximumStreamingBytes !== null && <p>{copy.photoBackupStreamingLimit.replace('{bytes}', number.format(props.maximumStreamingBytes))}</p>}
			<p>{copy.photoBackupDownloadLimit.replace('{bytes}', number.format(SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES))}</p>
			{!props.ready && !props.error && <p role="status">{copy.photoBackupPreparing}</p>}
			{(props.busy || saving) && <p role="status">{copy.photoWorking}</p>}
			{(props.error || failed) && <p role="alert">{props.error ?? copy.photoBackupFailed}</p>}
			{receipt && <div role="status" data-photo-backup-receipt data-photo-backup-status={receipt.status}>
				<p>{receipt.status === 'cancelled' ? copy.photoBackupCancelled
					: (receipt.status === 'saved' ? copy.photoBackupSaved : copy.photoBackupDownloadStarted).replace('{name}', receipt.fileName)}</p>
				{receipt.status !== 'cancelled' && <>
					<p>{copy.photoBackupSummary.replace('{count}', number.format(receipt.photoCount)).replace('{bytes}', number.format(receipt.byteLength))}</p>
					{receipt.notices.length > 0 && <p>{copy.photoBackupCleanupFailed}</p>}
				</>}
			</div>}
			<div className="lightscaper-catalog-backup-actions">
				<button ref={saveButton} type="button" data-photo-backup-save disabled={!props.ready || props.busy || saving} onClick={save}>{copy.photoBackupSave}</button>
				<button type="button" data-photo-backup-close onClick={close}>{copy.photoBackupClose}</button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}
