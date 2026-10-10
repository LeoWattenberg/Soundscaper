/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { PhotoRasterExportBatchQueue, type PhotoRasterExportBatchReceipt } from '../../../../lightscaper/controller/photo-raster-export-batch-queue.ts';
import { capturePhotoRasterExportBatchV1 } from '../../../../lightscaper/controller/photo-raster-export-batch-v1.ts';
import type { PhotoRasterBatchSelection } from '../../../../lightscaper/controller/photo-raster-export-batch-selection.ts';
import { PhotoRasterPersistedBatch } from '../../../../lightscaper/controller/photo-raster-export-persisted-batch.ts';
import type { PhotoLibraryExportJournalPort } from '../../photo-library-session-port-v2.ts';
import { capturePhotoRasterExportOutput } from '../../../../lightscaper/controller/photo-raster-export.ts';
import { encodePixelFramePngV1 } from '../../imaging/pixel-frame-png-v1.ts';
import { encodePixelFrameJpegV1 } from '../../imaging/pixel-frame-jpeg-v1.ts';
import { photoPngExportCopy } from '../../../i18n/lightscaper-photo-png-export-copy.ts';
import { photoJpegExportCopy } from '../../../i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoBatchExportCopy } from '../../../i18n/lightscaper-photo-batch-export-copy.ts';
import type { PhotoRasterExportDialogProps } from './PhotoRasterExportDialog.tsx';
import PhotoRasterExportSettings, { DEFAULT_RASTER_EXPORT_SETTINGS, rasterExportSizing, restoreRasterExportSettings } from './PhotoRasterExportSettings.tsx';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PhotoRasterExportPresets from './PhotoRasterExportPresets.tsx';
import './photo-catalog-backup.css';

type Ports = Omit<PhotoRasterExportDialogProps, 'format' | 'encode' | 'copy' | 'photoId' | 'fileName' | 'onClose'>;
export interface PhotoRasterBatchExportDialogProps extends Ports {
	readonly selection: readonly Readonly<PhotoRasterBatchSelection>[]; readonly batchId: string;
	readonly captureJournal: () => PhotoLibraryExportJournalPort['open'];
	readonly visible: boolean; readonly onHide: () => void; readonly onSettled: () => void;
}
interface Lifetime {
	readonly stop: AbortController; live: boolean; closed: boolean;
	preparing: Promise<void> | null; active: Promise<void> | null; retirement: Promise<void> | null;
	queue: PhotoRasterExportBatchQueue | null; persisted: PhotoRasterPersistedBatch | null; unsubscribe: (() => void) | null;
}
interface Target { readonly owner: PhotoRasterPersistedBatch; readonly lifetime: Lifetime; }

/** Hiding presentation never cancels its queue. The captured catalog registers
 * the joined preparation/job/destination lifetime, including hidden work. */
export default function PhotoRasterBatchExportDialog(props: PhotoRasterBatchExportDialogProps) {
	const latest = useRef(props); latest.current = props;
	const scope = useRef<Lifetime | null>(null), retiring = useRef<Promise<void> | null>(null);
	const [target, setTarget] = useState<Target | null>(null), [receipt, setReceipt] = useState<Readonly<PhotoRasterExportBatchReceipt> | null>(null);
	const [format, setFormat] = useState<'png' | 'jpeg'>('png'), [failed, setFailed] = useState(false), [invalid, setInvalid] = useState(false);
	const [reviewed, setReviewed] = useState<readonly string[]>([]);
	const [discardReview, setDiscardReview] = useState(false), [discarding, setDiscarding] = useState(false), [discardFailed, setDiscardFailed] = useState(false);
	const [settings, setSettings] = useState({ ...DEFAULT_RASTER_EXPORT_SETTINGS, filenameTemplate: '{index:2}-{name}' });
	const copy = photoBatchExportCopy(props.locale), settingsCopy = format === 'png' ? photoPngExportCopy(props.locale) : photoJpegExportCopy(props.locale);
	const retire = useCallback((current: Lifetime): Promise<void> => {
		if (current.retirement) return current.retirement;
		current.closed = true; current.stop.abort();
		current.retirement = Promise.all([current.queue?.cancelAndJoin(), current.preparing, current.active]).then(async () => { await current.persisted?.closeAndJoin(); });
		retiring.current = current.retirement; return current.retirement;
	}, []);
	const { execute, selection, registerDestination, captureSidecarReader, captureJournal } = props;
	useLayoutEffect(() => {
		const previous = retiring.current;
		const current: Lifetime = { stop: new AbortController(), live: true, closed: false, preparing: null, active: null, retirement: null, queue: null, persisted: null, unsubscribe: null };
		scope.current = current;
		const unregister = registerDestination(() => retire(current));
		current.preparing = (async () => {
			if (!captureSidecarReader) throw new Error('Photo export journal requires its saved-photo reader.');
			const readSidecar = captureSidecarReader(), openJournal = captureJournal();
			await previous;
			current.stop.signal.throwIfAborted();
			const owner = await PhotoRasterPersistedBatch.prepare({ selection, execute, readSidecar, openJournal, signal: current.stop.signal });
			current.persisted = owner;
			if (current.live && !current.closed) {
				const retained = owner.journal;
				if (retained) { setSettings(restoreRasterExportSettings(retained.output, retained.filenameTemplate)); setFormat(retained.format); }
				setTarget({ owner, lifetime: current });
				if (!owner.journal && !owner.prepared || owner.journal?.members.every(member => member.state === 'committed')) latest.current.onSettled();
			}
		})().catch(() => { if (current.live && !current.closed) { setFailed(true); latest.current.onSettled(); } });
		return () => { current.live = false; current.unsubscribe?.(); unregister(); };
	}, [execute, selection, registerDestination, retire, captureSidecarReader, captureJournal]);
	const ready = target?.lifetime === scope.current && props.saveRuntime !== null && !failed && !props.preparationFailed && !scope.current?.closed && !discarding;
	const started = receipt !== null, busy = started && receipt.phase !== 'settled';
	const journal = target?.owner.journal, recovery = target?.owner.recovery ?? [];
	const jobs = recovery.filter(row => row.disposition === 'eligible' || (row.disposition === 'needs-review' && row.currentMatches && reviewed.includes(row.member.jobId))).map(row => row.member.jobId);
	const replaceable = !!journal && journal.members.every(member => member.state === 'committed') && target?.owner.prepared !== null;
	const canStart = journal ? jobs.length > 0 : !!target?.owner.prepared;
	const start = (replaceCompleted = false) => {
		const current = latest.current, lifetime = scope.current, runtime = current.saveRuntime;
		if (!lifetime?.live || lifetime.closed || lifetime.queue || lifetime.active || !target || target.lifetime !== lifetime || !runtime || !ready) return;
		let plan: ReturnType<typeof capturePhotoRasterExportBatchV1>;
		const recovering = !!journal && !replaceCompleted;
		if (recovering && !jobs.length || replaceCompleted && !replaceable) return;
		const value = { schemaVersion: 1, batchId: current.batchId, format, filenameTemplate: settings.filenameTemplate, members: target.owner.prepared?.members };
		try {
			const output = capturePhotoRasterExportOutput({ sizing: rasterExportSizing(settings), quality: settings.quality, metadataScope: settings.metadataScope,
				...(settings.sharpen ? { sharpen: { amount: Number(settings.sharpenAmount), threshold: Number(settings.sharpenThreshold) } } : {}) });
			plan = recovering ? journal! : capturePhotoRasterExportBatchV1({ ...value, output });
		} catch { setInvalid(true); return; }
		setInvalid(false);
		const queue = new PhotoRasterExportBatchQueue({ fileTypeDescription: plan.format === 'png' ? photoPngExportCopy(current.locale).fileType : photoJpegExportCopy(current.locale).fileType,
			prepareDestinations: admitted => recovering ? target.owner.prepareRecoveryDestinations(admitted, runtime, reviewed)
				: target.owner.prepareFreshDestinations(admitted, runtime, settings.filenameTemplate, replaceCompleted),
			execute: current.execute, withOriginalFrame: current.withOriginalFrame, loadRenderer: current.loadRenderer,
			...(current.readMetadata ? { readMetadata: current.readMetadata } : {}),
			encode: (kind, frame, options) => kind === 'png' ? encodePixelFramePngV1(frame, options) : encodePixelFrameJpegV1(frame, { ...options, quality: 0.9 }) });
		lifetime.queue = queue;
		lifetime.unsubscribe = queue.subscribe(snapshot => { if (lifetime.live) setReceipt(snapshot); });
		// The synchronous start captures every explicit target in this gesture.
		const work = recovering ? queue.startRecovery(journal, jobs) : queue.start({ ...value, output: plan.output });
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
	const discard = () => {
		const lifetime = scope.current;
		if (!ready || started || !discardReview || !journal || !target || target.lifetime !== lifetime || !lifetime?.live || lifetime.closed || lifetime.active) return;
		const review = { batchId: journal.batchId, revision: journal.revision, reviewed: true };
		setDiscarding(true); setDiscardFailed(false);
		lifetime.active = target.owner.discardUnfinished(review).then(() => {
			if (!lifetime.live || lifetime.closed) return;
			setTarget({ owner: target.owner, lifetime }); setDiscardReview(false); setReviewed([]); latest.current.onSettled();
		}, () => { if (lifetime.live && !lifetime.closed) setDiscardFailed(true); }).finally(() => {
			lifetime.active = null; if (lifetime.live && !lifetime.closed) setDiscarding(false);
		});
	};
	if (!props.visible) return null;
	const labels = { queued: copy.queued, running: copy.running, completed: copy.saved, failed: copy.memberFailed, cancelled: copy.cancelled };
	return <AudioEditorDialogShell title={copy.title} onClose={props.onHide} initialFocus="[data-photo-batch-export-start]"
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div data-photo-batch-export-dialog className="lightscaper-catalog-backup">
			<p>{copy.description}</p>
			<label>{copy.format}<select data-photo-batch-export-format value={journal && !replaceable ? journal.format : format} disabled={started || !ready || !!journal && !replaceable}
				onChange={event => { if (event.target.value === 'png' || event.target.value === 'jpeg') setFormat(event.target.value); }}>
				<option value="png">{copy.png}</option><option value="jpeg">{copy.jpeg}</option>
			</select></label>
			<PhotoRasterExportSettings value={settings} copy={settingsCopy} disabled={started || !ready || !!journal && !replaceable}
				onChange={value => { setSettings(value); setInvalid(false); }} />
			<PhotoRasterExportPresets locale={props.locale} capture={props.capturePresets} registerDestination={registerDestination} batch disabled={started || !ready || !!journal && !replaceable}
				captureCurrent={(id, name) => ({ schemaVersion: 1, id, name, format, filenameTemplate: settings.filenameTemplate, sidecarEnabled: false,
					output: capturePhotoRasterExportOutput({ sizing: rasterExportSizing(settings), quality: settings.quality, metadataScope: settings.metadataScope,
						...(settings.sharpen ? { sharpen: { amount: Number(settings.sharpenAmount), threshold: Number(settings.sharpenThreshold) } } : {}) }) })}
				onApply={preset => { setSettings(restoreRasterExportSettings(preset.output, preset.filenameTemplate)); setFormat(preset.format); setInvalid(false); }} />
			{invalid && <p role="alert">{settingsCopy.invalidSettings}</p>}
			{(failed || props.preparationFailed) && <p role="alert">{copy.failed}</p>}
			{!ready && !failed && !started && !discarding && <p role="status">{copy.preparing}</p>}
			{discarding && <p role="status">{copy.discarding}</p>}
			{discardFailed && <p role="alert">{copy.discardFailed}</p>}
			{ready && !journal && !target?.owner.prepared && <p role="status">{copy.empty}</p>}
			{journal && !receipt && <ol data-photo-export-journal>{recovery.map(row => <li key={row.member.jobId} data-photo-journal-job={row.member.jobId} data-journal-state={row.disposition}>
				<span>{row.member.fileName}</span><span>{row.disposition === 'already-committed' ? copy.downloaded.replace('{name}', row.member.fileName) : row.disposition === 'needs-review' ? copy.needsReview : row.disposition === 'stale' ? copy.stale : copy.queued}</span>
				{row.disposition === 'needs-review' && row.currentMatches && <label>{copy.review.replace('{name}', row.member.fileName)}<input type="checkbox" checked={reviewed.includes(row.member.jobId)}
					onChange={event => { setReviewed(value => event.target.checked ? [...value, row.member.jobId] : value.filter(id => id !== row.member.jobId)); }} /></label>}
			</li>)}</ol>}
			{journal && !started && journal.members.some(member => member.state !== 'committed') && <fieldset disabled={!ready}>
				<p>{copy.discardWarning}</p><label>{copy.discardReview}<input type="checkbox" data-photo-batch-export-discard-review checked={discardReview}
					onChange={event => { setDiscardReview(event.target.checked); }} /></label>
				<button type="button" data-photo-batch-export-discard disabled={!discardReview || !ready} onClick={discard}>{copy.discard}</button>
			</fieldset>}
			{receipt && <div data-photo-batch-export-receipt data-phase={receipt.phase} role="status">
				<p>{receipt.phase === 'settled' ? copy.settled : receipt.paused ? copy.paused : copy.running}</p>
				<ol>{receipt.members.map(member => <li key={member.jobId} data-photo-batch-job={member.jobId} data-state={member.state}>
					<span>{member.fileName}</span><span>{member.delivery?.status === 'download-started' ? copy.downloaded.replace('{name}', member.fileName) : labels[member.state]}</span>
					{(member.state === 'queued' || member.state === 'running') && <button type="button" onClick={() => { cancelMember(member.jobId); }}>{copy.cancelMember}</button>}
				</li>)}</ol>
			</div>}
			<div className="lightscaper-catalog-backup-actions">
				<button type="button" data-photo-batch-export-start disabled={!ready || started || !canStart} onClick={() => { start(); }}>{journal ? copy.continue : copy.start}</button>
				{replaceable && <button type="button" data-photo-batch-export-replace disabled={!ready || started} onClick={() => { start(true); }}>{copy.replaceCompleted}</button>}
				{busy && <><button type="button" data-photo-batch-export-pause onClick={() => { const queue = scope.current?.queue; if (receipt.paused) queue?.resume(); else queue?.pause(); }}>{receipt.paused ? copy.resume : copy.pause}</button>
					<button type="button" data-photo-batch-export-cancel onClick={cancel}>{copy.cancel}</button></>}
				<button type="button" data-photo-batch-export-hide onClick={props.onHide}>{copy.hide}</button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}
