/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PhotoDefinitionSelector from './PhotoDefinitionSelector.tsx';
import { photoFramescaperCollectionHandoffCopy } from '../../../i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { PhotoFramescaperHandoffDownload, type BuildPhotoFramescaperCollectionHandoffArchive,
	type PhotoFramescaperCollectionHandoffDownloadReceipt } from '../../../../lightscaper/controller/photo-framescaper-handoff-download.ts';
import { exportPhotoFramescaperCollectionHandoffArchiveV1 } from '../../../../lightscaper/controller/photo-framescaper-collection-handoff-archive-v1.ts';
import { exportPhotoFramescaperCollectionHandoffArchiveCurrentV1 } from '../../../../lightscaper/controller/photo-framescaper-collection-handoff-archive-current-v1.ts';
import { isPhotoFramescaperCollectionHandoffTargetCurrentV1, type BuildPhotoFramescaperCollectionHandoffArchiveCurrentV1 } from '../../../../lightscaper/controller/photo-framescaper-collection-handoff-download-current-v1.ts';
import type { CapturedPhotoCollectionHandoff } from './photo-library-workflow-collection-handoff.ts';
import type { PhotoLibraryDefinitionPageRequestV1 } from '../../photo-library-session-port-v1.ts';
import type { PhotoLibrarySavedCollectionPageV1 } from '../../photo-library-saved-collection-port-v1.ts';
import type { PhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import './photo-catalog-backup.css';

export interface PhotoFramescaperCollectionHandoffDialogProps {
	readonly locale: string; readonly capture: Readonly<CapturedPhotoCollectionHandoff>; readonly isCurrent: () => boolean;
	readonly saveRuntime: PhotoLibraryBackupSaveRuntimeV1 | null;
	readonly registerDestination: (cancelAndJoin: () => Promise<void>) => () => void; readonly onClose: () => void;
	readonly buildArchive?: BuildPhotoFramescaperCollectionHandoffArchive;
	readonly buildArchiveCurrent?: BuildPhotoFramescaperCollectionHandoffArchiveCurrentV1;
}
type Prepared = Awaited<ReturnType<CapturedPhotoCollectionHandoff['prepare']>>;
type Selection = Readonly<{ scope: 'catalog' | 'saved-query'; collectionId: string }>;
interface Scope {
	readonly stop: AbortController; readonly before: Promise<void> | null;
	readonly source: Readonly<CapturedPhotoCollectionHandoff>; readonly capture: Readonly<CapturedPhotoCollectionHandoff>;
	live: boolean; closed: boolean; retired: boolean; reading: Promise<unknown> | null;
	preparing: Promise<void> | null; active: Promise<void> | null; retirement: Promise<void> | null;
}
const CHECK = AbortSignal.prototype.throwIfAborted, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!, ANY = AbortSignal.any;

/** One menu lifetime owns only scalar choices and a selected collection target.
 * Native capture/archive/delivery remain in their owning modules; every child
 * read and destination joins the existing generation retirement bridge. */
export default function PhotoFramescaperCollectionHandoffDialog(props: PhotoFramescaperCollectionHandoffDialogProps) {
	const latest = useRef(props); latest.current = props;
	const scope = useRef<Scope | null>(null), draining = useRef<Promise<void> | null>(null);
	const controller = useRef<PhotoFramescaperHandoffDownload | null>(null); controller.current ??= new PhotoFramescaperHandoffDownload();
	const owner = controller.current, copy = photoFramescaperCollectionHandoffCopy(props.locale);
	const [kind, setKind] = useState<Selection['scope'] | ''>(''), [selectedId, setSelectedId] = useState('');
	const selection = useRef<Selection | null>(null);
	const [savedPage, setSavedPage] = useState<PhotoLibrarySavedCollectionPageV1 | null>(null);
	const [target, setTarget] = useState<Readonly<{ owner: Scope; value: Prepared }> | null>(null);
	const [reading, setReading] = useState(false), [preparing, setPreparing] = useState(false), [saving, setSaving] = useState(false);
	const [closing, setClosing] = useState(false), [failed, setFailed] = useState(false);
	const [receipt, setReceipt] = useState<PhotoFramescaperCollectionHandoffDownloadReceipt | null>(null);
	const present = useCallback((current: Scope) => current.live && !current.closed && scope.current === current
		&& latest.current.capture === current.source && latest.current.isCurrent(), []);
	const checked = useCallback((current: Scope) => {
		Reflect.apply(CHECK, current.stop.signal, []);
		if (!present(current)) throw new DOMException('Collection handoff presentation is closed.', 'AbortError');
	}, [present]);
	const retire = useCallback((current: Scope): Promise<void> => {
		if (current.retirement) return current.retirement;
		current.closed = true; current.stop.abort();
		const joined = Promise.allSettled([current.before, current.reading, current.preparing, current.active, owner.cancelAndJoin()]).then(results => {
			const reason: unknown = Reflect.apply(REASON, current.stop.signal, []);
			const failures = results.filter(result => result.status === 'rejected' && !Object.is(result.reason, reason))
				.map(result => (result as PromiseRejectedResult).reason as unknown);
			if (failures.length === 1) throw failures[0];
			if (failures.length) throw new AggregateError(failures, 'Collection handoff cleanup failed.');
		}).finally(() => { current.retired = true; });
		current.retirement = joined; draining.current = joined; void joined.catch(() => undefined); return joined;
	}, [owner]);
	const { capture, registerDestination } = props;
	useLayoutEffect(() => {
		const readCatalogPage = capture.readCatalogPage, readSavedPage = capture.readSavedPage, prepare = capture.prepare;
		const current: Scope = { stop: new AbortController(), before: draining.current, source: capture, live: true, closed: false, retired: false,
			reading: null, preparing: null, active: null, retirement: null,
			capture: Object.freeze<CapturedPhotoCollectionHandoff>({
				readCatalogPage: request => Reflect.apply(readCatalogPage, capture, [request]) as ReturnType<typeof readCatalogPage>,
				readSavedPage: request => Reflect.apply(readSavedPage, capture, [request]) as ReturnType<typeof readSavedPage>,
				prepare: (request, signal) => Reflect.apply(prepare, capture, [request, signal]) as ReturnType<typeof prepare>,
			}) };
		scope.current = current; selection.current = null; setKind(''); setSelectedId(''); setSavedPage(null); setTarget(null);
		setReceipt(null); setFailed(false); setClosing(false); setReading(false); setPreparing(false); setSaving(false);
		const unregister = registerDestination(() => retire(current));
		return () => { current.live = false; unregister(); void retire(current).catch(() => undefined); };
	}, [capture, registerDestination, retire]);
	const read = useCallback(<Value,>(current: Scope, action: () => Promise<Value>): Promise<Value> => {
		if (current.closed || current.reading) return Promise.reject(new Error('A collection choice read is unavailable or pending.'));
		setReading(true);
		const work = Promise.resolve(current.before).then(async () => { checked(current); const value = await action(); checked(current); return value; });
		current.reading = work;
		const finish = () => { if (current.reading === work) current.reading = null; if (present(current)) setReading(false); };
		void work.then(finish, finish); return work;
	}, [checked, present]);
	const catalogRead = useCallback(async (request: PhotoLibraryDefinitionPageRequestV1) => {
		const current = scope.current; if (!current || current.source !== capture) throw new Error('The collection choice generation changed.');
		const signal = Reflect.apply(ANY, AbortSignal, [[current.stop.signal, ...(request.signal ? [request.signal] : [])]]) as AbortSignal;
		const page = await read(current, () => current.capture.readCatalogPage({ cursor: request.cursor, selectedId: request.selectedId, signal }))
			.catch(() => { throw new Error(copy.photoDefinitionFailed); });
		const label = (row: typeof page.rows[number]) => row.kind === 'collection'
			? Object.freeze({ ...row, name: `${row.name} — ${row.collectionKind === 'manual' ? copy.manual : copy.smart}` }) : row;
		return Object.freeze({ ...page, rows: Object.freeze(page.rows.map(label)), selected: page.selected ? label(page.selected) : null });
	}, [capture, copy.manual, copy.smart, copy.photoDefinitionFailed, read]);
	const clearSelection = () => { selection.current = null; setSelectedId(''); setTarget(null); setReceipt(null); setFailed(false); };
	const loadSaved = (cursor: string | null) => {
		const current = scope.current; if (!current || current.reading || current.preparing || current.active || !present(current)) return;
		clearSelection(); setSavedPage(null);
		void read(current, () => current.capture.readSavedPage({ cursor, signal: current.stop.signal })).then(page => {
			if (present(current)) setSavedPage(page);
		}, () => { if (present(current)) setFailed(true); });
	};
	const choose = (next: Selection | null) => {
		const current = scope.current; if (!current || current.reading || current.preparing || current.active || !present(current)) return;
		clearSelection(); if (!next) return;
		const chosen = Object.freeze({ ...next }); selection.current = chosen; setSelectedId(chosen.collectionId); setPreparing(true);
		const work = Promise.resolve(current.before).then(async () => {
			checked(current); const result = await current.capture.prepare(chosen, current.stop.signal); checked(current);
			if (selection.current !== chosen) throw new Error('The selected collection changed.');
			const check = result.target.checkCurrent;
			const value = Object.freeze({ ...result, target: Object.freeze({ ...result.target, checkCurrent: async (signal: AbortSignal) => {
				checked(current); if (selection.current !== chosen) throw new Error('The selected collection changed.');
				await Reflect.apply(check, result.target, [signal]) as void; checked(current);
				if (selection.current !== chosen) throw new Error('The selected collection changed.');
			} }) });
			setTarget({ owner: current, value });
		}).catch(error => { if (present(current)) setFailed(true); throw error; }).finally(() => {
			if (current.preparing === work) current.preparing = null; if (present(current)) setPreparing(false);
		});
		current.preparing = work; void work.catch(() => undefined);
	};
	const download = () => {
		const current = scope.current, input = latest.current, runtime = input.saveRuntime;
		if (!current || current.reading || current.preparing || current.active || !present(current) || target?.owner !== current || !runtime || !selection.current) return;
		setSaving(true); setFailed(false); setReceipt(null);
		const prepareSave = runtime.prepareSave.bind(runtime), saveFile = runtime.saveFile.bind(runtime);
		const selected = target.value.target;
		const request = { fileName: target.value.fileName, fileTypeDescription: copy.fileType, signal: current.stop.signal, prepareSave, saveFile };
		const work = isPhotoFramescaperCollectionHandoffTargetCurrentV1(selected)
			? owner.startCollectionCurrent({ ...request, target: selected, buildArchive: (input.buildArchiveCurrent ?? exportPhotoFramescaperCollectionHandoffArchiveCurrentV1).bind(input) })
			: owner.startCollection({ ...request, target: selected, buildArchive: (input.buildArchive ?? exportPhotoFramescaperCollectionHandoffArchiveV1).bind(input) });
		const active = work.then(value => { if (present(current)) setReceipt(value); }, error => { if (present(current)) setFailed(true); throw error; })
			.finally(() => { if (current.active === active) current.active = null; if (present(current)) setSaving(false); });
		current.active = active; void active.catch(() => undefined);
	};
	const close = () => {
		const current = scope.current; if (!current?.live) return;
		if (current.closed) { if (current.retired && !closing) latest.current.onClose(); return; }
		setClosing(true); void retire(current).then(() => { if (current.live) latest.current.onClose(); }, () => { if (current.live) { setFailed(true); setClosing(false); } });
	};
	const busy = reading || preparing || saving || closing;
	return <AudioEditorDialogShell title={copy.title} onClose={close} initialFocus="select[name=collectionScope]" className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-framescaper-collection-handoff-dialog className="lightscaper-catalog-backup">
			<p>{copy.description}</p><p>{copy.next}</p>
			<label>{copy.scope}<select name="collectionScope" data-photo-collection-handoff-scope value={kind} disabled={busy} onChange={event => {
				const current = scope.current, value = event.currentTarget.value;
				if (!current || current.reading || current.preparing || current.active || !present(current) || (value !== 'catalog' && value !== 'saved-query' && value !== '')) return;
				clearSelection(); setKind(value); setSavedPage(null); if (value === 'saved-query') loadSaved(null);
			}}><option value="">{copy.chooseScope}</option><option value="catalog">{copy.catalog}</option><option value="saved-query">{copy.savedQuery}</option></select></label>
			{kind === 'catalog' && <fieldset disabled={preparing || saving || closing}><legend>{copy.catalog}</legend>
				<PhotoDefinitionSelector kind="collection" selectedId={selectedId || null} copy={copy} readPage={catalogRead}
					onSelect={row => { if (row === null || row.kind === 'collection') choose(row ? { scope: 'catalog', collectionId: row.id } : null); }} />
			</fieldset>}
			{kind === 'saved-query' && savedPage && <>
				<label>{copy.savedCollection}<select data-photo-collection-handoff-saved value={selectedId} disabled={busy} onChange={event => {
					const id = event.currentTarget.value; if (id === '') choose(null); else if (savedPage.items.some(item => item.id === id)) choose({ scope: 'saved-query', collectionId: id });
				}}><option value="">{copy.chooseCollection}</option>{savedPage.items.map(item => <option key={item.id} value={item.id} data-photo-collection-saved-choose={item.id}>{item.name}</option>)}</select></label>
				{savedPage.items.length === 0 && <p>{copy.emptySaved}</p>}
				<button type="button" data-photo-collection-handoff-next disabled={busy || savedPage.cursor === null} onClick={() => { if (savedPage.cursor) loadSaved(savedPage.cursor); }}>{copy.photoDefinitionNext}</button>
				<button type="button" disabled={busy} onClick={() => { loadSaved(null); }}>{copy.photoDefinitionReload}</button>
			</>}
			{busy && <p role="status">{saving || closing ? copy.working : copy.preparing}</p>}{failed && <p role="alert">{copy.failed}</p>}
			{receipt && <p role="status" data-photo-collection-handoff-receipt={receipt.status} data-photo-framescaper-collection-handoff-receipt={receipt.status}>{receipt.status === 'cancelled' ? copy.cancelled
				: (receipt.status === 'saved' ? copy.saved : copy.downloadStarted).replace('{name}', receipt.fileName)}</p>}
			<div className="lightscaper-catalog-backup-actions"><button type="button" data-photo-collection-handoff-download data-photo-framescaper-collection-handoff-download disabled={!target || !props.saveRuntime || busy || failed} onClick={download}>{copy.download}</button>
				<button type="button" data-photo-collection-handoff-close disabled={closing} onClick={close}>{copy.close}</button></div>
		</div>
	</AudioEditorDialogShell>;
}
