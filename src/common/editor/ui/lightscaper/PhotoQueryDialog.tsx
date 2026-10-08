/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useState } from 'react';
import type { PhotoLibraryDefinitionPageRequestV1, PhotoLibraryDefinitionPageV1, PhotoLibraryQueryBuildProgressV1,
	PhotoLibraryQueryFilterV1, PhotoLibraryQueryV1, PhotoLibraryRowV1 } from '../../photo-library-session-port-v1.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PhotoDefinitionSelector, { type PhotoDefinitionSelectorCopyV1 } from './PhotoDefinitionSelector.tsx';

export interface PhotoQueryDialogCopyV1 extends PhotoDefinitionSelectorCopyV1 {
	readonly photoQueryTitle: string;
	readonly photoQueryText: string;
	readonly photoQueryFilter: string;
	readonly photoQueryAllPhotos: string;
	readonly photoQuerySort: string;
	readonly photoQueryDirection: string;
	readonly photoQuerySortId: string;
	readonly photoQuerySortFileName: string;
	readonly photoQuerySortCaptureTime: string;
	readonly photoQuerySortRating: string;
	readonly photoQueryAscending: string;
	readonly photoQueryDescending: string;
	readonly photoQueryFolder: string;
	readonly photoQueryKeyword: string;
	readonly photoQueryCollection: string;
	readonly photoQueryApply: string;
	readonly photoQueryBuildIndex: string;
	readonly photoQueryResumeIndex: string;
	readonly photoQueryIndexRequired: string;
	readonly photoQueryIndexProgress: string;
	readonly photoRating: string;
	readonly photoFlag: string;
	readonly photoColorLabel: string;
	readonly photoCloseMetadata: string;
}

export interface PhotoQueryDialogPropsV1 {
	readonly query: PhotoLibraryQueryV1;
	readonly copy: PhotoQueryDialogCopyV1;
	readonly flags: Readonly<Record<PhotoLibraryRowV1['flag'], string>>;
	readonly colorLabels: Readonly<Record<PhotoLibraryRowV1['colorLabel'], string>>;
	readonly busy: boolean;
	readonly error: string | null;
	readonly needsIndex: boolean;
	readonly indexProgress: PhotoLibraryQueryBuildProgressV1 | null;
	readonly readDefinitions: (request: PhotoLibraryDefinitionPageRequestV1) => Promise<PhotoLibraryDefinitionPageV1>;
	readonly onApply: (query: PhotoLibraryQueryV1) => void;
	readonly onBuild: () => void;
	readonly onClose: () => void;
}

/** Controlled opt-in form; the product port remains authoritative for admission and persistence. */
export default function PhotoQueryDialog(props: PhotoQueryDialogPropsV1) {
	const { copy, query } = props;
	const [text, setText] = useState(query.text);
	const [filterKind, setFilterKind] = useState<PhotoLibraryQueryFilterV1['kind'] | ''>(query.filter?.kind ?? '');
	const [filterValue, setFilterValue] = useState(query.filter && 'value' in query.filter ? String(query.filter.value) : '0');
	const [selectedId, setSelectedId] = useState(query.filter && 'id' in query.filter ? query.filter.id : null);
	const [sort, setSort] = useState(query.sort.field);
	const [direction, setDirection] = useState(query.sort.direction);
	const definitionKind = filterKind === 'folder' || filterKind === 'keyword' || filterKind === 'collection' ? filterKind : null;
	const canApply = !props.busy && !props.needsIndex && (definitionKind === null || selectedId !== null);
	const selectFilter = (kind: typeof filterKind) => {
		setFilterKind(kind); setSelectedId(null); setFilterValue(kind === 'flag' ? 'unflagged' : kind === 'label' ? 'none' : '0');
	};
	return <AudioEditorDialogShell title={copy.photoQueryTitle} onClose={props.onClose}
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" initialFocus="input[name=queryText]" closeOnOutside={false}>
		{props.error && <p role="alert">{props.error}</p>}
		{props.busy && <p role="status">{copy.photoWorking}</p>}
		<form onSubmit={event => {
			event.preventDefault(); if (!canApply) return;
			let filter: PhotoLibraryQueryFilterV1 | null = null;
			if (definitionKind && selectedId) filter = { kind: definitionKind, id: selectedId };
			else if (filterKind === 'rating') filter = { kind: filterKind, value: Number(filterValue) };
			else if (filterKind === 'flag') filter = { kind: filterKind, value: filterValue as PhotoLibraryRowV1['flag'] };
			else if (filterKind === 'label') filter = { kind: filterKind, value: filterValue as PhotoLibraryRowV1['colorLabel'] };
			props.onApply({ text, filter, sort: { field: sort, direction } });
		}}>
			<label>{copy.photoQueryText}<input name="queryText" maxLength={256} value={text} onChange={event => { setText(event.currentTarget.value); }} /></label>
			<fieldset disabled={props.busy}>
				<label>{copy.photoQueryFilter}<select name="queryFilter" value={filterKind} onChange={event => { selectFilter(event.currentTarget.value as typeof filterKind); }}>
					{([['', copy.photoQueryAllPhotos], ['rating', copy.photoRating], ['flag', copy.photoFlag], ['label', copy.photoColorLabel],
						['folder', copy.photoQueryFolder], ['keyword', copy.photoQueryKeyword], ['collection', copy.photoQueryCollection]] as const)
						.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
				</select></label>
				{filterKind === 'rating' && <label>{copy.photoRating}<select name="queryRating" value={filterValue} onChange={event => { setFilterValue(event.currentTarget.value); }}>
					{[0, 1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}
				</select></label>}
				{(filterKind === 'flag' || filterKind === 'label') && <label>{filterKind === 'flag' ? copy.photoFlag : copy.photoColorLabel}
					<select name={filterKind === 'flag' ? 'queryFlag' : 'queryLabel'} value={filterValue} onChange={event => { setFilterValue(event.currentTarget.value); }}>
						{Object.entries(filterKind === 'flag' ? props.flags : props.colorLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
					</select></label>}
				{definitionKind && <PhotoDefinitionSelector kind={definitionKind} selectedId={selectedId} copy={copy}
					readPage={props.readDefinitions} onSelect={row => { setSelectedId(row?.id ?? null); }} />}
				<label>{copy.photoQuerySort}<select name="querySort" value={sort} onChange={event => { setSort(event.currentTarget.value as typeof sort); }}>
					{([['photo-id', copy.photoQuerySortId], ['file-name', copy.photoQuerySortFileName], ['capture-time', copy.photoQuerySortCaptureTime],
						['rating', copy.photoQuerySortRating]] as const).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
				</select></label>
				<label>{copy.photoQueryDirection}<select name="queryDirection" value={direction} onChange={event => { setDirection(event.currentTarget.value as typeof direction); }}>
					<option value="ascending">{copy.photoQueryAscending}</option><option value="descending">{copy.photoQueryDescending}</option>
				</select></label>
			</fieldset>
			{props.needsIndex && <div><p>{copy.photoQueryIndexRequired}</p>
				{props.indexProgress && <p role="status">{copy.photoQueryIndexProgress.replace('{count}', String(props.indexProgress.processed))}</p>}
				<button type="button" disabled={props.busy} data-query-build onClick={props.onBuild}>
					{props.indexProgress ? copy.photoQueryResumeIndex : copy.photoQueryBuildIndex}</button></div>}
			<div className="lightscaper-dialog-actions"><button type="submit" disabled={!canApply}>{copy.photoQueryApply}</button>
				<button type="button" data-query-close onClick={props.onClose}>{copy.photoCloseMetadata}</button></div>
		</form>
	</AudioEditorDialogShell>;
}
