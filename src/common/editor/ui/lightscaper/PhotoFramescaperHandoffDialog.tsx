/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { photoFramescaperHandoffCopy } from '../../../i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { PhotoFramescaperHandoffDownload, type PhotoFramescaperHandoffDownloadReceipt, type PhotoFramescaperHandoffTarget,
} from '../../../../lightscaper/controller/photo-framescaper-handoff-download.ts';
import { isPhotoFramescaperHandoffTargetCurrentV1, type PreparePhotoFramescaperHandoffSelectedV1, type PhotoFramescaperHandoffTargetCurrentV1 } from '../../../../lightscaper/controller/photo-framescaper-handoff-download-current-v1.ts';
import { exportPhotoFramescaperHandoffArchiveV1 } from '../../../../lightscaper/controller/photo-framescaper-handoff-archive-v1.ts';
import { exportPhotoFramescaperHandoffArchiveCurrentV1 } from '../../../../lightscaper/controller/photo-framescaper-handoff-archive-current-v1.ts';
import type { PhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import './photo-catalog-backup.css';

export interface PhotoFramescaperHandoffDialogProps {
	readonly locale: string; readonly photoId: string; readonly fileName: string;
	readonly prepare: PreparePhotoFramescaperHandoffSelectedV1; readonly isSelected: () => boolean;
	readonly saveRuntime: PhotoLibraryBackupSaveRuntimeV1 | null;
	readonly registerDestination: (cancelAndJoin: () => Promise<void>) => () => void; readonly onClose: () => void;
}
interface Scope {
	readonly stop: AbortController; live: boolean; closed: boolean;
	preparing: Promise<void> | null; active: Promise<void> | null; retirement: Promise<void> | null;
}
export default function PhotoFramescaperHandoffDialog(props: PhotoFramescaperHandoffDialogProps) {
	const { prepare, photoId, registerDestination } = props;
	const latest = useRef(props); latest.current = props;
	const controller = useRef<PhotoFramescaperHandoffDownload | null>(null); controller.current ??= new PhotoFramescaperHandoffDownload();
	const owner = controller.current, scope = useRef<Scope | null>(null), draining = useRef<Promise<void> | null>(null);
	const [target, setTarget] = useState<Readonly<{ owner: Scope; value: PhotoFramescaperHandoffTarget | PhotoFramescaperHandoffTargetCurrentV1 }> | null>(null);
	const [failed, setFailed] = useState(false), [saving, setSaving] = useState(false), [closing, setClosing] = useState(false);
	const [receipt, setReceipt] = useState<PhotoFramescaperHandoffDownloadReceipt | null>(null), button = useRef<HTMLButtonElement>(null);
	const copy = photoFramescaperHandoffCopy(props.locale);
	const retire = useCallback((current: Scope) => {
		if (current.retirement) return current.retirement;
		current.closed = true; current.stop.abort();
		const joined = Promise.allSettled([current.preparing, current.active, owner.cancelAndJoin()]).then(results => {
			const failures = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown);
			if (failures.length === 1) throw failures[0];
			if (failures.length) throw new AggregateError(failures, 'Editable photo copy cleanup failed.');
		});
		current.retirement = joined; draining.current = joined; void joined.catch(() => undefined); return joined;
	}, [owner]);
	useLayoutEffect(() => {
		const current: Scope = { stop: new AbortController(), live: true, closed: false, preparing: null, active: null, retirement: null };
		scope.current = current; setTarget(null); setFailed(false); setReceipt(null); setClosing(false); setSaving(false);
		const unregister = registerDestination(() => retire(current)), before = draining.current;
		const preparing = Promise.resolve(before).then(async () => {
			current.stop.signal.throwIfAborted();
			const selected = await prepare(photoId, current.stop.signal); current.stop.signal.throwIfAborted();
			if (!latest.current.isSelected()) throw new Error('The selected photo changed.');
			const check = selected.checkCurrent;
			const value = Object.freeze({ ...selected, checkCurrent: async (signal: AbortSignal) => {
				if (!latest.current.isSelected()) throw new Error('The selected photo changed.');
				await Reflect.apply(check, selected, [signal]) as void;
				if (!latest.current.isSelected()) throw new Error('The selected photo changed.');
			} });
			if (current.live && !current.closed) setTarget({ owner: current, value });
		}).catch(() => { if (current.live && !current.closed) setFailed(true); });
		current.preparing = preparing;
		return () => { current.live = false; unregister(); void retire(current).catch(() => undefined); };
	}, [prepare, photoId, registerDestination, retire]);
	useLayoutEffect(() => { if (target && !saving && !closing) button.current?.focus(); }, [target, saving, closing]);
	const download = () => {
		const current = scope.current, input = latest.current, runtime = input.saveRuntime;
		if (!current?.live || current.closed || current.active || target?.owner !== current || !runtime || !input.isSelected()) return;
		setSaving(true); setFailed(false); setReceipt(null);
		const prepareSave = runtime.prepareSave.bind(runtime), saveFile = runtime.saveFile.bind(runtime);
		const delivery = { fileName: input.fileName, fileTypeDescription: copy.fileType, signal: current.stop.signal, prepareSave, saveFile };
		const work = isPhotoFramescaperHandoffTargetCurrentV1(target.value)
			? owner.startCurrent({ ...delivery, target: target.value, buildArchive: exportPhotoFramescaperHandoffArchiveCurrentV1 })
			: owner.start({ ...delivery, target: target.value, buildArchive: exportPhotoFramescaperHandoffArchiveV1 });
		const active = work.then(value => { if (current.live && !current.closed) setReceipt(value); }, () => { if (current.live && !current.closed) setFailed(true); })
			.finally(() => { if (current.active === active) current.active = null; if (current.live && !current.closed) setSaving(false); });
		current.active = active;
	};
	const close = () => {
		const current = scope.current; if (!current?.live || current.closed) return;
		setClosing(true); void retire(current).then(() => { if (current.live) latest.current.onClose(); }, () => { if (current.live) { setFailed(true); setClosing(false); } });
	};
	return <AudioEditorDialogShell title={copy.title} onClose={close} initialFocus="[data-photo-framescaper-handoff-download]" className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-framescaper-handoff-dialog className="lightscaper-catalog-backup">
			<p>{copy.description}</p><p>{copy.next}</p><p>{props.fileName}</p>
			{!target && !failed && <p role="status">{copy.preparing}</p>}
			{(saving || closing) && <p role="status">{copy.working}</p>}
			{failed && <p role="alert">{copy.failed}</p>}
			{receipt && <p role="status" data-photo-framescaper-handoff-receipt={receipt.status}>{receipt.status === 'cancelled' ? copy.cancelled
				: (receipt.status === 'saved' ? copy.saved : copy.downloadStarted).replace('{name}', receipt.fileName)}</p>}
			<div className="lightscaper-catalog-backup-actions"><button ref={button} type="button" data-photo-framescaper-handoff-download disabled={!target || !props.saveRuntime || saving || closing || failed} onClick={download}>{copy.download}</button>
				<button type="button" disabled={closing} onClick={close}>{copy.close}</button></div>
		</div>
	</AudioEditorDialogShell>;
}
