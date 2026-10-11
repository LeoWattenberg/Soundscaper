/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { motionWorkAreaOutputFrames } from '../../motion-work-area-output.ts';
import { decodeMotionChannel } from '../../motion-surface.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperDeliveryQueue } from '../../../../motionscaper/editor-delivery-queue.ts';
import { chooseMotionRenderDestination, downloadMotionRender } from './motion-render-download.ts';
import { motionCompositionHasAudio } from '../../motion-composition-audio.ts';
import { motionscaperDesktopDelivery } from '../../../../motionscaper/desktop-delivery-adapter.ts';
import type { MOTION_PRORES_DELIVERY_PROFILE } from '../../../../motionscaper/desktop-delivery-contract.ts';

type Format = 'png' | 'mp4' | 'webm' | 'prores';

export default function MotionRenderDialog({ copy, project, queue, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; queue: MotionscaperDeliveryQueue; onClose: () => void;
}>) {
	const [compositionId, setCompositionId] = useState(project.primaryCompositionId);
	const composition = project.compositions.find((entry) => entry.id === compositionId)!;
	const area = motionWorkAreaOutputFrames(composition);
	const id = useId(); const cancellation = useRef<AbortController | null>(null); const mounted = useRef(true);
	const [format, setFormat] = useState<Format>('png'); const [firstFrame, setFirstFrame] = useState(area.firstFrame); const [endFrame, setEndFrame] = useState(area.endFrame);
	const [nativeProfile, setNativeProfile] = useState<typeof MOTION_PRORES_DELIVERY_PROFILE | null>(null);
	const [excludeAudio, setExcludeAudio] = useState(false);
	const authoredAudio = motionCompositionHasAudio(project, composition.id);
	const [background, setBackground] = useState('#000000'); const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null); const [complete, setComplete] = useState(false);
	const [jobId, setJobId] = useState<string | null>(null); const jobs = useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
	const job = jobs.find(entry => entry.id === jobId);
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
		setBusy(true); setError(null); setComplete(false); setJobId(null);
		let writable: WritableStream<Uint8Array> | undefined;
		try {
			if (!Number.isSafeInteger(firstFrame) || !Number.isSafeInteger(endFrame) || firstFrame < 0 || endFrame <= firstFrame || endFrame > composition.durationFrames) throw new Error(copy.motionscaperRenderRangeInvalid);
			writable = await chooseMotionRenderDestination(project.title, format, copy.motionscaperRender);
			controller.signal.throwIfAborted();
			const channel = (offset: number) => decodeMotionChannel(Number.parseInt(background.slice(offset, offset + 2), 16) / 255, 'srgb');
			const handle = queue.enqueue({ project, compositionId: composition.id, firstFrame, endFrame, format, excludeAudio,
				background: [channel(1), channel(3), channel(5)], writable });
			writable = undefined; cancellation.current = null; setJobId(handle.id);
			const output = await handle.completion;
			if (output instanceof Blob) downloadMotionRender(output, project.title, format);
			if (mounted.current) setComplete(true);
		} catch (failure) {
			if (writable) { try { await writable.abort(failure); } catch (cleanup) { if (mounted.current) setError(cleanup instanceof Error ? cleanup.message : copy.motionscaperFailed); } }
			if (mounted.current && !(failure instanceof DOMException && failure.name === 'AbortError')) setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!);
		} finally { cancellation.current = null; if (mounted.current) setBusy(false); }
	};
	const empty = firstFrame === endFrame;
	const selectComposition = (value: string) => {
		const selected = project.compositions.find((entry) => entry.id === value); if (!selected) return;
		const range = motionWorkAreaOutputFrames(selected); setCompositionId(value); setFirstFrame(range.firstFrame); setEndFrame(range.endFrame); setComplete(false); setError(null);
	};
	const submit = (event: FormEvent) => { event.preventDefault(); void render(); };
	return <AudioEditorDialogShell title={copy.motionscaperRenderTitle} onClose={onClose} width={480} initialFocus="[data-motion-render-format]"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			<Button variant="secondary" onClick={onClose}>{copy.motionscaperClose}</Button>
			{busy && <Button variant="secondary" onClick={() => { cancellation.current?.abort(); if (jobId) void queue.cancel(jobId).catch(failure => setError(failure instanceof Error ? failure.message : copy.motionscaperFailed)); }}>{copy.motionscaperCancel}</Button>}
			<Button variant="primary" disabled={busy || empty || (format === 'prores' && authoredAudio && nativeProfile?.audio !== 'pcm-s24le' && !excludeAudio)} type="submit" form={id}>{copy.motionscaperRender}</Button>
		</>} />}>
		<form id={id} onSubmit={submit} className="motionscaper-settings-form"><fieldset disabled={busy}>
			<label htmlFor={`${id}-composition`}>{copy.motionscaperComposition}</label><select id={`${id}-composition`} value={composition.id} onChange={(event) => selectComposition(event.currentTarget.value)}>{project.compositions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
			<label htmlFor={`${id}-format`}>{copy.motionscaperOutputFormat}</label><select id={`${id}-format`} data-motion-render-format value={format} onChange={(event) => setFormat(event.currentTarget.value as Format)}>
				<option value="png">{copy.motionscaperPngSequence}</option><option value="mp4">{copy.motionscaperMp4}</option><option value="webm">{copy.motionscaperWebm}</option>
				{nativeProfile && <option value="prores">{copy.motionscaperProres}</option>}
			</select>
			<label className="motionscaper-number-field"><span>{copy.motionscaperFirstFrame}</span><input type="number" min={0} max={composition.durationFrames - 1} step={1} required value={firstFrame} onChange={(event) => setFirstFrame(event.currentTarget.valueAsNumber)} /></label>
			<label className="motionscaper-number-field"><span>{copy.motionscaperEndFrame}</span><input type="number" min={1} max={composition.durationFrames} step={1} required value={endFrame} onChange={(event) => setEndFrame(event.currentTarget.valueAsNumber)} /></label>
			<div className="motionscaper-preview-controls"><Button variant="secondary" onClick={() => { setFirstFrame(area.firstFrame); setEndFrame(area.endFrame); }}>{copy.motionscaperUseWorkArea}</Button><Button variant="secondary" onClick={() => { setFirstFrame(0); setEndFrame(composition.durationFrames); }}>{copy.motionscaperUseFullComposition}</Button></div>
			<p>{copy.motionscaperWorkAreaOutputHint}</p>
			{empty && <p role="alert">{copy.motionscaperWorkAreaNoSamples}</p>}
			{(format === 'mp4' || format === 'webm') && <><label className="motionscaper-number-field"><span>{copy.motionscaperRenderBackground}</span><input type="color" value={background} onChange={(event) => setBackground(event.currentTarget.value)} /></label><p>{copy.motionscaperVideoOpaque}</p></>}
			{format === 'png' && <p>{copy.motionscaperPngWithoutAudio}</p>}
			{format === 'prores' && <><p>{copy.motionscaperProresProfile}</p><p>{nativeProfile?.audio === 'pcm-s24le' && !excludeAudio ? copy.motionscaperNativePcm : copy.motionscaperNativeWithoutAudio}</p>
				{authoredAudio && <label><input type="checkbox" checked={excludeAudio} onChange={(event) => setExcludeAudio(event.currentTarget.checked)} />{copy.motionscaperExcludeAudio}</label>}
			</>}
		</fieldset></form>
		{error && <p role="alert">{error}</p>}
		<p role="status">{complete ? copy.motionscaperRenderComplete : busy ? copy.motionscaperWorking : ''}</p>
		<p>{copy.motionscaperQueueContinues}</p><p>{copy.motionscaperQueueLimits}</p>
		{job && busy && <progress value={job.completed} max={job.total} aria-label={copy.motionscaperRenderProgress} />}
	</AudioEditorDialogShell>;
}
