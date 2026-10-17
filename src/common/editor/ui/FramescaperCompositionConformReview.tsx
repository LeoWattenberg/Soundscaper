/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef } from 'react';
import type { FramescaperCompositionConformPlan } from '../../../framescaper/editor-composition-link-conform.ts';
import type { FramescaperCompositionConformWindow } from '../../../framescaper/editor-composition-link-conform-core.ts';
import type { framescaperSuccessorCopy } from '../../i18n/framescaper-successor-copy.ts';
import type { FramescaperSuccessorProject } from '../../../framescaper/editor-project-successor.ts';
type Copy = ReturnType<typeof framescaperSuccessorCopy>;
function record(value: unknown): Readonly<Record<string, unknown>> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {}; }
function names(value: unknown, key: 'title' | 'name'): ReadonlyMap<string, string> {
	const result = new Map<string, string>();
	if (Array.isArray(value)) for (const entry of value as readonly unknown[]) { const item = record(entry), label = item[key]; if (typeof item.id === 'string' && typeof label === 'string' && label) result.set(item.id, label); }
	return result;
}
function rational(value: Readonly<{ num: number; den: number }>): string { return value.den === 1 ? String(value.num) : `${value.num}/${value.den}`; }
function output(value: FramescaperCompositionConformPlan['outputBefore'], copy: Copy): string {
	return `${value.width} × ${value.height}; ${rational(value.frameRate)} ${copy.framesPerSecond}; ${rational(value.duration)} ${copy.seconds}; ${value.sampleRate} Hz`;
}
function Window({ value, copy, kind }: { value: FramescaperCompositionConformWindow; copy: Copy; kind: 'video' | 'audio' }) {
	return <><p>{copy.sourceWindow}: [{value.start}, {value.start + value.count}) / {rational(value.rate)} {kind === 'video' ? copy.framesPerSecond : copy.samplesPerSecond}</p>
		<p>{copy.sourceDuration}: {rational(value.sourceDuration)} {copy.seconds}; {copy.timelineDuration}: {rational(value.timelineDuration)} {copy.seconds}</p>
		<p>{copy.playbackRate}: {value.speedRatio}×</p><p>{copy.sourceTrims}: {value.trimStart} / {value.trimEnd} @ {rational(value.trimRate)} {copy.samplesPerSecond}</p></>;
}
export default function FramescaperCompositionConformReview({ plan, project, copy, busy, readOnly, onApply, onCancel }: {
	plan: FramescaperCompositionConformPlan; project: FramescaperSuccessorProject | null; copy: Copy; busy: boolean; readOnly: boolean; onApply(): void; onCancel(): void;
}) {
	const heading = useRef<HTMLHeadingElement>(null); useEffect(() => { heading.current?.focus(); }, [plan]);
	const clipNames = new Map([...names(project?.clips, 'title'), ...names(record(project?.projectBin).clips, 'title')]), sequenceNames = names(project?.sequences, 'name');
	return <section role="region" aria-labelledby="frame-conform-review-title" data-composition-conform-review="true">
		<h3 id="frame-conform-review-title" ref={heading} tabIndex={-1}>{copy.conformReview}</h3><p>{copy.conformPolicy}</p><p>{copy.conformRounding}</p>
		<dl><dt>{copy.before}</dt><dd>{output(plan.outputBefore, copy)}</dd><dt>{copy.after}</dt><dd>{output(plan.outputAfter, copy)}</dd></dl>
		{plan.changes.length ? <table><caption>{copy.affectedClips}</caption><thead><tr><th>{copy.clip}</th><th>{copy.before}</th><th>{copy.after}</th></tr></thead>
			<tbody>{plan.changes.map(change => <tr key={`${change.scope}:${change.clipId}`}><th scope="row">{clipNames.get(change.clipId) ?? change.clipId}<p>{change.scope === 'project-bin' ? copy.projectBin : copy.timeline} / {change.kind === 'video' ? copy.video : copy.audio}{change.sequenceId ? ` / ${sequenceNames.get(change.sequenceId) ?? change.sequenceId}` : ''}</p>
				{change.clamped && <p>{copy.conformClamped}</p>}{change.reversed && <p>{copy.conformReversed}</p>}{change.retimeMapChanged && <p>{copy.conformRetime}</p>}{change.warpMapChanged && <p>{copy.conformWarp}</p>}</th>
				<td><Window value={change.before} copy={copy} kind={change.kind} /></td><td><Window value={change.after} copy={copy} kind={change.kind} /></td></tr>)}</tbody></table> : <p>{copy.noAffectedClips}</p>}
		<button type="button" disabled={busy} onClick={onCancel}>{copy.cancelReview}</button>{' '}<button type="button" disabled={busy || readOnly} onClick={onApply}>{copy.applyReview}</button>
	</section>;
}
