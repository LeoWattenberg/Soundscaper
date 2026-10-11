/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { decodeMotionChannel } from '../../motion-surface.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionAssetReader } from '../../../../motionscaper/editor-render-resources.ts';
import { renderMotionscaperDelivery } from '../../../../motionscaper/editor-render-delivery.ts';
import { motionCompositionHasAudio } from '../../motion-composition-audio.ts';
import { motionscaperDesktopDelivery } from '../../../../motionscaper/desktop-delivery-adapter.ts';
import type { MOTION_PRORES_DELIVERY_PROFILE } from '../../../../motionscaper/desktop-delivery-contract.ts';
import { motionDocumentFileName } from '../../../../motionscaper/editor-document-file-name.ts';

type Format = 'png' | 'mp4' | 'webm' | 'prores';
interface StreamingPicker { showSaveFilePicker?(options: { suggestedName: string; types: readonly { description: string; accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle> }

export default function MotionRenderDialog({ copy, project, store, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; store: MotionAssetReader; onClose: () => void;
}>) {
	const composition = project.compositions.find((entry) => entry.id === project.primaryCompositionId)!;
	const id = useId(); const cancellation = useRef<AbortController | null>(null); const mounted = useRef(true);
	const [format, setFormat] = useState<Format>('png'); const [firstFrame, setFirstFrame] = useState(0); const [endFrame, setEndFrame] = useState(composition.durationFrames);
	const [nativeProfile, setNativeProfile] = useState<typeof MOTION_PRORES_DELIVERY_PROFILE | null>(null);
	const [excludeAudio, setExcludeAudio] = useState(false);
	const authoredAudio = motionCompositionHasAudio(project, composition.id);
	const [background, setBackground] = useState('#000000'); const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null); const [progress, setProgress] = useState<readonly [number, number] | null>(null); const [complete, setComplete] = useState(false);
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try { const profile = await motionscaperDesktopDelivery()?.getProfile(); if (!cancelled) setNativeProfile(profile ?? null); }
			catch (failure) { if (!cancelled) setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!); }
		})();
		return () => { cancelled = true; };
	}, [copy]);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancellation.current?.abort(); }; }, []);
	const render = async () => {
		const controller = new AbortController(); cancellation.current = controller;
		setBusy(true); setError(null); setComplete(false); setProgress(null);
		try {
			if (!Number.isSafeInteger(firstFrame) || !Number.isSafeInteger(endFrame) || firstFrame < 0 || endFrame <= firstFrame || endFrame > composition.durationFrames) throw new Error(copy.motionscaperRenderRangeInvalid);
			const extension = format === 'png' ? 'tar' : format === 'prores' ? 'mov' : format;
			const fileName = motionDocumentFileName(project.title).replace(/\.mscape$/u, `.${extension}`);
			const picker = globalThis as StreamingPicker;
			let writable: WritableStream<Uint8Array> | undefined;
			if (format !== 'prores' && picker.showSaveFilePicker) {
				const handle = await picker.showSaveFilePicker({ suggestedName: fileName, types: [{ description: copy.motionscaperRender!,
					accept: { [format === 'png' ? 'application/x-tar' : `video/${format}`]: [`.${extension}`] } }] });
				controller.signal.throwIfAborted(); writable = await handle.createWritable();
			}
			const channel = (offset: number) => decodeMotionChannel(Number.parseInt(background.slice(offset, offset + 2), 16) / 255, 'srgb');
			const output = await renderMotionscaperDelivery({ project, store, compositionId: composition.id, firstFrame, endFrame, format, excludeAudio,
				background: [channel(1), channel(3), channel(5)], writable, signal: controller.signal,
				onProgress: (completed, total) => { if (mounted.current) setProgress([completed, total]); } });
			if (output instanceof Blob) {
				const url = URL.createObjectURL(output); const link = document.createElement('a'); link.href = url; link.download = fileName;
				document.body.append(link); link.click(); link.remove(); globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
			}
			if (mounted.current) setComplete(true);
		} catch (failure) {
			if (mounted.current && !(failure instanceof DOMException && failure.name === 'AbortError')) setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!);
		} finally { cancellation.current = null; if (mounted.current) setBusy(false); }
	};
	const submit = (event: FormEvent) => { event.preventDefault(); void render(); };
	return <AudioEditorDialogShell title={copy.motionscaperRenderTitle} onClose={onClose} width={480} initialFocus="[data-motion-render-format]"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" onClick={() => { if (busy) cancellation.current?.abort(); else onClose(); }}>{busy ? copy.motionscaperCancel : copy.motionscaperClose}</Button>
			<Button variant="primary" disabled={busy || (format === 'prores' && authoredAudio && !excludeAudio)} type="submit" form={id}>{copy.motionscaperRender}</Button>
		</>} />}>
		<form id={id} onSubmit={submit} className="motionscaper-settings-form"><fieldset disabled={busy}>
			<label htmlFor={`${id}-format`}>{copy.motionscaperOutputFormat}</label><select id={`${id}-format`} data-motion-render-format value={format} onChange={(event) => setFormat(event.currentTarget.value as Format)}>
				<option value="png">{copy.motionscaperPngSequence}</option><option value="mp4">{copy.motionscaperMp4}</option><option value="webm">{copy.motionscaperWebm}</option>
				{nativeProfile && <option value="prores">{copy.motionscaperProres}</option>}
			</select>
			<label className="motionscaper-number-field"><span>{copy.motionscaperFirstFrame}</span><input type="number" min={0} max={composition.durationFrames - 1} step={1} required value={firstFrame} onChange={(event) => setFirstFrame(event.currentTarget.valueAsNumber)} /></label>
			<label className="motionscaper-number-field"><span>{copy.motionscaperEndFrame}</span><input type="number" min={1} max={composition.durationFrames} step={1} required value={endFrame} onChange={(event) => setEndFrame(event.currentTarget.valueAsNumber)} /></label>
			{(format === 'mp4' || format === 'webm') && <><label className="motionscaper-number-field"><span>{copy.motionscaperRenderBackground}</span><input type="color" value={background} onChange={(event) => setBackground(event.currentTarget.value)} /></label><p>{copy.motionscaperVideoOpaque}</p></>}
			{format === 'png' && <p>{copy.motionscaperPngWithoutAudio}</p>}
			{format === 'prores' && <><p>{copy.motionscaperProresProfile}</p><p>{copy.motionscaperNativeWithoutAudio}</p>
				{authoredAudio && <label><input type="checkbox" checked={excludeAudio} onChange={(event) => setExcludeAudio(event.currentTarget.checked)} />{copy.motionscaperExcludeAudio}</label>}
			</>}
		</fieldset></form>
		{error && <p role="alert">{error}</p>}
		<p role="status">{complete ? copy.motionscaperRenderComplete : busy ? copy.motionscaperWorking : ''}</p>
		{progress && busy && <progress value={progress[0]} max={progress[1]} aria-label={copy.motionscaperRenderProgress} />}
	</AudioEditorDialogShell>;
}
