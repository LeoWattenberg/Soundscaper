/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectStore } from '../../../../motionscaper/editor-project-store.ts';
import type { PreparedMotionscaperAeExport } from '../../../../motionscaper/editor-ae-export-conversion.ts';
const PAGE_SIZE = 50;
export default function MotionAeExportPanel({ project, store, copy, disabled, run, download }: Readonly<{
	project?: MotionscaperProject; store: MotionscaperProjectStore; copy: Readonly<Record<string, string>>; disabled: boolean;
	run: (operation: (signal: AbortSignal) => Promise<void>) => Promise<void>; download: (blob: Blob, name: string) => void;
}>) {
	const [review, setReview] = useState<{ source: MotionscaperProject; prepared: PreparedMotionscaperAeExport } | null>(null);
	const [acknowledged, setAcknowledged] = useState(false), [page, setPage] = useState(0), [complete, setComplete] = useState(false);
	const prepared = review && review.source === project ? review.prepared : null;
	const prepare = () => run(async signal => {
		if (!project) return;
		setReview(null); setAcknowledged(false); setPage(0); setComplete(false);
		const module = await import('../../../../motionscaper/editor-ae-export-conversion.ts'); signal.throwIfAborted();
		const prepared = module.prepareMotionscaperAeExport(project); signal.throwIfAborted(); setReview({ source: project, prepared });
	});
	const publish = () => run(async signal => {
		if (!prepared || !acknowledged) return;
		setComplete(false);
		const module = await import('../../../../motionscaper/editor-ae-export-package.ts'); signal.throwIfAborted();
		const blob = await module.createMotionscaperAeExportPackage(prepared, asset => store.readAsset(asset), { acknowledgeUnsupported: acknowledged, signal });
		signal.throwIfAborted(); download(blob, 'Motionscaper-AE-Export.zip'); setComplete(true);
	});
	return <section aria-label={copy.motionscaperAeExport}>
		<h3>{copy.motionscaperAeExport}</h3><p>{copy.motionscaperAeExportInstructions}</p><p>{copy.motionscaperAeExportLimits}</p>
		<Button variant="secondary" disabled={disabled || !project} onClick={() => { void prepare(); }}>{copy.motionscaperAeReviewExport}</Button>
		{prepared && <section aria-label={copy.motionscaperAeExportReport}>
			<h4>{prepared.revision.project.title}</h4><p>{copy.motionscaperAeExportCustody}</p>
			<p>{(['editable', 'sampled', 'rendered', 'unsupported'] as const).map(kind => <span key={kind}>{copy[`motionscaperAeStatus_${kind}`]}: {prepared.exchange.report.filter(item => item.status === kind).length}{' '}</span>)}</p>
			<table><thead><tr><th>{copy.motionscaperAeReportScope}</th><th>{copy.motionscaperAeReportMapping}</th><th>{copy.motionscaperAeReportDetail}</th></tr></thead><tbody>{prepared.exchange.report.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((entry, index) => <tr key={page * PAGE_SIZE + index}>
				<td>{entry.scopeId} {entry.propertyPath}</td><td>{copy[`motionscaperAeStatus_${entry.status}`]}</td><td>{entry.message}</td>
			</tr>)}</tbody></table>
			{prepared.exchange.report.length > PAGE_SIZE && <div><Button variant="secondary" disabled={disabled || page === 0} onClick={() => setPage(value => value - 1)}>{copy.motionscaperAePrevious}</Button><span>{page + 1}/{Math.ceil(prepared.exchange.report.length / PAGE_SIZE)}</span><Button variant="secondary" disabled={disabled || (page + 1) * PAGE_SIZE >= prepared.exchange.report.length} onClick={() => setPage(value => value + 1)}>{copy.motionscaperAeNext}</Button></div>}
			<label><input type="checkbox" disabled={disabled} checked={acknowledged} onChange={event => setAcknowledged(event.currentTarget.checked)} />{copy.motionscaperAeExportAcknowledge}</label>
			<Button variant="secondary" disabled={disabled || !acknowledged} onClick={() => { void publish(); }}>{copy.motionscaperAeExportDownload}</Button>
			{complete && <p role="status">{copy.motionscaperAeExportComplete}</p>}
		</section>}
	</section>;
}
