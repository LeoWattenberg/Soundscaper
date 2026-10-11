/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PhotoRasterExport, isPhotoRasterExportMetadataRefusal, capturePhotoRasterExportOutput, type PhotoRasterExportReceipt, type PhotoRasterExportRequest } from '../../../../lightscaper/controller/photo-raster-export.ts';
import { formatImageExportFilenameV1 } from '../../image-export-filename-v1.ts';
import PhotoRasterExportSettings, { DEFAULT_RASTER_EXPORT_SETTINGS, rasterExportSizing, rasterExportText, restoreRasterExportSettings } from './PhotoRasterExportSettings.tsx';
import PhotoRasterExportPresets from './PhotoRasterExportPresets.tsx';
import type { PhotoLibraryExportPresetsPortV1, PhotoRasterExportPresetV1 } from '../../photo-library-export-presets-port-v1.ts';
import type { ReadPhotoExportSidecar } from '../../photo-library-session-port-v2.ts';
import type { ExecutePhotoDevelopCurrent } from './photo-library-workflow-develop.ts';
import type { PhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import { photoBatchExportCopy } from '../../../i18n/lightscaper-photo-batch-export-copy.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import GraphicWatermarkFields, { useGraphicWatermarkSelection } from '../GraphicWatermarkFields.tsx';
import './photo-catalog-backup.css';

export interface PhotoRasterExportDialogProps {
	readonly format: 'png' | 'jpeg';
	readonly encode: PhotoRasterExportRequest['encode'];
	readonly copy: PhotoRasterExportCopy;
	readonly locale: string;
	readonly photoId: string;
	readonly fileName: string;
	readonly execute: ExecutePhotoDevelopCurrent;
	readonly withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'];
	readonly captureSidecarReader?: () => ReadPhotoExportSidecar;
	readonly readMetadata?: PhotoRasterExportRequest['readMetadata'];
	readonly withGraphicFrame?: PhotoRasterExportRequest['withGraphicFrame'];
	readonly withTextFrame?: PhotoRasterExportRequest['withTextFrame'];
	readonly loadRenderer: LoadPhotoLibraryDevelopProxyRuntimeV2;
	readonly saveRuntime: PhotoLibraryBackupSaveRuntimeV1 | null;
	readonly preparationFailed: boolean;
	readonly registerDestination: (cancelAndJoin: () => Promise<void>) => () => void;
	readonly capturePresets?: () => PhotoLibraryExportPresetsPortV1['open'];
	readonly initialPreset?: PhotoRasterExportPresetV1;
	readonly onApplyPreset?: (preset: PhotoRasterExportPresetV1) => void;
	readonly visible?: boolean;
	readonly onHide?: () => void;
	readonly onClose: () => void;
}
export interface PhotoRasterExportCopy {
	readonly title: string; readonly description: string; readonly save: string; readonly close: string;
	readonly preparing: string; readonly working: string; readonly saved: string; readonly downloadStarted: string;
	readonly cancelled: string; readonly failed: string; readonly summary: string; readonly fileType: string;
	readonly outputSize: string; readonly originalSize: string; readonly fitSize: string; readonly longEdgeSize: string;
	readonly megapixelsSize: string; readonly percentageSize: string; readonly width: string; readonly height: string;
	readonly pixels: string; readonly megapixels: string; readonly percentage: string; readonly allowUpscale: string;
	readonly resample: string; readonly nearest: string; readonly bilinear: string; readonly filenameTemplate: string;
	readonly filenameHelp: string; readonly invalidSettings: string;
	readonly metadata: string; readonly stripMetadata: string; readonly captureMetadata: string; readonly metadataHelp: string; readonly metadataFailed: string;
	readonly sidecar: string; readonly sidecarHelp: string; readonly sidecarSaved: string; readonly sidecarPartial: string; readonly sidecarRetry: string;
	readonly outputSharpen: string; readonly sharpenAmount: string; readonly sharpenThreshold: string;
}
interface Target { readonly versionId: string; readonly revision: number; readonly scope: Scope; }
interface Scope {
	readonly stop: AbortController; live: boolean; closed: boolean;
	preparing: Promise<void> | null; active: Promise<void> | null; retirement: Promise<void> | null;
}

/** Opt-in presentation; destination preparation is invoked directly in the original Save gesture. */
export default function PhotoRasterExportDialog(props: PhotoRasterExportDialogProps) {
	const latest = useRef(props); latest.current = props;
	const rendered = {}, presentation = useRef(rendered); presentation.current = rendered;
	const owner = useRef<PhotoRasterExport | null>(null); owner.current ??= new PhotoRasterExport(props.format);
	const scope = useRef<Scope | null>(null), retiring = useRef<Promise<void> | null>(null);
	const [target, setTarget] = useState<Target | null>(null), [receipt, setReceipt] = useState<PhotoRasterExportReceipt | null>(null);
	const [failed, setFailed] = useState(false), [saving, setSaving] = useState(false), [closing, setClosing] = useState(false);
	const [settings, setSettings] = useState(() => props.initialPreset ? restoreRasterExportSettings(props.initialPreset.output, props.initialPreset.filenameTemplate) : DEFAULT_RASTER_EXPORT_SETTINGS), [invalidSettings, setInvalidSettings] = useState(false);
	const [metadataFailed, setMetadataFailed] = useState(false), [sidecarEnabled, setSidecarEnabled] = useState(props.initialPreset?.sidecarEnabled ?? false);
	const saveButton = useRef<HTMLButtonElement>(null), focused = useRef(false);
	const controller = owner.current, copy = props.copy, queueCopy = photoBatchExportCopy(props.locale);
	const graphic = useGraphicWatermarkSelection(useMemo(() => ({ execute: props.execute, photoId: props.photoId, registerDestination: props.registerDestination }),
		[props.execute, props.photoId, props.registerDestination]));
	const retire = useCallback((current: Scope) => {
		if (current.retirement) return current.retirement;
		current.closed = true; current.stop.abort();
		const joined = Promise.all([controller.cancelAndJoin(), current.preparing, current.active]).then(() => undefined);
		current.retirement = joined; retiring.current = joined; return joined;
	}, [controller]);
	const { execute, photoId, registerDestination } = props;
	useLayoutEffect(() => {
		const previous = retiring.current;
		const current: Scope = { stop: new AbortController(), live: true, closed: false, preparing: null, active: null, retirement: null };
		scope.current = current;
		const unregister = registerDestination(() => retire(current));
		current.preparing = Promise.resolve(previous).then(async () => {
			current.stop.signal.throwIfAborted(); let entered = false; const selected: { target: Target | null } = { target: null };
			const status = await execute(async context => {
				entered = true; const port = await context.acquire(); context.signal.throwIfAborted();
				const snapshot = await port.read({ schemaVersion: 2, photoId }, { signal: context.signal });
				context.signal.throwIfAborted();
				if (!context.isCurrent() || current.closed) return;
				if (snapshot.schemaVersion !== 2 || snapshot.photoId !== photoId) throw new Error('Selected photo export is unavailable.');
				selected.target = { versionId: snapshot.versionId, revision: snapshot.revision, scope: current };
			}, current.stop.signal);
			if (current.live && !current.closed) {
				if (!entered || !selected.target || status !== 'completed') setFailed(true);
				else setTarget(selected.target);
			}
		}).catch(() => { if (current.live && !current.closed) setFailed(true); });
		return () => { current.live = false; unregister(); };
	}, [execute, photoId, registerDestination, retire]);
	const ready = target !== null && target.scope === scope.current && props.saveRuntime !== null && !failed && !props.preparationFailed && !scope.current?.closed;
	const isCurrentPresentation = () => latest.current === props && presentation.current === rendered && props.visible !== false;
	const actionScope = () => {
		const current = scope.current;
		return isCurrentPresentation() && current?.live && !current.closed && (!target || target.scope === current) ? current : null;
	};
	useLayoutEffect(() => {
		const button = saveButton.current;
		if (props.visible !== false && !focused.current && ready && !saving && button && !button.disabled) {
			button.focus({ preventScroll: true }); focused.current = button.ownerDocument.activeElement === button;
		}
	}, [ready, saving, props.visible]);
	const save = () => {
		const current = latest.current, runtime = current.saveRuntime;
		const lifetime = actionScope();
		if (!lifetime?.live || lifetime.closed || lifetime.active || !target || target.scope !== lifetime || !runtime || failed || current.preparationFailed) return;
		let sidecar: PhotoRasterExportRequest['sidecar'];
		let fileName: string, output: NonNullable<PhotoRasterExportRequest['output']>, graphicWatermark: PhotoRasterExportRequest['graphicWatermark'];
		try {
			fileName = formatImageExportFilenameV1({ template: settings.filenameTemplate, sourceFileName: current.fileName, format: current.format, index: 1 });
			output = capturePhotoRasterExportOutput({ sizing: rasterExportSizing(settings), quality: settings.quality, metadataScope: settings.metadataScope, ...rasterExportText(settings),
				...(settings.sharpen ? { sharpen: { amount: Number(settings.sharpenAmount), threshold: Number(settings.sharpenThreshold) } } : {}) });
			graphicWatermark = graphic.capture();
			if (sidecarEnabled) { if (!current.captureSidecarReader) throw new Error('Photo sidecar reader is unavailable.'); sidecar = { read: current.captureSidecarReader() }; }
		} catch { setInvalidSettings(true); return; }
		setInvalidSettings(false); setMetadataFailed(false);
		setSaving(true); setReceipt(null);
		const prepareSave = runtime.prepareSave.bind(runtime), saveFile = runtime.saveFile.bind(runtime);
		// start() is deliberately called before any await or Promise continuation.
		const work = controller.start({ photoId: current.photoId, versionId: target.versionId, expectedRevision: target.revision,
			fileName, output, fileTypeDescription: copy.fileType, ...(sidecar ? { sidecar, signal: lifetime.stop.signal } : {}),
			execute: current.execute, withOriginalFrame: current.withOriginalFrame, loadRenderer: current.loadRenderer,
			...(current.readMetadata ? { readMetadata: current.readMetadata } : {}),
			...(graphicWatermark ? { graphicWatermark } : {}), ...(current.withGraphicFrame ? { withGraphicFrame: current.withGraphicFrame } : {}),
			...(current.withTextFrame ? { withTextFrame: current.withTextFrame } : {}),
			prepareSave, saveFile, encode: current.encode });
		const joined = work.then(result => { if (lifetime.live) setReceipt(result); }, (error: unknown) => { if (lifetime.live) {
			if (isPhotoRasterExportMetadataRefusal(error)) setMetadataFailed(true); else setFailed(true);
		} })
			.finally(() => { if (lifetime.active === joined) lifetime.active = null; if (lifetime.live) setSaving(false); });
		lifetime.active = joined;
	};
	const partialSidecar = receipt?.status !== 'cancelled' && receipt?.sidecar && receipt.sidecar.status !== 'download-started';
	const applyPreset = async (preset: PhotoRasterExportPresetV1, signal: AbortSignal) => {
		const current = actionScope(), input = props;
		if (!current?.live || current.closed || current.active || !ready || closing || partialSidecar) throw new Error('Export settings are currently protected.');
		if (input.onApplyPreset) {
			setClosing(true); await retire(current); signal.throwIfAborted();
			if (latest.current !== input || input.visible === false || scope.current !== current || !current.live) throw new Error('Export presentation changed.');
			input.onApplyPreset(preset); return;
		}
		if (preset.format !== input.format) throw new Error('This export surface cannot change format.');
		setSettings(restoreRasterExportSettings(preset.output, preset.filenameTemplate)); setSidecarEnabled(preset.sidecarEnabled); setReceipt(null);
		graphic.onChange({ ...graphic.value, enabled: false, body: null });
	};
	const retrySidecar = () => {
		const lifetime = actionScope();
		if (!lifetime?.live || lifetime.closed || lifetime.active || !ready || closing || !partialSidecar) return;
		setSaving(true);
		const joined = controller.retrySidecar().then(result => { if (lifetime.live) setReceipt(result); }, () => { if (lifetime.live) setFailed(true); })
			.finally(() => { if (lifetime.active === joined) lifetime.active = null; if (lifetime.live) setSaving(false); });
		lifetime.active = joined;
	};
	const close = () => {
		const current = actionScope();
		if (!current?.live || current.closed || closing) return;
		setClosing(true);
		void retire(current).then(() => { if (current.live) latest.current.onClose(); }, () => { if (current.live) { setFailed(true); setClosing(false); } });
	};
	const hide = () => {
		if (actionScope() && !closing) props.onHide?.();
	};
	if (props.visible === false) return null;
	const number = new Intl.NumberFormat(props.locale);
	return <AudioEditorDialogShell title={copy.title} onClose={props.onHide ? hide : close} initialFocus={`[data-photo-${props.format}-export-save]`}
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div {...{ [`data-photo-${props.format}-export-dialog`]: true }} className="lightscaper-catalog-backup">
			<p>{copy.description}</p>
			<PhotoRasterExportSettings value={settings} copy={copy} locale={props.locale} disabled={!ready || saving || closing}
				onChange={value => { if (actionScope() && ready && !saving && !closing) { setSettings(value); setInvalidSettings(false); setMetadataFailed(false); } }} />
			<label><input type="checkbox" data-photo-raster-export-sidecar checked={sidecarEnabled} disabled={!ready || saving || closing || !!partialSidecar || !props.captureSidecarReader}
				onChange={event => { if (actionScope() && ready && !saving && !closing && !partialSidecar) { setSidecarEnabled(event.target.checked); setInvalidSettings(false); } }} />{copy.sidecar}</label>
			<p data-photo-raster-export-sidecar-help>{copy.sidecarHelp}</p>
			<GraphicWatermarkFields {...graphic} onChange={value => { if (actionScope() && ready && !saving && !closing) graphic.onChange(value); }} locale={props.locale} disabled={!ready || saving || closing} />
			<PhotoRasterExportPresets locale={props.locale} capture={props.capturePresets} registerDestination={registerDestination} disabled={!ready || saving || closing || !!partialSidecar}
				captureCurrent={(id, name) => {
					if (!actionScope() || !ready || saving || closing || partialSidecar) throw new Error('Export settings are currently protected.');
					return { schemaVersion: 1, id, name, format: props.format, filenameTemplate: settings.filenameTemplate, sidecarEnabled,
						output: capturePhotoRasterExportOutput({ sizing: rasterExportSizing(settings), quality: settings.quality, metadataScope: settings.metadataScope, ...rasterExportText(settings),
							...(settings.sharpen ? { sharpen: { amount: Number(settings.sharpenAmount), threshold: Number(settings.sharpenThreshold) } } : {}) }) };
				}} onApply={applyPreset} />
			{invalidSettings && <p role="alert">{copy.invalidSettings}</p>}
			{metadataFailed && <p role="alert" data-photo-raster-export-metadata-error>{copy.metadataFailed}</p>}
			{!ready && !failed && !props.preparationFailed && !saving && !closing && <p role="status">{copy.preparing}</p>}
			{(saving || closing) && <p role="status">{copy.working}</p>}
			{(failed || props.preparationFailed) && <p role="alert">{copy.failed}</p>}
			{receipt && <div role="status" {...{ [`data-photo-${props.format}-export-receipt`]: true, [`data-photo-${props.format}-export-status`]: receipt.status }}>
				<p>{receipt.status === 'cancelled' ? copy.cancelled : (receipt.status === 'saved' ? copy.saved : copy.downloadStarted).replace('{name}', receipt.fileName)}</p>
				{receipt.status !== 'cancelled' && receipt.sidecar && <p {...(partialSidecar ? { 'data-photo-raster-export-sidecar-partial': true } : { 'data-photo-raster-export-sidecar-receipt': true })}>{(partialSidecar ? copy.sidecarPartial : copy.sidecarSaved).replace('{name}', receipt.sidecar.fileName)}</p>}
				{receipt.status !== 'cancelled' && <p>{copy.summary.replace('{width}', number.format(receipt.width)).replace('{height}', number.format(receipt.height)).replace('{bytes}', number.format(receipt.byteLength))}</p>}
			</div>}
			<div className="lightscaper-catalog-backup-actions">
				{partialSidecar && <button type="button" data-photo-raster-export-sidecar-retry disabled={!ready || saving || closing} onClick={retrySidecar}>{copy.sidecarRetry}</button>}
				<button type="button" ref={saveButton} {...{ [`data-photo-${props.format}-export-save`]: true }} disabled={!ready || saving || closing || !!partialSidecar} onClick={save}>{copy.save}</button>
				{props.onHide && <button type="button" {...{ [`data-photo-${props.format}-export-hide`]: true }} disabled={closing} onClick={hide}>{queueCopy.hide}</button>}
				<button type="button" {...{ [`data-photo-${props.format}-export-close`]: true }} disabled={closing} onClick={close}>{props.onHide && saving ? queueCopy.cancel : copy.close}</button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}
