/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectStore } from '../../../../motionscaper/editor-project-store.ts';
import type { PreparedMotionscaperAeRender } from '../../../../motionscaper/editor-ae-render-export.ts';
/** Reached only through the opt-in File bridge dialog. Export never publishes a saved revision. */
export default function MotionAeRenderedExportPanel({ project, store, copy, disabled, run, download }: Readonly<{
	project?: MotionscaperProject; store: MotionscaperProjectStore; copy: Readonly<Record<string, string>>; disabled: boolean;
	run: (operation: (signal: AbortSignal) => Promise<void>) => Promise<void>; download: (blob: Blob, name: string) => void;
}>) {
	const [selected, setSelected] = useState(''), [acknowledged, setAcknowledged] = useState(false), [complete, setComplete] = useState(false);
	const [progress, setProgress] = useState<number | null>(null);
	const [review, setReview] = useState<{ source: MotionscaperProject; prepared: PreparedMotionscaperAeRender } | null>(null);
	const compositionId = project?.compositions.some(item => item.id === selected) ? selected : project?.primaryCompositionId ?? '';
	const prepared = review?.source === project && review?.prepared.plan.identity.compositionId === compositionId ? review.prepared : null;
	const prepare = () => run(async signal => {
		setReview(null); setAcknowledged(false); setComplete(false);
		if (!project) return;
		const module = await import('../../../../motionscaper/editor-ae-render-export.ts'); signal.throwIfAborted();
		setReview({ source: project, prepared: module.prepareMotionscaperAeRender(project, compositionId) });
	});
	const render = () => run(async signal => {
		if (!prepared || !acknowledged) return;
		setComplete(false); setProgress(0);
		try {
			const module = await import('../../../../motionscaper/editor-ae-render-package.ts'); signal.throwIfAborted();
			const blob = await module.createMotionscaperAeRenderPackage(prepared, store, { acknowledgeImageOnly: acknowledged, signal, onProgress: count => setProgress(count) });
			signal.throwIfAborted(); download(blob, 'Motionscaper-AE-Rendered.zip'); setComplete(true);
		} finally { setProgress(null); }
	});
	return <section aria-label={copy.motionscaperAeRenderedExport}>
		<h3>{copy.motionscaperAeRenderedExport}</h3><p>{copy.motionscaperAeRenderedHint}</p><p>{copy.motionscaperAeRenderedLimits}</p>
		<label>{copy.motionscaperAeRenderedComposition}<select disabled={disabled || !project} value={compositionId} onChange={event => { setSelected(event.currentTarget.value); setReview(null); setAcknowledged(false); setComplete(false); }}>{project?.compositions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
		<Button variant="secondary" disabled={disabled || !project} onClick={() => { void prepare(); }}>{copy.motionscaperAeRenderedReview}</Button>
		{prepared && <section aria-label={copy.motionscaperAeRenderedReport}>
			<h4>{copy.motionscaperAeRenderedReport}</h4><p>{prepared.plan.width} × {prepared.plan.height} · {prepared.plan.frameCount} {copy.motionscaperAeRenderedFrames} · {prepared.plan.frameRate.num}/{prepared.plan.frameRate.den} {copy.motionscaperAeRenderedFps}</p>
			<p>{copy.motionscaperAeRenderedPolicy}</p><p>{copy.motionscaperAeRenderedCustody}</p><p>{copy.motionscaperAeQualification}</p>
			<label><input type="checkbox" disabled={disabled} checked={acknowledged} onChange={event => setAcknowledged(event.currentTarget.checked)} />{copy.motionscaperAeRenderedAcknowledge}</label>
			<Button variant="secondary" disabled={disabled || !acknowledged} onClick={() => { void render(); }}>{copy.motionscaperAeRenderedDownload}</Button>
			{progress !== null && <progress aria-label={copy.motionscaperAeRenderedProgress} value={progress} max={prepared.plan.frameCount} />}
			{complete && <p role="status">{copy.motionscaperAeExportComplete}</p>}
		</section>}
	</section>;
}
