/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useLayoutEffect, useRef } from 'react';
import type { PhotoLibraryDefinitionPageRequestV1, PhotoLibraryDefinitionPageV1, PhotoLibraryQueryFilterV1,
	PhotoLibraryRowV1 } from '../../photo-library-session-port-v1.ts';
import type { PhotoLibraryQueryV2 } from '../../photo-library-query-port-v2.ts';
import PhotoDefinitionSelector, { type PhotoDefinitionSelectorCopyV1 } from './PhotoDefinitionSelector.tsx';
import PhotoMetadataQueryFields, { type PhotoMetadataQueryCopyV2, type PhotoMetadataQueryFieldsPropsV2 } from './PhotoMetadataQueryFields.tsx';

export interface PhotoQueryFieldsCopyV2 extends PhotoDefinitionSelectorCopyV1, PhotoMetadataQueryCopyV2 {
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
	readonly photoRating: string;
	readonly photoFlag: string;
	readonly photoColorLabel: string;
}

export interface PhotoQueryFieldsPropsV2 {
	readonly query: PhotoLibraryQueryV2;
	readonly metadataValid: boolean;
	readonly metadataColumns: PhotoMetadataQueryFieldsPropsV2['columns'];
	readonly normalizeMetadataPredicate: PhotoMetadataQueryFieldsPropsV2['normalizePredicate'];
	readonly copy: PhotoQueryFieldsCopyV2;
	readonly flags: Readonly<Record<PhotoLibraryRowV1['flag'], string>>;
	readonly colorLabels: Readonly<Record<PhotoLibraryRowV1['colorLabel'], string>>;
	readonly disabled: boolean;
	readonly readDefinitions: (request: PhotoLibraryDefinitionPageRequestV1) => Promise<PhotoLibraryDefinitionPageV1>;
	readonly onChange: (query: PhotoLibraryQueryV2, metadataValid: boolean) => void;
}

/** An empty reference is an incomplete local draft, never a publishable scope. */
export function isPhotoQueryFieldsValidV2(query: PhotoLibraryQueryV2, metadataValid: boolean): boolean {
	return metadataValid && !(query.filter && 'id' in query.filter && query.filter.id === '');
}

/** The parent owns one query and its validity. Raw metadata scratch is mount-scoped;
 * a deliberate draft reset remounts these fields rather than overwriting dirty input. */
export default function PhotoQueryFields(props: PhotoQueryFieldsPropsV2) {
	const { query, copy } = props, { filter, sort } = query;
	const filterKind = filter?.kind ?? '', filterValue = filter && 'value' in filter ? String(filter.value) : '0';
	const definitionKind = filterKind === 'folder' || filterKind === 'keyword' || filterKind === 'collection' ? filterKind : null;
	const current = useRef(props); current.current = props;
	const live = useRef(false);
	useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const publish = (next: PhotoLibraryQueryV2, valid = current.current.metadataValid, textEdit = false) => {
		if (!live.current || current.current.query !== query || (current.current.disabled && !textEdit)) return;
		current.current.onChange(next, valid);
	};
	const selectFilter = (kind: PhotoLibraryQueryFilterV1['kind'] | '') => {
		let next: PhotoLibraryQueryFilterV1 | null = null;
		if (kind === 'folder' || kind === 'keyword' || kind === 'collection') next = { kind, id: '' };
		else if (kind === 'rating') next = { kind, value: 0 };
		else if (kind === 'flag') next = { kind, value: 'unflagged' };
		else if (kind === 'label') next = { kind, value: 'none' };
		publish({ ...query, filter: next });
	};
	return <>
		<label>{copy.photoQueryText}<input name="queryText" maxLength={256} value={query.text}
			onChange={event => { publish({ ...query, text: event.currentTarget.value }, current.current.metadataValid, true); }} /></label>
		<fieldset disabled={props.disabled}>
			<label>{copy.photoQueryFilter}<select name="queryFilter" value={filterKind}
				onChange={event => { selectFilter(event.currentTarget.value as typeof filterKind); }}>
				{([['', copy.photoQueryAllPhotos], ['rating', copy.photoRating], ['flag', copy.photoFlag], ['label', copy.photoColorLabel],
					['folder', copy.photoQueryFolder], ['keyword', copy.photoQueryKeyword], ['collection', copy.photoQueryCollection]] as const)
					.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
			</select></label>
			{filterKind === 'rating' && <label>{copy.photoRating}<select name="queryRating" value={filterValue}
				onChange={event => { publish({ ...query, filter: { kind: 'rating', value: Number(event.currentTarget.value) } }); }}>
				{[0, 1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}
			</select></label>}
			{(filterKind === 'flag' || filterKind === 'label') && <label>{filterKind === 'flag' ? copy.photoFlag : copy.photoColorLabel}
				<select name={filterKind === 'flag' ? 'queryFlag' : 'queryLabel'} value={filterValue} onChange={event => {
					const next: PhotoLibraryQueryFilterV1 = filterKind === 'flag'
						? { kind: 'flag', value: event.currentTarget.value as PhotoLibraryRowV1['flag'] }
						: { kind: 'label', value: event.currentTarget.value as PhotoLibraryRowV1['colorLabel'] };
					publish({ ...query, filter: next });
				}}>
					{Object.entries(filterKind === 'flag' ? props.flags : props.colorLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
				</select></label>}
			{definitionKind && <PhotoDefinitionSelector kind={definitionKind} selectedId={filter && 'id' in filter ? filter.id || null : null}
				copy={copy} readPage={props.readDefinitions} onSelect={row => { publish({ ...query, filter: { kind: definitionKind, id: row?.id ?? '' } }); }} />}
			<label>{copy.photoQuerySort}<select name="querySort" value={sort.field}
				onChange={event => { publish({ ...query, sort: { ...sort, field: event.currentTarget.value as typeof sort.field } }); }}>
				{([['photo-id', copy.photoQuerySortId], ['file-name', copy.photoQuerySortFileName], ['capture-time', copy.photoQuerySortCaptureTime],
					['rating', copy.photoQuerySortRating]] as const).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
			</select></label>
			<label>{copy.photoQueryDirection}<select name="queryDirection" value={sort.direction}
				onChange={event => { publish({ ...query, sort: { ...sort, direction: event.currentTarget.value as typeof sort.direction } }); }}>
				<option value="ascending">{copy.photoQueryAscending}</option><option value="descending">{copy.photoQueryDescending}</option>
			</select></label>
		</fieldset>
		<PhotoMetadataQueryFields predicate={query.predicate} columns={props.metadataColumns} normalizePredicate={props.normalizeMetadataPredicate}
			copy={copy} disabled={props.disabled} onChange={(predicate, valid) => { publish({ ...query, predicate }, valid); }} />
	</>;
}
