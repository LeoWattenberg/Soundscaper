/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useState } from 'react';
import type { PhotoLibraryDefinitionReader } from '../../controller/shared/photo-library-definition-reader.ts';
import type { PhotoLibraryDefinitionReadRequestV1, PhotoLibraryDefinitionSnapshotV1, PhotoLibraryMembershipPatchV1,
	PhotoLibraryMembershipSnapshotV1 } from '../../photo-library-organization-port-v1.ts';
import type { PhotoLibraryDefinitionKindV1, PhotoLibraryDefinitionPageRequestV1, PhotoLibraryDefinitionPageV1,
	PhotoLibraryDefinitionRowV1 } from '../../photo-library-session-port-v1.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PhotoDefinitionSelector, { type PhotoDefinitionSelectorCopyV1 } from './PhotoDefinitionSelector.tsx';
import PhotoMembershipNames from './PhotoMembershipNames.tsx';

export interface PhotoMembershipDialogCopyV1 extends PhotoDefinitionSelectorCopyV1 {
	readonly photoCloseMetadata: string;
	readonly photoMembershipTitle: string;
	readonly photoMembershipFolder: string;
	readonly photoMembershipKeywords: string;
	readonly photoMembershipCollections: string;
	readonly photoMembershipAdd: string;
	readonly photoMembershipRemove: string;
	readonly photoMembershipClearFolder: string;
	readonly photoMembershipApply: string;
	readonly photoMembershipNone: string;
	readonly photoMembershipManualOnly: string;
	readonly photoMembershipPrevious: string;
}

export interface PhotoMembershipDialogPropsV1 {
	readonly snapshot: PhotoLibraryMembershipSnapshotV1 | null;
	readonly copy: PhotoMembershipDialogCopyV1;
	readonly busy: boolean;
	readonly error: string | null;
	readonly readDefinitions: (request: PhotoLibraryDefinitionPageRequestV1) => Promise<PhotoLibraryDefinitionPageV1>;
	readonly readDefinition: (request: PhotoLibraryDefinitionReadRequestV1) => Promise<PhotoLibraryDefinitionSnapshotV1>;
	readonly definitionReader: Pick<PhotoLibraryDefinitionReader, 'read'>;
	readonly onApply: (photoId: string, expectedRevision: number, changes: PhotoLibraryMembershipPatchV1) => void;
	readonly onClose: () => void;
}

export default function PhotoMembershipDialog(props: PhotoMembershipDialogPropsV1) {
	return <AudioEditorDialogShell title={props.copy.photoMembershipTitle} onClose={props.onClose} initialFocus="select[name=membershipKind]"
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		{props.error && <p role="alert">{props.error}</p>}{props.busy && <p role="status">{props.copy.photoWorking}</p>}
		{props.snapshot && <MembershipDraft key={`${props.snapshot.photoId}:${String(props.snapshot.revision)}`} {...props} snapshot={props.snapshot} />}
		{!props.snapshot && <button type="button" onClick={props.onClose}>{props.copy.photoCloseMetadata}</button>}
	</AudioEditorDialogShell>;
}

function MembershipDraft(props: PhotoMembershipDialogPropsV1 & Readonly<{ snapshot: PhotoLibraryMembershipSnapshotV1 }>) {
	const { snapshot, copy } = props;
	const [kind, setKind] = useState<PhotoLibraryDefinitionKindV1>('folder');
	const [folderId, setFolderId] = useState(snapshot.folderId);
	const [keywordIds, setKeywordIds] = useState([...snapshot.keywordIds]);
	const [collectionIds, setCollectionIds] = useState([...snapshot.collectionIds]);
	const [chosen, setChosen] = useState<PhotoLibraryDefinitionRowV1 | null>(null);
	const [offset, setOffset] = useState(0);
	const ids = kind === 'folder' ? folderId === null ? [] : [folderId] : kind === 'keyword' ? keywordIds : collectionIds;
	const position = Math.min(offset, Math.max(0, Math.ceil(ids.length / 64) - 1) * 64);
	const smart = chosen?.kind === 'collection' && chosen.collectionKind === 'smart';
	const remove = (id: string) => {
		if (props.busy) return;
		if (kind === 'folder') setFolderId(null);
		else if (kind === 'keyword') setKeywordIds(previous => previous.filter(value => value !== id));
		else setCollectionIds(previous => previous.filter(value => value !== id));
	};
	const add = () => {
		if (props.busy || !chosen || smart || ids.includes(chosen.id) || ids.length >= 1_024) return;
		if (kind === 'keyword') setKeywordIds(previous => [...previous, chosen.id].sort());
		else if (kind === 'collection') setCollectionIds(previous => [...previous, chosen.id].sort());
	};
	return <form onSubmit={event => { event.preventDefault(); if (!props.busy) props.onApply(snapshot.photoId, snapshot.revision,
		{ folderId, keywordIds, collectionIds }); }}>
		<fieldset disabled={props.busy}>
			<label>{copy.photoMembershipTitle}<select name="membershipKind" autoFocus value={kind} onChange={event => {
				setKind(event.currentTarget.value as PhotoLibraryDefinitionKindV1); setChosen(null); setOffset(0);
			}}>
				<option value="folder">{copy.photoMembershipFolder}</option><option value="keyword">{copy.photoMembershipKeywords}</option>
				<option value="collection">{copy.photoMembershipCollections}</option>
			</select></label>
			<PhotoDefinitionSelector kind={kind} copy={copy} selectedId={kind === 'folder' ? folderId : chosen?.id ?? null}
				readPage={props.readDefinitions} onSelect={row => { if (kind === 'folder') setFolderId(row?.id ?? null); else setChosen(row); }} />
			{kind === 'folder' ? <button type="button" disabled={folderId === null} onClick={() => { setFolderId(null); }}>{copy.photoMembershipClearFolder}</button>
				: <button type="button" data-membership-add disabled={!chosen || smart || ids.includes(chosen.id) || ids.length >= 1_024} onClick={add}>{copy.photoMembershipAdd}</button>}
			{smart && <p>{copy.photoMembershipManualOnly}</p>}
			{ids.length === 0 ? <p>{copy.photoMembershipNone}</p> : <PhotoMembershipNames ids={ids.slice(position, position + 64)} kind={kind}
				snapshotKey={`${snapshot.photoId}:${String(snapshot.revision)}`} copy={copy} reader={props.definitionReader}
				readDefinition={props.readDefinition} onRemove={remove} />}
			<div className="lightscaper-dialog-actions">
				<button type="button" data-membership-previous disabled={position === 0} onClick={() => { setOffset(Math.max(0, position - 64)); }}>{copy.photoMembershipPrevious}</button>
				<button type="button" data-membership-next disabled={position + 64 >= ids.length} onClick={() => { setOffset(position + 64); }}>{copy.photoDefinitionNext}</button>
			</div>
		</fieldset>
		<div className="lightscaper-dialog-actions"><button type="submit" disabled={props.busy}>{copy.photoMembershipApply}</button>
			<button type="button" onClick={props.onClose}>{copy.photoCloseMetadata}</button></div>
	</form>;
}
