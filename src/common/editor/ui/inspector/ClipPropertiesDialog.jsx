import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { AUDIO_EDITOR_SAMPLE_RATE, findClip, findClipTrack, findSource } from '../../project.js';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import { ActionHook, CommitField, DesignCheckbox, LabeledDropdown } from './inspector-controls.jsx';
import ClipResampleDialog from './ClipResampleDialog.jsx';
import { VideoEffectRack } from './VideoEffectRack.jsx';
import {
	clipPitchInUnit,
	clipPitchUnitFieldLabel,
	clipPitchUnitOptions,
	clipPitchUnitToCents,
	dbToLinear,
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
	const [resampleOpen, setResampleOpen] = useState(false);
	// A pitch shift is stored in cents, but musicians reach for semitones and
	// sound designers for a percentage of the original frequency. The unit is a
	// reading of the same stored value, so it is remembered for the dialog
	// rather than written to the clip.
	const [pitchUnit, setPitchUnit] = useState('semitones');
	const projectIdentity = project?.id ?? null;
	const clipIdentity = clip?.id ?? null;
	const currentTarget = useRef({ projectIdentity, clipIdentity });
	const activeOperation = useRef(null);
	if (currentTarget.current.projectIdentity !== projectIdentity
		|| currentTarget.current.clipIdentity !== clipIdentity) {
		currentTarget.current = { projectIdentity, clipIdentity };
		activeOperation.current = null;
	}

	useEffect(() => {
		setError('');
		setResampleOpen(false);
		return () => { activeOperation.current = null; };
	}, [clipIdentity, projectIdentity]);

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
			} else if (name === 'fadeIn' || name === 'fadeOut'
				|| name === 'fadeInFrame' || name === 'fadeOutFrame') {
				const field = name.startsWith('fadeIn') ? 'fadeInFrames' : 'fadeOutFrames';
				const frames = Math.min(clip.durationFrames, name.endsWith('Frame')
					? nonNegativeFrame(rawValue, copy)
					: secondsInputToFrames(rawValue, copy, sampleRate));
				controller.actions.clip.update(clip.id, { [field]: frames });
			} else if (name === 'pitchCents') {
				const pitchCents = clipPitchUnitToCents(rawValue, pitchUnit, copy);
				controller.actions.clip.setTimePitch(clip.id, { pitchCents });
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
		const target = currentTarget.current;
		if (activeOperation.current?.target === target) return;
		const operation = { target };
		activeOperation.current = operation;
		const liveProjectIdentity = () => ('project' in controller
			? controller.project?.id ?? null
			: currentTarget.current.projectIdentity);
		const ownsOperation = () => activeOperation.current === operation
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
				setError(cause instanceof Error ? cause.message : String(cause));
			});
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
					<h3>{copy.clipMediaSettings}</h3>
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
				</section>
				{!isVideoClip && <section className="audio-editor-clip-properties__card">
					<h3>{copy.fading}</h3>
					<div className="audio-editor-clip-properties__stack">
						<CommitField label={`${copy.clipGain} (dB)`} name="gain" value={clip ? linearToDb(clip.gain).toFixed(2) : '0.00'} type="number" disabled={disabled} onCommit={commitField} />
						<ClipTimeCodeField name="fadeInFrame" label={copy.fadeIn} value={clip?.fadeInFrames ?? 0}
							sampleRate={sampleRate} maximum={clip?.durationFrames ?? 0} disabled={disabled}
							onCommit={(value) => commitField('fadeInFrame', value)} />
						<ClipTimeCodeField name="fadeOutFrame" label={copy.fadeOut} value={clip?.fadeOutFrames ?? 0}
							sampleRate={sampleRate} maximum={clip?.durationFrames ?? 0} disabled={disabled}
							onCommit={(value) => commitField('fadeOutFrame', value)} />
					</div>
				</section>}
				{!isVideoClip && source && <section className="audio-editor-clip-properties__card">
					<h3>{copy.sampleRate}</h3>
					<div className="audio-editor-clip-properties__stack">
						<ClipSourceFactRow name="sampleRate" label={copy.sampleRateHz} value={source.sampleRate} />
						{snapshot.capabilities?.audioEffects !== false && (
							<div className="audio-editor-panel-actions">
								<ActionHook hook="resample-clip">
									<Button disabled={disabled} onClick={() => setResampleOpen(true)}>{copy.resample}</Button>
								</ActionHook>
							</div>
						)}
					</div>
				</section>}
				{!isVideoClip && snapshot.capabilities?.audioEffects && <section className="audio-editor-clip-properties__card">
					<h3>{copy.pitchTempo}</h3>
					<div className="audio-editor-clip-properties__stack">
						<LabeledDropdown label={copy.clipPitchUnit} hook="clip-pitch-unit" options={clipPitchUnitOptions(copy)} value={pitchUnit} disabled={disabled} onChange={setPitchUnit} />
						{/* Remounting on a unit change drops any half-typed draft, which
						    would otherwise be read as a figure in the newly chosen unit. */}
						<CommitField key={pitchUnit} label={clipPitchUnitFieldLabel(copy, pitchUnit)} name="pitchCents" value={clipPitchInUnit(clip?.pitchCents ?? 0, pitchUnit)} type="number" disabled={disabled} onCommit={commitField} />
						<CommitField label={copy.clipSpeedRatio} name="speedRatio" value={clip?.speedRatio ?? 1} type="number" disabled={disabled} onCommit={commitField} />
						<div data-clip-field="preserveFormants"><DesignCheckbox label={copy.preserveFormants} checked={Boolean(clip?.preserveFormants)} disabled={disabled} onChange={(checked) => controller.actions.clip.setTimePitch(clip.id, { preserveFormants: checked })} /></div>
						<div data-clip-field="stretchToTempo"><DesignCheckbox label={copy.stretchToTempo} checked={Boolean(clip?.stretchToTempo)} disabled={disabled} onChange={() => controller.actions.clip.toggleStretchToTempo(clip.id)} /></div>
						<div className="audio-editor-panel-actions">
							<ActionHook hook="render-pitch-speed"><Button disabled={disabled || !clip || (clip.pitchCents === 0 && clip.speedRatio === 1)} onClick={() => run(controller.actions.clip.renderPitchSpeed)}>{copy.render}</Button></ActionHook>
							<ActionHook hook="reset-pitch-speed"><Button variant="secondary" disabled={disabled || !clip || (clip.pitchCents === 0 && clip.speedRatio === 1)} onClick={() => run(controller.actions.clip.resetPitchSpeed)}>{copy.reset}</Button></ActionHook>
						</div>
					</div>
				</section>}
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
			{!isVideoClip && snapshot.capabilities?.audioEffects && <div className="audio-editor-panel-actions">
				<ActionHook hook="normalize-peak"><Button disabled={disabled} onClick={() => run(controller.actions.clip.normalizePeak)}>{copy.normalizePeak}</Button></ActionHook>
				<ActionHook hook="normalize-lufs"><Button disabled={disabled} onClick={() => run(controller.actions.clip.normalizeLoudness)}>{copy.normalizeLufs}</Button></ActionHook>
			</div>}
		</div>
	);
}

/**
 * One read-only fact about the material a clip plays.
 *
 * A rate is not edited in place: changing it is a resample, which the dialog
 * beside this row asks for, so it is displayed as text rather than as an input
 * that would refuse every keystroke.
 */
function ClipSourceFactRow({ name, label, value }) {
	return <div className="audio-editor-field" data-clip-source-fact={name}>
		<span>{label}</span>
		<span className="audio-editor-field__value">{value}</span>
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

export default ClipPropertiesDialog;
