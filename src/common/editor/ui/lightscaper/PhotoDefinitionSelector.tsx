/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useState } from 'react';
import type { PhotoLibraryDefinitionKindV1, PhotoLibraryDefinitionPageRequestV1, PhotoLibraryDefinitionPageV1, PhotoLibraryDefinitionRowV1 } from '../../photo-library-session-port-v1.ts';

export interface PhotoDefinitionSelectorCopyV1 {
	readonly photoDefinitionRoot: string;
	readonly photoDefinitionUp: string;
	readonly photoDefinitionNext: string;
	readonly photoDefinitionReload: string;
	readonly photoDefinitionChoose: string;
	readonly photoDefinitionOpen: string;
	readonly photoDefinitionClear: string;
	readonly photoDefinitionSelected: string;
	readonly photoDefinitionEmpty: string;
	readonly photoDefinitionFailed: string;
	readonly photoWorking: string;
}

export interface PhotoDefinitionSelectorPropsV1 {
	readonly kind: PhotoLibraryDefinitionKindV1;
	readonly selectedId: string | null;
	readonly copy: PhotoDefinitionSelectorCopyV1;
	readonly readPage: (request: PhotoLibraryDefinitionPageRequestV1) => Promise<PhotoLibraryDefinitionPageV1>;
	readonly onSelect: (row: PhotoLibraryDefinitionRowV1 | null) => void;
}

/** A kind change starts at Root; only an explicitly mounted selector requests definitions. */
export default function PhotoDefinitionSelector(props: PhotoDefinitionSelectorPropsV1) {
	return <DefinitionScope key={props.kind} {...props} />;
}

function DefinitionScope({ kind, selectedId, copy, readPage, onSelect }: PhotoDefinitionSelectorPropsV1) {
	const [scope, setScope] = useState({ parentId: null as string | null, cursor: null as string | null, reload: 0 });
	const [page, setPage] = useState<PhotoLibraryDefinitionPageV1 | null>(null);
	const [busy, setBusy] = useState(true);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const controller = new AbortController(); let live = true;
		void Promise.resolve().then(async () => {
			if (!live) return;
			setBusy(true); setPage(null); setError(null);
			try {
				const next = await readPage({ kind, ...(kind === 'collection' ? {} : { parentId: scope.parentId }),
					selectedId, cursor: scope.cursor, signal: controller.signal });
				if (live && !controller.signal.aborted) setPage(next);
			} catch (failure) { if (live && !controller.signal.aborted) setError(message(failure, copy.photoDefinitionFailed)); }
			finally { if (live) setBusy(false); }
		});
		return () => { live = false; controller.abort(); };
	}, [kind, selectedId, readPage, scope, copy.photoDefinitionFailed]);
	const navigate = (parentId: string | null, cursor: string | null = null) => { setScope(previous => ({ parentId, cursor, reload: previous.reload + 1 })); };
	return <section aria-busy={busy} data-definition-selector={kind}>
		{error && <p role="alert">{error}</p>}
		{busy && <p role="status">{copy.photoWorking}</p>}
		{page?.selected && <p>{copy.photoDefinitionSelected}: {page.selected.name}</p>}
		{page?.parent && <p data-definition-parent>{page.parent.name}</p>}
		<div className="lightscaper-dialog-actions">
			{kind !== 'collection' && <>
				<button type="button" disabled={busy || scope.parentId === null} data-definition-root onClick={() => { navigate(null); }}>{copy.photoDefinitionRoot}</button>
				<button type="button" disabled={busy || !page?.parent} data-definition-up onClick={() => { navigate(page?.parent?.parentId ?? null); }}>{copy.photoDefinitionUp}</button>
			</>}
			<button type="button" disabled={busy || !page?.cursor} data-definition-next onClick={() => { navigate(scope.parentId, page?.cursor ?? null); }}>{copy.photoDefinitionNext}</button>
			<button type="button" disabled={busy} data-definition-reload onClick={() => { navigate(scope.parentId); }}>{copy.photoDefinitionReload}</button>
			<button type="button" disabled={busy || selectedId === null} onClick={() => { onSelect(null); }}>{copy.photoDefinitionClear}</button>
		</div>
		{page && page.rows.length === 0 && <p>{copy.photoDefinitionEmpty}</p>}
		{page && <ul>{page.rows.map(row => <li key={row.id} data-definition-id={row.id}>
			<button type="button" aria-pressed={selectedId === row.id} data-definition-choose={row.id}
				onClick={() => { onSelect(row); }}>{copy.photoDefinitionChoose}: {row.name}</button>
			{row.kind !== 'collection' && <button type="button" data-definition-open={row.id}
				onClick={() => { navigate(row.id); }}>{copy.photoDefinitionOpen}: {row.name}</button>}
		</li>)}</ul>}
	</section>;
}

function message(failure: unknown, fallback: string): string {
	const property = failure && typeof failure === 'object' ? Object.getOwnPropertyDescriptor(failure, 'message') : undefined;
	return property && Object.hasOwn(property, 'value') && typeof property.value === 'string'
		? property.value.slice(0, 2_048) : fallback;
}
