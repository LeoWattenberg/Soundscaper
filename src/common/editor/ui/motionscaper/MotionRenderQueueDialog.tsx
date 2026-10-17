/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState, useSyncExternalStore } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MotionscaperDeliveryQueue } from '../../../../motionscaper/editor-delivery-queue.ts';
import { chooseMotionRenderDestination, downloadMotionRender } from './motion-render-download.ts';
const STATUS = { queued: 'motionscaperQueueQueued', rendering: 'motionscaperQueueRendering', completed: 'motionscaperQueueCompleted', cancelled: 'motionscaperQueueCancelled', failed: 'motionscaperQueueFailed' } as const;
export default function MotionRenderQueueDialog({ copy, queue, onClose }: Readonly<{ copy: Readonly<Record<string, string>>; queue: MotionscaperDeliveryQueue; onClose: () => void }>) {
	const jobs = useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
	const [error, setError] = useState<string | null>(null); const [choosing, setChoosing] = useState(false);
	const run = async (operation: () => Promise<void>) => {
		setError(null); try { await operation(); } catch (failure) { if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(failure instanceof Error ? failure.message : copy.motionscaperFailed); }
	};
	const retry = async (id: string) => {
		const intent = queue.intent(id); let writable: WritableStream<Uint8Array> | undefined;
		setChoosing(true);
		try {
			writable = await chooseMotionRenderDestination(intent.project.title, intent.format, copy.motionscaperRender);
			const handle = queue.retry(id, writable); writable = undefined; setChoosing(false);
			const result = await handle.completion;
			if (result instanceof Blob) downloadMotionRender(result, intent.project.title, intent.format);
		} catch (failure) { if (writable) await writable.abort(failure); throw failure; }
		finally { setChoosing(false); }
	};
	return <AudioEditorDialogShell title={copy.motionscaperRenderQueue} onClose={choosing ? undefined : onClose} width={680}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button disabled={choosing} onClick={onClose}>{copy.motionscaperClose}</Button>} />}>
		<p>{copy.motionscaperQueueDescription}</p><p>{copy.motionscaperQueueLimits}</p>
		{jobs.length === 0 && <p>{copy.motionscaperQueueEmpty}</p>}
		{jobs.map(job => <section key={job.id} aria-label={`${job.title} — ${job.composition}`} data-motion-render-job={job.id}>
			<h3>{job.title} — {job.composition}</h3>
			<p>{job.format.toUpperCase()} · {job.firstFrame}–{job.endFrame} · {copy.motionscaperQueueAttempt} {job.attempt}</p>
			<details><summary>{copy.motionscaperQueueRevision}</summary><code>{job.revisionDigest}</code></details>
			<p role="status">{copy[STATUS[job.status]]}</p>
			{job.status === 'rendering' && <progress value={job.completed} max={job.total} aria-label={copy.motionscaperRenderProgress} />}
			{job.error && <p>{job.error}</p>}
			<div className="motionscaper-preview-controls">
				{(job.cleanupRequired || job.status === 'rendering' || job.status === 'queued')
					? <Button onClick={() => { void run(() => queue.cancel(job.id)); }}>{job.cleanupRequired ? copy.motionscaperQueueCleanup : copy.motionscaperCancel}</Button>
					: <>
						{(job.status === 'failed' || job.status === 'cancelled') && <Button disabled={choosing} onClick={() => { void run(() => retry(job.id)); }}>{copy.motionscaperQueueRetry}</Button>}
						{job.downloadAvailable && <Button onClick={() => { const blob = queue.output(job.id); if (blob) downloadMotionRender(blob, job.title, job.format); }}>{copy.motionscaperQueueDownload}</Button>}
						<Button onClick={() => { void run(() => { queue.remove(job.id); return Promise.resolve(); }); }}>{copy.motionscaperQueueRemove}</Button>
					</>}
			</div>
		</section>)}
		{error && <p role="alert">{error}</p>}
	</AudioEditorDialogShell>;
}
