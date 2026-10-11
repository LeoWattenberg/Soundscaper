/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PhotoRasterExportBatchQueue, type PhotoRasterExportBatchReceipt, type PhotoRasterExportBatchRuntime } from '../../../../lightscaper/controller/photo-raster-export-batch-queue.ts';
import { capturePhotoRasterExportBatchV1 } from '../../../../lightscaper/controller/photo-raster-export-batch-v1.ts';
import { PhotoRasterPersistedBatch } from '../../../../lightscaper/controller/photo-raster-export-persisted-batch.ts';
import { isPhotoRasterExportMemberCompleteV1 } from '../../../../lightscaper/storage/photo-raster-export-journal-v1.ts';
import type { ReadPhotoExportSidecar } from '../../photo-library-session-port-v2.ts';
import { capturePhotoRasterExportOutput } from '../../../../lightscaper/controller/photo-raster-export.ts';
import { encodePixelFramePngV1 } from '../../imaging/pixel-frame-png-v1.ts';
import { encodePixelFrameJpegV1 } from '../../imaging/pixel-frame-jpeg-v1.ts';
import { photoPngExportCopy } from '../../../i18n/lightscaper-photo-png-export-copy.ts';
import { photoJpegExportCopy } from '../../../i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoBatchExportCopy } from '../../../i18n/lightscaper-photo-batch-export-copy.ts';
import { imageExportGraphicCopy } from '../../../i18n/image-export-graphic-copy.ts';
import PhotoRasterExportSettings, { DEFAULT_RASTER_EXPORT_SETTINGS, rasterExportSizing, rasterExportText, restoreRasterExportSettings } from './PhotoRasterExportSettings.tsx';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import PhotoRasterExportPresets from './PhotoRasterExportPresets.tsx';
import GraphicWatermarkFields from '../GraphicWatermarkFields.tsx';
import { takeSelectedFile } from '../file-input-selection.ts';
import { usePhotoRasterBatchGraphic } from './use-photo-raster-batch-graphic.ts';
import './photo-catalog-backup.css';

import { PhotoRasterExportBatchQueueCurrentV1 } from '../../../../lightscaper/controller/photo-raster-export-batch-queue-current-v1.ts';
import { PhotoRasterPersistedBatchCurrentV1 } from '../../../../lightscaper/controller/photo-raster-export-persisted-batch-current-v1.ts';
import type { PhotoRasterBatchExportDialogProps, PhotoRasterBatchExportDialogPropsCurrentV1 } from './PhotoRasterBatchExportDialog.tsx';

type Props = (PhotoRasterBatchExportDialogProps & Readonly<{ profile: 'legacy2' }>)
	| (PhotoRasterBatchExportDialogPropsCurrentV1 & Readonly<{ profile: 'current3' }>);
interface Lifetime {
	readonly stop: AbortController; live: boolean; closed: boolean;
	readonly cancelGraphic: () => Promise<void>;
	preparing: Promise<void> | null; active: Promise<void> | null; retirement: Promise<void> | null;
	readSidecar: ReadPhotoExportSidecar | null; queue: PhotoRasterExportBatchQueue | PhotoRasterExportBatchQueueCurrentV1 | null; persisted: PhotoRasterPersistedBatch | PhotoRasterPersistedBatchCurrentV1 | null; unsubscribe: (() => void) | null;
}
interface Target { readonly owner: PhotoRasterPersistedBatch | PhotoRasterPersistedBatchCurrentV1; readonly lifetime: Lifetime; }

/** Hiding presentation never cancels its queue. The captured catalog registers
 * the joined preparation/job/destination lifetime, including hidden work. */
export default function PhotoRasterBatchExportDialogKernelV1(props: Props) {
	const latest = useRef(props); latest.current = props;
	const scope = useRef<Lifetime | null>(null), retiring = useRef<Promise<void> | null>(null);
	const [target, setTarget] = useState<Target | null>(null), [receipt, setReceipt] = useState<Readonly<PhotoRasterExportBatchReceipt> | null>(null);
	const [format, setFormat] = useState<'png' | 'jpeg'>('png'), [failed, setFailed] = useState(false), [invalid, setInvalid] = useState(false);
	const [sidecarEnabled, setSidecarEnabled] = useState(false);
	const [reviewed, setReviewed] = useState<readonly string[]>([]);
	const [discardReview, setDiscardReview] = useState(false), [discarding, setDiscarding] = useState(false), [discardFailed, setDiscardFailed] = useState(false);
	const [settings, setSettings] = useState({ ...DEFAULT_RASTER_EXPORT_SETTINGS, filenameTemplate: '{index:2}-{name}' });
	const copy = photoBatchExportCopy(props.locale), settingsCopy = format === 'png' ? photoPngExportCopy(props.locale) : photoJpegExportCopy(props.locale);
	const graphicCopy = imageExportGraphicCopy(props.locale);
	const journal = target?.owner.journal, recovery = target?.owner.recovery ?? [];
	const replaceable = !!journal && journal.members.every(isPhotoRasterExportMemberCompleteV1) && target?.owner.prepared !== null;
	const graphic = usePhotoRasterBatchGraphic(useMemo(() => ({ execute: props.execute, selection: props.selection, register: props.registerDestination }),
		[props.execute, props.selection, props.registerDestination]), props.registerDestination, !replaceable ? journal?.graphicWatermark : undefined);
	const retire = useCallback((current: Lifetime): Promise<void> => {
		if (current.retirement) return current.retirement;
		let resolve!: () => void, reject!: (cause: unknown) => void;
		const retirement = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		current.retirement = retirement; retiring.current = retirement;
		current.closed = true; current.stop.abort();
		void (async () => {
			const results = await Promise.allSettled([current.queue?.cancelAndJoin(), current.preparing, current.active, current.cancelGraphic()]);
			const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			try { await current.persisted?.closeAndJoin(); } catch (cause) { failures.push(cause); }
			if (failures.length === 1) throw failures[0];
			if (failures.length) throw new AggregateError(failures, 'Batch export retirement failed.');
		})().then(resolve, reject);
		return retirement;
	}, []);
	const { execute, selection, registerDestination, captureSidecarReader, captureJournal, profile } = props;
	const captureGraphicRetirement = graphic.captureRetirement;
	useLayoutEffect(() => {
		const previous = retiring.current;
		const current: Lifetime = { stop: new AbortController(), cancelGraphic: captureGraphicRetirement(), live: true, closed: false, preparing: null, active: null, retirement: null, readSidecar: null, queue: null, persisted: null, unsubscribe: null };
		scope.current = current;
		const unregister = registerDestination(() => retire(current));
		current.preparing = (async () => {
			if (!captureSidecarReader) throw new Error('Photo export journal requires its saved-photo reader.');
			const readSidecar = captureSidecarReader(), openJournal = captureJournal(); current.readSidecar = readSidecar;
			await previous;
			current.stop.signal.throwIfAborted();
			const owner = profile === 'current3'
				? await PhotoRasterPersistedBatchCurrentV1.prepare({ selection, execute: execute as PhotoRasterBatchExportDialogPropsCurrentV1['execute'], readSidecar, openJournal, signal: current.stop.signal })
				: await PhotoRasterPersistedBatch.prepare({ selection, execute: execute as PhotoRasterBatchExportDialogProps['execute'], readSidecar, openJournal, signal: current.stop.signal });
			current.persisted = owner;
			if (current.live && !current.closed) {
				const retained = owner.journal;
				if (retained) { setSettings(restoreRasterExportSettings(retained.output, retained.filenameTemplate)); setFormat(retained.format); setSidecarEnabled(Boolean(retained.sidecarEnabled)); }
				setTarget({ owner, lifetime: current });
				if (!owner.journal && !owner.prepared || owner.journal?.members.every(isPhotoRasterExportMemberCompleteV1)) latest.current.onSettled();
			}
		})().catch(() => { if (current.live && !current.closed) { setFailed(true); latest.current.onSettled(); } });
		return () => { current.live = false; current.unsubscribe?.(); unregister(); };
	}, [profile, execute, selection, registerDestination, retire, captureSidecarReader, captureJournal, captureGraphicRetirement]);
	const ready = target?.lifetime === scope.current && props.saveRuntime !== null && !failed && !props.preparationFailed && !scope.current?.closed && !discarding;
	const started = receipt !== null, busy = started && receipt.phase !== 'settled';
	const jobs = recovery.filter(row => row.disposition === 'eligible' || (row.disposition === 'needs-review' && row.currentMatches && reviewed.includes(row.member.jobId))).map(row => row.member.jobId);
	const canStart = journal ? jobs.length > 0 : !!target?.owner.prepared;
	const graphicNeeded = journal && !replaceable ? !!journal.graphicWatermark && journal.members.some(member => jobs.includes(member.jobId) && member.state !== 'committed') : graphic.value.enabled;
	const retainedRasterPending = journal?.members.some(member => member.state !== 'committed');
	const graphicReady = !graphic.pending && (!graphicNeeded || graphic.prepared !== null);
	const start = (replaceCompleted = false) => {
		const current = latest.current, lifetime = scope.current, runtime = current.saveRuntime;
		if (!lifetime?.live || lifetime.closed || lifetime.queue || lifetime.active || !target || target.lifetime !== lifetime || !runtime || !ready || !graphicReady) return;
		let plan: ReturnType<typeof capturePhotoRasterExportBatchV1>;
		const recovering = !!journal && !replaceCompleted;
		if (recovering && !jobs.length || replaceCompleted && !replaceable) return;
		const value = { schemaVersion: 1, batchId: current.batchId, format, filenameTemplate: settings.filenameTemplate, members: target.owner.prepared?.members };
		try {
			const output = capturePhotoRasterExportOutput({ sizing: rasterExportSizing(settings), quality: settings.quality, metadataScope: settings.metadataScope, ...rasterExportText(settings),
				...(settings.sharpen ? { sharpen: { amount: Number(settings.sharpenAmount), threshold: Number(settings.sharpenThreshold) } } : {}) });
			plan = recovering ? journal! : capturePhotoRasterExportBatchV1({ ...value, output, ...(sidecarEnabled ? { sidecarEnabled: true } : {}), ...(graphic.value.enabled && graphic.prepared ? { graphicWatermark: graphic.prepared.intent } : {}) });
		} catch { setInvalid(true); return; }
		setInvalid(false);
		const encode: PhotoRasterExportBatchRuntime['encode'] = (kind, frame, options) => kind === 'png' ? encodePixelFramePngV1(frame, options) : encodePixelFrameJpegV1(frame, { ...options, quality: 0.9 });
		const runtimeOptions = { fileTypeDescription: plan.format === 'png' ? photoPngExportCopy(current.locale).fileType : photoJpegExportCopy(current.locale).fileType,
			prepareDestinations: (admitted: Parameters<PhotoRasterExportBatchRuntime['prepareDestinations']>[0]) => recovering ? target.owner.prepareRecoveryDestinations(admitted, runtime, reviewed)
				: target.owner.prepareFreshDestinations(admitted, runtime, settings.filenameTemplate, replaceCompleted),
			...(plan.sidecarEnabled ? { readSidecar: lifetime.readSidecar! } : {}),
			execute: current.execute, withOriginalFrame: current.withOriginalFrame, loadRenderer: current.loadRenderer,
			...(current.readMetadata ? { readMetadata: current.readMetadata } : {}),
			...(graphicNeeded && graphic.prepared ? { graphicWatermark: graphic.prepared } : {}), ...(current.withGraphicFrame ? { withGraphicFrame: current.withGraphicFrame } : {}),
			encode };
		const queue = current.profile === 'current3'
			? new PhotoRasterExportBatchQueueCurrentV1({ ...runtimeOptions, execute: current.execute, loadRenderer: current.loadRenderer })
			: new PhotoRasterExportBatchQueue({ ...runtimeOptions, execute: current.execute, loadRenderer: current.loadRenderer });
		lifetime.queue = queue;
		if (current.profile === 'current3') current.onPending?.();
		lifetime.unsubscribe = queue.subscribe(snapshot => { if (lifetime.live) setReceipt(snapshot); });
		// The synchronous start captures every explicit target in this gesture.
		const work = recovering ? queue.startRecovery(journal, jobs) : queue.start({ ...value, output: plan.output, ...(plan.sidecarEnabled ? { sidecarEnabled: true } : {}), ...(plan.graphicWatermark ? { graphicWatermark: plan.graphicWatermark } : {}) });
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
			<PhotoRasterExportSettings value={settings} copy={settingsCopy} locale={props.locale} disabled={started || !ready || !!journal && !replaceable}
				onChange={value => { setSettings(value); setInvalid(false); }} />
			<PhotoRasterExportPresets locale={props.locale} capture={props.capturePresets} registerDestination={registerDestination} batch disabled={started || !ready || graphic.pending || !!journal && !replaceable}
				captureCurrent={(id, name) => ({ schemaVersion: 1, id, name, format, filenameTemplate: settings.filenameTemplate, sidecarEnabled,
					output: capturePhotoRasterExportOutput({ sizing: rasterExportSizing(settings), quality: settings.quality, metadataScope: settings.metadataScope, ...rasterExportText(settings),
						...(settings.sharpen ? { sharpen: { amount: Number(settings.sharpenAmount), threshold: Number(settings.sharpenThreshold) } } : {}) }) })}
				onApply={async preset => { const lifetime = scope.current; await graphic.reset(); if (!lifetime?.live || lifetime.closed || scope.current !== lifetime) return;
					setSettings(restoreRasterExportSettings(preset.output, preset.filenameTemplate)); setFormat(preset.format); setSidecarEnabled(preset.sidecarEnabled); setInvalid(false); }} />
			{journal?.graphicWatermark && !replaceable ? <fieldset disabled={started || !ready || graphic.pending} data-photo-batch-graphic-recovery>
				<p>{retainedRasterPending ? copy.graphicRecovery : copy.graphicSidecarOnly}</p>
				<dl data-photo-batch-graphic-placement>
					<dt>{graphicCopy.anchor}</dt><dd>{graphicCopy[journal.graphicWatermark.anchor]}</dd>
					<dt>{graphicCopy.width}</dt><dd>{journal.graphicWatermark.widthFraction * 100}%</dd>
					<dt>{graphicCopy.margin}</dt><dd>{journal.graphicWatermark.marginFraction * 100}%</dd>
					<dt>{graphicCopy.opacity}</dt><dd>{journal.graphicWatermark.opacity * 100}%</dd>
				</dl>
				{retainedRasterPending && <label>{copy.graphicReselect}<input type="file" data-photo-batch-graphic-reselect accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
					onChange={event => { graphic.reselect(takeSelectedFile(event.currentTarget)); }} /></label>}
			</fieldset> : <GraphicWatermarkFields value={graphic.value} onChange={graphic.onChange} disabled={started || !ready || graphic.pending} locale={props.locale} />}
			{graphic.pending && <p role="status" data-photo-batch-graphic-preparing>{copy.graphicPreparing}</p>}
			{graphic.failed && <p role="alert" data-photo-batch-graphic-invalid>{copy.graphicInvalid}</p>}
			<label>{settingsCopy.sidecar}<input type="checkbox" data-photo-batch-export-sidecar checked={sidecarEnabled} disabled={started || !ready || !!journal && !replaceable}
				onChange={event => { setSidecarEnabled(event.target.checked); }} /></label><p>{settingsCopy.sidecarHelp}</p>
			{invalid && <p role="alert">{settingsCopy.invalidSettings}</p>}
			{(failed || props.preparationFailed) && <p role="alert">{copy.failed}</p>}
			{!ready && !failed && !started && !discarding && <p role="status">{copy.preparing}</p>}
			{discarding && <p role="status">{copy.discarding}</p>}
			{discardFailed && <p role="alert">{copy.discardFailed}</p>}
			{ready && !journal && !target?.owner.prepared && <p role="status">{copy.empty}</p>}
			{journal && !receipt && <ol data-photo-export-journal>{recovery.map(row => <li key={row.member.jobId} data-photo-journal-job={row.member.jobId} data-journal-state={row.disposition}>
				<span>{row.member.fileName}</span><span>{row.disposition === 'already-committed' ? copy.downloaded.replace('{name}', row.member.fileName) : row.disposition === 'needs-review' ? copy.needsReview : row.disposition === 'stale' ? copy.stale : copy.queued}</span>
				{row.member.state === 'committed' && row.member.sidecar && row.member.sidecar.state !== 'committed' && <p data-photo-batch-sidecar-pending>{settingsCopy.sidecarPartial}</p>}
				{row.disposition === 'needs-review' && row.currentMatches && <label>{copy.review.replace('{name}', row.member.fileName)}<input type="checkbox" checked={reviewed.includes(row.member.jobId)}
					onChange={event => { setReviewed(value => event.target.checked ? [...value, row.member.jobId] : value.filter(id => id !== row.member.jobId)); }} /></label>}
			</li>)}</ol>}
			{journal && !started && journal.members.some(member => !isPhotoRasterExportMemberCompleteV1(member)) && <fieldset disabled={!ready}>
				<p>{copy.discardWarning}</p><label>{copy.discardReview}<input type="checkbox" data-photo-batch-export-discard-review checked={discardReview}
					onChange={event => { setDiscardReview(event.target.checked); }} /></label>
				<button type="button" data-photo-batch-export-discard disabled={!discardReview || !ready} onClick={discard}>{copy.discard}</button>
			</fieldset>}
			{receipt && <div data-photo-batch-export-receipt data-phase={receipt.phase} role="status">
				<p>{receipt.phase === 'settled' ? copy.settled : receipt.paused ? copy.paused : copy.running}</p>
				<ol>{receipt.members.map(member => <li key={member.jobId} data-photo-batch-job={member.jobId} data-state={member.state}>
					<span>{member.fileName}</span><span>{member.delivery?.status === 'download-started' ? copy.downloaded.replace('{name}', member.fileName) : labels[member.state]}</span>
					{member.delivery && member.delivery.status !== 'cancelled' && member.delivery.sidecar && <p data-photo-batch-sidecar-receipt data-sidecar-status={member.delivery.sidecar.status}>
						{member.delivery.sidecar.status === 'download-started' ? settingsCopy.sidecarSaved.replace('{name}', member.delivery.sidecar.fileName) : settingsCopy.sidecarPartial}</p>}
					{(member.state === 'queued' || member.state === 'running') && <button type="button" onClick={() => { cancelMember(member.jobId); }}>{copy.cancelMember}</button>}
				</li>)}</ol>
			</div>}
			<div className="lightscaper-catalog-backup-actions">
				<button type="button" data-photo-batch-export-start disabled={!ready || started || !canStart || !graphicReady} onClick={() => { start(); }}>{journal ? copy.continue : copy.start}</button>
				{replaceable && <button type="button" data-photo-batch-export-replace disabled={!ready || started || !graphicReady} onClick={() => { start(true); }}>{copy.replaceCompleted}</button>}
				{busy && <><button type="button" data-photo-batch-export-pause onClick={() => { const queue = scope.current?.queue; if (receipt.paused) queue?.resume(); else queue?.pause(); }}>{receipt.paused ? copy.resume : copy.pause}</button>
					<button type="button" data-photo-batch-export-cancel onClick={cancel}>{copy.cancel}</button></>}
				<button type="button" data-photo-batch-export-hide onClick={props.onHide}>{copy.hide}</button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}
