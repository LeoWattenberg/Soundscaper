/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionComposition } from '../../motion-composition.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { createMotionscaperAudioPlacementCommands, type MotionscaperAudioPlacementEdit } from '../../../../motionscaper/editor-audio-placement-commands.ts';
import { parseMotionExactInput as exact, formatMotionExactInput as format, parseMotionNumberInput } from './motion-exact-input.ts';

interface Draft { readonly id: string; readonly revision: number; readonly gain: string; readonly inFrame: string; readonly outFrame: string; readonly sourceStart: string; readonly timeScale: string; readonly delta: string }

export default function MotionTimelineAudio({ copy, project, composition, busy, onEdit }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; composition: MotionComposition; busy: boolean;
	onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>;
}>) {
	const id = useId(); const [selection, setSelection] = useState(''); const [draft, setDraft] = useState<Draft | null>(null);
	const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null);
	const placement = composition.audio.find((entry) => entry.id === selection) ?? composition.audio[0];
	if (!placement) return null;
	const current = draft?.id === placement.id && draft.revision === project.revision ? draft : {
		id: placement.id, revision: project.revision, gain: String(placement.gain.value * 100), inFrame: format(placement.inFrame), outFrame: format(placement.outFrame),
		sourceStart: format(placement.sourceStart), timeScale: format(placement.timeScale), delta: '1',
	};
	const change = (key: keyof Omit<Draft, 'id' | 'revision'>, value: string) => setDraft({ ...current, [key]: value });
	const edit = (create: () => MotionscaperAudioPlacementEdit) => {
		setError(null); setWorking(true);
		void (async () => {
			try { await onEdit(createMotionscaperAudioPlacementCommands({ project, compositionId: composition.id, edit: create() })); }
			catch (failure) { setError(failure instanceof Error ? failure.message : copy.motionscaperFailed!); }
			finally { setWorking(false); }
		})();
	};
	const field = (key: keyof Omit<Draft, 'id' | 'revision'>, label: string) => <label>{label}<input value={current[key]} onChange={(event) => change(key, event.currentTarget.value)} /></label>;
	return <section data-motion-audio-editor={placement.id} data-motion-gain={placement.gain.value} data-motion-in={`${placement.inFrame.num}/${placement.inFrame.den}`} data-motion-enabled={placement.enabled}>
		<fieldset disabled={busy || working} className="motionscaper-timeline-actions"><legend>{copy.motionscaperAudio}</legend>
			<label htmlFor={`${id}-placement`}>{copy.motionscaperAudioPlacement}</label><select id={`${id}-placement`} value={placement.id} onChange={(event) => { setSelection(event.currentTarget.value); setError(null); }}>
				{composition.audio.map((entry, index) => <option key={entry.id} value={entry.id}>{index + 1}: {project.assets.find((asset) => asset.id === entry.assetId)?.name}</option>)}
			</select>
			<label><input type="checkbox" checked={placement.enabled} onChange={(event) => { const enabled = event.currentTarget.checked; edit(() => ({ type: 'enabled', placementIds: [placement.id], enabled })); }} />{copy.motionscaperAudioEnabled}</label>
			{field('gain', copy.motionscaperBaseGain!)}
			<Button variant="secondary" onClick={() => edit(() => ({ type: 'gain', placementId: placement.id, gain: { ...placement.gain, value: parseMotionNumberInput(current.gain) / 100 } }))}>{copy.motionscaperApplyGain}</Button>
			{field('delta', copy.motionscaperMoveFrames!)}
			<Button variant="secondary" onClick={() => edit(() => ({ type: 'move', placementIds: [placement.id], deltaFrames: exact(current.delta) }))}>{copy.motionscaperMove}</Button>
			{field('inFrame', copy.motionscaperInFrame!)}{field('outFrame', copy.motionscaperOutFrame!)}
			<Button variant="secondary" onClick={() => edit(() => ({ type: 'trim', placementId: placement.id, inFrame: exact(current.inFrame), outFrame: exact(current.outFrame) }))}>{copy.motionscaperTrim}</Button>
			{field('sourceStart', copy.motionscaperSourceStart!)}{field('timeScale', copy.motionscaperTimeScale!)}
			<Button variant="secondary" onClick={() => edit(() => ({ type: 'source', placementId: placement.id, sourceStart: exact(current.sourceStart), timeScale: exact(current.timeScale) }))}>{copy.motionscaperApplyTiming}</Button>
			<Button variant="secondary" onClick={() => edit(() => ({ type: 'remove', placementIds: [placement.id] }))}>{copy.motionscaperRemoveAudio}</Button>
		</fieldset>
		{placement.gain.curve && <p>{copy.motionscaperGainCurveRetained}</p>}
		{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</section>;
}
