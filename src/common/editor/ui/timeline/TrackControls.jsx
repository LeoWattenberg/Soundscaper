import { useEffect, useRef, useState } from 'react';
import { TextInput } from '@soundscaper/design-system/TextInput';
import { ToggleToolButton } from '@soundscaper/design-system/ToggleToolButton';
import { TrackControlPanel } from '@soundscaper/design-system/TrackControlPanel';

import {
	designValueToPan,
	designVolumeToGainDb,
	gainDbToDesignVolume,
	panToDesignValue,
} from '../../design-system-adapters.js';
import RecordingInputSelectors from '../RecordingInputSelectors.jsx';
import {
	dbToLinear,
	linearToDb,
} from './geometry.ts';
import { TrackTelemetryMeters } from './TrackTelemetryMeters.tsx';
import { focusCandidate, focusFirst, focusPanelControl } from './timeline-navigation.js';

const COMPACT_TRACK_PANEL_WIDTH = 164;

export function TrackControls({
	controller,
	track,
	trackHeight,
	panelWidth,
	selected,
	blocked,
	showArmControls,
	displayAudioSupported,
	recordingInputs,
	isFlatNavigation,
	copy,
	run,
	onMenu,
	onOpenEffects,
	onTabOut,
	onShiftTabOut,
	onNavigateVertical,
}) {
	const controlsRef = useRef(null);
	const [editingName, setEditingName] = useState(false);
	const adapterSelector = '.audio-editor-track-adapters input:not([disabled]), .audio-editor-track-adapters button:not([disabled]), .audio-editor-track-input select:not([disabled])';
	const focusAdapterControl = (last = false) => focusCandidate(
		controlsRef.current,
		adapterSelector,
		last,
	);
	const handleAdapterTab = (event) => {
		if (event.key !== 'Tab') return;
		const adapters = [...controlsRef.current.querySelectorAll(adapterSelector)];
		const currentIndex = adapters.indexOf(document.activeElement);
		if (currentIndex < 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.shiftKey) {
			if (currentIndex > 0) focusFirst(adapters[currentIndex - 1]);
			else if (!focusPanelControl(controlsRef.current?.querySelector('.track-control-panel'), true)) onShiftTabOut?.();
		} else if (currentIndex < adapters.length - 1) {
			focusFirst(adapters[currentIndex + 1]);
		} else {
			onTabOut?.();
		}
	};

	useEffect(() => {
		const adapters = controlsRef.current?.querySelectorAll(
			'.audio-editor-track-adapters input:not([disabled]), .audio-editor-track-adapters button:not([disabled]), .audio-editor-track-input select:not([disabled])',
		);
		for (const adapter of adapters || []) adapter.tabIndex = isFlatNavigation ? 0 : -1;
	}, [blocked, isFlatNavigation, recordingInputs, showArmControls, track.id]);

	return (
		<div ref={controlsRef} className="audio-editor-track-controls" data-track-header style={{ width: panelWidth }} onDoubleClick={(event) => {
			if (blocked || !(event.target instanceof Element) || !event.target.closest('.track-control-panel__track-name-text')) return;
			setEditingName(true);
		}}>
			<TrackControlPanel
				trackName={track.name}
				trackType="stereo"
				volume={gainDbToDesignVolume(linearToDb(track.gain))}
				pan={panToDesignValue(track.pan)}
				isMuted={track.mute}
				isSolo={track.solo}
				isFocused={selected}
				height={panelWidth <= COMPACT_TRACK_PANEL_WIDTH ? 'truncated' : 'default'}
				trackHeight={trackHeight}
				meterContent={<TrackTelemetryMeters controller={controller} trackId={track.id} />}
				tabIndex={-1}
				onTabOut={() => {
					if (!focusAdapterControl()) onTabOut?.();
				}}
				onShiftTabOut={onShiftTabOut}
				onNavigateVertical={onNavigateVertical}
				onVolumeChange={(volume) => !blocked && run(() => controller.actions.track.update(track.id, {
					gain: dbToLinear(designVolumeToGainDb(volume)),
				}))}
				onPanChange={(pan) => !blocked && run(() => controller.actions.track.update(track.id, { pan: designValueToPan(pan) }))}
				onMuteToggle={() => !blocked && run(() => controller.actions.track.update(track.id, { mute: !track.mute }))}
				onSoloToggle={() => !blocked && run(() => controller.actions.track.update(track.id, { solo: !track.solo }))}
				onEffectsClick={() => {
					if (!selected) run(() => controller.actions.timeline.selectTrack(track.id));
					onOpenEffects?.(track.id, controlsRef.current?.getBoundingClientRect() || null);
				}}
				onMenuClick={(event) => onMenu(event.currentTarget)}
				onClick={() => !selected && run(() => controller.actions.timeline.selectTrack(track.id))}
			/>
			<div className="audio-editor-track-adapters" onKeyDownCapture={handleAdapterTab}>
				{editingName && <TrackNameEditor
					track={track}
					label={copy.trackName}
					blocked={blocked}
					controller={controller}
					run={run}
					onClose={() => setEditingName(false)}
				/>}
				{showArmControls && (
					<span data-track-action="arm">
						<ToggleToolButton
							icon="record"
							isActive={track.armed}
							disabled={blocked}
							ariaLabel={`${copy.arm}: ${track.name}`}
							onClick={() => run(() => controller.actions.track.update(track.id, { armed: !track.armed }))}
						/>
					</span>
				)}
			</div>
			{showArmControls && (
				<div className="audio-editor-track-input" onKeyDownCapture={handleAdapterTab}>
					<RecordingInputSelectors
						controller={controller}
						recordingInputs={recordingInputs}
						track={track}
						copy={copy}
						run={run}
						displayAudioSupported={displayAudioSupported}
						disabled={blocked}
						surface="track"
					/>
				</div>
			)}
		</div>
	);
}

export function TrackNameEditor({ track, label, blocked, controller, run, onClose }) {
	const editorRef = useRef(null);
	const [name, setName] = useState(track.name);
	useEffect(() => setName(track.name), [track.name]);
	useEffect(() => {
		const input = editorRef.current?.querySelector('input');
		input?.focus();
		input?.select();
	}, []);
	const commit = () => {
		const nextName = name.trim();
		if (!nextName) {
			setName(track.name);
			onClose();
			return;
		}
		if (nextName !== track.name) run(() => controller.actions.track.update(track.id, { name: nextName }));
		onClose();
	};
	return (
		<label ref={editorRef} data-track-name onBlur={commit} onKeyDown={(event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				event.currentTarget.querySelector('input')?.blur();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				setName(track.name);
				onClose();
			}
		}}>
			<span className="kw-audio-editor-sr-only">{label}: {track.name}</span>
			<TextInput value={name} disabled={blocked} width="100%" onChange={setName} />
		</label>
	);
}
