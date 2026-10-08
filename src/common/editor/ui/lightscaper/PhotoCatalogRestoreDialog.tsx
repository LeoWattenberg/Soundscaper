/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import type { PhotoLibraryRestoreCopyV1 } from '../../../i18n/lightscaper-restore-copy.ts';
import type { PhotoLibraryRestoreReceiptV1 } from '../../photo-library-restore-port-v1.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import './photo-catalog-restore.css';

export interface PhotoCatalogRestoreDialogPropsV1 {
	readonly locale: string;
	readonly copy: PhotoLibraryRestoreCopyV1;
	readonly ready: boolean;
	readonly busy: boolean;
	readonly cancelling: boolean;
	readonly cancelled: boolean;
	readonly receipt: Readonly<PhotoLibraryRestoreReceiptV1> | null;
	readonly error: string | null;
	readonly onRestore: (file: File) => Promise<Readonly<PhotoLibraryRestoreReceiptV1> | null>;
	readonly onCancel: () => Promise<void>;
	readonly onClose: () => void;
}

/** Closing hides presentation only; explicit Cancel belongs to the stable restore owner. */
export default function PhotoCatalogRestoreDialog(props: PhotoCatalogRestoreDialogPropsV1) {
	const [file, setFile] = useState<File | null>(null), { copy, receipt } = props;
	const live = useRef(true);
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const close = () => { if (!live.current) return; live.current = false; props.onClose(); };
	const number = new Intl.NumberFormat(props.locale);
	const summary = receipt ? copy.summary.replace('{photos}', number.format(receipt.photoCount)).replace('{stacks}', number.format(receipt.stackCount))
		.replace('{filters}', number.format(receipt.savedCollectionCount)).replace('{originals}', number.format(receipt.originalCount)).replace('{bytes}', number.format(receipt.originalByteLength)) : null;
	return <AudioEditorDialogShell title={copy.title} onClose={close} initialFocus="[data-photo-restore-file]"
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-restore-dialog className="lightscaper-catalog-restore">
			<p>{copy.description}</p>
			<label>{copy.file}<input data-photo-restore-file type="file" accept=".liscape,.scape" disabled={props.busy}
				onChange={event => { if (live.current && !props.busy) setFile(event.currentTarget.files?.[0] ?? null); }} /></label>
			{props.busy && <p role="status">{copy.working}</p>}
			{props.cancelled && !props.busy && <p role="status">{copy.cancelled}</p>}
			{props.error && <p role="alert">{props.error}</p>}
			{receipt && <div data-photo-restore-receipt role="status">
				<p>{copy.acknowledged.replace('{name}', receipt.catalogName)}</p><p>{summary}</p>
				{receipt.notices.includes('cleanup-failed') && <p>{copy.cleanupFailed}</p>}
				{receipt.notices.includes('publication-reconciled') && <p>{copy.publicationReconciled}</p>}
			</div>}
			<div className="lightscaper-catalog-restore-actions">
				<button data-photo-restore-start type="button" disabled={!props.ready || props.busy || !file}
					onClick={() => { if (live.current && file && props.ready && !props.busy) void props.onRestore(file); }}>{copy.restore}</button>
				<button data-photo-restore-cancel type="button" disabled={!props.busy || props.cancelling}
					onClick={() => { if (live.current && props.busy && !props.cancelling) void props.onCancel(); }}>{copy.cancel}</button>
				<button data-photo-restore-close type="button" onClick={close}>{copy.close}</button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}
