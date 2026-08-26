import { useEffect, useState } from 'react';
import { Button, DialogFooter } from '@dilsonspickles/components';
import { AUDIO_EDITOR_SAMPLE_RATE, findClip, findClipTrack, findSource } from '../../project.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import { ActionHook, CommitField, DesignCheckbox } from './inspector-controls.jsx';
import { VideoEffectRack } from './VideoEffectRack.jsx';
import {
	dbToLinear,
	framesToSecondsText,
	linearToDb,
	nonNegativeFrame,
	secondsInputToFrames,
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

export function ClipPropertiesDialog({ isOpen, controller, snapshot, copy, onClose }) {
	return (
		<AudioEditorDialogShell
			isOpen={isOpen}
			title={copy.clipProperties || copy.clip}
			onClose={onClose}
			width={720}
			className="audio-editor-clip-properties-dialog"
			dataAttributes={{ 'data-clip-properties-dialog': '' }}
			footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="primary" onClick={onClose}>{copy.done}</Button>} />}
		>
			<ClipProperties controller={controller} snapshot={snapshot} copy={copy} />
		</AudioEditorDialogShell>
	);
}

function ClipProperties({ controller, snapshot, copy }) {
	const project = snapshot.project;
	const clip = project && snapshot.selectedClipId ? findClip(project, snapshot.selectedClipId) : null;
	const source = clip ? findSource(project, clip.sourceId) : null;
	const displayedName = clip?.title || source?.name || copy.clip;
	const track = clip ? findClipTrack(project, clip.id) : null;
	const sampleRate = project?.sampleRate || AUDIO_EDITOR_SAMPLE_RATE;
	const blocked = selectAudioEditorEditBlock(snapshot).blocked;
	const disabled = blocked || !clip;
	const isVideoClip = clip?.kind === 'video';
	const [error, setError] = useState('');

	useEffect(() => setError(''), [clip?.id]);

	const commitField = (name, rawValue) => {
		if (!clip || !track || disabled) return;
		try {
			if (name === 'name') {
				const title = clipRenameTitle(rawValue, displayedName);
				if (title !== null) controller.actions.clip.update(clip.id, { title });
			} else if (name === 'start' || name === 'startFrame') {
				const timelineStartFrame = name === 'start'
					? secondsInputToFrames(rawValue, copy, sampleRate)
					: nonNegativeFrame(rawValue, copy);
				controller.actions.clip.move(clip.id, track.id, timelineStartFrame);
			} else if (name === 'sourceIn' || name === 'sourceInFrame') {
				const sourceStartFrame = name === 'sourceIn'
					? secondsInputToFrames(rawValue, copy, sampleRate)
					: nonNegativeFrame(rawValue, copy);
				controller.actions.clip.trim(clip.id, { sourceStartFrame });
			} else if (name === 'duration' || name === 'durationFrame') {
				const durationFrames = Math.max(1, name === 'duration'
					? secondsInputToFrames(rawValue, copy, sampleRate)
					: nonNegativeFrame(rawValue, copy));
				const sourceStartFrame = clip.reversed
					? clip.sourceStartFrame + clip.durationFrames - durationFrames
					: clip.sourceStartFrame;
				controller.actions.clip.trim(clip.id, { sourceStartFrame, durationFrames });
			} else if (name === 'gain') {
				controller.actions.clip.update(clip.id, { gain: dbToLinear(rawValue, 16, copy) });
			} else if (name === 'fadeIn' || name === 'fadeOut') {
				const frames = Math.min(clip.durationFrames, secondsInputToFrames(rawValue, copy, sampleRate));
				controller.actions.clip.update(clip.id, { [`${name}Frames`]: frames });
			} else if (name === 'pitchCents') {
				controller.actions.clip.setTimePitch(clip.id, { pitchCents: Number(rawValue) });
			} else if (name === 'speedRatio') {
				controller.actions.clip.setTimePitch(clip.id, { speedRatio: Number(rawValue) });
			}
			setError('');
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	const run = (action) => {
		if (!clip || disabled) return;
		setError('');
		Promise.resolve(action(clip.id)).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
	};

	return (
		<div className="audio-editor-clip-inspector">
			{!clip && <p className="audio-editor-panel-hint" data-no-clip>{copy.noClipSelected}</p>}
			<div className="audio-editor-clip-properties" data-clip-fields aria-disabled={disabled}>
				<section className="audio-editor-clip-properties__card audio-editor-clip-properties__card--wide">
					<h3>{copy.clip}</h3>
					<CommitField label={copy.clipName} name="name" value={displayedName} disabled={disabled} onCommit={commitField} />
				</section>
				<section className="audio-editor-clip-properties__card audio-editor-clip-properties__card--wide">
					<h3>{copy.clipStart} / {copy.clipDuration}</h3>
					<div className="audio-editor-clip-properties__time-grid">
						<CommitField label={`${copy.clipStart} (s)`} name="start" value={clip ? framesToSecondsText(clip.timelineStartFrame, sampleRate) : '0.000'} disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.clipStart} (${copy.frames})`} name="startFrame" value={clip?.timelineStartFrame ?? 0} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.clipIn} (s)`} name="sourceIn" value={clip ? framesToSecondsText(clip.sourceStartFrame, sampleRate) : '0.000'} disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.clipIn} (${copy.frames})`} name="sourceInFrame" value={clip?.sourceStartFrame ?? 0} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.clipDuration} (s)`} name="duration" value={clip ? framesToSecondsText(clip.durationFrames, sampleRate) : '0.000'} disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.clipDuration} (${copy.frames})`} name="durationFrame" value={clip?.durationFrames ?? 1} type="number" disabled={disabled} onCommit={commitField} />
					</div>
				</section>
				{!isVideoClip && <section className="audio-editor-clip-properties__card">
					<h3>{copy.fading}</h3>
					<div className="audio-editor-clip-properties__stack">
						<CommitField label={`${copy.clipGain} (dB)`} name="gain" value={clip ? linearToDb(clip.gain).toFixed(2) : '0.00'} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.fadeIn} (s)`} name="fadeIn" value={clip ? framesToSecondsText(clip.fadeInFrames, sampleRate) : '0.000'} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={`${copy.fadeOut} (s)`} name="fadeOut" value={clip ? framesToSecondsText(clip.fadeOutFrames, sampleRate) : '0.000'} type="number" disabled={disabled} onCommit={commitField} />
					</div>
				</section>}
				{!isVideoClip && snapshot.capabilities?.audioEffects && <section className="audio-editor-clip-properties__card">
					<h3>{copy.pitchTempo}</h3>
					<div className="audio-editor-clip-properties__stack">
						<CommitField label={copy.clipPitchCents} name="pitchCents" value={clip?.pitchCents ?? 0} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={copy.clipSpeedRatio} name="speedRatio" value={clip?.speedRatio ?? 1} type="number" disabled={disabled} onCommit={commitField} />
						<div data-clip-field="preserveFormants"><DesignCheckbox label={copy.preserveFormants} checked={Boolean(clip?.preserveFormants)} disabled={disabled} onChange={(checked) => controller.actions.clip.setTimePitch(clip.id, { preserveFormants: checked })} /></div>
						<div data-clip-field="stretchToTempo"><DesignCheckbox label={copy.stretchToTempo} checked={Boolean(clip?.stretchToTempo)} disabled={disabled} onChange={() => controller.actions.clip.toggleStretchToTempo(clip.id)} /></div>
					</div>
				</section>}
				{isVideoClip && snapshot.capabilities?.videoEffects && <VideoEffectRack clip={clip} controller={controller} copy={copy} disabled={disabled} onError={setError} />}
			</div>
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
			{!isVideoClip && snapshot.capabilities?.audioEffects && <div className="audio-editor-panel-actions">
				<ActionHook hook="reverse"><Button disabled={disabled} onClick={() => run(controller.actions.clip.reverse)}>{copy.reverse}</Button></ActionHook>
				<ActionHook hook="normalize-peak"><Button disabled={disabled} onClick={() => run(controller.actions.clip.normalizePeak)}>{copy.normalizePeak}</Button></ActionHook>
				<ActionHook hook="normalize-lufs"><Button disabled={disabled} onClick={() => run(controller.actions.clip.normalizeLoudness)}>{copy.normalizeLufs}</Button></ActionHook>
				<ActionHook hook="render-pitch-speed"><Button disabled={disabled || !clip || (clip.pitchCents === 0 && clip.speedRatio === 1)} onClick={() => run(controller.actions.clip.renderPitchSpeed)}>{copy.renderPitchSpeed}</Button></ActionHook>
				<ActionHook hook="reset-pitch-speed"><Button variant="secondary" disabled={disabled || !clip || (clip.pitchCents === 0 && clip.speedRatio === 1)} onClick={() => run(controller.actions.clip.resetPitchSpeed)}>{copy.resetPitchSpeed}</Button></ActionHook>
			</div>}
		</div>
	);
}

export default ClipPropertiesDialog;
