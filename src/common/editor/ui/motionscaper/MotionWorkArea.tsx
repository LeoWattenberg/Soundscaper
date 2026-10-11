/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionComposition } from '../../motion-composition.ts';
import { motionCompositionWorkArea } from '../../motion-composition-work-area.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperWorkAreaCommands } from '../../../../motionscaper/editor-work-area-commands.ts';
import { formatMotionExactInput as format, parseMotionExactInput as exact } from './motion-exact-input.ts';

export default function MotionWorkArea({ copy, project, composition, busy, onEdit }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; composition: MotionComposition; busy: boolean;
	onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>;
}>) {
	const area = motionCompositionWorkArea(composition); const [start, setStart] = useState(format(area.startFrame)); const [end, setEnd] = useState(format(area.endFrame));
	const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null);
	const apply = async (reset: boolean) => {
		setWorking(true); setError(null);
		try { await onEdit(createMotionscaperWorkAreaCommands({ project, compositionId: composition.id, workArea: reset ? null : { startFrame: exact(start), endFrame: exact(end) } })); }
		catch (failure) { setError(failure instanceof Error ? failure.message : copy.motionscaperEditFailed!); }
		finally { setWorking(false); }
	};
	return <fieldset disabled={busy || working} className="motionscaper-timeline-actions" data-motion-work-area data-motion-work-start={format(area.startFrame)} data-motion-work-end={format(area.endFrame)}><legend>{copy.motionscaperWorkArea}</legend>
		<label>{copy.motionscaperWorkAreaStart}<input value={start} onChange={(event) => setStart(event.currentTarget.value)} /></label>
		<label>{copy.motionscaperWorkAreaEnd}<input value={end} onChange={(event) => setEnd(event.currentTarget.value)} /></label>
		<Button variant="secondary" onClick={() => { void apply(false); }}>{copy.motionscaperSetWorkArea}</Button><Button variant="secondary" onClick={() => { void apply(true); }}>{copy.motionscaperResetWorkArea}</Button>
		<p>{copy.motionscaperWorkAreaHint}</p>{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</fieldset>;
}
