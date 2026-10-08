/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PhotoLibraryStackAcknowledgementV1, PhotoLibraryStackBindingV1, PhotoLibraryStackCommandV1,
	PhotoLibraryStackMembersV1, PhotoLibraryStackSnapshotV1 } from '../../photo-library-stack-port-v1.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import './photo-stack.css';

export interface PhotoStackDialogCopyV1 {
	readonly photoStackTitle: string;
	readonly photoStackDescription: string;
	readonly photoStackCover: string;
	readonly photoStackMakeCover: string;
	readonly photoStackMoveEarlier: string;
	readonly photoStackMoveLater: string;
	readonly photoStackSave: string;
	readonly photoStackDissolve: string;
	readonly photoStackDissolveDescription: string;
	readonly photoStackCreated: string;
	readonly photoStackSaved: string;
	readonly photoStackDissolved: string;
	readonly photoStackRefreshFailed: string;
	readonly photoStackUnavailable: string;
	readonly photoStackPreviousPage: string;
	readonly photoStackNextPage: string;
	readonly photoStackPage: string;
	readonly photoStackReload: string;
	readonly photoStackFailed: string;
	readonly photoCloseMetadata: string;
	readonly photoCancelAction: string;
	readonly photoWorking: string;
	readonly photoOriginalCleanupFailed: string;
}
export interface PhotoStackDialogPropsV1 {
	readonly generation: unknown;
	readonly mode: 'create' | 'edit';
	readonly snapshot: PhotoLibraryStackSnapshotV1 | null;
	readonly selectedIds: readonly string[];
	readonly members: readonly Readonly<{ photoId: string; fileName: string }>[];
	readonly copy: PhotoStackDialogCopyV1;
	readonly busy: boolean;
	readonly error: string | null;
	readonly receipt: PhotoLibraryStackAcknowledgementV1 | null;
	readonly notice: 'refresh-failed' | null;
	readonly onReadMembers: (binding: PhotoLibraryStackBindingV1, ids: readonly string[], signal: AbortSignal) => Promise<PhotoLibraryStackMembersV1>;
	readonly onApply: (command: PhotoLibraryStackCommandV1) => Promise<PhotoLibraryStackAcknowledgementV1 | null>;
	readonly onReload: () => void;
	readonly onCancel: () => void;
	readonly onClose: () => void;
}

/** One ordered scalar draft; only its current64 names are retained and rendered. */
export default function PhotoStackDialog(props: PhotoStackDialogPropsV1) {
	const [closed, setClosed] = useState(false), owner = useRef({ props, live: true });
	owner.current.props = props;
	const identity = useRef({ generation: props.generation, snapshot: props.snapshot, version: 0 });
	if (!Object.is(identity.current.generation, props.generation) || identity.current.snapshot !== props.snapshot) {
		identity.current = { generation: props.generation, snapshot: props.snapshot, version: identity.current.version + 1 };
	}
	useEffect(() => { const state = owner.current; state.live = true; return () => { state.live = false; }; }, []);
	const current = () => owner.current.live && !closed && Object.is(owner.current.props.generation, props.generation)
		&& owner.current.props.snapshot === props.snapshot && owner.current.props.mode === props.mode;
	const close = () => { if (current()) { owner.current.live = false; setClosed(true); props.onClose(); } };
	if (closed) return null;
	const ids = props.mode === 'create' ? props.selectedIds : props.snapshot?.stack?.photoIds ?? [];
	const admitted = props.snapshot !== null && ids.length >= 2 && ids.length <= (props.mode === 'create' ? 64 : 1024)
		&& new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128)
		&& props.members.length <= 64 && (props.mode === 'create' || props.snapshot.stack !== null);
	return <AudioEditorDialogShell title={props.copy.photoStackTitle} onClose={close} initialFocus="button[data-stack-cover]:not([disabled])"
		className="lightscaper-dialog lightscaper-stack-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-stack-dialog><p>{props.copy.photoStackDescription}</p>
		{props.error && <p role="alert" data-stack-error>{props.error}</p>}
		{props.notice && <p role="status" data-stack-notice>{props.copy.photoStackRefreshFailed}</p>}
		{props.receipt && <p role="status" data-stack-ack>{props.receipt.action === 'created' ? props.copy.photoStackCreated
			: props.receipt.action === 'dissolved' ? props.copy.photoStackDissolved : props.copy.photoStackSaved}</p>}
		{props.receipt?.notices.includes('cleanup-failed') && <p role="status">{props.copy.photoOriginalCleanupFailed}</p>}
		{admitted && props.snapshot ? <StackDraft key={identity.current.version} {...props} snapshot={props.snapshot}
			ids={ids} current={current} close={close} /> : <>
			<p role="status">{props.busy ? props.copy.photoWorking : props.copy.photoStackUnavailable}</p>
			<button type="button" data-stack-reload disabled={props.busy} onClick={() => { if (current()) props.onReload(); }}>{props.copy.photoStackReload}</button>
			<button type="button" data-stack-close onClick={close}>{props.copy.photoCloseMetadata}</button>
		</>}
		</div>
	</AudioEditorDialogShell>;
}

function StackDraft(props: PhotoStackDialogPropsV1 & Readonly<{ snapshot: PhotoLibraryStackSnapshotV1;
	ids: readonly string[]; current: () => boolean; close: () => void }>) {
	const { copy, snapshot } = props;
	const [ids, setIds] = useState<readonly string[]>(() => Object.freeze([...props.ids]));
	const [cover, setCover] = useState(snapshot.stack?.coverPhotoId ?? props.ids[0]!);
	const [offset, setOffset] = useState(0), [names, setNames] = useState(props.members);
	const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
	const active = useRef(false), live = useRef(true), read = useRef<AbortController | null>(null), first = useRef<HTMLButtonElement>(null), focused = useRef(false);
	const latest = useRef(props); latest.current = props;
	useEffect(() => { live.current = true; return () => { live.current = false; read.current?.abort(); }; }, []);
	const current = () => live.current && props.current() && latest.current.snapshot === snapshot;
	const locked = props.busy || pending || props.receipt !== null;
	useLayoutEffect(() => {
		const target = first.current;
		if (locked || focused.current || !target || !live.current || !props.current()) return;
		target.focus();
		if (target.ownerDocument.activeElement === target) focused.current = true;
	}, [locked, props]);
	const binding: PhotoLibraryStackBindingV1 | null = snapshot.stack ? Object.freeze({ schemaVersion: 1,
		catalogId: snapshot.context.catalogId, catalogRevision: snapshot.context.catalogRevision, indexRevision: snapshot.context.indexRevision,
		stateRevision: snapshot.context.stateRevision, stackId: snapshot.stack.id, stackRevision: snapshot.stack.revision }) : null;
	const page = async (nextOffset: number, nextIds = ids) => {
		if (!current() || locked || active.current || !binding) return;
		active.current = true; const controller = new AbortController(); read.current = controller; setPending(true); setError(null);
		const selected = Object.freeze(nextIds.slice(nextOffset, nextOffset + 64));
		try {
			const result = await props.onReadMembers(binding, selected, controller.signal); controller.signal.throwIfAborted();
			if (!current()) return;
			if (result.context.catalogId !== binding.catalogId || result.context.catalogRevision !== binding.catalogRevision
				|| result.context.indexRevision !== binding.indexRevision || result.context.stateRevision !== binding.stateRevision
				|| result.rows.length !== selected.length || result.rows.some((row, index) => row.photoId !== selected[index])) {
				throw new Error(copy.photoStackUnavailable);
			}
			setNames(result.rows); setOffset(nextOffset);
		} catch (failure) { if (current() && !controller.signal.aborted) setError(message(failure, copy.photoStackFailed)); }
		finally { active.current = false; if (read.current === controller) read.current = null; if (current()) setPending(false); }
	};
	const move = (index: number, delta: number) => {
		if (!current() || locked || active.current || index + delta < 0 || index + delta >= ids.length) return;
		const next = [...ids]; [next[index], next[index + delta]] = [next[index + delta]!, next[index]!]; setIds(Object.freeze(next));
		if (next.slice(offset, offset + 64).some(id => !names.some(row => row.photoId === id))) void page(offset, next);
	};
	const publish = async (dissolve = false) => {
		if (!current() || locked || active.current) return;
		const base = { schemaVersion: 1 as const, catalogId: snapshot.context.catalogId,
			expectedCatalogRevision: snapshot.context.catalogRevision, expectedStateRevision: snapshot.context.stateRevision };
		const command: PhotoLibraryStackCommandV1 = snapshot.stack
			? dissolve ? { ...base, type: 'dissolve', id: snapshot.stack.id, expectedStackRevision: snapshot.stack.revision }
				: { ...base, type: 'update', id: snapshot.stack.id, expectedStackRevision: snapshot.stack.revision, photoIds: Object.freeze([...ids]), coverPhotoId: cover }
			: { ...base, type: 'create', photoIds: Object.freeze([...ids]), coverPhotoId: cover };
		active.current = true; setPending(true); setError(null);
		try { await props.onApply(Object.freeze(command)); }
		catch (failure) { if (current()) setError(message(failure, copy.photoStackFailed)); }
		finally { active.current = false; if (current()) setPending(false); }
	};
	return <>
		{(pending || props.busy) && <p role="status">{copy.photoWorking}</p>}
		{error && <p role="alert">{error}</p>}
		<p data-stack-page>{copy.photoStackPage.replace('{from}', String(offset + 1))
			.replace('{to}', String(Math.min(offset + 64, ids.length))).replace('{count}', String(ids.length))}</p>
		<ol className="lightscaper-stack-members" start={offset + 1}>
			{ids.slice(offset, offset + 64).map((id, localIndex) => {
				const name = names.find(row => row.photoId === id)?.fileName ?? copy.photoStackUnavailable, index = offset + localIndex;
				return <li key={id} data-stack-member={id}><span>{name}</span>{id === cover && <strong>{copy.photoStackCover}</strong>}
					<div><button ref={localIndex === 0 ? first : undefined} type="button" data-stack-cover={id} disabled={locked}
						onClick={() => { if (current() && !locked && !active.current) setCover(id); }}>{copy.photoStackMakeCover}</button>
						<button type="button" data-stack-earlier={id} disabled={locked || index === 0} onClick={() => { move(index, -1); }}>{copy.photoStackMoveEarlier}</button>
						<button type="button" data-stack-later={id} disabled={locked || index === ids.length - 1} onClick={() => { move(index, 1); }}>{copy.photoStackMoveLater}</button>
					</div></li>;
			})}
		</ol>
		<div className="lightscaper-dialog-actions">
			<button type="button" data-stack-previous disabled={locked || offset === 0} onClick={() => { void page(offset - 64); }}>{copy.photoStackPreviousPage}</button>
			<button type="button" data-stack-next disabled={locked || offset + 64 >= ids.length} onClick={() => { void page(offset + 64); }}>{copy.photoStackNextPage}</button>
			<button type="button" data-stack-save disabled={locked} onClick={() => { void publish(); }}>{copy.photoStackSave}</button>
			{snapshot.stack && <button type="button" data-stack-dissolve disabled={locked} onClick={() => { void publish(true); }}>{copy.photoStackDissolve}</button>}
			<button type="button" data-stack-reload disabled={props.busy || pending} onClick={() => { if (current() && !active.current) props.onReload(); }}>{copy.photoStackReload}</button>
			{(props.busy || pending) && <button type="button" data-stack-cancel onClick={() => { if (current()) props.onCancel(); }}>{copy.photoCancelAction}</button>}
			<button type="button" data-stack-close onClick={props.close}>{copy.photoCloseMetadata}</button>
		</div>
		{snapshot.stack && <p>{copy.photoStackDissolveDescription}</p>}
	</>;
}
function message(value: unknown, fallback: string): string {
	try { const field = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'message') : undefined;
		if (field && Object.hasOwn(field, 'value') && typeof field.value === 'string') return field.value.slice(0, 2048);
	} catch { /* Caller errors cannot revoke a durable acknowledgment. */ }
	return fallback;
}
