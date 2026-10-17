/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoFramescaperReceiveCopy } from '../../../i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { inspectPhotoFramescaperHandoffSourcesV1, type PhotoFramescaperHandoffInspectionV1 } from '../../../../lightscaper/controller/photo-framescaper-handoff-inspect-v1.ts';
import { inspectPhotoFramescaperHandoffSourcesCurrentV1, type PhotoFramescaperHandoffInspectionCurrentV1 } from '../../../../lightscaper/controller/photo-framescaper-handoff-inspect-current-v1.ts';
import type { CapturedPhotoImageReceive, PhotoImageReceiveOutcome } from './photo-library-workflow-image-receive.ts';
import type { PhotoLibraryImageReceiveReceiptV1 } from '../../photo-library-image-receive-port-v1.ts';
import type { PhotoLibraryImageReceiveReceiptV2 } from '../../photo-library-image-receive-port-v2.ts';
import './photo-catalog-backup.css';

export interface PhotoFramescaperReceiveDialogProps {
	readonly locale: string; readonly capture: Readonly<CapturedPhotoImageReceive>; readonly isCurrent: () => boolean;
	readonly inspect?: typeof inspectPhotoFramescaperHandoffSourcesV1 | typeof inspectPhotoFramescaperHandoffSourcesCurrentV1;
	readonly registerDestination: (cancelAndJoin: () => Promise<void>) => () => void;
	readonly onImported: (receipt: Readonly<PhotoLibraryImageReceiveReceiptV1 | PhotoLibraryImageReceiveReceiptV2>) => void; readonly onClose: () => void;
}
interface Scope {
	readonly stop: AbortController; readonly before: Promise<void> | null; readonly capture: Readonly<CapturedPhotoImageReceive>;
	readonly inspect: typeof inspectPhotoFramescaperHandoffSourcesV1 | typeof inspectPhotoFramescaperHandoffSourcesCurrentV1;
	live: boolean; closed: boolean; retired: boolean; archive: File | null; active: Promise<void> | null; retirement: Promise<void> | null;
}
const CHECK = AbortSignal.prototype.throwIfAborted, REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
function check(current: Scope): void { Reflect.apply(CHECK, current.stop.signal, []); }

/** The menu owns one ephemeral archive choice. Inspection, publication and
 * recovery reload all join the existing Session destination retirement bridge. */
export default function PhotoFramescaperReceiveDialog(props: PhotoFramescaperReceiveDialogProps) {
	const latest = useRef(props); latest.current = props;
	const scope = useRef<Scope | null>(null), draining = useRef<Promise<void> | null>(null), fileInput = useRef<HTMLInputElement>(null);
	const [inspection, setInspection] = useState<Readonly<PhotoFramescaperHandoffInspectionV1 | PhotoFramescaperHandoffInspectionCurrentV1> | null>(null), [sourceId, setSourceId] = useState(''), [imageClipId, setImageClipId] = useState('');
	const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [failed, setFailed] = useState(false), [reloadFailed, setReloadFailed] = useState(false);
	const [outcome, setOutcome] = useState<Readonly<PhotoImageReceiveOutcome> | null>(null), [reloaded, setReloaded] = useState(false);
	const copy = photoFramescaperReceiveCopy(props.locale);
	const retire = useCallback((current: Scope): Promise<void> => {
		if (current.retirement) return current.retirement;
		current.closed = true; current.archive = null; current.stop.abort();
		if (current.live) { setInspection(null); setSourceId(''); setImageClipId(''); if (fileInput.current) fileInput.current.value = ''; }
		const joined = Promise.allSettled([current.before, current.active]).then(results => {
			const reason: unknown = Reflect.apply(REASON, current.stop.signal, []);
			const failures = results.filter(result => result.status === 'rejected' && !Object.is(result.reason, reason)).map(result => (result as PromiseRejectedResult).reason as unknown);
			if (failures.length === 1) throw failures[0];
			if (failures.length) throw new AggregateError(failures, 'Editable photo receive cleanup failed.');
		}).finally(() => { current.retired = true; });
		current.retirement = joined; draining.current = joined; void joined.catch(() => undefined); return joined;
	}, []);
	const { capture, registerDestination } = props;
	const inspect = props.inspect ?? (capture.schemaVersion === 2 ? inspectPhotoFramescaperHandoffSourcesCurrentV1 : inspectPhotoFramescaperHandoffSourcesV1);
	useLayoutEffect(() => {
		const receive = capture.receive, reload = capture.reload;
		const current: Scope = { stop: new AbortController(), before: draining.current, live: true, closed: false, retired: false,
			archive: null, active: null, retirement: null, inspect,
			capture: Object.freeze<CapturedPhotoImageReceive>({ ...(capture.schemaVersion === 2 ? { schemaVersion: 2 as const } : {}), receive: (request, signal) => Reflect.apply(receive, capture, [request, signal]) as ReturnType<typeof receive>,
				reload: signal => Reflect.apply(reload, capture, [signal]) as ReturnType<typeof reload> }) };
		scope.current = current; setInspection(null); setSourceId(''); setImageClipId(''); setOutcome(null); setBusy(false); setClosing(false); setFailed(false); setReloadFailed(false); setReloaded(false);
		const unregister = registerDestination(() => retire(current));
		return () => { current.live = false; unregister(); void retire(current).catch(() => undefined); };
	}, [capture, registerDestination, inspect, retire]);
	const present = (current: Scope) => current.live && !current.closed && scope.current === current && latest.current.isCurrent();
	const checked = (current: Scope) => { check(current); if (!present(current)) throw new DOMException('Photo receive presentation is closed.', 'AbortError'); };
	const start = (current: Scope, run: () => Promise<void>, reload = false) => {
		setBusy(true); setFailed(false); setReloadFailed(false);
		const work = Promise.resolve(current.before).then(run).catch(error => {
			if (present(current)) { if (reload) setReloadFailed(true); else setFailed(true); }
			throw error;
		}).finally(() => { if (current.active === work) current.active = null; if (present(current)) setBusy(false); });
		current.active = work; void work.catch(() => undefined);
	};
	const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
		const body = event.currentTarget.files?.[0]; event.currentTarget.value = '';
		const current = scope.current;
		if (!body || !current || current.active || !present(current)) return;
		current.archive = body; setInspection(null); setSourceId(''); setImageClipId(''); setOutcome(null); setReloaded(false);
		start(current, async () => {
			checked(current); const result = await current.inspect({ archive: body, signal: current.stop.signal }); checked(current); setInspection(result);
		});
	};
	const importPhoto = () => {
		const current = scope.current, archive = current?.archive;
		const selected = inspection?.sources.find(source => source.sourceId === sourceId), clip = selected?.imageClips?.find(clip => clip.clipId === imageClipId);
		if (!current || !archive || current.active || !present(current) || !selected || (selected.imageClips && !clip)) return;
		const request = Object.freeze({ archive, sourceId, ...(clip ? { imageClipId: clip.clipId } : {}) }); setOutcome(null); setReloaded(false);
		start(current, async () => {
			checked(current); const result = await current.capture.receive(request, current.stop.signal);
			// A returned Imported ACK remains durable. Presentation still belongs
			// only to this live menu generation, even if Close joined it later.
			if (!present(current)) return; setOutcome(result); latest.current.onImported(result.receipt);
		});
	};
	const reload = () => {
		const current = scope.current; if (!current || current.active || !present(current) || !outcome) return;
		start(current, async () => { checked(current); await current.capture.reload(current.stop.signal); checked(current); setReloaded(true); }, true);
	};
	const close = () => {
		const current = scope.current; if (!current?.live) return;
		if (current.closed) { if (current.retired && !closing) latest.current.onClose(); return; }
		setClosing(true); void retire(current).then(() => { if (current.live) latest.current.onClose(); }, () => { if (current.live) { setFailed(true); setClosing(false); } });
	};
	const selected = inspection?.sources.find(source => source.sourceId === sourceId), imageClips = selected?.imageClips;
	const clipSelected = !imageClips || imageClips.some(clip => clip.clipId === imageClipId);
	const needsReload = outcome && !reloaded && (outcome.refresh === 'failed' || outcome.receipt.settlement === 'recovery-pending');
	return <AudioEditorDialogShell title={copy.title} onClose={close} initialFocus="[data-photo-framescaper-receive-file]" className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-framescaper-receive-dialog className="lightscaper-catalog-backup">
			<p>{copy.description}</p>
			<label>{copy.file}<input ref={fileInput} type="file" accept=".fscape" data-photo-framescaper-receive-file disabled={busy || closing} onChange={selectFile} /></label>
			{inspection && <><p>{inspection.title}</p><label>{copy.source}<select data-photo-framescaper-receive-source value={sourceId} disabled={busy || closing} onChange={event => { setSourceId(event.currentTarget.value); setImageClipId(''); setFailed(false); setOutcome(null); }}>
				<option value="">{copy.choose}</option>{inspection.sources.map(source => <option key={source.sourceId} value={source.sourceId}>{source.name} — {source.originalName}</option>)}
			</select></label>{selected && <p>{copy.originalDimensions}: {selected.width} × {selected.height}</p>}
				{imageClips && <><p>{copy.ordinaryStill}</p><label>{copy.imageClip}<select data-photo-framescaper-receive-clip value={imageClipId} disabled={busy || closing} onChange={event => { setImageClipId(event.currentTarget.value); setFailed(false); setOutcome(null); }}>
					<option value="">{copy.chooseClip}</option>{imageClips.map((clip, index) => <option key={clip.clipId} value={clip.clipId}>{clip.sequenceName} — {clip.scope === 'timeline' ? copy.timeline : copy.projectBin}{imageClips.length > 1 ? ` (${String(index + 1)})` : ''}</option>)}
				</select></label></>}
				{inspection.unsupportedImageCount > 0 && <p>{copy.unavailable.replace('{count}', String(inspection.unsupportedImageCount))}</p>}
				{inspection.sources.length === 0 && <p>{copy.empty}</p>}</>}
			{(busy || closing) && <p role="status">{copy.working}</p>}
			{failed && <p role="alert">{copy.failed}</p>}{reloadFailed && <p role="alert">{copy.reloadFailed}</p>}
			{outcome && <p role="status" data-photo-framescaper-receive-receipt="imported">{needsReload ? (outcome.receipt.settlement === 'recovery-pending' ? copy.recovery : copy.refreshFailed) : copy.imported}</p>}
			<div className="lightscaper-catalog-backup-actions"><button type="button" data-photo-framescaper-receive-import disabled={!selected || !clipSelected || busy || closing || outcome !== null} onClick={importPhoto}>{copy.importPhoto}</button>
				{needsReload && <button type="button" disabled={busy || closing} onClick={reload}>{copy.reload}</button>}
				<button type="button" disabled={closing} onClick={close}>{copy.close}</button></div>
		</div>
	</AudioEditorDialogShell>;
}
