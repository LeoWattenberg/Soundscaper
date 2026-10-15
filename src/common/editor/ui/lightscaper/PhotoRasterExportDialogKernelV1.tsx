/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PhotoRasterExport, isPhotoRasterExportMetadataRefusal, type PhotoRasterExportReceipt, type PhotoRasterExportRequest } from '../../../../lightscaper/controller/photo-raster-export.ts';
import { formatImageExportFilenameV1 } from '../../image-export-filename-v1.ts';
import PhotoRasterExportSettings, { DEFAULT_RASTER_EXPORT_SETTINGS, captureRasterExportSettingsOutputV1, captureRasterExportSettingsOutputCurrentV1,
	restoreRasterExportSettings, restoreRasterExportSettingsCurrentV1 } from './PhotoRasterExportSettings.tsx';
import PhotoRasterExportPresets from './PhotoRasterExportPresets.tsx';
import type { PhotoRasterExportPresetV1 } from '../../photo-library-export-presets-port-v1.ts';
import { photoBatchExportCopy } from '../../../i18n/lightscaper-photo-batch-export-copy.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import GraphicWatermarkFields, { useGraphicWatermarkSelection } from '../GraphicWatermarkFields.tsx';
import './photo-catalog-backup.css';

import { PhotoRasterExportCurrentV1 } from '../../../../lightscaper/controller/photo-raster-export-current-v1.ts';
import type { PhotoRasterExportDialogProps, PhotoRasterExportDialogPropsCurrentV1 } from './PhotoRasterExportDialog.tsx';
import type { ExecutePhotoDevelopV2 } from '../../controller/shared/photo-library-develop-workflow-v2.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../../controller/shared/photo-library-develop-workflow-current-v1.ts';

type Props = (PhotoRasterExportDialogProps & Readonly<{ profile: 'legacy2' }>)
	| (PhotoRasterExportDialogPropsCurrentV1 & Readonly<{ profile: 'current3' }>);
interface Target { readonly versionId: string; readonly revision: number; readonly scope: Scope; }
interface Scope {
	readonly stop: AbortController; live: boolean; closed: boolean;
	preparing: Promise<void> | null; active: Promise<void> | null; retirement: Promise<void> | null;
}

/** Opt-in presentation; destination preparation is invoked directly in the original Save gesture. */
export default function PhotoRasterExportDialogKernelV1(props: Props) {
	const latest = useRef(props); latest.current = props;
	const rendered = {}, presentation = useRef(rendered); presentation.current = rendered;
	const owner = useRef<PhotoRasterExport | PhotoRasterExportCurrentV1 | null>(null);
	owner.current ??= props.profile === 'current3' ? new PhotoRasterExportCurrentV1(props.format) : new PhotoRasterExport(props.format);
	const scope = useRef<Scope | null>(null), retiring = useRef<Promise<void> | null>(null);
	const [target, setTarget] = useState<Target | null>(null), [receipt, setReceipt] = useState<PhotoRasterExportReceipt | null>(null);
	const [failed, setFailed] = useState(false), [saving, setSaving] = useState(false), [closing, setClosing] = useState(false);
	const [settings, setSettings] = useState(() => props.initialPreset ? (props.profile === 'current3'
		? restoreRasterExportSettingsCurrentV1(props.initialPreset.output, props.initialPreset.filenameTemplate, props.format)
		: restoreRasterExportSettings(props.initialPreset.output, props.initialPreset.filenameTemplate)) : DEFAULT_RASTER_EXPORT_SETTINGS), [invalidSettings, setInvalidSettings] = useState(false);
	const [metadataFailed, setMetadataFailed] = useState(false), [sidecarEnabled, setSidecarEnabled] = useState(props.initialPreset?.sidecarEnabled ?? false);
	const saveButton = useRef<HTMLButtonElement>(null), focused = useRef(false);
	const controller = owner.current, copy = props.copy, queueCopy = photoBatchExportCopy(props.locale);
	const graphic = useGraphicWatermarkSelection(useMemo(() => ({ execute: props.execute, photoId: props.photoId, registerDestination: props.registerDestination }),
		[props.execute, props.photoId, props.registerDestination]));
	const retire = useCallback((current: Scope) => {
		if (current.retirement) return current.retirement;
		let resolve!: () => void, reject!: (cause: unknown) => void;
		const joined = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		current.retirement = joined; retiring.current = joined; current.closed = true; current.stop.abort();
		void Promise.all([controller.cancelAndJoin(), current.preparing, current.active]).then(() => { resolve(); }, reject);
		return joined;
	}, [controller]);
	const { execute, photoId, registerDestination, profile } = props;
	useLayoutEffect(() => {
		const previous = retiring.current;
		const current: Scope = { stop: new AbortController(), live: true, closed: false, preparing: null, active: null, retirement: null };
		scope.current = current;
		const unregister = registerDestination(() => retire(current));
		current.preparing = Promise.resolve(previous).then(async () => {
			current.stop.signal.throwIfAborted(); let entered = false; const selected: { target: Target | null } = { target: null };
			const accept = (snapshot: Readonly<{ schemaVersion: 2 | 3; photoId: string; versionId: string; revision: number }>, isCurrent: () => boolean, signal: AbortSignal) => {
				signal.throwIfAborted(); if (!isCurrent() || current.closed) return;
				if (snapshot.schemaVersion !== (profile === 'current3' ? 3 : 2) || snapshot.photoId !== photoId) throw new Error('Selected photo export is unavailable.');
				selected.target = { versionId: snapshot.versionId, revision: snapshot.revision, scope: current };
			};
			const status = profile === 'current3' ? await (execute as ExecutePhotoDevelopCurrentV1)(async context => {
				entered = true; const port = await context.acquire(); context.signal.throwIfAborted();
				accept(await port.read({ schemaVersion: 3, photoId }, { signal: context.signal }), context.isCurrent, context.signal);
			}, current.stop.signal) : await (execute as ExecutePhotoDevelopV2)(async context => {
				entered = true; const port = await context.acquire(); context.signal.throwIfAborted();
				accept(await port.read({ schemaVersion: 2, photoId }, { signal: context.signal }), context.isCurrent, context.signal);
			}, current.stop.signal);
			if (current.live && !current.closed) {
				if (!entered || !selected.target || status !== 'completed') setFailed(true);
				else setTarget(selected.target);
			}
		}).catch(() => { if (current.live && !current.closed) setFailed(true); });
		return () => { current.live = false; unregister(); };
	}, [profile, execute, photoId, registerDestination, retire]);
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
			output = profile === 'current3' ? captureRasterExportSettingsOutputCurrentV1(settings, current.format) : captureRasterExportSettingsOutputV1(settings);
			graphicWatermark = graphic.capture();
			if (sidecarEnabled) { if (!current.captureSidecarReader) throw new Error('Photo sidecar reader is unavailable.'); sidecar = { read: current.captureSidecarReader() }; }
		} catch { setInvalidSettings(true); return; }
		setInvalidSettings(false); setMetadataFailed(false);
		setSaving(true); setReceipt(null);
		const prepareSave = runtime.prepareSave.bind(runtime), saveFile = runtime.saveFile.bind(runtime);
		// start() is deliberately called before any await or Promise continuation.
		const request = { photoId: current.photoId, versionId: target.versionId, expectedRevision: target.revision,
			fileName, output, fileTypeDescription: copy.fileType, ...(sidecar ? { sidecar, signal: lifetime.stop.signal } : {}),
			execute: current.execute, withOriginalFrame: current.withOriginalFrame, loadRenderer: current.loadRenderer,
			...(current.readMetadata ? { readMetadata: current.readMetadata } : {}),
			...(graphicWatermark ? { graphicWatermark } : {}), ...(current.withGraphicFrame ? { withGraphicFrame: current.withGraphicFrame } : {}),
			...(current.withTextFrame ? { withTextFrame: current.withTextFrame } : {}),
			prepareSave, saveFile, encode: current.encode };
		const work = current.profile === 'current3'
			? (controller as PhotoRasterExportCurrentV1).start({ ...request, execute: current.execute, loadRenderer: current.loadRenderer })
			: (controller as PhotoRasterExport).start({ ...request, execute: current.execute, loadRenderer: current.loadRenderer });
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
		setSettings(profile === 'current3' ? restoreRasterExportSettingsCurrentV1(preset.output, preset.filenameTemplate, input.format)
			: restoreRasterExportSettings(preset.output, preset.filenameTemplate)); setSidecarEnabled(preset.sidecarEnabled); setReceipt(null);
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
				currentFormat={profile === 'current3' ? props.format : undefined}
				onChange={value => { if (actionScope() && ready && !saving && !closing) { setSettings(value); setInvalidSettings(false); setMetadataFailed(false); } }} />
			<label><input type="checkbox" data-photo-raster-export-sidecar checked={sidecarEnabled} disabled={!ready || saving || closing || !!partialSidecar || !props.captureSidecarReader}
				onChange={event => { if (actionScope() && ready && !saving && !closing && !partialSidecar) { setSidecarEnabled(event.target.checked); setInvalidSettings(false); } }} />{copy.sidecar}</label>
			<p data-photo-raster-export-sidecar-help>{copy.sidecarHelp}</p>
			<GraphicWatermarkFields {...graphic} onChange={value => { if (actionScope() && ready && !saving && !closing) graphic.onChange(value); }} locale={props.locale} disabled={!ready || saving || closing} />
			<PhotoRasterExportPresets locale={props.locale} capture={props.capturePresets} registerDestination={registerDestination} disabled={!ready || saving || closing || !!partialSidecar}
				captureCurrent={(id, name) => {
					if (!actionScope() || !ready || saving || closing || partialSidecar) throw new Error('Export settings are currently protected.');
					return { schemaVersion: 1, id, name, format: props.format, filenameTemplate: settings.filenameTemplate, sidecarEnabled,
						output: profile === 'current3' ? captureRasterExportSettingsOutputCurrentV1(settings, props.format) : captureRasterExportSettingsOutputV1(settings) };
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
