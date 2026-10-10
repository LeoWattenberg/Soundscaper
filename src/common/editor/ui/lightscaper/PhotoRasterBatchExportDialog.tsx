/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { PhotoRasterExportBatchQueue, type PhotoRasterExportBatchReceipt } from '../../../../lightscaper/controller/photo-raster-export-batch-queue.ts';
import { capturePhotoRasterExportBatchV1 } from '../../../../lightscaper/controller/photo-raster-export-batch-v1.ts';
import { preparePhotoRasterBatchSelection, type PhotoRasterBatchSelection, type PreparedPhotoRasterBatchSelection } from '../../../../lightscaper/controller/photo-raster-export-batch-selection.ts';
import { createPhotoRasterBatchDownloadDestinations } from '../../../../lightscaper/controller/photo-raster-export-batch-download-destinations.ts';
import { capturePhotoRasterExportOutput } from '../../../../lightscaper/controller/photo-raster-export.ts';
import { encodePixelFramePngV1 } from '../../imaging/pixel-frame-png-v1.ts';
import { encodePixelFrameJpegV1 } from '../../imaging/pixel-frame-jpeg-v1.ts';
import { photoPngExportCopy } from '../../../i18n/lightscaper-photo-png-export-copy.ts';
import { photoJpegExportCopy } from '../../../i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoBatchExportCopy } from '../../../i18n/lightscaper-photo-batch-export-copy.ts';
import type { PhotoRasterExportDialogProps } from './PhotoRasterExportDialog.tsx';
import PhotoRasterExportSettings, { DEFAULT_RASTER_EXPORT_SETTINGS, rasterExportSizing } from './PhotoRasterExportSettings.tsx';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import './photo-catalog-backup.css';

type Ports = Omit<PhotoRasterExportDialogProps, 'format' | 'encode' | 'copy' | 'photoId' | 'fileName' | 'onClose'>;
export interface PhotoRasterBatchExportDialogProps extends Ports {
	readonly selection: readonly Readonly<PhotoRasterBatchSelection>[]; readonly batchId: string;
	readonly visible: boolean; readonly onHide: () => void; readonly onSettled: () => void;
}
interface Lifetime {
	readonly stop: AbortController; live: boolean; closed: boolean;
	preparing: Promise<void> | null; active: Promise<void> | null; retirement: Promise<void> | null;
	queue: PhotoRasterExportBatchQueue | null; unsubscribe: (() => void) | null;
}
interface Target { readonly prepared: Readonly<PreparedPhotoRasterBatchSelection>; readonly lifetime: Lifetime; }

/** Hiding presentation never cancels its queue. The captured catalog registers
 * the joined preparation/job/destination lifetime, including hidden work. */
export default function PhotoRasterBatchExportDialog(props: PhotoRasterBatchExportDialogProps) {
	const latest = useRef(props); latest.current = props;
	const scope = useRef<Lifetime | null>(null), retiring = useRef<Promise<void> | null>(null);
	const [target, setTarget] = useState<Target | null>(null), [receipt, setReceipt] = useState<Readonly<PhotoRasterExportBatchReceipt> | null>(null);
	const [format, setFormat] = useState<'png' | 'jpeg'>('png'), [failed, setFailed] = useState(false), [invalid, setInvalid] = useState(false);
	const [settings, setSettings] = useState({ ...DEFAULT_RASTER_EXPORT_SETTINGS, filenameTemplate: '{index:2}-{name}' });
	const copy = photoBatchExportCopy(props.locale), settingsCopy = format === 'png' ? photoPngExportCopy(props.locale) : photoJpegExportCopy(props.locale);
	const retire = useCallback((current: Lifetime): Promise<void> => {
		if (current.retirement) return current.retirement;
		current.closed = true; current.stop.abort();
		current.retirement = Promise.all([current.queue?.cancelAndJoin(), current.preparing, current.active]).then(() => undefined);
		retiring.current = current.retirement; return current.retirement;
	}, []);
	const { execute, selection, registerDestination } = props;
	useLayoutEffect(() => {
		const previous = retiring.current;
		const current: Lifetime = { stop: new AbortController(), live: true, closed: false, preparing: null, active: null, retirement: null, queue: null, unsubscribe: null };
		scope.current = current;
		const unregister = registerDestination(() => retire(current));
		current.preparing = Promise.resolve(previous).then(async () => {
			current.stop.signal.throwIfAborted();
			const prepared = await preparePhotoRasterBatchSelection(selection, execute, current.stop.signal);
			if (current.live && !current.closed) setTarget({ prepared, lifetime: current });
		}).catch(() => { if (current.live && !current.closed) { setFailed(true); latest.current.onSettled(); } });
		return () => { current.live = false; current.unsubscribe?.(); unregister(); };
	}, [execute, selection, registerDestination, retire]);
	const ready = target?.lifetime === scope.current && props.saveRuntime !== null && !failed && !props.preparationFailed && !scope.current?.closed;
	const started = receipt !== null, busy = started && receipt.phase !== 'settled';
	const start = () => {
		const current = latest.current, lifetime = scope.current, runtime = current.saveRuntime;
		if (!lifetime?.live || lifetime.closed || lifetime.queue || !target || target.lifetime !== lifetime || !runtime || !ready) return;
		let plan: ReturnType<typeof capturePhotoRasterExportBatchV1>;
		const value = { schemaVersion: 1, batchId: current.batchId, format, filenameTemplate: settings.filenameTemplate, members: target.prepared.members };
		try {
			const output = capturePhotoRasterExportOutput({ sizing: rasterExportSizing(settings), quality: settings.quality, metadataScope: settings.metadataScope,
				...(settings.sharpen ? { sharpen: { amount: Number(settings.sharpenAmount), threshold: Number(settings.sharpenThreshold) } } : {}) });
			plan = capturePhotoRasterExportBatchV1({ ...value, output });
		} catch { setInvalid(true); return; }
		setInvalid(false);
		const queue = new PhotoRasterExportBatchQueue({ fileTypeDescription: settingsCopy.fileType,
			prepareDestinations: admitted => createPhotoRasterBatchDownloadDestinations(admitted, runtime),
			execute: current.execute, withOriginalFrame: current.withOriginalFrame, loadRenderer: current.loadRenderer,
			...(current.readMetadata ? { readMetadata: current.readMetadata } : {}),
			encode: (kind, frame, options) => kind === 'png' ? encodePixelFramePngV1(frame, options) : encodePixelFrameJpegV1(frame, { ...options, quality: 0.9 }) });
		lifetime.queue = queue;
		lifetime.unsubscribe = queue.subscribe(snapshot => { if (lifetime.live) setReceipt(snapshot); });
		// The synchronous start captures every explicit target in this gesture.
		const work = queue.start({ ...value, output: plan.output });
		lifetime.active = work.then(snapshot => { if (lifetime.live) setReceipt(snapshot); }, () => { if (lifetime.live) setFailed(true); })
			.finally(() => { if (lifetime.live) latest.current.onSettled(); });
	};
	const cancel = () => {
		const current = scope.current;
		if (!current?.live || current.closed) return;
		void retire(current).catch(() => { if (current.live) setFailed(true); });
	};
	const cancelMember = (jobId: string) => {
		const current = scope.current;
		if (current?.live && !current.closed && current.queue) void current.queue.cancelMember(jobId).catch(() => { if (current.live) setFailed(true); });
	};
	if (!props.visible) return null;
	const labels = { queued: copy.queued, running: copy.running, completed: copy.saved, failed: copy.memberFailed, cancelled: copy.cancelled };
	return <AudioEditorDialogShell title={copy.title} onClose={props.onHide} initialFocus="[data-photo-batch-export-start]"
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-batch-export-dialog className="lightscaper-catalog-backup">
			<p>{copy.description}</p>
			<label>{copy.format}<select data-photo-batch-export-format value={format} disabled={started || !ready}
				onChange={event => { if (event.target.value === 'png' || event.target.value === 'jpeg') setFormat(event.target.value); }}>
				<option value="png">{copy.png}</option><option value="jpeg">{copy.jpeg}</option>
			</select></label>
			<PhotoRasterExportSettings value={settings} copy={settingsCopy} disabled={started || !ready}
				onChange={value => { setSettings(value); setInvalid(false); }} />
			{invalid && <p role="alert">{settingsCopy.invalidSettings}</p>}
			{(failed || props.preparationFailed) && <p role="alert">{copy.failed}</p>}
			{!ready && !failed && !started && <p role="status">{copy.preparing}</p>}
			{receipt && <div data-photo-batch-export-receipt data-phase={receipt.phase} role="status">
				<p>{receipt.phase === 'settled' ? copy.settled : receipt.paused ? copy.paused : copy.running}</p>
				<ol>{receipt.members.map(member => <li key={member.jobId} data-photo-batch-job={member.jobId} data-state={member.state}>
					<span>{member.fileName}</span><span>{member.delivery?.status === 'download-started' ? copy.downloaded.replace('{name}', member.fileName) : labels[member.state]}</span>
					{(member.state === 'queued' || member.state === 'running') && <button type="button" onClick={() => { cancelMember(member.jobId); }}>{copy.cancelMember}</button>}
				</li>)}</ol>
			</div>}
			<div className="lightscaper-catalog-backup-actions">
				<button type="button" data-photo-batch-export-start disabled={!ready || started} onClick={start}>{copy.start}</button>
				{busy && <><button type="button" data-photo-batch-export-pause onClick={() => { const queue = scope.current?.queue; if (receipt.paused) queue?.resume(); else queue?.pause(); }}>{receipt.paused ? copy.resume : copy.pause}</button>
					<button type="button" data-photo-batch-export-cancel onClick={cancel}>{copy.cancel}</button></>}
				<button type="button" data-photo-batch-export-hide onClick={props.onHide}>{copy.hide}</button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}
