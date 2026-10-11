/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionLayer } from '../../motion-composition.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperLayerTimingCommands, type MotionscaperLayerTimingEdit } from '../../../../motionscaper/editor-layer-timing-commands.ts';
import { formatMotionExactInput as format, parseMotionExactInput as exact } from './motion-exact-input.ts';

export default function MotionTimelineSourceTiming({ copy, project, compositionId, layer, busy, onEdit }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; compositionId: string; layer: Extract<MotionLayer, { kind: 'footage' | 'precomp' }>; busy: boolean;
	onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>;
}>) {
	const [start, setStart] = useState(format(layer.sourceStart)); const [speed, setSpeed] = useState(format(layer.timeScale));
	const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null);
	const edit = async (create: () => MotionscaperLayerTimingEdit) => { setWorking(true); setError(null); try {
		await onEdit(createMotionscaperLayerTimingCommands({ project, compositionId, layerId: layer.id, edit: create() }));
	} catch (failure) { setError(failure instanceof Error ? failure.message : copy.motionscaperEditFailed!); } finally { setWorking(false); } };
	return <fieldset disabled={busy || working} className="motionscaper-timeline-actions" data-motion-source-timing data-motion-time-scale={format(layer.timeScale)} data-motion-remapped={layer.timeRemap !== null}><legend>{copy.motionscaperSourceTiming}</legend>
		<label>{copy.motionscaperSourceStart}<input value={start} onChange={(event) => setStart(event.currentTarget.value)} /></label>
		<label>{copy.motionscaperSourceSpeed}<input value={speed} onChange={(event) => setSpeed(event.currentTarget.value)} /></label>
		<Button variant="secondary" onClick={() => { void edit(() => ({ type: 'source', sourceStart: exact(start), timeScale: exact(speed) })); }}>{copy.motionscaperApplySourceTiming}</Button>
		<Button variant="secondary" disabled={layer.timeRemap !== null} onClick={() => { void edit(() => ({ type: 'enable-remap' })); }}>{copy.motionscaperEnableRemap}</Button>
		<Button variant="secondary" disabled={layer.timeRemap === null} onClick={() => { void edit(() => ({ type: 'clear-remap' })); }}>{copy.motionscaperClearRemap}</Button>
		<p>{copy.motionscaperSourceTimingHint}</p>{layer.timeRemap !== null && <p>{copy.motionscaperRemapHint}</p>}
		{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</fieldset>;
}
