/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoLibraryDefinitionAcknowledgementV1, PhotoLibraryDefinitionCommandV1, PhotoLibraryDefinitionReadRequestV1,
	PhotoLibraryDefinitionSnapshotV1 } from '../../photo-library-organization-port-v1.ts';
import type { PhotoLibraryDefinitionKindV1, PhotoLibraryDefinitionPageRequestV1, PhotoLibraryDefinitionPageV1 } from '../../photo-library-session-port-v1.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PhotoDefinitionSelector, { type PhotoDefinitionSelectorCopyV1 } from './PhotoDefinitionSelector.tsx';
import PhotoSmartQueryGrammarHelp from './PhotoSmartQueryGrammarHelp.tsx';

export interface PhotoCatalogOrganizerDialogCopyV1 extends PhotoDefinitionSelectorCopyV1 {
	readonly photoCloseMetadata: string;
	readonly photoOrganizerTitle: string;
	readonly photoOrganizerKind: string;
	readonly photoOrganizerFolder: string;
	readonly photoOrganizerKeyword: string;
	readonly photoOrganizerCollection: string;
	readonly photoOrganizerCreate: string;
	readonly photoOrganizerEdit: string;
	readonly photoOrganizerName: string;
	readonly photoOrganizerId: string;
	readonly photoOrganizerParent: string;
	readonly photoOrganizerRename: string;
	readonly photoOrganizerReparent: string;
	readonly photoOrganizerDeleteEmpty: string;
	readonly photoOrganizerReload: string;
	readonly photoOrganizerManual: string;
	readonly photoOrganizerSmart: string;
	readonly photoOrganizerQueryJson: string;
	readonly photoOrganizerQueryGrammar: string;
	readonly photoOrganizerSaveCollection: string;
}

export interface PhotoCatalogOrganizerDialogPropsV1 {
	readonly copy: PhotoCatalogOrganizerDialogCopyV1;
	readonly busy: boolean;
	readonly error: string | null;
	readonly readDefinitions: (request: PhotoLibraryDefinitionPageRequestV1) => Promise<PhotoLibraryDefinitionPageV1>;
	readonly readDefinition: (request: PhotoLibraryDefinitionReadRequestV1) => Promise<PhotoLibraryDefinitionSnapshotV1>;
	readonly onApply: (revision: number, command: PhotoLibraryDefinitionCommandV1) => Promise<PhotoLibraryDefinitionAcknowledgementV1>;
	readonly createId: () => string;
	readonly onClose: () => void;
}

/** One definition draft, one scalar picker and an explicit expected root revision. */
export default function PhotoCatalogOrganizerDialog(props: PhotoCatalogOrganizerDialogPropsV1) {
	const { copy, readDefinition, readDefinitions } = props;
	const [kind, setKind] = useState<PhotoLibraryDefinitionKindV1>('folder');
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [snapshot, setSnapshot] = useState<PhotoLibraryDefinitionSnapshotV1 | null>(null);
	const [revision, setRevision] = useState<number | null>(null);
	const [name, setName] = useState('');
	const [parentId, setParentId] = useState<string | null>(null);
	const [collectionKind, setCollectionKind] = useState<'manual' | 'smart'>('manual');
	const [queryJson, setQueryJson] = useState('');
	const [pickingParent, setPickingParent] = useState(false);
	const [reload, setReload] = useState(0);
	const [loading, setLoading] = useState(false), [writing, setWriting] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const draftId = useRef<string | null>(null), alive = useRef(true), generation = useRef({ epoch: 0 });
	useEffect(() => { const state = generation.current; alive.current = true; return () => { alive.current = false; state.epoch++; }; }, []);
	useEffect(() => {
		if (selectedId === null) return;
		const controller = new AbortController(); let live = true;
		void Promise.resolve().then(async () => {
			if (!live) return;
			setLoading(true); setFailure(null);
			try {
				const next = await readDefinition({ kind, id: selectedId, signal: controller.signal });
				if (!live || controller.signal.aborted) return;
				setSnapshot(next); setRevision(next.rootRevision); setName(next.row.name); draftId.current = next.row.id;
				setParentId(next.row.kind === 'collection' ? null : next.row.parentId);
				setCollectionKind(next.row.kind === 'collection' ? next.row.collectionKind : 'manual'); setQueryJson(next.queryJson ?? '');
			} catch (error) { if (live && !controller.signal.aborted) setFailure(message(error, copy.photoDefinitionFailed)); }
			finally { if (live) setLoading(false); }
		});
		return () => { live = false; controller.abort(); };
	}, [selectedId, kind, reload, readDefinition, copy.photoDefinitionFailed]);
	const readPage = useCallback(async (request: PhotoLibraryDefinitionPageRequestV1) => {
		const page = await readDefinitions(request);
		if (alive.current && !request.signal?.aborted) setRevision(previous => previous ?? page.rootRevision);
		return page;
	}, [readDefinitions]);
	const locked = props.busy || writing, pending = locked || loading;
	const reset = (nextKind = kind) => {
		generation.current.epoch++; setKind(nextKind); setSelectedId(null); setSnapshot(null); setRevision(null); setName('');
		setParentId(null); setCollectionKind('manual'); setQueryJson(''); setPickingParent(false); setFailure(null); setLoading(false);
		draftId.current = null; setReload(previous => previous + 1);
	};
	const publish = async (command: PhotoLibraryDefinitionCommandV1) => {
		if (pending || revision === null) return;
		const stamp = generation.current.epoch; setWriting(true); setFailure(null);
		try {
			const ack = await props.onApply(revision, command);
			if (!alive.current || stamp !== generation.current.epoch) return;
			setRevision(ack.rootRevision);
			if (ack.row) {
				setSelectedId(ack.row.id); setSnapshot({ rootRevision: ack.rootRevision, row: ack.row,
					queryJson: 'collection' in command && command.collection.kind === 'smart' ? command.collection.queryJson : null });
			} else reset();
		} catch (error) { if (alive.current && stamp === generation.current.epoch) setFailure(message(error, copy.photoDefinitionFailed)); }
		finally { if (alive.current) setWriting(false); }
	};
	const submit = () => {
		if (pending || revision === null || selectedId && !snapshot) return;
		const key = selectedId ?? (draftId.current ??= props.createId());
		if (kind === 'collection') {
			const collection = collectionKind === 'manual' ? { id: key, name, kind: collectionKind }
				: { id: key, name, kind: collectionKind, queryJson };
			void publish({ type: selectedId ? 'update-collection' : 'create-collection', collection });
		} else if (selectedId) void publish({ type: 'rename-node', nodeKind: kind, id: key, name });
		else void publish({ type: 'create-node', nodeKind: kind, id: key, name, parentId });
	};
	return <AudioEditorDialogShell title={copy.photoOrganizerTitle} onClose={props.onClose} initialFocus="input[name=definitionName]"
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		{(failure || props.error) && <p role="alert">{failure || props.error}</p>}
		{pending && <p role="status">{copy.photoWorking}</p>}
		<label>{copy.photoOrganizerKind}<select name="organizerKind" value={kind} disabled={locked}
			onChange={event => { reset(event.currentTarget.value as PhotoLibraryDefinitionKindV1); }}>
			<option value="folder">{copy.photoOrganizerFolder}</option><option value="keyword">{copy.photoOrganizerKeyword}</option>
			<option value="collection">{copy.photoOrganizerCollection}</option>
		</select></label>
		<button type="button" data-organizer-create disabled={locked} onClick={() => { reset(); }}>{copy.photoOrganizerCreate}</button>
		<fieldset disabled={locked}>
			<PhotoDefinitionSelector key={`${kind}:${String(reload)}:${String(pickingParent)}`} kind={kind} copy={copy}
				selectedId={pickingParent ? parentId : selectedId} readPage={readPage} onSelect={row => {
					if (pickingParent) { setParentId(row?.id ?? null); setPickingParent(false); }
					else if (row) {
						if (row.id === selectedId && snapshot) return;
						generation.current.epoch++; setSnapshot(null); setFailure(null);
						if (row.id === selectedId) setReload(previous => previous + 1); else setSelectedId(row.id);
					}
					else reset();
				}} />
		</fieldset>
		{snapshot && <p data-organizer-selected>{copy.photoOrganizerEdit}: {snapshot.row.name} ({copy.photoOrganizerId}: {snapshot.row.id})</p>}
		<form onSubmit={event => { event.preventDefault(); submit(); }}>
			<label>{copy.photoOrganizerName}<input name="definitionName" value={name} required maxLength={256} disabled={loading || writing}
				onChange={event => { setName(event.currentTarget.value); }} /></label>
			{kind !== 'collection' && <div><p>{copy.photoOrganizerParent}: {parentId ?? copy.photoDefinitionRoot}</p>
				<button type="button" disabled={pending} onClick={() => { setPickingParent(previous => !previous); }}>{copy.photoOrganizerParent}</button></div>}
			{kind === 'collection' && <>
				<label>{copy.photoOrganizerKind}<select name="collectionKind" value={collectionKind} disabled={pending || selectedId !== null}
					onChange={event => { setCollectionKind(event.currentTarget.value as 'manual' | 'smart'); }}>
					<option value="manual">{copy.photoOrganizerManual}</option><option value="smart">{copy.photoOrganizerSmart}</option>
				</select></label>
				{collectionKind === 'smart' && <><PhotoSmartQueryGrammarHelp text={copy.photoOrganizerQueryGrammar} /><label>{copy.photoOrganizerQueryJson}
					<textarea name="queryJson" value={queryJson} maxLength={2_097_152} disabled={loading || writing}
						onChange={event => { setQueryJson(event.currentTarget.value); }} /></label></>}
			</>}
			<div className="lightscaper-dialog-actions">
				<button type="submit" disabled={pending || revision === null || Boolean(selectedId && !snapshot)}>
					{!selectedId ? copy.photoOrganizerCreate : kind === 'collection' ? copy.photoOrganizerSaveCollection : copy.photoOrganizerRename}</button>
				{selectedId && kind !== 'collection' && <>
					<button type="button" disabled={pending || !snapshot} onClick={() => { void publish({ type: 'reparent-node', nodeKind: kind, id: selectedId, parentId }); }}>{copy.photoOrganizerReparent}</button>
					<button type="button" disabled={pending || !snapshot} onClick={() => { void publish({ type: 'delete-empty-node', nodeKind: kind, id: selectedId }); }}>{copy.photoOrganizerDeleteEmpty}</button>
				</>}
				<button type="button" data-organizer-reload disabled={pending} onClick={() => { setRevision(null); setReload(previous => previous + 1); }}>{copy.photoOrganizerReload}</button>
				<button type="button" onClick={props.onClose}>{copy.photoCloseMetadata}</button>
			</div>
		</form>
	</AudioEditorDialogShell>;
}

function message(error: unknown, fallback: string): string {
	const entry = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
	return entry && Object.hasOwn(entry, 'value') && typeof entry.value === 'string' ? entry.value.slice(0, 2_048) : fallback;
}
