import { useEffect, useRef, useState } from 'react';
import { Button } from '@dilsonspickles/components';

import {
	ebuMeterBounds,
	ebuMeterPercent,
	ebuMeterTicks,
	playbackMeterAmplitudeToDb,
	playbackMeterPercent,
} from '../../playback-meter.js';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import {
	METER_DB_RANGES,
	formatDbtp,
	formatEbuLoudness,
	formatLra,
	playbackMeterTicks,
} from '../meter-settings.ts';

export function AudacityAudioMeter({
	copy,
	meter,
	settings,
	orientation,
	clipped,
	slider,
	channelCount = 2,
	meterLabel,
	meterKind = 'playback',
	compact = false,
	className = '',
	dataMeterAttribute,
}) {
	const meterRef = useRef(null);
	const [meterSize, setMeterSize] = useState(orientation === 'vertical' ? 500 : 280);
	const isEbu = settings.type === 'ebu-r128';
	const loudness = meter?.loudness || {};
	const ebuBounds = ebuMeterBounds(settings.ebuScale);
	const liveLufs = settings.ebuLiveValue === 'short-term'
		? loudness.shortTermLufs
		: loudness.momentaryLufs;
	const range = settings.type === 'amplitude' ? 60 : settings.dbRange;
	const peakDb = Number.isFinite(meter?.dbfs)
		? meter.dbfs
		: playbackMeterAmplitudeToDb(meter?.peak, range);
	const rmsDb = playbackMeterAmplitudeToDb(meter?.rms, range);
	const peakPercent = isEbu
		? ebuMeterPercent(liveLufs, settings.ebuScale)
		: playbackMeterPercent(peakDb, settings.type, range);
	const rmsPercent = isEbu
		? peakPercent
		: Math.min(peakPercent, playbackMeterPercent(rmsDb, settings.type, range));
	const absoluteDisplayedValue = Math.max(
		ebuBounds.minimumLufs,
		Math.min(ebuBounds.maximumLufs, Number.isFinite(liveLufs) ? liveLufs : ebuBounds.minimumLufs),
	);
	const displayedValue = isEbu
		? settings.ebuUnit === 'relative' ? absoluteDisplayedValue + 23 : absoluteDisplayedValue
		: settings.type === 'amplitude'
			? Math.max(0, Math.min(1, Number(meter?.peak) || 0))
			: Math.max(-range, Math.min(0, peakDb));
	const ticks = isEbu
		? ebuMeterTicks(settings.ebuScale, settings.ebuUnit, meterSize)
		: playbackMeterTicks(settings.type, range, meterSize);
	const ebuMinimum = settings.ebuUnit === 'relative'
		? ebuBounds.minimumLufs + 23
		: ebuBounds.minimumLufs;
	const ebuMaximum = settings.ebuUnit === 'relative'
		? ebuBounds.maximumLufs + 23
		: ebuBounds.maximumLufs;
	const truePeakExceeded = Number.isFinite(loudness.maximumTruePeakDbtp)
		&& loudness.maximumTruePeakDbtp > -1;
	const style = {
		'--playback-meter-peak': `${peakPercent}%`,
		'--playback-meter-rms': `${rmsPercent}%`,
	};
	useEffect(() => {
		const element = meterRef.current;
		if (!element) return undefined;
		const update = () => {
			const rect = element.getBoundingClientRect();
			const length = orientation === 'vertical' ? rect.height : rect.width;
			const next = Math.max(0, Math.round(length - 22));
			setMeterSize((current) => current === next ? current : next);
		};
		update();
		if (typeof ResizeObserver !== 'function') return undefined;
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, [orientation]);
	return (
		<div
			ref={meterRef}
			className={`kw-audio-editor__master-meter kw-audio-editor__playback-meter-surface kw-audio-editor__playback-meter-surface--${orientation}${compact ? ' kw-audio-editor__playback-meter-surface--compact' : ''}${className ? ` ${className}` : ''}`}
			data-playback-meter={!meterLabel ? '' : undefined}
			data-audio-meter
			data-meter-kind={meterKind}
			data-input-meter={dataMeterAttribute === 'input-meter' ? '' : undefined}
			data-idle-input-meter={dataMeterAttribute === 'idle-input-meter' ? '' : undefined}
			data-meter-position={settings.position}
			data-meter-style={settings.style}
			data-meter-type={settings.type}
			data-meter-db-range={range}
			data-ebu-scale={isEbu ? settings.ebuScale : undefined}
			data-ebu-unit={isEbu ? settings.ebuUnit : undefined}
			data-ebu-live-value={isEbu ? settings.ebuLiveValue : undefined}
			data-meter-orientation={orientation}
			style={style}
		>
			<div
				className="kw-audio-editor__playback-meter-channels"
				role="meter"
				aria-label={meterLabel || copy.metering}
				aria-valuemin={isEbu ? ebuMinimum : settings.type === 'amplitude' ? 0 : -range}
				aria-valuemax={isEbu ? ebuMaximum : settings.type === 'amplitude' ? 1 : 0}
				aria-valuenow={displayedValue}
				aria-valuetext={isEbu ? formatEbuLoudness(liveLufs, settings.ebuUnit) : undefined}
			>
				{Array.from({ length: isEbu ? 1 : channelCount === 2 ? 2 : 1 }, (_, channel) => (
					<span className="kw-audio-editor__playback-meter-channel" key={channel} aria-hidden="true">
						<i className="kw-audio-editor__playback-meter-peak" />
						{settings.style === 'rms' && <i className="kw-audio-editor__playback-meter-rms" />}
						<b className="kw-audio-editor__playback-meter-peak-mark" />
					</span>
				))}
			</div>
			<div className="kw-audio-editor__playback-meter-ruler" aria-hidden="true">
				{ticks.map((tick) => (
					<span
						key={`${tick.label}-${tick.position}`}
						data-ebu-target={isEbu && tick.target ? '' : undefined}
						style={{ '--playback-meter-tick': `${tick.position}%` }}
					>{tick.label}</span>
				))}
			</div>
			{isEbu && <div className="kw-audio-editor__ebu-compact-readout" aria-hidden="true">
				<span>{settings.ebuLiveValue === 'short-term' ? 'S' : 'M'} {formatEbuLoudness(liveLufs, settings.ebuUnit)}</span>
				<span>I {formatEbuLoudness(loudness.integratedLufs, settings.ebuUnit)}</span>
				<span className={truePeakExceeded ? 'is-over' : ''}>
					TP {formatDbtp(loudness.truePeakDbtp)}
				</span>
			</div>}
			{slider && <input
				className="kw-audio-editor__playback-meter-volume"
				type="range"
				min={slider.minimum}
				max={slider.maximum}
				step={slider.step}
				value={slider.value}
				aria-label={slider.label}
				aria-orientation={orientation}
				aria-valuetext={slider.valueText}
				orient={orientation === 'vertical' ? 'vertical' : undefined}
				onChange={(event) => slider.onChange(Number(event.currentTarget.value))}
			/>}
			{(clipped || truePeakExceeded) && <span className="kw-audio-editor__playback-meter-clipped" aria-hidden="true" />}
		</div>
	);
}

export function MeterSettingsFlyout({
	copy,
	settings,
	onChange,
	meterKind = 'playback',
	recordingOptions = null,
}) {
	const update = (key, value) => onChange((current) => ({ ...current, [key]: value }));
	const isEbu = settings.type === 'ebu-r128';
	const positions = [
		['flyout', copy.meterPositionFlyout],
		['top', copy.meterPositionTop],
		['side', copy.meterPositionSide],
	];
	const styles = [
		['default', copy.defaultOption],
		['rms', 'RMS'],
		['gradient', copy.gradient],
	];
	const types = [
		['db-log', copy.meterTypeLogarithmic],
		['db-linear', copy.meterTypeLinearDb],
		['amplitude', copy.meterTypeLinearAmplitude],
		['ebu-r128', copy.meterTypeEbuR128],
	];

	return (
		<div className="kw-audio-editor__playback-meter-settings" data-playback-meter-settings>
			<fieldset>
				<legend>{copy.position}</legend>
				{positions.map(([value, label]) => (
					<label key={value} className="kw-audio-editor__playback-meter-radio">
						<input
							type="radio"
							name="meter-position"
							value={value}
							checked={settings.position === value}
							onChange={() => update('position', value)}
						/>
						<span>{label}</span>
					</label>
				))}
			</fieldset>
			<div className="kw-audio-editor__playback-meter-settings-row">
				{!isEbu && <fieldset>
					<legend>{copy.meterStyle}</legend>
					{styles.map(([value, label]) => (
						<label key={value} className="kw-audio-editor__playback-meter-radio">
							<input
								type="radio"
								name="meter-style"
								value={value}
								checked={settings.style === value}
								onChange={() => update('style', value)}
							/>
							<span>{label}</span>
						</label>
					))}
				</fieldset>}
				<fieldset>
					<legend>{copy.meterType}</legend>
					{types.map(([value, label]) => (
						<label key={value} className="kw-audio-editor__playback-meter-radio">
							<input
								type="radio"
								name="meter-type"
								value={value}
								checked={settings.type === value}
								onChange={() => update('type', value)}
							/>
							<span>{label}</span>
						</label>
					))}
				</fieldset>
			</div>
			{isEbu ? <div className="kw-audio-editor__ebu-settings">
				<fieldset>
					<legend>{copy.ebuScale}</legend>
					{[
						['plus9', copy.ebuScalePlus9],
						['plus18', copy.ebuScalePlus18],
					].map(([value, label]) => (
						<label key={value} className="kw-audio-editor__playback-meter-radio">
							<input
								type="radio"
								name={`ebu-scale-${meterKind}`}
								value={value}
								checked={settings.ebuScale === value}
								onChange={() => update('ebuScale', value)}
							/>
							<span>{label}</span>
						</label>
					))}
				</fieldset>
				<fieldset>
					<legend>{copy.ebuUnits}</legend>
					{[
						['absolute', copy.ebuUnitsAbsolute],
						['relative', copy.ebuUnitsRelative],
					].map(([value, label]) => (
						<label key={value} className="kw-audio-editor__playback-meter-radio">
							<input
								type="radio"
								name={`ebu-units-${meterKind}`}
								value={value}
								checked={settings.ebuUnit === value}
								onChange={() => update('ebuUnit', value)}
							/>
							<span>{label}</span>
						</label>
					))}
				</fieldset>
				<fieldset>
					<legend>{copy.ebuLiveValue}</legend>
					{[
						['momentary', copy.ebuMomentary],
						['short-term', copy.ebuShortTerm],
					].map(([value, label]) => (
						<label key={value} className="kw-audio-editor__playback-meter-radio">
							<input
								type="radio"
								name={`ebu-live-${meterKind}`}
								value={value}
								checked={settings.ebuLiveValue === value}
								onChange={() => update('ebuLiveValue', value)}
							/>
							<span>{label}</span>
						</label>
					))}
				</fieldset>
			</div> : <label className="kw-audio-editor__playback-meter-range">
				<span>{copy.dbRange}</span>
				<select
					value={settings.dbRange}
					disabled={settings.type === 'amplitude'}
					onChange={(event) => update('dbRange', Number(event.currentTarget.value))}
				>
					{METER_DB_RANGES.map((range) => (
						<option key={range} value={range}>−{range === 144 ? 145 : range} dB – 0 dB</option>
					))}
				</select>
			</label>}
			{recordingOptions && <div className="kw-audio-editor__microphone-level-options" data-recording-meter-options>
				{recordingOptions}
			</div>}
		</div>
	);
}

function EbuMeterDashboard({ copy, loudness = {}, unit, meterKind, controller }) {
	const values = [
		['M', copy.ebuMomentary, formatEbuLoudness(loudness?.momentaryLufs, unit)],
		['S', copy.ebuShortTerm, formatEbuLoudness(loudness?.shortTermLufs, unit)],
		['I', copy.ebuIntegrated, formatEbuLoudness(loudness?.integratedLufs, unit)],
		['maxM', copy.ebuMaximumMomentary, formatEbuLoudness(loudness?.maximumMomentaryLufs, unit)],
		['maxS', copy.ebuMaximumShortTerm, formatEbuLoudness(loudness?.maximumShortTermLufs, unit)],
		['lra', copy.ebuLoudnessRange, formatLra(loudness?.loudnessRangeLu)],
		['tp', copy.ebuMaximumTruePeak, formatDbtp(loudness?.maximumTruePeakDbtp)],
	];
	const running = loudness?.state === 'running';
	const provisional = !loudness?.loudnessRangeStable && Number(loudness?.measuredSeconds) < 60;
	return (
		<section className="kw-audio-editor__ebu-dashboard" aria-label={copy.ebuR128Readout}>
			<header>
				<strong>{copy.meterTypeEbuR128}</strong>
				<span data-ebu-state={running ? 'running' : 'standby'}>
					{running ? copy.ebuRunning : copy.ebuStandby}
				</span>
			</header>
			<div className="kw-audio-editor__ebu-values">
				{values.map(([key, label, value]) => (
					<div key={key} data-ebu-value={key}>
						<span>{label}</span>
						<strong>{value}</strong>
					</div>
				))}
			</div>
			{provisional && <p>{copy.ebuLraProvisional}</p>}
			<div className="kw-audio-editor__ebu-actions">
				<Button
					variant="secondary"
					onClick={() => controller?.actions.metering[
						running ? 'pause' : 'continue'
					]?.(meterKind)}
				>
					{running ? copy.ebuPause : copy.ebuContinue}
				</Button>
				<Button
					variant="secondary"
					onClick={() => controller?.actions.metering.reset?.(meterKind)}
				>
					{copy.ebuReset}
				</Button>
			</div>
		</section>
	);
}

export function EbuR128WorkspacePanel({ copy, controller, settings }) {
	const masterMeter = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.master);
	return (
		<EbuMeterDashboard
			copy={copy}
			loudness={masterMeter?.loudness}
			unit={settings?.ebuUnit || 'absolute'}
			meterKind="playback"
			controller={controller}
		/>
	);
}
