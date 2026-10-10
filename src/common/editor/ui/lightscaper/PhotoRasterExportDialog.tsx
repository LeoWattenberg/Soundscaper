/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { PhotoRasterExport, capturePhotoRasterExportOutput, type PhotoRasterExportReceipt, type PhotoRasterExportRequest } from '../../../../lightscaper/controller/photo-raster-export.ts';
import { formatImageExportFilenameV1 } from '../../image-export-filename-v1.ts';
import PhotoRasterExportSettings, { DEFAULT_RASTER_EXPORT_SETTINGS, rasterExportSizing } from './PhotoRasterExportSettings.tsx';
import type { ExecutePhotoDevelopCurrent } from './photo-library-workflow-develop.ts';
import type { PhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import type { LoadPhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
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
	readonly loadRenderer: LoadPhotoLibraryDevelopProxyRuntimeV2;
	readonly saveRuntime: PhotoLibraryBackupSaveRuntimeV1 | null;
	readonly preparationFailed: boolean;
	readonly registerDestination: (cancelAndJoin: () => Promise<void>) => () => void;
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
}
interface Target { readonly versionId: string; readonly revision: number; readonly scope: Scope; }
interface Scope {
	readonly stop: AbortController; live: boolean; closed: boolean;
	preparing: Promise<void> | null; active: Promise<void> | null; retirement: Promise<void> | null;
}

/** Opt-in presentation; destination preparation is invoked directly in the original Save gesture. */
export default function PhotoRasterExportDialog(props: PhotoRasterExportDialogProps) {
	const latest = useRef(props); latest.current = props;
	const owner = useRef<PhotoRasterExport | null>(null); owner.current ??= new PhotoRasterExport(props.format);
	const scope = useRef<Scope | null>(null), retiring = useRef<Promise<void> | null>(null);
	const [target, setTarget] = useState<Target | null>(null), [receipt, setReceipt] = useState<PhotoRasterExportReceipt | null>(null);
	const [failed, setFailed] = useState(false), [saving, setSaving] = useState(false), [closing, setClosing] = useState(false);
	const [settings, setSettings] = useState(DEFAULT_RASTER_EXPORT_SETTINGS), [invalidSettings, setInvalidSettings] = useState(false);
	const saveButton = useRef<HTMLButtonElement>(null), focused = useRef(false);
	const controller = owner.current, copy = props.copy;
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
	useLayoutEffect(() => {
		const button = saveButton.current;
		if (!focused.current && ready && !saving && button && !button.disabled) {
			button.focus({ preventScroll: true }); focused.current = button.ownerDocument.activeElement === button;
		}
	}, [ready, saving]);
	const save = () => {
		const current = latest.current, runtime = current.saveRuntime;
		const lifetime = scope.current;
		if (!lifetime?.live || lifetime.closed || lifetime.active || !target || target.scope !== lifetime || !runtime || failed || current.preparationFailed) return;
		let fileName: string, output: NonNullable<PhotoRasterExportRequest['output']>;
		try {
			fileName = formatImageExportFilenameV1({ template: settings.filenameTemplate, sourceFileName: current.fileName, format: current.format, index: 1 });
			output = capturePhotoRasterExportOutput({ sizing: rasterExportSizing(settings), quality: settings.quality });
		} catch { setInvalidSettings(true); return; }
		setInvalidSettings(false);
		setSaving(true); setReceipt(null);
		// start() is deliberately called before any await or Promise continuation.
		const work = controller.start({ photoId: current.photoId, versionId: target.versionId, expectedRevision: target.revision,
			fileName, output, fileTypeDescription: copy.fileType,
			execute: current.execute, withOriginalFrame: current.withOriginalFrame, loadRenderer: current.loadRenderer,
			prepareSave: request => runtime.prepareSave(request), saveFile: request => runtime.saveFile(request), encode: current.encode });
		const joined = work.then(result => { if (lifetime.live) setReceipt(result); }, () => { if (lifetime.live) setFailed(true); })
			.finally(() => { if (lifetime.active === joined) lifetime.active = null; if (lifetime.live) setSaving(false); });
		lifetime.active = joined;
	};
	const close = () => {
		const current = scope.current;
		if (!current?.live || current.closed || closing) return;
		setClosing(true);
		void retire(current).then(() => { if (current.live) latest.current.onClose(); }, () => { if (current.live) { setFailed(true); setClosing(false); } });
	};
	const number = new Intl.NumberFormat(props.locale);
	return <AudioEditorDialogShell title={copy.title} onClose={close} initialFocus={`[data-photo-${props.format}-export-save]`}
		className="lightscaper-dialog" overlayClassName="lightscaper-dialog-backdrop" closeOnOutside={false}>
		<div {...{ [`data-photo-${props.format}-export-dialog`]: true }} className="lightscaper-catalog-backup">
			<p>{copy.description}</p>
			<PhotoRasterExportSettings value={settings} copy={copy} disabled={!ready || saving || closing}
				onChange={value => { setSettings(value); setInvalidSettings(false); }} />
			{invalidSettings && <p role="alert">{copy.invalidSettings}</p>}
			{!ready && !failed && !props.preparationFailed && !saving && !closing && <p role="status">{copy.preparing}</p>}
			{(saving || closing) && <p role="status">{copy.working}</p>}
			{(failed || props.preparationFailed) && <p role="alert">{copy.failed}</p>}
			{receipt && <div role="status" {...{ [`data-photo-${props.format}-export-receipt`]: true, [`data-photo-${props.format}-export-status`]: receipt.status }}>
				<p>{receipt.status === 'cancelled' ? copy.cancelled : (receipt.status === 'saved' ? copy.saved : copy.downloadStarted).replace('{name}', receipt.fileName)}</p>
				{receipt.status !== 'cancelled' && <p>{copy.summary.replace('{width}', number.format(receipt.width)).replace('{height}', number.format(receipt.height)).replace('{bytes}', number.format(receipt.byteLength))}</p>}
			</div>}
			<div className="lightscaper-catalog-backup-actions">
				<button type="button" ref={saveButton} {...{ [`data-photo-${props.format}-export-save`]: true }} disabled={!ready || saving || closing} onClick={save}>{copy.save}</button>
				<button type="button" {...{ [`data-photo-${props.format}-export-close`]: true }} disabled={closing} onClick={close}>{copy.close}</button>
			</div>
		</div>
	</AudioEditorDialogShell>;
}
