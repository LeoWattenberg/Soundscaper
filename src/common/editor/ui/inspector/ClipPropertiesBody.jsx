/* SPDX-License-Identifier: AGPL-3.0-only */

import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { AUDIO_EDITOR_SAMPLE_RATE, findClip, findClipTrack, findSource } from '../../project.js';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import { ActionHook, CommitField, DesignCheckbox, SteppedSlider } from './inspector-controls.jsx';
import ClipPropertyKnob from './ClipPropertyKnob.tsx';
import ClipResampleDialog from './ClipResampleDialog.jsx';
import { VideoEffectRack } from './VideoEffectRack.jsx';
import VideoSourcePropertiesSection from './VideoSourcePropertiesSection.jsx';
import {
	clipPitchInUnit,
	clipPitchUnitFieldLabel,
	clipPitchUnitToCents,
	dbToLinear,
	linearToDb,
	nonNegativeFrame,
} from './inspector-helpers.ts';

/**
 * The title a rename should commit, or null when the field was left alone.
 *
 * A clip with no title of its own displays its source name, and failing that a
 * generic label. The field commits on blur, so without this comparison merely
 * tabbing through an untitled clip's name would adopt whichever placeholder was
 * on screen as a real title.
 */
export function clipRenameTitle(rawValue, displayedName) {
	const title = String(rawValue).trim();
	if (!title) throw new TypeError('A clip name is required.');
	return title === displayedName ? null : title;
}

export default function ClipPropertiesBody({ controller, snapshot, copy, clipId = snapshot.selectedClipId, focusField = null }) {
	const project = snapshot.project;
	const clip = project && clipId ? findClip(project, clipId) : null;
	const source = clip ? findSource(project, clip.sourceId) : null;
	const displayedName = clip?.title || source?.name || copy.clip;
	const track = clip ? findClipTrack(project, clip.id) : null;
	const sampleRate = project?.sampleRate || AUDIO_EDITOR_SAMPLE_RATE;
	const blocked = selectAudioEditorEditBlock(snapshot).blocked;
	const disabled = blocked || !clip;
	const isVideoClip = clip?.kind === 'video';
	const [error, setError] = usePresentationFeedback(copy);
	const [resampleOpen, setResampleOpen] = useState(false);
	// A pitch shift is stored in cents, but musicians reach for semitones and
	// sound designers for a percentage of the original frequency. The unit is a
	// reading of the same stored value, so it is remembered for this inspector
	// rather than written to the clip.
	const [pitchUnit, setPitchUnit] = useState('semitones');
	const projectIdentity = project?.id ?? null;
	const clipIdentity = clip?.id ?? null;
	const currentTarget = useRef({ projectIdentity, clipIdentity });
	const activeOperation = useRef(null);
	const targetActive = useRef(true);
	if (currentTarget.current.projectIdentity !== projectIdentity
		|| currentTarget.current.clipIdentity !== clipIdentity) {
		currentTarget.current = { projectIdentity, clipIdentity };
		activeOperation.current = null;
	}

	useEffect(() => {
		targetActive.current = true;
		setError('');
		setResampleOpen(false);
		return () => { targetActive.current = false; activeOperation.current = null; };
	}, [clipIdentity, projectIdentity, setError]);

	const liveProjectIdentity = () => ('project' in controller
		? controller.project?.id ?? null : currentTarget.current.projectIdentity);
	const ownsTarget = () => targetActive.current
		&& currentTarget.current.projectIdentity === projectIdentity
		&& currentTarget.current.clipIdentity === clipIdentity
		&& liveProjectIdentity() === projectIdentity;

	const commitField = (name, rawValue) => {
		if (!clip || !track || disabled || !ownsTarget()) return;
		try {
			if (name === 'name') {
				const title = clipRenameTitle(rawValue, displayedName);
				if (title !== null) controller.actions.clip.update(clip.id, { title });
			} else if (name === 'startFrame') {
				const timelineStartFrame = nonNegativeFrame(rawValue, copy);
				controller.actions.clip.move(clip.id, track.id, timelineStartFrame);
			} else if (name === 'sourceInFrame') {
				const sourceStartFrame = nonNegativeFrame(rawValue, copy);
				controller.actions.clip.trim(clip.id, { sourceStartFrame });
			} else if (name === 'durationFrame') {
				const durationFrames = Math.max(1, nonNegativeFrame(rawValue, copy));
				const sourceStartFrame = clip.reversed
					? clip.sourceStartFrame + clip.durationFrames - durationFrames
					: clip.sourceStartFrame;
				controller.actions.clip.trim(clip.id, { sourceStartFrame, durationFrames });
			} else if (name === 'gain') {
				controller.actions.clip.update(clip.id, { gain: dbToLinear(rawValue, 16, copy) });
			} else if (name === 'fadeInFrame' || name === 'fadeOutFrame') {
				const field = name.startsWith('fadeIn') ? 'fadeInFrames' : 'fadeOutFrames';
				const frames = Math.min(clip.durationFrames, nonNegativeFrame(rawValue, copy));
				controller.actions.clip.update(clip.id, { [field]: frames });
			} else if (name === 'fadeInShape' || name === 'fadeOutShape') {
				const shape = Number(rawValue);
				if (!Number.isFinite(shape) || shape < 0.15 || shape > 6) throw new RangeError('Invalid fade shape.');
				controller.actions.clip.update(clip.id, { [name]: shape });
			} else if (name === 'pitchCents') {
				const pitchCents = clipPitchUnitToCents(rawValue, pitchUnit, copy);
				controller.actions.clip.setTimePitch(clip.id, { pitchCents });
			} else if (name === 'speedRatio') {
				controller.actions.clip.setTimePitch(clip.id, { speedRatio: Number(rawValue) });
			}
			setError('');
		} catch (cause) {
			setError(feedbackFailure(cause));
		}
	};

	const run = (action) => {
		if (!clip || disabled || !ownsTarget()) return;
		const target = currentTarget.current;
		if (activeOperation.current?.target === target) return;
		const operation = { target };
		activeOperation.current = operation;
		const ownsOperation = () => targetActive.current && activeOperation.current === operation
			&& currentTarget.current === target
			&& liveProjectIdentity() === target.projectIdentity;
		setError('');
		void Promise.resolve()
			.then(() => ownsOperation() ? action(clip.id) : undefined)
			.then(() => {
				if (ownsOperation()) activeOperation.current = null;
			}, (cause) => {
				if (!ownsOperation()) return;
				activeOperation.current = null;
				setError(feedbackFailure(cause));
			});
	};

	return (
		<div className="audio-editor-clip-inspector">
			{!clip && <p className="audio-editor-panel-hint" data-no-clip>{copy.noClipSelected}</p>}
			<div className="audio-editor-clip-properties" data-clip-fields aria-disabled={disabled}>
				<ClipPropertiesDrawer name="media" label={copy.clipMediaSettings} initiallyOpen={focusField === 'name'}>
					<CommitField label={copy.clipName} name="name" value={displayedName} disabled={disabled} onCommit={commitField} />
					<div className="audio-editor-clip-properties__time-grid">
						<ClipTimeCodeField name="startFrame" label={copy.clipStart} value={clip?.timelineStartFrame ?? 0}
							sampleRate={sampleRate} disabled={disabled}
							onCommit={(value) => commitField('startFrame', value)} />
						<ClipTimeCodeField name="sourceInFrame" label={copy.clipIn} value={clip?.sourceStartFrame ?? 0}
							sampleRate={sampleRate} disabled={disabled}
							onCommit={(value) => commitField('sourceInFrame', value)} />
						<ClipTimeCodeField name="durationFrame" label={copy.clipDuration} value={clip?.durationFrames ?? 1}
							sampleRate={sampleRate} minimum={1} disabled={disabled}
							onCommit={(value) => commitField('durationFrame', value)} />
						{!isVideoClip && source && (
							<ClipSourceFactRow name="sampleRate" label={copy.sampleRateHz} value={source.sampleRate}
								action={snapshot.capabilities?.audioEffects !== false && (
									<ActionHook hook="resample-clip">
										<Button disabled={disabled} onClick={() => setResampleOpen(true)}>{copy.resample}</Button>
									</ActionHook>
								)} />
						)}
					</div>
					{!isVideoClip && snapshot.capabilities?.audioEffects && (
						<div className="audio-editor-clip-properties__toggles">
							<div data-clip-field="reversed">
								<DesignCheckbox label={copy.reverse} checked={Boolean(clip?.reversed)} disabled={disabled}
									onChange={() => run(controller.actions.clip.reverse)} />
							</div>
							<div data-clip-field="inverted">
								<DesignCheckbox label={copy.invert} checked={Boolean(clip?.inverted)} disabled={disabled}
									onChange={() => run(controller.actions.clip.invert)} />
							</div>
						</div>
					)}
				</ClipPropertiesDrawer>
				{isVideoClip && source?.kind === 'video' && <VideoSourcePropertiesSection source={source} controller={controller} copy={copy} disabled={disabled} />}
				{!isVideoClip && <ClipPropertiesDrawer name="fading" label={copy.fading}>
					<div className="audio-editor-clip-properties__stack">
						<CommitField label={`${copy.clipGain} (dB)`} name="gain" value={clip ? linearToDb(clip.gain).toFixed(2) : '0.00'} type="number" disabled={disabled} onCommit={commitField} />
						<ClipTimeCodeField name="fadeInFrame" label={copy.fadeIn} value={clip?.fadeInFrames ?? 0}
							sampleRate={sampleRate} maximum={clip?.durationFrames ?? 0} disabled={disabled}
							onCommit={(value) => commitField('fadeInFrame', value)} />
						<ClipFadeShapeField name="fadeInShape" label={copy.fadeInShape} value={clip?.fadeInShape}
							fadeFrames={clip?.fadeInFrames ?? 0} legacyLabel={copy.legacyLinearFadeShape}
							disabled={disabled} onCommit={commitField} />
						<ClipTimeCodeField name="fadeOutFrame" label={copy.fadeOut} value={clip?.fadeOutFrames ?? 0}
							sampleRate={sampleRate} maximum={clip?.durationFrames ?? 0} disabled={disabled}
							onCommit={(value) => commitField('fadeOutFrame', value)} />
						<ClipFadeShapeField name="fadeOutShape" label={copy.fadeOutShape} value={clip?.fadeOutShape}
							fadeFrames={clip?.fadeOutFrames ?? 0} legacyLabel={copy.legacyLinearFadeShape}
							disabled={disabled} onCommit={commitField} />
					</div>
				</ClipPropertiesDrawer>}
				{!isVideoClip && snapshot.capabilities?.audioEffects && <ClipPropertiesDrawer name="pitch" label={copy.pitchTempo}
					initiallyOpen={['pitchCents', 'speedRatio'].includes(focusField)}>
					<div className="audio-editor-clip-properties__stack">
						<ClipPropertyKnob key={pitchUnit} label={clipPitchUnitFieldLabel(copy, pitchUnit)} name="pitchCents"
							value={clipPitchInUnit(clip?.pitchCents ?? 0, pitchUnit)}
							min={pitchUnit === 'percent' ? -50 : -12} max={pitchUnit === 'percent' ? 100 : 12}
							step={pitchUnit === 'percent' ? 0.1 : 0.01} defaultValue={0} disabled={disabled} onCommit={commitField}
							formatKnobValue={(value) => value.toFixed(pitchUnit === 'percent' ? 3 : 2)}
							onKnobCommit={(value) => commitField('pitchCents', value)}>
							<div className="audio-editor-clip-pitch-units" role="group" aria-label={copy.clipPitchUnit} data-clip-pitch-unit>
								<button type="button" aria-label={copy.clipPitchUnitSemitones} title={copy.clipPitchUnitSemitones}
									aria-pressed={pitchUnit === 'semitones'} disabled={disabled} onClick={() => setPitchUnit('semitones')}>
									<span className="audio-editor-clip-pitch-units__semitones" aria-hidden="true">{'\uEF21'}</span>
								</button>
								<button type="button" aria-label={copy.clipPitchUnitPercent} title={copy.clipPitchUnitPercent}
									aria-pressed={pitchUnit === 'percent'} disabled={disabled} onClick={() => setPitchUnit('percent')}>%</button>
							</div>
						</ClipPropertyKnob>
						<ClipPropertyKnob label={copy.clipSpeedRatio} name="speedRatio" value={clip?.speedRatio ?? 1}
							min={Math.min(0.25, clip?.speedRatio ?? 1)} max={Math.max(4, clip?.speedRatio ?? 1)}
							step={0.01} defaultValue={1} mode="unipolar" disabled={disabled}
							onCommit={commitField} onKnobCommit={(value) => commitField('speedRatio', value)} />
						<div data-clip-field="preserveFormants"><DesignCheckbox label={copy.preserveFormants} checked={Boolean(clip?.preserveFormants)} disabled={disabled} onChange={(checked) => { if (ownsTarget()) controller.actions.clip.setTimePitch(clip.id, { preserveFormants: checked }); }} /></div>
						<div data-clip-field="stretchToTempo"><DesignCheckbox label={copy.stretchToTempo} checked={Boolean(clip?.stretchToTempo)} disabled={disabled} onChange={() => { if (ownsTarget()) controller.actions.clip.toggleStretchToTempo(clip.id); }} /></div>
						<div className="audio-editor-panel-actions">
							<ActionHook hook="render-pitch-speed"><Button disabled={disabled || !clip || (clip.pitchCents === 0 && clip.speedRatio === 1)} onClick={() => run(controller.actions.clip.renderPitchSpeed)}>{copy.render}</Button></ActionHook>
							<ActionHook hook="reset-pitch-speed"><Button variant="secondary" disabled={disabled || !clip || (clip.pitchCents === 0 && clip.speedRatio === 1)} onClick={() => run(controller.actions.clip.resetPitchSpeed)}>{copy.reset}</Button></ActionHook>
						</div>
					</div>
				</ClipPropertiesDrawer>}
				{!isVideoClip && snapshot.capabilities?.audioEffects && <ClipPropertiesDrawer name="normalize" label={copy.clipNormalize}>
					<div className="audio-editor-panel-actions">
						<ActionHook hook="normalize-peak"><Button disabled={disabled} onClick={() => run(controller.actions.clip.normalizePeak)}>{copy.normalizePeak}</Button></ActionHook>
						<ActionHook hook="normalize-lufs"><Button disabled={disabled} onClick={() => run(controller.actions.clip.normalizeLoudness)}>{copy.normalizeLufs}</Button></ActionHook>
					</div>
				</ClipPropertiesDrawer>}
				{isVideoClip && snapshot.capabilities?.videoEffects && <VideoEffectRack clip={clip} controller={controller} copy={copy} disabled={disabled} onError={setError} />}
			</div>
			{resampleOpen && clip && source && (
				<ClipResampleDialog
					sampleRate={source.sampleRate}
					copy={copy}
					disabled={disabled}
					onCancel={() => setResampleOpen(false)}
					onApply={(request) => {
						setResampleOpen(false);
						run((id) => controller.actions.clip.resample(id, request));
					}}
				/>
			)}
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
		</div>
	);
}

function ClipPropertiesDrawer({ name, label, initiallyOpen = false, children }) {
	return <details className="audio-editor-clip-properties__drawer" data-clip-properties-drawer={name} open={initiallyOpen || undefined}>
		<summary><h3>{label}</h3></summary>
		<div className="audio-editor-clip-properties__drawer-content">{children}</div>
	</details>;
}

/**
 * One read-only fact about the material a clip plays.
 *
 * A rate is not edited in place: changing it is a resample, so the fact is
 * displayed as text rather than as an input that would refuse every keystroke,
 * and the action that does change it sits on the same row instead of claiming
 * a card of its own.
 */
function ClipSourceFactRow({ name, label, value, action = null }) {
	return <div className="audio-editor-field" data-clip-source-fact={name}>
		<span>{label}</span>
		<div className="audio-editor-field__value-row">
			<span className="audio-editor-field__value">{value}</span>
			{action}
		</div>
	</div>;
}

function ClipTimeCodeField({ name, label, value, sampleRate, minimum = 0,
	maximum = Number.POSITIVE_INFINITY, disabled, onCommit }) {
	return <label className="audio-editor-field" data-clip-field={name}><span>{label}</span>
		<AudioEditorTimeCodeInput label={label} value={value} unit="samples" rate={sampleRate}
			format="hh:mm:ss+milliseconds" minimum={minimum} maximum={maximum}
			disabled={disabled} onCommit={onCommit} />
	</label>;
}

function ClipFadeShapeField({ name, label, value, fadeFrames, legacyLabel, disabled, onCommit }) {
	const legacy = value === undefined && fadeFrames > 0;
	const shape = value ?? (legacy ? 2 : 1);
	return <label className="audio-editor-field" data-clip-field={name}>
		<span>{label}</span>
		<div className="audio-editor-clip-fade-shape__row">
			<SteppedSlider value={shape} min={0.15} max={6} step={0.01} defaultValue={1}
				ariaLabel={label} valueText={legacy ? legacyLabel : undefined}
				disabled={disabled} onChange={(next) => onCommit(name, next)} />
			<output>{legacy ? legacyLabel : shape.toFixed(2)}</output>
		</div>
	</label>;
}
