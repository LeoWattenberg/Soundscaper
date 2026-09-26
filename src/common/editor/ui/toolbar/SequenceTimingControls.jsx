/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';

import {
	formatSequenceTimecode,
	isSequenceDropFrameRate,
	parseSequenceTimecode,
} from '../../sequence-timecode.ts';
import {
	resolveSequenceTimingView,
	sequenceTimecodeLabelAtSample,
} from '../../sequence-timing-model.ts';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';

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

/** Framescaper frame navigation beside the shared time display. */
export function SequenceTimingControls({ project, snapshot, controller, copy, run }) {
	const view = React.useMemo(() => resolveSequenceTimingView(project), [project]);
	const positionFrame = useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => Math.max(0, telemetry.positionFrame || 0),
	);
	const label = sequenceTimecodeLabelAtSample(view, positionFrame, project.sampleRate);
	const sourceReading = controller.actions.video.sourceTimecodeAtSample(positionFrame, view.id);

	return <div
		className="kw-audio-editor__sequence-timecode"
		data-sequence-timecode={label}
		data-source-timecode={sourceReading?.label || ''}
		data-source-origin={sourceReading?.originReported ? 'probed' : 'unknown'}
		role="group"
		aria-label={copy.videoNavigation}
	>
			<button
				type="button"
				className="kw-audio-editor__sequence-frame-step"
				data-sequence-step="previous"
				aria-label={copy.previousFrame}
				disabled={snapshot.recording}
				onClick={() => run(() => controller.actions.sequences.stepPlayhead(-1))}
			><span className="musescore-icon" aria-hidden="true"></span></button>
			<button
				type="button"
				className="kw-audio-editor__sequence-frame-step"
				data-sequence-step="next"
				aria-label={copy.nextFrame}
				disabled={snapshot.recording}
				onClick={() => run(() => controller.actions.sequences.stepPlayhead(1))}
			><span className="musescore-icon" aria-hidden="true"></span></button>
	</div>;
}

/** Sequence properties live in the project properties panel. */
export function SequenceTimingProjectProperties({ project, snapshot, controller, copy, run }) {
	const [selectedId, setSelectedId] = React.useState(null);
	const sequences = project.sequences || [];
	const activeId = sequences.some(({ id }) => id === selectedId)
		? selectedId : project.primarySequenceId;
	const view = React.useMemo(() => resolveSequenceTimingView(project, activeId), [activeId, project]);
	return <div data-project-sequence-properties>
		{sequences.length > 1 && <label className="kw-audio-editor__sequence-selector">
			<span>{copy.sequenceTiming}</span>
			<select value={activeId} onChange={(event) => setSelectedId(event.currentTarget.value)}>
				{sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.name}</option>)}
			</select>
		</label>}
		<SequenceTimingEditor
			key={view.id}
			project={project}
			view={view}
			disabled={snapshot.readOnly || snapshot.recording}
			controller={controller}
			copy={copy}
			run={run}
		/>
	</div>;
}

function SequenceTimingEditor({ project, view, disabled, controller, copy, run }) {
	const rateId = `${String(view.rate.num)}/${String(view.rate.den)}`;
	const dropFrameAvailable = isSequenceDropFrameRate(view.rate);
	const [startTimecodeError, setStartTimecodeError] = React.useState(false);
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
