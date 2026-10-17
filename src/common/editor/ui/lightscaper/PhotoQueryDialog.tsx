/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useState } from 'react';
import type { PhotoLibraryDefinitionPageRequestV1, PhotoLibraryDefinitionPageV1, PhotoLibraryQueryBuildProgressV1,
	PhotoLibraryQueryV1, PhotoLibraryRowV1 } from '../../photo-library-session-port-v1.ts';
import type { PhotoLibraryQueryV2 } from '../../photo-library-query-port-v2.ts';
import type { PhotoPredicateV2 } from '../../../../lightscaper/catalog/photo-smart-query-types-v2.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { PhotoMetadataQueryColumnsV2 } from './PhotoMetadataQueryFields.tsx';
import PhotoQueryFields, { isPhotoQueryFieldsValidV2, type PhotoQueryFieldsCopyV2 } from './PhotoQueryFields.tsx';

export interface PhotoQueryDialogCopyV1 extends PhotoQueryFieldsCopyV2 {
	readonly photoQueryTitle: string;
	readonly photoQueryApply: string;
	readonly photoQueryBuildIndex: string;
	readonly photoQueryResumeIndex: string;
	readonly photoQueryIndexRequired: string;
	readonly photoQueryIndexProgress: string;
	readonly photoCloseMetadata: string;
}

export interface PhotoQueryDialogPropsV1 {
	readonly query: PhotoLibraryQueryV1 | PhotoLibraryQueryV2;
	readonly metadataColumns: PhotoMetadataQueryColumnsV2;
	readonly normalizeMetadataPredicate: (value: unknown) => PhotoPredicateV2;
	readonly copy: PhotoQueryDialogCopyV1;
	readonly flags: Readonly<Record<PhotoLibraryRowV1['flag'], string>>;
	readonly colorLabels: Readonly<Record<PhotoLibraryRowV1['colorLabel'], string>>;
	readonly busy: boolean;
	readonly error: string | null;
	readonly needsIndex: boolean;
	readonly indexProgress: PhotoLibraryQueryBuildProgressV1 | null;
	readonly readDefinitions: (request: PhotoLibraryDefinitionPageRequestV1) => Promise<PhotoLibraryDefinitionPageV1>;
	readonly onApply: (query: PhotoLibraryQueryV2) => void;
	readonly onBuild: () => void;
	readonly onClose: () => void;
}

/** Controlled opt-in form; the product port remains authoritative for admission and persistence. */
export default function PhotoQueryDialog(props: PhotoQueryDialogPropsV1) {
	const { copy, query } = props;
	const [draft, setDraft] = useState(() => ({ query: { ...query, schemaVersion: 2 as const,
		kind: 'photo-catalog-query' as const, predicate: 'predicate' in query ? query.predicate : null }, metadataValid: true }));
	const canApply = !props.busy && !props.needsIndex && isPhotoQueryFieldsValidV2(draft.query, draft.metadataValid);
	return <AudioEditorDialogShell title={copy.photoQueryTitle} onClose={props.onClose}
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" initialFocus="input[name=queryText]" closeOnOutside={false}>
		{props.error && <p role="alert">{props.error}</p>}
		{props.busy && <p role="status">{copy.photoWorking}</p>}
		<form onSubmit={event => {
			event.preventDefault(); if (canApply) props.onApply(draft.query);
		}}>
			<PhotoQueryFields query={draft.query} metadataValid={draft.metadataValid} metadataColumns={props.metadataColumns}
				normalizeMetadataPredicate={props.normalizeMetadataPredicate} copy={copy} flags={props.flags} colorLabels={props.colorLabels}
				disabled={props.busy} readDefinitions={props.readDefinitions} onChange={(query, metadataValid) => { setDraft({ query, metadataValid }); }} />
			{props.needsIndex && <div><p>{copy.photoQueryIndexRequired}</p>
				{props.indexProgress && <p role="status">{copy.photoQueryIndexProgress.replace('{count}', String(props.indexProgress.processed))}</p>}
				<button type="button" disabled={props.busy} data-query-build onClick={props.onBuild}>
					{props.indexProgress ? copy.photoQueryResumeIndex : copy.photoQueryBuildIndex}</button></div>}
			<div className="lightscaper-dialog-actions"><button type="submit" disabled={!canApply}>{copy.photoQueryApply}</button>
				<button type="button" data-query-close onClick={props.onClose}>{copy.photoCloseMetadata}</button></div>
		</form>
	</AudioEditorDialogShell>;
}
