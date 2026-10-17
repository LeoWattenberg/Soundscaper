/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDefinitionReader } from '../../controller/shared/photo-library-definition-reader.ts';
import type { PhotoLibraryOrganizationPortV1 } from '../../photo-library-organization-port-v1.ts';
import type { PhotoLibrarySessionPortV1 } from '../../photo-library-session-port-v1.ts';
import type { PhotoDefinitionSelectorCopyV1 } from './PhotoDefinitionSelector.tsx';
import { useEffect, useId, useRef, useState } from 'react';
import PhotoDefinitionSelector from './PhotoDefinitionSelector.tsx';
import PhotoMembershipNames from './PhotoMembershipNames.tsx';

export interface PhotoImportKeywordCopyV1 extends PhotoDefinitionSelectorCopyV1 {
	readonly photoKeywords: string;
	readonly photoImportAddKeyword: string;
	readonly photoImportRemoveKeyword: string;
	readonly photoImportNoKeywords: string;
	readonly photoImportPreviousKeywords: string;
	readonly photoImportNextKeywords: string;
}

export interface PhotoImportKeywordOptionsPropsV1 {
	readonly keywordIds: readonly string[];
	readonly onChange: (next: readonly string[]) => void;
	readonly busy: boolean;
	readonly copy: PhotoImportKeywordCopyV1;
	readonly readDefinitions: PhotoLibrarySessionPortV1['readDefinitionPage'];
	readonly readDefinition: PhotoLibraryOrganizationPortV1['readDefinition'];
	readonly definitionReader: Pick<PhotoLibraryDefinitionReader, 'read'>;
}

/** Keeps the complete scalar recipe while only its current page borrows human names. */
export default function PhotoImportKeywordOptions({ keywordIds, onChange, busy, copy, readDefinitions, readDefinition, definitionReader }: PhotoImportKeywordOptionsPropsV1) {
	if (keywordIds.length > 1_024) throw new RangeError('Import keyword IDs exceed their reference bound.');
	const [chosen, setChosen] = useState<Readonly<{ id: string; name: string }> | null>(null), [offset, setOffset] = useState(0);
	const selected = useRef(chosen), ids = useRef(keywordIds); ids.current = keywordIds;
	const snapshotKey = useId();
	useEffect(() => { selected.current = null; setChosen(null); setOffset(0); }, [readDefinitions, readDefinition]);
	const update = (next: readonly string[]) => {
		if (busy) return;
		const detached = Object.freeze([...next].sort()); ids.current = detached; onChange(detached);
	};
	const position = Math.min(offset, Math.max(0, Math.ceil(keywordIds.length / 64) - 1) * 64);
	const add = () => {
		const candidate = selected.current;
		if (busy || !candidate || ids.current.includes(candidate.id) || ids.current.length >= 1_024) return;
		update([...ids.current, candidate.id]);
	};
	return <section data-import-keyword-options>
		<h3>{copy.photoKeywords}</h3>
		<fieldset disabled={busy}>
			<PhotoDefinitionSelector kind="keyword" selectedId={chosen?.id ?? null} copy={copy} readPage={readDefinitions}
				onSelect={row => {
					if (busy) return;
					const next = row?.kind === 'keyword' ? Object.freeze({ id: row.id, name: row.name }) : null;
					selected.current = next; setChosen(next);
				}} />
			<button type="button" data-import-keyword-add disabled={!chosen || keywordIds.includes(chosen.id) || keywordIds.length >= 1_024} onClick={add}>{copy.photoImportAddKeyword}</button>
			{keywordIds.length === 0 ? <p>{copy.photoImportNoKeywords}</p> : <PhotoMembershipNames ids={keywordIds.slice(position, position + 64)} kind="keyword"
				snapshotKey={snapshotKey} reader={definitionReader} readDefinition={readDefinition}
				copy={{ photoWorking: copy.photoWorking, photoDefinitionFailed: copy.photoDefinitionFailed, photoMembershipRemove: copy.photoImportRemoveKeyword }}
				onRemove={id => { update(ids.current.filter(candidate => candidate !== id)); }} />}
			<div className="lightscaper-dialog-actions">
				<button type="button" data-import-keywords-previous disabled={position === 0} onClick={() => { if (!busy) setOffset(Math.max(0, position - 64)); }}>{copy.photoImportPreviousKeywords}</button>
				<button type="button" data-import-keywords-next disabled={position + 64 >= keywordIds.length} onClick={() => { if (!busy) setOffset(position + 64); }}>{copy.photoImportNextKeywords}</button>
			</div>
		</fieldset>
	</section>;
}
