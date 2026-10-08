/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef, useState } from 'react';
import type { PhotoLibraryBatchRenamePlanV1, PhotoLibraryBatchRenameReceiptV1, PhotoLibraryBatchRenameRequestV1,
	PhotoLibraryBatchRenameSnapshotV1 } from '../../photo-library-batch-rename-port-v1.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PhotoNameTemplateFields, { type PhotoNameTemplateFieldsCopyV1 } from './PhotoNameTemplateFields.tsx';
import PhotoBatchRenameResults, { type PhotoBatchRenameResultsCopyV1 } from './PhotoBatchRenameResults.tsx';
import type { PhotoLibraryBatchRenameWorkflowReceiptV1 } from './use-photo-library-workflow.ts';
import './photo-batch-rename.css';

const DEFAULT_RENAME = Object.freeze({ template: '{stem}-{sequence}.{extension}', sequenceStart: 1, sequencePadding: 3 });
export interface PhotoBatchRenameDialogCopyV1 extends PhotoNameTemplateFieldsCopyV1, PhotoBatchRenameResultsCopyV1 {
	readonly photoBatchRenameTitle: string;
	readonly photoBatchRenamePreview: string;
	readonly photoBatchRenameAction: string;
	readonly photoBatchRenameClose: string;
	readonly photoBatchRenameCount: string;
	readonly photoWorking: string;
	readonly photoCancelAction: string;
}
export interface PhotoBatchRenameDialogPropsV1 {
	readonly snapshot: PhotoLibraryBatchRenameSnapshotV1 | null;
	readonly busy: boolean;
	readonly error: string | null;
	readonly copy: PhotoBatchRenameDialogCopyV1;
	readonly onPlan: (request: PhotoLibraryBatchRenameRequestV1) => PhotoLibraryBatchRenamePlanV1;
	readonly onApply: (plan: PhotoLibraryBatchRenamePlanV1, options?: Readonly<{ signal?: AbortSignal }>) => Promise<PhotoLibraryBatchRenameWorkflowReceiptV1>;
	readonly onClose: () => void;
}
interface Generation {
	readonly key: number;
	readonly snapshot: PhotoLibraryBatchRenameSnapshotV1 | null;
	live: boolean;
	busy: boolean;
	acknowledged: boolean;
	plan: PhotoLibraryBatchRenamePlanV1 | null;
	active: AbortController | null;
}

/** The captured scalar snapshot owns this opt-in form; the workflow owns durable edits. */
export default function PhotoBatchRenameDialog(props: PhotoBatchRenameDialogPropsV1) {
	const slot = useRef<Generation>({ key: 0, snapshot: props.snapshot, live: true, busy: props.busy, acknowledged: false, plan: null, active: null });
	if (slot.current.snapshot !== props.snapshot) {
		slot.current.live = false;
		slot.current = { key: slot.current.key + 1, snapshot: props.snapshot, live: true, busy: props.busy, acknowledged: false, plan: null, active: null };
	}
	const generation = slot.current;
	generation.busy = props.busy;
	const isCurrent = () => slot.current === generation && generation.live;
	useLayoutEffect(() => {
		generation.live = true;
		return () => { generation.live = false; generation.active?.abort(); };
	}, [generation]);
	const close = () => {
		if (!isCurrent()) return;
		generation.live = false; generation.active?.abort(); props.onClose();
	};
	return <AudioEditorDialogShell title={props.copy.photoBatchRenameTitle} onClose={close} initialFocus="[data-batch-rename-template]"
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		{props.snapshot ? <RenameDraft key={generation.key} {...props} snapshot={props.snapshot} generation={generation} isCurrent={isCurrent} close={close} />
			: <>{props.error && <p role="alert">{props.error}</p>}{props.busy && <p role="status">{props.copy.photoWorking}</p>}
				<button type="button" data-batch-rename-close onClick={close}>{props.copy.photoBatchRenameClose}</button></>}
	</AudioEditorDialogShell>;
}

function RenameDraft(props: PhotoBatchRenameDialogPropsV1 & Readonly<{ snapshot: PhotoLibraryBatchRenameSnapshotV1;
	generation: Generation; isCurrent: () => boolean; close: () => void }>) {
	const { copy, generation, isCurrent, busy } = props;
	const [rename, setRename] = useState<PhotoLibraryBatchRenameRequestV1['rename']>(DEFAULT_RENAME);
	const [plan, setPlan] = useState<PhotoLibraryBatchRenamePlanV1 | null>(null);
	const [receipt, setReceipt] = useState<PhotoLibraryBatchRenameReceiptV1 | null>(null);
	const [notice, setNotice] = useState<'refresh-failed' | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const form = useRef<HTMLFormElement>(null), initiallyFocused = useRef(false);
	useLayoutEffect(() => {
		if (initiallyFocused.current || busy || !isCurrent()) return;
		const input = form.current?.querySelector<HTMLInputElement>('[data-batch-rename-template]');
		if (!input || input.disabled) return;
		input.focus({ preventScroll: true });
		if (input.ownerDocument.activeElement === input) initiallyFocused.current = true;
	}, [busy, isCurrent]);
	const blocked = props.busy || pending || receipt !== null;
	const canStart = () => props.isCurrent() && !generation.busy && generation.active === null && !generation.acknowledged;
	const preview = () => {
		if (!canStart()) return;
		const active = new AbortController(); generation.active = active; setError(null);
		try {
			const next = props.onPlan(Object.freeze({ ...props.snapshot, rename: Object.freeze({ ...rename }) }));
			if (props.isCurrent()) { generation.plan = next; setPlan(next); }
		} catch (failure) { if (props.isCurrent()) setError(failureMessage(failure, copy.photoBatchFailed)); }
		finally { if (generation.active === active) generation.active = null; }
	};
	const apply = async () => {
		if (!plan || generation.plan !== plan || !canStart()) return;
		const active = new AbortController(); generation.active = active;
		setPending(true); setCancelling(false); setError(null);
		try {
			const result = await props.onApply(plan, { signal: active.signal });
			if (!props.isCurrent()) return;
			// An abort may stop later slots; it cannot revoke a durable returned receipt.
			if (result.outcome === 'acknowledged') {
				generation.acknowledged = true; generation.plan = null; setReceipt(result.receipt); setNotice(result.notice); setPlan(null);
			}
		} catch (failure) { if (props.isCurrent()) setError(failureMessage(failure, copy.photoBatchFailed)); }
		finally {
			if (generation.active === active) generation.active = null;
			if (props.isCurrent()) { setPending(false); setCancelling(false); }
		}
	};
	return <form ref={form} onSubmit={event => { event.preventDefault(); preview(); }} data-batch-rename-form aria-busy={pending || props.busy}>
		<p>{copy.photoBatchRenameCount.replace('{count}', String(props.snapshot.selection.length))}</p>
		{(error || props.error) && <p role="alert">{error || props.error}</p>}
		{(pending || props.busy) && <p role="status">{copy.photoWorking}</p>}
		<PhotoNameTemplateFields value={rename} copy={copy} busy={blocked} dataPrefix="batch-rename" onChange={next => {
			if (!canStart()) return;
			generation.plan = null; setRename(next); setPlan(null); setError(null);
		}} />
		{plan && <table className="lightscaper-batch-rename-table">
			<thead><tr><th scope="col">{copy.photoBatchCurrentName}</th><th scope="col">{copy.photoBatchNewName}</th></tr></thead>
			<tbody>{plan.items.map(item => <tr key={item.index} data-batch-rename-plan-row>
				<td>{item.sourceFileName}</td><td>{item.fileName}</td>
			</tr>)}</tbody>
		</table>}
		{receipt && <PhotoBatchRenameResults receipt={receipt} notice={notice} copy={copy} />}
		<div className="lightscaper-dialog-actions">
			<button type="submit" data-batch-rename-preview disabled={blocked}>{copy.photoBatchRenamePreview}</button>
			<button type="button" data-batch-rename-apply disabled={blocked || plan === null} onClick={() => { void apply(); }}>{copy.photoBatchRenameAction}</button>
			{pending && <button type="button" data-batch-rename-cancel disabled={cancelling} onClick={() => {
				if (!props.isCurrent() || generation.active === null) return;
				generation.active.abort(); setCancelling(true);
			}}>{copy.photoCancelAction}</button>}
			<button type="button" data-batch-rename-close onClick={props.close}>{copy.photoBatchRenameClose}</button>
		</div>
	</form>;
}

function failureMessage(failure: unknown, fallback: string): string {
	try {
		const descriptor = failure && typeof failure === 'object' ? Object.getOwnPropertyDescriptor(failure, 'message') : undefined;
		const text = descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
			? descriptor.value : typeof failure === 'string' ? failure : fallback;
		return text.slice(0, 2_048);
	} catch { return fallback.slice(0, 2_048); }
}
