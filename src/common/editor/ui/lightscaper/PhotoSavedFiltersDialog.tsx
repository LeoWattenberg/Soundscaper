/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PhotoSavedFilterRuntimeV1 } from '../../photo-library-saved-filter-runtime-v1.ts';
import type { PhotoLibraryQueryV1 } from '../../photo-library-session-port-v1.ts';
import type { PhotoLibraryQueryV2 } from '../../photo-library-query-port-v2.ts';
import type { PhotoLibrarySavedCollectionCommandV1 } from '../../photo-library-saved-collection-port-v1.ts';
import type { usePhotoSavedFilters } from './use-photo-saved-filters.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PhotoQueryFields, { isPhotoQueryFieldsValidV2, type PhotoQueryFieldsCopyV2, type PhotoQueryFieldsPropsV2 } from './PhotoQueryFields.tsx';

export interface PhotoSavedFiltersCopyV1 extends PhotoQueryFieldsCopyV2 {
	readonly photoSavedFiltersTitle: string;
	readonly photoSavedFilterName: string;
	readonly photoSavedFilterNew: string;
	readonly photoSavedFilterLoad: string;
	readonly photoSavedFilterUse: string;
	readonly photoSavedFilterSave: string;
	readonly photoSavedFilterDelete: string;
	readonly photoSavedFilterReload: string;
	readonly photoSavedFilterRefreshList: string;
	readonly photoSavedFilterShowAll: string;
	readonly photoSavedFilterDeleted: string;
	readonly photoSavedFilterSaved: string;
	readonly photoSavedFilterRefreshFailed: string;
	readonly photoSavedFilterCleanupFailed: string;
	readonly photoSavedFilterActiveDelete: string;
	readonly photoSavedFilterNoSelection: string;
	readonly photoSavedFilterEmpty: string;
	readonly photoSavedFilterSummaryPage: string;
	readonly photoSavedFilterConflict: string;
	readonly photoOrganizerQueryJson: string;
	readonly photoNextPage: string;
	readonly photoCloseMetadata: string;
	readonly photoCancelAction: string;
}

export interface PhotoSavedFiltersDialogPropsV1 {
	readonly runtime: PhotoSavedFilterRuntimeV1;
	readonly initialQuery: PhotoLibraryQueryV1 | PhotoLibraryQueryV2;
	readonly initialMode: 'create' | 'manage';
	readonly initialCollectionId?: string | null;
	readonly generation: unknown;
	readonly savedFilters: ReturnType<typeof usePhotoSavedFilters>;
	readonly activeCollectionId: string | null;
	readonly readDefinitions: PhotoQueryFieldsPropsV2['readDefinitions'];
	readonly copy: PhotoSavedFiltersCopyV1;
	readonly flags: PhotoQueryFieldsPropsV2['flags'];
	readonly colorLabels: PhotoQueryFieldsPropsV2['colorLabels'];
	readonly busy: boolean;
	readonly error: string | null;
	readonly onCancel: () => void;
	readonly onClose: () => void;
	/** Explicit admitted Use/Show-all intent, without claiming the host read succeeded. */
	readonly onUse?: () => void;
}

interface Draft { readonly query: PhotoLibraryQueryV2; readonly metadataValid: boolean; readonly name: string }
interface Owner extends Pick<PhotoSavedFiltersDialogPropsV1, 'generation' | 'runtime' | 'initialMode' | 'initialCollectionId'>,
	Pick<ReturnType<typeof usePhotoSavedFilters>, 'readSnapshot' | 'readPage' | 'apply' | 'use' | 'showAll'> {}

/** Menu-owned presentation: one recipe draft, scalar selection and borrowed hook demands only. */
export default function PhotoSavedFiltersDialog(props: PhotoSavedFiltersDialogPropsV1) {
	const { copy, savedFilters } = props;
	const [draft, setDraft] = useState<Draft>(() => ({ query: promote(props.initialQuery), metadataValid: true, name: '' }));
	const [selected, setSelected] = useState(props.initialMode === 'manage' ? props.initialCollectionId ?? '' : '');
	const [epoch, setEpoch] = useState(0), [advanced, setAdvanced] = useState(false);
	const [waiting, setWaiting] = useState(false), [closed, setClosed] = useState(false);
	const [failure, setFailure] = useState<'conflict' | 'invalid' | null>(null);
	const initial = useRef<Owner>({ generation: props.generation, runtime: props.runtime, initialMode: props.initialMode,
		initialCollectionId: props.initialCollectionId, readSnapshot: savedFilters.readSnapshot, readPage: savedFilters.readPage,
		apply: savedFilters.apply, use: savedFilters.use, showAll: savedFilters.showAll });
	const latest = useRef(props); latest.current = props;
	const draftOwner = useRef(draft); draftOwner.current = draft;
	const live = useRef(false), retired = useRef(false), initialized = useRef(false), pending = useRef<object | null>(null);
	const binding = useRef<string | null | undefined>(undefined), selectedOwner = useRef(selected); selectedOwner.current = selected;
	const json = useRef<HTMLTextAreaElement | null>(null), name = useRef<HTMLInputElement | null>(null), initialFocus = useRef(false);
	const scratch = useRef({ advanced, epoch }); scratch.current = { advanced, epoch };
	const sameOwner = () => live.current && !retired.current && sameSource(latest.current, initial.current);
	const blocked = waiting || props.busy || savedFilters.busy || !initialized.current || !sameSource(props, initial.current);
	const available = () => sameOwner() && pending.current === null && !latest.current.busy && !latest.current.savedFilters.busy;
	useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const close = () => {
		if (!live.current || retired.current || !Object.is(latest.current.generation, props.generation)
			|| latest.current.runtime !== props.runtime || latest.current.onClose !== props.onClose) return;
		retired.current = true; binding.current = undefined; setClosed(true); latest.current.onClose();
	};
	const run = (action: () => Promise<void>) => {
		if (!available()) return false;
		const demand = {}; pending.current = demand; setWaiting(true); setFailure(null);
		void (async () => {
			try { await action(); }
			catch { if (sameOwner()) setFailure('conflict'); }
			finally { if (pending.current === demand) { pending.current = null; if (sameOwner()) setWaiting(false); } }
		})();
		return true;
	};
	const replaceDraft = (next: Draft) => { draftOwner.current = next; setDraft(next); setEpoch(value => value + 1); setAdvanced(false); };
	const readDraft = async (id: string): Promise<Draft | null> => {
		const snapshot = await savedFilters.readSnapshot(id);
		if (!sameOwner() || snapshot?.collectionId !== id || snapshot.definition === null) return null;
		return { query: props.runtime.readQueryJson(snapshot.definition.queryJson), metadataValid: true, name: snapshot.definition.name };
	};
	const acquire = async (id: string | null, replace: boolean) => {
		binding.current = undefined;
		if (replace && id !== null) {
			const next = await readDraft(id); if (!sameOwner() || next === null) return;
			binding.current = id; replaceDraft(next); return;
		}
		const snapshot = await savedFilters.readSnapshot(id);
		if (sameOwner() && snapshot?.collectionId === id && (id === null || snapshot.definition !== null)) binding.current = id;
	};
	useEffect(() => {
		if (initialized.current || !available()) return;
		initialized.current = true;
		run(async () => {
			if (initial.current.initialMode === 'manage') { await savedFilters.readPage(null); return; }
			const id = initial.current.initialCollectionId;
			if (id) {
				// This scoped helper releases the source snapshot/JSON before the next acquisition.
				const next = await readDraft(id); if (!sameOwner() || next === null) return; replaceDraft(next);
			}
			if (sameOwner()) await acquire(null, false);
		});
	});
	useLayoutEffect(() => {
		if (advanced && json.current) {
			try { json.current.value = props.runtime.writeQueryJson(draftOwner.current.query); }
			catch { if (live.current && !retired.current && sameSource(latest.current, initial.current)) setFailure('invalid'); }
		}
	}, [advanced, epoch, props.runtime]);
	useLayoutEffect(() => {
		const input = name.current;
		if (initialFocus.current || blocked || !sameOwner() || !input?.isConnected || input.disabled) return;
		const active = input.ownerDocument.activeElement;
		if (input.closest('form')?.contains(active) && active instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) {
			initialFocus.current = true; return;
		}
		input.focus({ preventScroll: true }); if (input.ownerDocument.activeElement === input) initialFocus.current = true;
	});
	const loaded = savedFilters.loaded;
	const authorized = loaded !== null && loaded.collectionId === binding.current
		&& (binding.current === null || (binding.current === selected && loaded.definition?.id === selected));
	const valid = isPhotoQueryFieldsValidV2(draft.query, draft.metadataValid) && draft.name.length > 0 && draft.name.length <= 256;
	const canSave = !blocked && authorized && valid;
	const activeDelete = selected !== '' && selected === props.activeCollectionId;
	const canDelete = !blocked && authorized && loaded?.definition !== null && binding.current !== null && !activeDelete;
	const edit = (next: Draft) => { if (!sameOwner() || draftOwner.current !== draft) return; draftOwner.current = next; setDraft(next); };
	const save = () => {
		if (!available() || !canSave || draftOwner.current !== draft || !loaded
			|| latest.current.savedFilters.loaded !== loaded || binding.current !== loaded.collectionId || selectedOwner.current !== selected) return;
		let queryJson: string;
		try { queryJson = props.runtime.writeQueryJson(draft.query); }
		catch { setFailure('invalid'); return; }
		const command: PhotoLibrarySavedCollectionCommandV1 = loaded.collectionId === null
			? { type: 'create', context: loaded.context, name: draft.name, queryJson }
			: { type: 'update', context: loaded.context, collectionId: loaded.collectionId,
				expectedDefinitionRevision: loaded.definition!.revision, name: draft.name, queryJson };
		run(async () => { await apply(command); });
	};
	const apply = async (command: PhotoLibrarySavedCollectionCommandV1) => {
		const result = await savedFilters.apply(command);
		if (!sameOwner()) return;
		if (result.outcome === 'acknowledged') {
			binding.current = result.receipt.summary === null ? undefined : result.receipt.collectionId;
			selectedOwner.current = result.receipt.summary === null ? '' : result.receipt.collectionId; setSelected(selectedOwner.current);
		} else if (result.outcome === 'failed') setFailure('conflict');
	};
	const deleteFilter = () => {
		if (!available() || !canDelete || selectedOwner.current !== selected || !loaded?.definition || !loaded.collectionId
			|| latest.current.savedFilters.loaded !== loaded || binding.current !== loaded.collectionId || latest.current.activeCollectionId === selected) return;
		run(async () => { await apply({ type: 'delete', context: loaded.context, collectionId: loaded.collectionId!,
			expectedDefinitionRevision: loaded.definition!.revision }); });
	};
	if (closed) return null;
	const error = props.error ?? savedFilters.error;
	return <AudioEditorDialogShell title={copy.photoSavedFiltersTitle} onClose={close} initialFocus="input[name=savedFilterName]"
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false} dataAttributes={{ 'data-photo-saved-filters': true }}>
		{error && <p role="alert">{error}</p>}
		{failure && <p role="alert">{failure === 'invalid' ? copy.photoMetadataInvalid : copy.photoSavedFilterConflict}</p>}
		{blocked && <p role="status">{copy.photoWorking}</p>}
		{savedFilters.receipt && <p role="status" data-saved-receipt>{savedFilters.receipt.outcome === 'deleted' ? copy.photoSavedFilterDeleted : copy.photoSavedFilterSaved}</p>}
		{savedFilters.notice && <p role="status" data-saved-refresh-failed>{copy.photoSavedFilterRefreshFailed}</p>}
		{savedFilters.receipt?.notices.includes('cleanup-failed') && <p role="status" data-saved-cleanup-failed>{copy.photoSavedFilterCleanupFailed}</p>}
		<div className="lightscaper-dialog-actions">
			<button type="button" data-saved-new disabled={blocked} onClick={() => {
				if (!available()) return; binding.current = undefined; selectedOwner.current = ''; setSelected('');
				replaceDraft({ query: promote(props.initialQuery), metadataValid: true, name: '' }); run(async () => { await acquire(null, false); });
			}}>{copy.photoSavedFilterNew}</button>
			<button type="button" data-saved-list disabled={blocked} onClick={() => { run(async () => { await savedFilters.readPage(null); }); }}>{copy.photoSavedFilterRefreshList}</button>
			<button type="button" data-saved-all disabled={blocked} onClick={() => {
				if (run(async () => { await savedFilters.showAll(); }) && sameOwner()) latest.current.onUse?.();
			}}>{copy.photoSavedFilterShowAll}</button>
		</div>
		{savedFilters.page && <section aria-label={copy.photoSavedFiltersTitle}>
			<p>{copy.photoSavedFilterSummaryPage.replace('{count}', String(savedFilters.page.items.length))}</p>
			{savedFilters.page.items.length === 0 && <p>{copy.photoSavedFilterEmpty}</p>}
			{savedFilters.page.items.map(item => <label key={item.id}><input type="radio" name="savedFilterSelection" value={item.id}
				data-saved-select={item.id} checked={selected === item.id} disabled={blocked} onChange={() => {
					if (!available() || latest.current.savedFilters.page !== savedFilters.page) return;
					binding.current = undefined; selectedOwner.current = item.id; setSelected(item.id);
				}} />{item.name}</label>)}
			<button type="button" data-saved-next disabled={blocked || savedFilters.page.cursor === null} onClick={() => {
				if (latest.current.savedFilters.page === savedFilters.page && savedFilters.page?.cursor) {
					run(async () => { await savedFilters.readPage(savedFilters.page!.cursor); });
				}
			}}>{copy.photoNextPage}</button>
		</section>}
		{!selected && props.initialMode === 'manage' && <p>{copy.photoSavedFilterNoSelection}</p>}
		<div className="lightscaper-dialog-actions">
			<button type="button" data-saved-load disabled={blocked || !selected} onClick={() => {
				if (selectedOwner.current === selected) run(async () => { await acquire(selected, true); });
			}}>{copy.photoSavedFilterLoad}</button>
			<button type="button" data-saved-reload disabled={blocked || (!selected && binding.current !== null)} onClick={() => {
				if (selectedOwner.current === selected) run(async () => { await acquire(selected || null, false); });
			}}>{copy.photoSavedFilterReload}</button>
			<button type="button" data-saved-use disabled={blocked || !selected} onClick={() => {
				if (selected && selectedOwner.current === selected && run(async () => { await savedFilters.use(selected); }) && sameOwner()) latest.current.onUse?.();
			}}>{copy.photoSavedFilterUse}</button>
		</div>
		<form onSubmit={event => { event.preventDefault(); save(); }}>
			<label>{copy.photoSavedFilterName}<input ref={name} name="savedFilterName" maxLength={256} value={draft.name} disabled={blocked}
				onChange={event => { if (available()) edit({ ...draft, name: event.currentTarget.value }); }} /></label>
			{!advanced && <PhotoQueryFields key={epoch} query={draft.query} metadataValid={draft.metadataValid}
				metadataColumns={props.runtime.columns} normalizeMetadataPredicate={props.runtime.normalizePredicate} copy={copy}
				flags={props.flags} colorLabels={props.colorLabels} disabled={blocked} readDefinitions={props.readDefinitions}
				onChange={(query, metadataValid) => { edit({ ...draft, query, metadataValid }); }} />}
			<button type="button" data-saved-json aria-expanded={advanced} disabled={blocked} onClick={() => {
				if (!available() || scratch.current.epoch !== epoch || scratch.current.advanced !== advanced) return;
				scratch.current = { advanced: !advanced, epoch: epoch + 1 }; setAdvanced(!advanced); setEpoch(value => value + 1);
			}}>{copy.photoOrganizerQueryJson}</button>
			{advanced && <label>{copy.photoOrganizerQueryJson}<textarea ref={json} name="savedFilterQueryJson" maxLength={524288} disabled={blocked}
				onChange={event => {
					if (!available() || draftOwner.current !== draft || !scratch.current.advanced || scratch.current.epoch !== epoch) return;
					try { edit({ ...draft, query: props.runtime.readQueryJson(event.currentTarget.value), metadataValid: true }); }
					catch { edit({ ...draft, metadataValid: false }); }
				}} /></label>}
			{!draft.metadataValid && <p role="alert">{copy.photoMetadataInvalid}</p>}
			{activeDelete && <p>{copy.photoSavedFilterActiveDelete}</p>}
			<div className="lightscaper-dialog-actions">
				<button type="button" data-saved-save disabled={!canSave} onClick={save}>{copy.photoSavedFilterSave}</button>
				<button type="button" data-saved-delete disabled={!canDelete} onClick={deleteFilter}>{copy.photoSavedFilterDelete}</button>
				<button type="button" data-saved-cancel disabled={!blocked} onClick={() => { if (sameOwner() && (pending.current || latest.current.busy || latest.current.savedFilters.busy)) latest.current.onCancel(); }}>{copy.photoCancelAction}</button>
				<button type="button" data-saved-close disabled={false} onClick={close}>{copy.photoCloseMetadata}</button>
			</div>
		</form>
	</AudioEditorDialogShell>;
}

function sameSource(current: PhotoSavedFiltersDialogPropsV1, initial: Owner): boolean {
	return Object.is(current.generation, initial.generation) && current.runtime === initial.runtime
		&& current.savedFilters.readSnapshot === initial.readSnapshot && current.savedFilters.readPage === initial.readPage
		&& current.savedFilters.apply === initial.apply && current.savedFilters.use === initial.use && current.savedFilters.showAll === initial.showAll;
}
function promote(query: PhotoLibraryQueryV1 | PhotoLibraryQueryV2): PhotoLibraryQueryV2 {
	return { ...query, schemaVersion: 2, kind: 'photo-catalog-query', predicate: 'predicate' in query ? query.predicate : null };
}
