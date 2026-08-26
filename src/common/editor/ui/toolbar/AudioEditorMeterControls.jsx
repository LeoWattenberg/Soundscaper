import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Flyout, Separator, ToolbarButtonGroup } from '@dilsonspickles/components';

import { iconNameToChar } from '../../audacity-iconcodes.js';
import {
	playbackMeterAmplitudeToDb,
	playbackMeterGainFromPosition,
	playbackMeterPercent,
} from '../../playback-meter.js';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import PreferenceCheckbox from '../EditorPreferenceCheckbox.tsx';
import { formatDb } from '../meter-settings.ts';
import { AudacityAudioMeter, MeterSettingsFlyout } from './AudioEditorMeters.jsx';

// Browser adaptations of Audacity's RecordLevel.qml/RecordLevelPopup.qml and
// PlaybackLevel.qml/PlaybackMeterCustomisePopup.qml at eee7be71d602bfd852d6d30e58b70a8ab43ed28f.
export function AudacityToolbarFlyoutButton({
	icon,
	ariaLabel,
	flyoutClassName,
	overlayPortal = false,
	children,
}) {
	const triggerRef = useRef(null);
	const [position, setPosition] = useState(null);
	const setTrigger = useCallback((element) => {
		triggerRef.current = element?.querySelector('button') || null;
	}, []);
	const close = useCallback(() => setPosition(null), []);
	const toggle = (event) => {
		if (position) {
			close();
			return;
		}
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		setPosition({
			x: rect.left + rect.width / 2,
			y: rect.bottom,
			direction: window.innerHeight - rect.bottom >= 320 ? 'down' : 'up',
			autoFocus: event.nativeEvent?.detail === 0,
		});
	};

	useEffect(() => {
		triggerRef.current?.setAttribute('aria-expanded', String(Boolean(position)));
	}, [position]);

	const flyout = (
		<Flyout
			isOpen={Boolean(position)}
			onClose={close}
			x={position?.x || 0}
			y={position?.y || 0}
			direction={position?.direction || 'down'}
			autoFocus={Boolean(position?.autoFocus)}
			triggerRef={triggerRef}
			showArrow
			closeOnOutsideClick
			closeOnEscape
			ariaLabel={ariaLabel}
			role="dialog"
			className={`kw-audio-editor__audacity-level-flyout ${flyoutClassName}`}
		>
			{children}
		</Flyout>
	);
	const overlayTarget = overlayPortal
		? triggerRef.current?.closest('#kw-audio-editor-design-system')?.querySelector('[data-editor-overlay-layer]')
		: null;
	return (
		<>
			<span ref={setTrigger} className="kw-audio-editor__audacity-level-trigger">
				<button
					type="button"
					className="tool-button tool-button--default tool-button--idle kw-audio-editor__audacity-level-button"
					aria-label={ariaLabel}
					aria-expanded={Boolean(position)}
					onClick={toggle}
				>
					<span className="musescore-icon tool-button__icon" aria-hidden="true">{icon}</span>
				</button>
			</span>
			{overlayTarget ? createPortal(flyout, overlayTarget) : flyout}
		</>
	);
}

function useRecordingMeter(controller) {
	return useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => telemetry.inputMeter
			|| Math.max(-60, Math.min(0, telemetry.inputMeterDb ?? -60)),
	);
}

function recordingMeterData(dbfs) {
	const peak = dbfs <= -60 ? 0 : 10 ** (dbfs / 20);
	return { dbfs, peak, rms: peak };
}

function recordingMeterChannelCount(snapshot) {
	return snapshot.recordingInputs?.routes?.[snapshot.selectedTrackId]?.channelCount === 2 ? 2 : 1;
}

function recordingMeterSlider(copy, snapshot, controller, run) {
	const inputGain = snapshot.recordingOptions?.inputGain ?? 1;
	const inputGainDb = Math.max(-60, Math.min(6, inputGain > 0 ? 20 * Math.log10(inputGain) : -60));
	return {
		minimum: -60,
		maximum: 6,
		step: 0.1,
		value: inputGainDb,
		label: copy.recordLevel,
		valueText: formatDb(inputGainDb),
		onChange: (value) => run(() => controller.actions.recording.setLevel(value <= -60 ? 0 : 10 ** (value / 20))),
	};
}

export function playbackMeterSlider(copy, volume, settings, onChange) {
	const range = settings.type === 'amplitude' ? 60 : settings.dbRange;
	const position = playbackMeterPercent(
		playbackMeterAmplitudeToDb(volume, range),
		settings.type,
		range,
	) / 100;
	const valueText = settings.type === 'amplitude'
		? volume.toFixed(2)
		: volume <= 0
			? '−∞ dB'
			: `${String(Math.round(playbackMeterAmplitudeToDb(volume, range) * 10) / 10).replace('-', '−')} dB`;
	return {
		minimum: 0,
		maximum: 1,
		step: 0.001,
		value: position,
		label: copy.playbackVolume,
		valueText,
		onChange: (nextPosition) => onChange(playbackMeterGainFromPosition(nextPosition, settings.type, range)),
	};
}

export function RecordingMeterToolbarGroup({
	copy,
	snapshot,
	controller,
	run,
	settings,
	onSettingsChange,
}) {
	const meterValue = useRecordingMeter(controller);
	const meter = typeof meterValue === 'number' ? recordingMeterData(meterValue) : meterValue;
	const meterVisible = Boolean(snapshot.recording || snapshot.monitor?.metering);
	const slider = recordingMeterSlider(copy, snapshot, controller, run);

	return (
		<ToolbarButtonGroup className="kw-audio-editor__recording-meter" gap={4}>
			<AudacityToolbarFlyoutButton
				icon={iconNameToChar('MICROPHONE')}
				ariaLabel={copy.recordLevel}
				flyoutClassName="kw-audio-editor__microphone-level-flyout"
			>
				<RecordingMeterFlyout
					copy={copy}
					snapshot={snapshot}
					meter={meter}
					controller={controller}
					run={run}
					settings={settings}
					onSettingsChange={onSettingsChange}
				/>
			</AudacityToolbarFlyoutButton>
			{meterVisible && settings.position === 'flyout' && <AudacityAudioMeter
				copy={copy}
				meter={meter}
				settings={settings}
				orientation="horizontal"
				channelCount={recordingMeterChannelCount(snapshot)}
				meterLabel={copy.inputLevel}
				meterKind="recording"
				compact
				className="kw-audio-editor__idle-input-meter"
				dataMeterAttribute="idle-input-meter"
			/>}
			{settings.position === 'top' && <AudacityAudioMeter
				copy={copy}
				meter={meter}
				settings={settings}
				orientation="horizontal"
				channelCount={recordingMeterChannelCount(snapshot)}
				meterLabel={copy.inputLevel}
				meterKind="recording"
				slider={slider}
			/>}
		</ToolbarButtonGroup>
	);
}

function RecordingMeterFlyout({
	copy,
	snapshot,
	meter,
	controller,
	run,
	settings,
	onSettingsChange,
}) {
	const slider = recordingMeterSlider(copy, snapshot, controller, run);

	return (
		<div className="kw-audio-editor__microphone-level-content" data-microphone-level-flyout>
			<strong>{copy.microphoneLevel}</strong>
			{settings.position === 'flyout' && <AudacityAudioMeter
				copy={copy}
				meter={meter}
				settings={settings}
				orientation="horizontal"
				channelCount={recordingMeterChannelCount(snapshot)}
				meterLabel={copy.inputLevel}
				meterKind="recording"
				dataMeterAttribute="input-meter"
				slider={slider}
			/>}
			<p>{copy.microphoneLevelNote}</p>
			<Separator />
			<MeterSettingsFlyout
				copy={copy}
				settings={settings}
				onChange={onSettingsChange}
				meterKind="recording"
				recordingOptions={(
					<>
						<PreferenceCheckbox
							label={copy.inputMonitoringDetailed}
							checked={Boolean(snapshot.monitor?.enabled)}
							onChange={(enabled) => run(() => controller.actions.recording.setMonitoring(enabled))}
						/>
						<PreferenceCheckbox
							label={copy.microphoneMeteringInactive}
							checked={Boolean(snapshot.monitor?.metering)}
							onChange={(enabled) => run(() => controller.actions.recording.setMetering(enabled))}
						/>
					</>
				)}
			/>
		</div>
	);
}

export function AudioDevicesFlyout({
	copy,
	snapshot,
	controller,
	run,
}) {
	const devices = snapshot.audioDevices || {};
	const inputs = Array.isArray(devices.inputs) ? devices.inputs : [];
	const outputs = Array.isArray(devices.outputs) ? devices.outputs : [];
	const preferredInput = devices.preferredInputDeviceId || 'default';
	const preferredInputChannelCount = devices.preferredInputChannelCount === 2 ? 2 : 1;
	const displayInputSelected = preferredInput === 'display';
	const preferredOutput = devices.preferredOutputDeviceId || '';
	const selectedInput = inputs.find((device) => device.deviceId === preferredInput);
	const stereoUnavailable = Number(selectedInput?.channelCount) === 1;
	const missingInput = preferredInput === 'display'
		? !devices.displayInputSupported
		: preferredInput !== 'default' && !inputs.some((device) => device.deviceId === preferredInput);
	const missingOutput = Boolean(preferredOutput)
		&& !outputs.some((device) => device.deviceId === preferredOutput);
	const outputMessage = devices.outputStatus === 'unavailable'
		? copy.audioDeviceOutputUnavailable
		: devices.outputStatus === 'denied'
			? copy.audioDeviceOutputDenied
			: !devices.outputSupported
				? copy.audioDeviceOutputUnsupported
				: '';

	return (
		<div className="kw-audio-editor__audio-devices-content" data-audio-devices-flyout>
			<strong>{copy.audioDevices}</strong>
			<label>
				<span>{copy.audioInputDevice}</span>
				<select
					aria-label={copy.audioInputDevice}
					value={preferredInput}
					disabled={!devices.inputSupported}
					onChange={(event) => run(() => controller.actions.audioDevices.setPreferredInput(event.currentTarget.value))}
				>
					<option value="default">{copy.audioDeviceSystemDefault}</option>
					{missingInput && <option value={preferredInput}>{copy.audioDevicePreferredUnavailable}</option>}
					{inputs
						.filter((device) => device.deviceId !== 'default')
						.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
					{devices.displayInputSupported && <option value="display">{copy.recordingDesktopAudio}</option>}
				</select>
			</label>
			{!displayInputSelected && !devices.inputAccess && devices.microphoneInputSupported && (
				<p className="kw-audio-editor__audio-devices-note">{copy.audioDeviceInputAccessRequired}</p>
			)}
			{displayInputSelected && (
				<Button
					variant="secondary"
					onClick={() => run(() => controller.actions.audioDevices.configureDisplayInput())}
				>
					{devices.displayCaptureOpen ? copy.audioDeviceChangeDisplaySource : copy.audioDeviceChooseDisplaySource}
				</Button>
			)}
			<fieldset
				className="kw-audio-editor__audio-device-channels"
				role="radiogroup"
				aria-label={copy.audioDeviceRecordingChannels}
			>
				<legend>{copy.audioDeviceRecordingChannels}</legend>
				<label>
					<input
						type="radio"
						name="audio-device-recording-channels"
						value="1"
						checked={preferredInputChannelCount === 1}
						onChange={() => run(() => controller.actions.audioDevices.setPreferredInputChannelCount(1))}
					/>
					<span>{copy.mono}</span>
				</label>
				<label>
					<input
						type="radio"
						name="audio-device-recording-channels"
						value="2"
						checked={preferredInputChannelCount === 2}
						disabled={stereoUnavailable}
						onChange={() => run(() => controller.actions.audioDevices.setPreferredInputChannelCount(2))}
					/>
					<span>{copy.stereo}</span>
				</label>
			</fieldset>
			<p className="kw-audio-editor__audio-devices-note">{copy.audioDeviceRecordingChannelsNote}</p>
			<label>
				<span>{copy.audioOutputDevice}</span>
				<select
					aria-label={copy.audioOutputDevice}
					value={preferredOutput}
					disabled={!devices.outputSupported}
					onChange={(event) => run(() => controller.actions.audioDevices.setOutput(event.currentTarget.value))}
				>
					<option value="">{copy.audioDeviceSystemDefault}</option>
					{missingOutput && <option value={preferredOutput}>{copy.audioDevicePreferredUnavailable}</option>}
					{outputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
				</select>
			</label>
			{outputMessage && <p className="kw-audio-editor__audio-devices-note" role="status">{outputMessage}</p>}
			<div className="kw-audio-editor__audio-devices-actions">
				{!snapshot.recordingInputs?.hasOpenInputs && typeof controller.actions.recording.requestInputAccess === 'function' && <Button
					variant="secondary"
					disabled={snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording}
					onClick={() => run(() => controller.actions.recording.requestInputAccess())}
				>{copy.recordingAllowInputs}</Button>}
				{snapshot.recordingInputs?.hasOpenInputs && <Button
					variant="secondary"
					disabled={snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording}
					onClick={() => run(() => controller.actions.recording.releaseInputs())}
				>{copy.recordingReleaseInputs}</Button>}
				<Button
					variant="secondary"
					disabled={snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording}
					onClick={() => run(() => controller.actions.audioDevices.refresh())}
				>
					{copy.audioDeviceRefresh}
				</Button>
			</div>
		</div>
	);
}

export function PlaybackMeterToolbarGroup({
	controller,
	copy,
	project,
	settings,
	onSettingsChange,
	clippingEnabled,
	isCompact,
	run,
}) {
	const masterMeter = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.master);
	return <ToolbarButtonGroup className="kw-audio-editor__playback-meter" gap={6}>
		<AudacityToolbarFlyoutButton
			icon={iconNameToChar('AUDIO')}
			ariaLabel={copy.playbackMeterSettings}
			flyoutClassName="kw-audio-editor__playback-meter-flyout"
		>
			<MeterSettingsFlyout
				copy={copy}
				settings={settings}
				onChange={onSettingsChange}
			/>
		</AudacityToolbarFlyoutButton>
		{settings.position === 'top' && <AudacityAudioMeter
			copy={copy}
			meter={masterMeter}
			settings={settings}
			orientation="horizontal"
			clipped={clippingEnabled && (masterMeter?.peak || 0) >= 1}
			slider={playbackMeterSlider(
				copy,
				Math.min(1, project?.master?.gain ?? 1),
				settings,
				(gain) => run(() => controller.actions.effects.setMasterGain(gain)),
			)}
			compact={isCompact}
		/>}
	</ToolbarButtonGroup>;
}

export function SidePlaybackMeter({
	controller,
	copy,
	project,
	settings,
	onSettingsChange,
	clippingEnabled,
	run,
}) {
	const masterMeter = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.master);
	return (
		<aside
			className="kw-audio-editor__side-playback-meter"
			data-side-playback-meter
			aria-label={copy.playbackMeterSettings}
		>
			<AudacityToolbarFlyoutButton
				icon={iconNameToChar('AUDIO')}
				ariaLabel={copy.playbackMeterSettings}
				flyoutClassName="kw-audio-editor__playback-meter-flyout"
			>
				<MeterSettingsFlyout
					copy={copy}
					settings={settings}
					onChange={onSettingsChange}
				/>
			</AudacityToolbarFlyoutButton>
			<AudacityAudioMeter
				copy={copy}
				meter={masterMeter}
				settings={settings}
				orientation="vertical"
				clipped={clippingEnabled && (masterMeter?.peak || 0) >= 1}
				slider={playbackMeterSlider(
					copy,
					Math.min(1, project?.master?.gain ?? 1),
					settings,
					(gain) => run(() => controller.actions.effects.setMasterGain(gain)),
				)}
			/>
		</aside>
	);
}

export function SideRecordingMeter({
	controller,
	copy,
	snapshot,
	settings,
	onSettingsChange,
	run,
}) {
	const meterValue = useRecordingMeter(controller);
	const meter = typeof meterValue === 'number' ? recordingMeterData(meterValue) : meterValue;
	const slider = recordingMeterSlider(copy, snapshot, controller, run);
	return (
		<aside
			className="kw-audio-editor__side-recording-meter"
			data-side-recording-meter
			aria-label={copy.recordLevel}
		>
			<AudacityToolbarFlyoutButton
				icon={iconNameToChar('MICROPHONE')}
				ariaLabel={copy.recordLevel}
				flyoutClassName="kw-audio-editor__microphone-level-flyout"
			>
				<RecordingMeterFlyout
					copy={copy}
					snapshot={snapshot}
					meter={meter}
					controller={controller}
					run={run}
					settings={settings}
					onSettingsChange={onSettingsChange}
				/>
			</AudacityToolbarFlyoutButton>
			<AudacityAudioMeter
				copy={copy}
				meter={meter}
				settings={settings}
				orientation="vertical"
				channelCount={recordingMeterChannelCount(snapshot)}
				meterLabel={copy.inputLevel}
				meterKind="recording"
				slider={slider}
			/>
		</aside>
	);
}
