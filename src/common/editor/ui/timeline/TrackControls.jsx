import { useCallback, useEffect, useRef, useState } from 'react';
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
import {
	beginParameterAutomationGestureV21,
	cancelParameterAutomationGestureV21,
	parameterAutomationCaptureAvailableV21,
	previewParameterAutomationGestureV21,
	releaseParameterAutomationGestureV21,
	TrackAutomationSelectors,
} from '../soundscaper-workflow-product-runtime.tsx';
import { COMPACT_TRACK_PANEL_WIDTH } from './constants.ts';

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
	automationTargets = [],
	automationTarget,
	automationRuntime,
	isFlatNavigation,
	copy,
	run,
	onMenu,
	onOpenEffects,
	onAutomationTarget,
	onTabOut,
	onShiftTabOut,
	onNavigateVertical,
}) {
	const controlsRef = useRef(null);
	const automationGestureRef = useRef(null);
	const [editingName, setEditingName] = useState(false);
	const adapterSelector = '.audio-editor-track-adapters input:not([disabled]), .audio-editor-track-adapters button:not([disabled]), .audio-editor-track-input select:not([disabled]), .audio-editor-track-automation select:not([disabled])';
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
			adapterSelector,
		);
		for (const adapter of adapters || []) adapter.tabIndex = isFlatNavigation ? 0 : -1;
	}, [adapterSelector, automationTarget, blocked, isFlatNavigation, recordingInputs, showArmControls, track.id]);

	const beginAutomationGesture = useCallback((parameterId, value) => {
		if (blocked || automationGestureRef.current) return false;
		const session = run(() => beginParameterAutomationGestureV21({
			runtime: automationRuntime,
			target: automationTarget,
			address: {
				kind: 'strip', strip: { kind: 'track', id: track.id }, parameterId,
			},
		}, value));
		if (!session) return false;
		automationGestureRef.current = { parameterId, session, value };
		return true;
	}, [automationRuntime, automationTarget, blocked, run, track.id]);
	const automationCaptureReserved = useCallback((parameterId) => (
		parameterAutomationCaptureAvailableV21({
			runtime: automationRuntime,
			target: automationTarget,
			address: {
				kind: 'strip', strip: { kind: 'track', id: track.id }, parameterId,
			},
		})
	), [automationRuntime, automationTarget, track.id]);
	const previewAutomationGesture = useCallback((parameterId, value) => {
		const gesture = automationGestureRef.current;
		if (!gesture || gesture.parameterId !== parameterId) return false;
		gesture.value = value;
		run(() => previewParameterAutomationGestureV21(gesture.session, value));
		return true;
	}, [run]);
	const finishAutomationGesture = useCallback((gesture, operation, recoverWithCancellation) => {
		run(() => {
			const clear = () => {
				if (automationGestureRef.current === gesture) automationGestureRef.current = null;
			};
			const reject = (error) => {
				if (!recoverWithCancellation) {
					clear();
					throw error;
				}
				let cancellation;
				try {
					cancellation = cancelParameterAutomationGestureV21(gesture.session);
				} catch (cancellationError) {
					clear();
					throw new AggregateError(
						[error, cancellationError],
						'Automation release and recovery cancellation both failed.',
						{ cause: cancellationError },
					);
				}
				if (cancellation && typeof cancellation.then === 'function') {
					return Promise.resolve(cancellation).then(() => {
						clear();
						throw error;
					}, (cancellationError) => {
						clear();
						throw new AggregateError(
							[error, cancellationError],
							'Automation release and recovery cancellation both failed.',
							{ cause: cancellationError },
						);
					});
				}
				clear();
				throw error;
			};
			let result;
			try {
				result = operation();
			} catch (error) {
				return reject(error);
			}
			if (result && typeof result.then === 'function') {
				return Promise.resolve(result).then((value) => {
					clear();
					return value;
				}, reject);
			}
			clear();
			return result;
		});
		return true;
	}, [run]);
	const endAutomationGesture = useCallback((parameterId, value) => {
		const gesture = automationGestureRef.current;
		if (!gesture || gesture.parameterId !== parameterId) return false;
		return finishAutomationGesture(
			gesture, () => releaseParameterAutomationGestureV21(gesture.session, value),
			true,
		);
	}, [finishAutomationGesture]);
	const cancelAutomationGesture = useCallback((parameterId) => {
		const gesture = automationGestureRef.current;
		if (!gesture || gesture.parameterId !== parameterId) return false;
		return finishAutomationGesture(
			gesture, () => cancelParameterAutomationGestureV21(gesture.session),
			false,
		);
	}, [finishAutomationGesture]);
	useEffect(() => () => {
		const gesture = automationGestureRef.current;
		if (!gesture) return;
		finishAutomationGesture(
			gesture, () => cancelParameterAutomationGestureV21(gesture.session), false,
		);
	}, [automationTarget?.key, finishAutomationGesture]);
	const updateMute = () => {
		const value = track.mute ? 0 : 1;
		const reserved = automationCaptureReserved('mute');
		if (beginAutomationGesture('mute', value)) {
			previewAutomationGesture('mute', value);
			endAutomationGesture('mute', value);
			return;
		}
		if (reserved) return;
		if (!blocked) run(() => controller.actions.track.update(track.id, { mute: !track.mute }));
	};

	return (
		<div ref={controlsRef} className="audio-editor-track-controls" data-track-header style={{ width: panelWidth }} onFocusCapture={() => {
			if (!selected) run(() => controller.actions.timeline.selectTrack(track.id));
		}} onDoubleClick={(event) => {
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
				onVolumeChange={(volume) => {
					const value = dbToLinear(designVolumeToGainDb(volume));
					if (!blocked && !previewAutomationGesture('gain', value)
						&& !automationCaptureReserved('gain')) {
						run(() => controller.actions.track.update(track.id, { gain: value }));
					}
				}}
				onVolumeGestureStart={(volume) => beginAutomationGesture('gain', dbToLinear(designVolumeToGainDb(volume)))}
				onVolumeGestureEnd={(volume) => endAutomationGesture('gain', dbToLinear(designVolumeToGainDb(volume)))}
				onVolumeGestureCancel={() => cancelAutomationGesture('gain')}
				onPanChange={(pan) => {
					const value = designValueToPan(pan);
					if (!blocked && !previewAutomationGesture('pan', value)
						&& !automationCaptureReserved('pan')) {
						run(() => controller.actions.track.update(track.id, { pan: value }));
					}
				}}
				onPanGestureStart={(pan) => beginAutomationGesture('pan', designValueToPan(pan))}
				onPanGestureEnd={(pan) => endAutomationGesture('pan', designValueToPan(pan))}
				onPanGestureCancel={() => cancelAutomationGesture('pan')}
				onMuteToggle={updateMute}
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
			{automationTarget && (
				<TrackAutomationSelectors
					trackId={track.id}
					targets={automationTargets}
					selectedTarget={automationTarget}
					runtime={automationRuntime}
					disabled={blocked}
					copy={copy}
					onTarget={onAutomationTarget}
				/>
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
