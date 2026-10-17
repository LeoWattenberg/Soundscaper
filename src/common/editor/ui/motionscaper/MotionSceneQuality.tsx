/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionComposition } from '../../motion-composition.ts';
import type { MotionTemporalSettings } from '../../motion-temporal-settings.ts';
import { MotionAppearanceNumber, type MotionAppearanceCopy } from './MotionAppearanceFields.tsx';
import { MotionSceneCheckbox } from './MotionSceneFields.tsx';
import { formatMotionExactInput, parseMotionExactInput, parseMotionNumberInput } from './motion-exact-input.ts';
export type MotionSceneQualityEdit = Readonly<{ temporal: MotionTemporalSettings | null; depthOfFieldSamples: number | null }>;
export default function MotionSceneQuality({ copy, composition, disabled, onEdit, onError }: Readonly<{ copy: MotionAppearanceCopy; composition: MotionComposition; disabled: boolean; onEdit: (edit: MotionSceneQualityEdit) => void; onError: (error: unknown) => void }>) {
	const [blur, setBlur] = useState(composition.temporal !== undefined), [depth, setDepth] = useState(composition.depthOfFieldSamples !== undefined);
	const [open, setOpen] = useState(formatMotionExactInput(composition.temporal?.shutterOpenFrames ?? { num: -1, den: 4 })), [close, setClose] = useState(formatMotionExactInput(composition.temporal?.shutterCloseFrames ?? { num: 1, den: 4 }));
	const [samples, setSamples] = useState(String(composition.temporal?.samples ?? 8)), [lens, setLens] = useState(String(composition.depthOfFieldSamples ?? 16));
	const submit = () => { try { onEdit({ temporal: blur ? { shutterOpenFrames: parseMotionExactInput(open), shutterCloseFrames: parseMotionExactInput(close), samples: parseMotionNumberInput(samples) } : null, depthOfFieldSamples: depth ? parseMotionNumberInput(lens) : null }); } catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperSceneQuality}</legend>
		<MotionSceneCheckbox label={copy.motionscaperSceneMotionBlur} value={blur} onChange={setBlur} />
		{blur && <><label>{copy.motionscaperSceneShutterOpen}<input value={open} onChange={event => setOpen(event.currentTarget.value)} /></label><label>{copy.motionscaperSceneShutterClose}<input value={close} onChange={event => setClose(event.currentTarget.value)} /></label><MotionAppearanceNumber label={copy.motionscaperSceneTemporalSamples} value={samples} min={1} max={64} onChange={setSamples} /></>}
		<MotionSceneCheckbox label={copy.motionscaperSceneLensOverride} value={depth} onChange={setDepth} />{depth && <MotionAppearanceNumber label={copy.motionscaperSceneLensSamples} value={lens} min={1} max={64} onChange={setLens} />}
		<p>{copy.motionscaperSceneQualityHint}</p><Button variant="secondary" onClick={submit}>{copy.motionscaperSceneApplyQuality}</Button>
	</fieldset>;
}
