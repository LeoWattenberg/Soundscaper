/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import MotionAeExportPanel from './MotionAeExportPanel.tsx';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectStore } from '../../../../motionscaper/editor-project-store.ts';
import { commitMotionscaperAeImport, createMotionscaperAeImportCustody, prepareMotionscaperAeImport, type PreparedMotionscaperAeImport } from '../../../../motionscaper/editor-ae-import.ts';

const PAGE_SIZE = 50;
function download(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name;
	try { document.body.append(link); link.click(); } finally { link.remove(); globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function failureText(failure: unknown): string {
	if (failure instanceof AggregateError) return `${failure.message} ${failure.errors.map(failureText).join(' ')}`;
	return failure instanceof Error ? failure.message : String(failure);
}
export default function MotionAeBridgeDialog({ store, project, copy, busy, onOpen, onClose, initialFile }: Readonly<{
	store: MotionscaperProjectStore; project?: MotionscaperProject; copy: Readonly<Record<string, string>>; busy: boolean;
	onOpen: (id: string) => Promise<void>; onClose: () => void; initialFile?: File;
}>) {
	const id = useId(), alive = useRef(true), active = useRef<AbortController | null>(null);
	const [manifest, setManifest] = useState<File | null>(initialFile ?? null), [media, setMedia] = useState<readonly File[]>([]);
	const [prepared, setPrepared] = useState<PreparedMotionscaperAeImport | null>(null), [acknowledged, setAcknowledged] = useState(false);
	const [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null), [status, setStatus] = useState<string | null>(null);
	const [page, setPage] = useState(0), [importedId, setImportedId] = useState<string | null>(null);
	useEffect(() => { alive.current = true; return () => { alive.current = false; active.current?.abort(); }; }, []);
	const adobeProject = Boolean(manifest && /\.aepx?$/iu.test(manifest.name)), disabled = busy || working;
	const resetReview = () => { setPrepared(null); setAcknowledged(false); setPage(0); setError(null); setStatus(null); setImportedId(null); };
	const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
		if (disabled || active.current) return;
		const abort = new AbortController(); active.current = abort; setWorking(true); setError(null); setStatus(null);
		try { await operation(abort.signal); }
		catch (failure) { if (alive.current) {
			// A cleanup failure remains visible even when the initiating operation was cancelled.
			if (abort.signal.aborted && failure instanceof DOMException && failure.name === 'AbortError') setStatus(copy.motionscaperAeCancelled!);
			else setError(failureText(failure));
		} }
		finally { active.current = null; if (alive.current) setWorking(false); }
	};
	const review = () => run(async signal => {
		if (!manifest || adobeProject) return;
		setPrepared(null); setAcknowledged(false); setPage(0);
		const result = await prepareMotionscaperAeImport(manifest, media.map(file => ({ path: `media/${file.name}`, file })), {}, signal);
		signal.throwIfAborted(); if (alive.current) setPrepared(result);
	});
	const publish = () => run(async signal => {
		if (importedId) { await onOpen(importedId); return; }
		if (!prepared || !acknowledged) return;
		const project = await commitMotionscaperAeImport(prepared, { acknowledgeUnsupported: acknowledged }, value => store.beginImport(value), signal);
		// Publication is complete. A later cancellation or open failure cannot undo or duplicate it.
		if (alive.current) setImportedId(project.id); await onOpen(project.id);
	});
	const scripts = () => run(async signal => {
		const bridge = await import('../../../../motionscaper/editor-ae-bridge-download.ts'); signal.throwIfAborted();
		const blob = await bridge.createMotionscaperAeBridgeDownload(signal); signal.throwIfAborted();
		download(blob, bridge.MOTIONSCAPER_AE_BRIDGE_DOWNLOAD_NAME);
	});
	const rows = prepared?.report.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];
	return <AudioEditorDialogShell title={copy.motionscaperAfterEffectsBridge} width={860} onClose={disabled ? undefined : onClose}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>{working && <Button variant="secondary" onClick={() => active.current?.abort()}>{copy.motionscaperCancel}</Button>}<Button variant="secondary" disabled={disabled} onClick={onClose}>{copy.motionscaperClose}</Button></>} />}>
		<p>{copy.motionscaperAeQualification}</p><p>{copy.motionscaperAeInstructions}</p><p>{copy.motionscaperAeSampling}</p><p>{copy.motionscaperAeRendered}</p>
		<Button variant="secondary" disabled={disabled} onClick={() => { void scripts(); }}>{copy.motionscaperAeDownload}</Button>
		<MotionAeExportPanel project={project} store={store} copy={copy} disabled={disabled} run={run} download={download} />
		<fieldset disabled={disabled || Boolean(importedId)} className="motionscaper-timeline-actions"><legend>{copy.motionscaperAeReview}</legend>
			<label htmlFor={`${id}-manifest`}>{copy.motionscaperAeManifest}</label><input id={`${id}-manifest`} type="file" accept=".json,.aep,.aepx" onChange={event => { resetReview(); setManifest(event.currentTarget.files?.[0] ?? null); }} />
			{manifest && <p>{manifest.name}</p>}
			{adobeProject && <p role="status">{copy.motionscaperAeOriginalProject}</p>}
			<label htmlFor={`${id}-media`}>{copy.motionscaperAeMedia}</label><input id={`${id}-media`} type="file" multiple disabled={adobeProject} onChange={event => { resetReview(); setMedia(Array.from(event.currentTarget.files ?? [])); }} />
			<p>{copy.motionscaperAeLimits}</p>
			<Button variant="secondary" disabled={!manifest || adobeProject} onClick={() => { void review(); }}>{copy.motionscaperAeReview}</Button>
		</fieldset>
		{prepared && <section aria-label={copy.motionscaperAeReport}>
			<h3>{prepared.project.title}</h3><p>{copy.motionscaperAeCustody}</p>
			<p>{(['editable', 'sampled', 'rendered', 'unsupported'] as const).map(kind => <span key={kind}>{copy[`motionscaperAeStatus_${kind}`]}: {prepared.report.filter(item => item.status === kind).length}{' '}</span>)}</p>
			<table><thead><tr><th>{copy.motionscaperAeReportScope}</th><th>{copy.motionscaperAeReportMapping}</th><th>{copy.motionscaperAeReportDetail}</th></tr></thead><tbody>{rows.map((entry, index) => <tr key={page * PAGE_SIZE + index}>
				<td>{entry.scopeId} {entry.propertyPath}</td><td>{copy[`motionscaperAeStatus_${entry.status}`]}</td><td>{entry.message}</td>
			</tr>)}</tbody></table>
			{prepared.report.length > PAGE_SIZE && <div><Button variant="secondary" disabled={page === 0} onClick={() => setPage(value => value - 1)}>{copy.motionscaperAePrevious}</Button><span>{page + 1}/{Math.ceil(prepared.report.length / PAGE_SIZE)}</span><Button variant="secondary" disabled={(page + 1) * PAGE_SIZE >= prepared.report.length} onClick={() => setPage(value => value + 1)}>{copy.motionscaperAeNext}</Button></div>}
			<Button variant="secondary" disabled={disabled} onClick={() => download(createMotionscaperAeImportCustody(prepared), 'Motionscaper-AE-Import-Report.json')}>{copy.motionscaperAeDownloadReport}</Button>
			<label><input type="checkbox" disabled={disabled || Boolean(importedId)} checked={acknowledged} onChange={event => setAcknowledged(event.currentTarget.checked)} />{copy.motionscaperAeAcknowledge}</label>
			<Button variant="secondary" disabled={disabled || (!acknowledged && !importedId)} onClick={() => { void publish(); }}>{importedId ? copy.motionscaperAeOpenImported : copy.motionscaperAeImport}</Button>
		</section>}
		{working && <p role="status">{copy.motionscaperAeWorking}</p>}{status && <p role="status">{status}</p>}
		{error && <p role="alert">{copy.motionscaperAeFailed} {error}</p>}
	</AudioEditorDialogShell>;
}
