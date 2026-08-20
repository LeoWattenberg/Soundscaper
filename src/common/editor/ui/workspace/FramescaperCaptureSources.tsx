/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef } from 'react';
import { Button } from '@dilsonspickles/components';

import type { CaptureSourceRole } from '../../framescaper-capture-domain.ts';
import type {
	FramescaperCaptureUiSnapshot,
	FramescaperCaptureUiSource,
} from '../framescaper-capture-ui-model.ts';

const SELECTABLE_SOURCE_ROLES = Object.freeze([
	'camera', 'microphone', 'display',
] as const satisfies readonly CaptureSourceRole[]);
const VIDEO_RESOLUTIONS = Object.freeze([[640, 480], [1280, 720], [1920, 1080], [3840, 2160]] as const);
const VIDEO_FRAME_RATES = Object.freeze([24, 25, 30, 50, 60]);
const AUDIO_SAMPLE_RATES = Object.freeze([44_100, 48_000, 96_000]);
const AUDIO_CHANNEL_COUNTS = Object.freeze([1, 2]);

interface CaptureSourceSetupProps {
	readonly capture: FramescaperCaptureUiSnapshot;
	readonly selectedRoles: readonly CaptureSourceRole[];
	readonly sourceLocked: boolean;
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly locale: string;
	readonly canListDisplaySources: boolean;
	readonly canSelectDevice: boolean;
	readonly canConfigureSource: boolean;
	onToggleRole(role: CaptureSourceRole, enabled: boolean): void;
	onListDisplaySources(): void;
	onSelectDisplaySource(sourceToken: string): void;
	onSelectDevice(role: 'camera' | 'microphone', deviceId: string): void;
	onConfigureSource(sourceId: string, settings: Readonly<Record<string, number>>): void;
}

export function FramescaperCaptureSources({
	capture, selectedRoles, sourceLocked, copy, locale,
	canListDisplaySources, canSelectDevice, canConfigureSource,
	onToggleRole, onListDisplaySources, onSelectDisplaySource, onSelectDevice, onConfigureSource,
}: CaptureSourceSetupProps) {
	const availability = capture.availability;
	if (availability.status !== 'available') return null;
	return <>
		<fieldset className="kw-framescaper-capture__sources">
			<legend>{copy.captureSources}</legend>
			<div className="kw-framescaper-capture__source-choices">
				{SELECTABLE_SOURCE_ROLES.map((role) => <label key={role}>
					<input type="checkbox" checked={selectedRoles.includes(role)}
						disabled={sourceLocked || !availability.sourceRoles.includes(role)}
						onChange={(event) => onToggleRole(role, event.currentTarget.checked)} />
					<span>{sourceRoleLabel(copy, role)}</span>
				</label>)}
				{capture.sources.some(({ role }) => role === 'system-audio') && <label>
					<input type="checkbox" checked disabled />
					<span>{copy.captureSystemAudio}</span>
				</label>}
			</div>
			{sourceLocked && <p className="kw-framescaper-capture__hint">{copy.captureSourceLocked}</p>}
			{!selectedRoles.length && <p className="kw-framescaper-capture__hint" role="alert">{copy.captureNoSources}</p>}
			{selectedRoles.includes('display') && <DisplaySourceSelection
				capture={capture} copy={copy} disabled={sourceLocked}
				canList={canListDisplaySources} onList={onListDisplaySources} onSelect={onSelectDisplaySource}
			/>}
		</fieldset>

		{Boolean(capture.sources.length) && <div className="kw-framescaper-capture__previews">
			{capture.sources.map((source) => <CaptureSourcePreview
				key={source.sourceId} source={source} capture={capture} copy={copy} locale={locale}
				disabled={sourceLocked} canSelectDevice={canSelectDevice}
				canConfigureSource={canConfigureSource} onSelectDevice={onSelectDevice}
				onConfigureSource={onConfigureSource}
			/>)}
		</div>}
	</>;
}

function DisplaySourceSelection({ capture, copy, disabled, canList, onList, onSelect }: Readonly<{
	capture: FramescaperCaptureUiSnapshot;
	copy: Readonly<Record<string, string | undefined>>;
	disabled: boolean;
	canList: boolean;
	onList(): void;
	onSelect(sourceToken: string): void;
}>) {
	if (capture.displaySelectionMode === 'system-picker') {
		return <p className="kw-framescaper-capture__hint">{copy.captureDisplaySystemPicker}</p>;
	}
	if (capture.displaySelectionMode !== 'source-list') return null;
	const sources = capture.displaySources ?? [];
	return <div className="kw-framescaper-capture__display-source">
		<label className="kw-framescaper-capture__select">
			<span>{copy.captureDisplaySource}</span>
			<select aria-label={copy.captureDisplaySource} value={capture.selectedDisplaySourceToken ?? ''}
				disabled={disabled || !sources.length}
				onChange={(event) => onSelect(event.currentTarget.value)}>
				<option value="" disabled>{copy.captureDisplaySourcePlaceholder}</option>
				{sources.map((source) => <option key={source.token} value={source.token}>
					{source.name} · {source.kind === 'screen' ? copy.captureDisplayKindScreen : copy.captureDisplayKindWindow}
				</option>)}
			</select>
		</label>
		<Button variant="secondary" disabled={disabled || !canList} onClick={onList}>
			{sources.length ? copy.captureRefreshDisplaySources : copy.captureListDisplaySources}
		</Button>
		{sources.length > 0 && !capture.selectedDisplaySourceToken
			? <p className="kw-framescaper-capture__hint" role="alert">{copy.captureDisplaySourceRequired}</p>
			: null}
	</div>;
}

function CaptureSourcePreview({
	source, capture, copy, locale, disabled, canSelectDevice, canConfigureSource,
	onSelectDevice, onConfigureSource,
}: Readonly<{
	source: FramescaperCaptureUiSource;
	capture: FramescaperCaptureUiSnapshot;
	copy: Readonly<Record<string, string | undefined>>;
	locale: string;
	disabled: boolean;
	canSelectDevice: boolean;
	canConfigureSource: boolean;
	onSelectDevice(role: 'camera' | 'microphone', deviceId: string): void;
	onConfigureSource(sourceId: string, settings: Readonly<Record<string, number>>): void;
}>) {
	const title = source.label || sourceRoleLabel(copy, source.role) || '';
	const settings = sourceSettingsText(source);
	const level = typeof source.level === 'number' ? Math.max(0, Math.min(1, source.level)) : null;
	const levelText = level === null
		? String(copy.captureConfidenceUnavailable)
		: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(level);
	return <article className="kw-framescaper-capture__preview" data-capture-source-role={source.role}>
		<header><strong>{title}</strong><span>{sourceRoleLabel(copy, source.role)}</span></header>
		{['camera', 'display'].includes(source.role) && (source.previewUrl || source.previewStream)
			? <CaptureVideoPreview source={source} title={title} />
			: ['camera', 'display'].includes(source.role)
				? <div className="kw-framescaper-capture__preview-placeholder">{copy.capturePreviewUnavailable}</div>
				: null}
		{(source.role === 'camera' || source.role === 'microphone') && <DeviceSelection
			source={source} capture={capture} copy={copy} disabled={disabled || !canSelectDevice}
			onSelect={onSelectDevice}
		/>}
		<SourceFormatSettings source={source} copy={copy} disabled={disabled || !canConfigureSource}
			onConfigure={onConfigureSource} />
		{settings && <p><span>{copy.captureSourceFormat}</span>: {settings}</p>}
		{['microphone', 'system-audio'].includes(source.role) && <div
			className="kw-framescaper-capture__meter" role="meter"
			aria-label={`${title}: ${String(copy.captureInputLevel)}`}
			aria-valuemin={0} aria-valuemax={1} aria-valuenow={level ?? undefined} aria-valuetext={levelText}
		><span style={{ width: `${String((level ?? 0) * 100)}%` }} /></div>}
	</article>;
}

function CaptureVideoPreview({ source, title }: Readonly<{
	source: FramescaperCaptureUiSource;
	title: string;
}>) {
	const videoRef = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		if (!videoRef.current || source.previewUrl || !source.previewStream) return undefined;
		return assignCapturePreviewStream(videoRef.current, source.previewStream);
	}, [source.previewStream, source.previewUrl]);
	return <video ref={videoRef} src={source.previewUrl ?? undefined}
		autoPlay muted playsInline aria-label={title} />;
}

export function assignCapturePreviewStream(
	element: Pick<HTMLVideoElement, 'srcObject'>,
	stream: unknown,
): () => void {
	element.srcObject = stream as MediaProvider;
	return () => {
		if (element.srcObject === stream) element.srcObject = null;
	};
}

function DeviceSelection({ source, capture, copy, disabled, onSelect }: Readonly<{
	source: FramescaperCaptureUiSource;
	capture: FramescaperCaptureUiSnapshot;
	copy: Readonly<Record<string, string | undefined>>;
	disabled: boolean;
	onSelect(role: 'camera' | 'microphone', deviceId: string): void;
}>) {
	if (source.role !== 'camera' && source.role !== 'microphone') return null;
	const devices = (capture.devices ?? []).filter(({ kind }) => kind === source.role);
	if (!devices.length) return null;
	const sourceLabel = sourceRoleLabel(copy, source.role) || '';
	const label = String(copy.captureDevice).replace('{source}', sourceLabel);
	const selected = capture.selectedDeviceIds?.[source.role] ?? source.settings?.deviceId ?? '';
	const hasSelected = devices.some(({ id }) => id === selected);
	return <label className="kw-framescaper-capture__select kw-framescaper-capture__device">
		<span>{label}</span>
		<select aria-label={label} value={selected} disabled={disabled}
			onChange={(event) => onSelect(source.role as 'camera' | 'microphone', event.currentTarget.value)}>
			{!hasSelected && <option value="" disabled>
				{String(copy.captureDevicePlaceholder).replace('{source}', sourceLabel.toLocaleLowerCase())}
			</option>}
			{devices.map((device, index) => <option key={device.id} value={device.id}>
				{device.label || String(copy.captureUnnamedDevice)
					.replace('{source}', sourceLabel.toLocaleLowerCase()).replace('{index}', String(index + 1))}
			</option>)}
		</select>
	</label>;
}

function SourceFormatSettings({ source, copy, disabled, onConfigure }: Readonly<{
	source: FramescaperCaptureUiSource;
	copy: Readonly<Record<string, string | undefined>>;
	disabled: boolean;
	onConfigure(sourceId: string, settings: Readonly<Record<string, number>>): void;
}>) {
	const settings = source.settings ?? {};
	const capabilities = source.capabilities ?? {};
	const resolutions = resolutionOptions(settings, capabilities);
	const frameRates = numericOptions(capabilities.frameRate, VIDEO_FRAME_RATES, settings.frameRate);
	const sampleRates = numericOptions(capabilities.sampleRate, AUDIO_SAMPLE_RATES, settings.sampleRate);
	const channelCounts = numericOptions(capabilities.channelCount, AUDIO_CHANNEL_COUNTS, settings.channelCount);
	return <div className="kw-framescaper-capture__format-controls">
		{settings.width && settings.height && resolutions.length > 1 && <SettingSelect label={copy.captureResolution}
			value={`${String(settings.width)}x${String(settings.height)}`} disabled={disabled}
			options={resolutions.map(([width, height]) => ({ value: `${String(width)}x${String(height)}`, label: `${String(width)} × ${String(height)}` }))}
			onChange={(value) => {
				const [width, height] = value.split('x').map(Number);
				if (width && height) onConfigure(source.sourceId, { width, height });
			}} />}
		{typeof settings.frameRate === 'number' && frameRates.length > 1 && <SettingSelect label={copy.captureFrameRate}
			value={String(settings.frameRate)} disabled={disabled}
			options={frameRates.map((value) => ({ value: String(value), label: `${String(value)} fps` }))}
			onChange={(value) => onConfigure(source.sourceId, { frameRate: Number(value) })} />}
		{typeof settings.sampleRate === 'number' && sampleRates.length > 1 && <SettingSelect label={copy.captureSampleRate}
			value={String(settings.sampleRate)} disabled={disabled}
			options={sampleRates.map((value) => ({ value: String(value), label: `${String(value)} Hz` }))}
			onChange={(value) => onConfigure(source.sourceId, { sampleRate: Number(value) })} />}
		{typeof settings.channelCount === 'number' && channelCounts.length > 1 && <SettingSelect label={copy.captureChannels}
			value={String(settings.channelCount)} disabled={disabled}
			options={channelCounts.map((value) => ({ value: String(value), label: String(value) }))}
			onChange={(value) => onConfigure(source.sourceId, { channelCount: Number(value) })} />}
	</div>;
}

function SettingSelect({ label, value, disabled, options, onChange }: Readonly<{
	label: string | undefined;
	value: string;
	disabled: boolean;
	options: readonly Readonly<{ value: string; label: string }>[];
	onChange(value: string): void;
}>) {
	return <label className="kw-framescaper-capture__select">
		<span>{label}</span>
		<select aria-label={label} value={value} disabled={disabled}
			onChange={(event) => onChange(event.currentTarget.value)}>
			{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
		</select>
	</label>;
}

function resolutionOptions(
	settings: FramescaperCaptureUiSource['settings'],
	capabilities: Readonly<Record<string, unknown>>,
): readonly (readonly [number, number])[] {
	const widths = numericOptions(capabilities.width, VIDEO_RESOLUTIONS.map(([width]) => width), settings?.width);
	const heights = numericOptions(capabilities.height, VIDEO_RESOLUTIONS.map(([, height]) => height), settings?.height);
	const widthSet = new Set(widths); const heightSet = new Set(heights);
	const values: [number, number][] = VIDEO_RESOLUTIONS
		.filter(([width, height]) => widthSet.has(width) && heightSet.has(height))
		.map(([width, height]) => [width, height]);
	if (settings?.width && settings.height && !values.some(([width, height]) => width === settings.width && height === settings.height)) {
		values.push([settings.width, settings.height]);
	}
	return Object.freeze(values.sort(([left], [right]) => left - right));
}

function numericOptions(capability: unknown, candidates: readonly number[], current?: number): number[] {
	let values: number[] = [];
	if (Array.isArray(capability)) {
		values = capability.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
	} else if (capability && typeof capability === 'object') {
		const { min, max } = capability as { readonly min?: unknown; readonly max?: unknown };
		if (typeof min === 'number' && typeof max === 'number') {
			values = candidates.filter((value) => value >= min && value <= max);
		}
	}
	if (typeof current === 'number' && Number.isFinite(current) && !values.includes(current)) values.push(current);
	return [...new Set(values)].sort((left, right) => left - right);
}

function sourceRoleLabel(
	copy: Readonly<Record<string, string | undefined>>,
	role: CaptureSourceRole,
): string | undefined {
	return {
		camera: copy.captureCamera, microphone: copy.captureMicrophone,
		display: copy.captureDisplay, 'system-audio': copy.captureSystemAudio,
	}[role];
}

function sourceSettingsText(source: FramescaperCaptureUiSource): string {
	const settings = source.settings;
	if (!settings) return '';
	if (settings.width && settings.height) {
		return `${String(settings.width)} × ${String(settings.height)}${settings.frameRate ? ` · ${String(settings.frameRate)} fps` : ''}`;
	}
	if (settings.sampleRate) {
		return `${String(settings.sampleRate)} Hz${settings.channelCount ? ` · ${String(settings.channelCount)}` : ''}`;
	}
	return '';
}
