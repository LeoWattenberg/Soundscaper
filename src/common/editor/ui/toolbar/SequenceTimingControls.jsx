/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useState } from 'react';

import { iconNameToChar } from '../../audacity-iconcodes.js';
import {
	formatSequenceTimecode,
	isSequenceDropFrameRate,
	parseSequenceTimecode,
} from '../../sequence-timecode.ts';
import {
	resolveSequenceTimingView,
	sequenceTimecodeLabelAtSample,
} from '../../sequence-timing-model.ts';
import { AudacityToolbarFlyoutButton } from './AudioEditorMeterControls.jsx';

const RATE_PRESETS = Object.freeze([
	{ id: '24000/1001', label: '23.976', rate: { num: 24_000, den: 1_001 } },
	{ id: '24/1', label: '24', rate: { num: 24, den: 1 } },
	{ id: '25/1', label: '25', rate: { num: 25, den: 1 } },
	{ id: '30000/1001', label: '29.97', rate: { num: 30_000, den: 1_001 } },
	{ id: '30/1', label: '30', rate: { num: 30, den: 1 } },
	{ id: '48/1', label: '48', rate: { num: 48, den: 1 } },
	{ id: '50/1', label: '50', rate: { num: 50, den: 1 } },
	{ id: '60000/1001', label: '59.94', rate: { num: 60_000, den: 1_001 } },
	{ id: '60/1', label: '60', rate: { num: 60, den: 1 } },
]);

/** Sequence timing: the playhead timecode, frame stepping, and the rate that defines both. */
export function SequenceTimingControls({ project, snapshot, telemetry, controller, copy, run }) {
	const view = useMemo(() => resolveSequenceTimingView(project), [project]);
	const sampleRate = project.sampleRate;
	const positionFrame = Math.max(0, telemetry.positionFrame || 0);
	const disabled = snapshot.readOnly || snapshot.recording;
	const label = sequenceTimecodeLabelAtSample(view, positionFrame, sampleRate);
	const [draft, setDraft] = useState(null);
	const [invalid, setInvalid] = useState(false);
	const commitDraft = (value) => {
		setDraft(null);
		if (value === null || value === label) return setInvalid(false);
		if (!parsesAt(value, view)) return setInvalid(true);
		setInvalid(false);
		run(() => controller.actions.sequences.seekLabel(value));
	};
	const step = (frameDelta) => run(() => controller.actions.sequences.stepPlayhead(frameDelta));

	return <>
		<div className="kw-audio-editor__sequence-timecode" data-sequence-timecode={label}>
			<button
				type="button"
				className="kw-audio-editor__sequence-frame-step"
				data-sequence-step="previous"
				aria-label={copy.previousFrame}
				disabled={snapshot.recording}
				onClick={() => step(-1)}
			>‹</button>
			<label className="kw-audio-editor__sequence-timecode-field">
				<span className="kw-audio-editor__visually-hidden">{copy.sequenceTimecode}</span>
				<input
					type="text"
					inputMode="numeric"
					spellCheck="false"
					value={draft ?? label}
					aria-label={copy.sequenceTimecode}
					aria-invalid={invalid ? 'true' : 'false'}
					aria-describedby={invalid ? 'audio-editor-sequence-timecode-error' : undefined}
					disabled={snapshot.recording}
					onChange={(event) => setDraft(event.currentTarget.value)}
					onBlur={(event) => commitDraft(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							commitDraft(event.currentTarget.value);
						} else if (event.key === 'Escape') {
							setDraft(null);
							setInvalid(false);
						} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
							event.preventDefault();
							setDraft(null);
							step(event.key === 'ArrowUp' ? 1 : -1);
						}
					}}
				/>
			</label>
			<button
				type="button"
				className="kw-audio-editor__sequence-frame-step"
				data-sequence-step="next"
				aria-label={copy.nextFrame}
				disabled={snapshot.recording}
				onClick={() => step(1)}
			>›</button>
			{invalid && <p
				id="audio-editor-sequence-timecode-error"
				className="kw-audio-editor__sequence-timecode-error"
				role="alert"
			>{copy.sequenceTimecodeInvalid}</p>}
		</div>
		<AudacityToolbarFlyoutButton
			icon={iconNameToChar('VIDEO')}
			ariaLabel={copy.sequenceTiming}
			flyoutClassName="kw-audio-editor__sequence-timing-flyout"
			overlayPortal
		>
			<SequenceTimingEditor
				project={project}
				view={view}
				disabled={disabled}
				controller={controller}
				copy={copy}
				run={run}
			/>
		</AudacityToolbarFlyoutButton>
	</>;
}

function SequenceTimingEditor({ project, view, disabled, controller, copy, run }) {
	const rateId = `${String(view.rate.num)}/${String(view.rate.den)}`;
	const dropFrameAvailable = isSequenceDropFrameRate(view.rate);
	const [startTimecodeError, setStartTimecodeError] = useState(false);
	const update = (changes) => run(() => controller.actions.sequences.update(view.id, changes));
	const startLabel = formatSequenceTimecode(view.startTimecode, view.rate, view.dropFrame);

	return <div className="kw-audio-editor__sequence-timing-editor" data-sequence-timing-editor>
		<header>
			<strong>{copy.sequenceTiming}</strong>
		</header>
		<label>
			<span>{copy.sequenceName}</span>
			<input
				type="text"
				defaultValue={view.name}
				disabled={disabled}
				onBlur={(event) => {
					const name = event.currentTarget.value.trim();
					if (name && name !== view.name) update({ name });
				}}
			/>
		</label>
		<label>
			<span>{copy.sequenceRate}</span>
			<select
				value={RATE_PRESETS.some((preset) => preset.id === rateId) ? rateId : ''}
				data-sequence-rate={rateId}
				disabled={disabled}
				onChange={(event) => {
					const preset = RATE_PRESETS.find(({ id }) => id === event.currentTarget.value);
					if (!preset) return;
					update({
						rate: preset.rate,
						...(isSequenceDropFrameRate(preset.rate) ? {} : { dropFrame: false }),
					});
				}}
			>
				{!RATE_PRESETS.some((preset) => preset.id === rateId) && <option value="">{rateId}</option>}
				{RATE_PRESETS.map((preset) => (
					<option key={preset.id} value={preset.id}>{preset.label}</option>
				))}
			</select>
		</label>
		<label className="kw-audio-editor__sequence-drop-frame">
			<input
				type="checkbox"
				checked={view.dropFrame}
				data-sequence-drop-frame={view.dropFrame ? 'true' : 'false'}
				disabled={disabled || !dropFrameAvailable}
				onChange={(event) => update({ dropFrame: event.currentTarget.checked })}
			/>
			<span>{copy.sequenceDropFrame}</span>
		</label>
		<label>
			<span>{copy.sequenceStartTimecode}</span>
			<input
				type="text"
				inputMode="numeric"
				spellCheck="false"
				key={startLabel}
				defaultValue={startLabel}
				aria-invalid={startTimecodeError ? 'true' : 'false'}
				data-sequence-start-timecode={startLabel}
				disabled={disabled}
				onBlur={(event) => {
					const value = event.currentTarget.value.trim();
					if (value === startLabel) return setStartTimecodeError(false);
					if (!parsesAt(value, view)) return setStartTimecodeError(true);
					setStartTimecodeError(false);
					update({ startTimecode: parseSequenceTimecode(value, view.rate, view.dropFrame) });
				}}
			/>
		</label>
		{startTimecodeError && <p role="alert">{copy.sequenceTimecodeInvalid}</p>}
		<label className="kw-audio-editor__sequence-timecode-ruler">
			<input
				type="checkbox"
				checked={project.timeDisplay?.format === 'timecode'}
				data-sequence-timecode-ruler={project.timeDisplay?.format === 'timecode' ? 'true' : 'false'}
				disabled={disabled}
				onChange={(event) => run(() => controller.actions.project.setTimeDisplay(
					event.currentTarget.checked ? 'timecode' : 'hh:mm:ss+milliseconds',
				))}
			/>
			<span>{copy.sequenceTimecodeRuler}</span>
		</label>
	</div>;
}

/** Only a label this sequence's rate can produce is worth committing. */
function parsesAt(value, view) {
	try {
		parseSequenceTimecode(value, view.rate, view.dropFrame);
		return true;
	} catch {
		return false;
	}
}
