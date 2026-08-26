/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { PreferencePanel } from '@soundscaper/design-system/PreferencePanel';
import { useEffect, useMemo, useState } from 'react';

import { resolveCopyCatalogOverrides } from '../copy-catalog-overrides.ts';
import './DesktopFfmpegPreferencePanel.css';

export type DesktopFfmpegState =
	| 'unconfigured'
	| 'probing'
	| 'ready'
	| 'unsupported'
	| 'quarantined'
	| 'unavailable'
	| 'installing'
	| 'error';

export interface DesktopFfmpegStatus {
	readonly state: DesktopFfmpegState;
	readonly location: string | null;
	readonly version: string | null;
	readonly detail: string;
	readonly canInstall: boolean;
	readonly canBrowse: boolean;
	readonly canClear: boolean;
}

export interface DesktopFfmpegPreferenceFileService {
	readonly getExternalFfmpegStatus?: () => Promise<unknown>;
	readonly chooseExternalFfmpeg?: () => Promise<unknown>;
	readonly clearExternalFfmpeg?: () => Promise<unknown>;
	readonly rescanExternalFfmpeg?: () => Promise<unknown>;
	readonly installExternalFfmpeg?: () => Promise<unknown>;
}

interface DesktopFfmpegPreferenceCopy {
	readonly [key: string]: string;
	readonly externalFfmpeg: string;
	readonly externalFfmpegDescription: string;
	readonly externalFfmpegLocation: string;
	readonly externalFfmpegNoLocation: string;
	readonly externalFfmpegVersion: string;
	readonly externalFfmpegUnconfigured: string;
	readonly externalFfmpegProbing: string;
	readonly externalFfmpegReady: string;
	readonly externalFfmpegUnsupported: string;
	readonly externalFfmpegQuarantined: string;
	readonly externalFfmpegUnavailable: string;
	readonly externalFfmpegInstalling: string;
	readonly externalFfmpegError: string;
	readonly externalFfmpegControlsUnavailable: string;
	readonly externalFfmpegBrowse: string;
	readonly externalFfmpegClear: string;
	readonly externalFfmpegRescan: string;
	readonly externalFfmpegInstall: string;
}

export interface DesktopFfmpegPreferencePanelProps {
	readonly fileService: DesktopFfmpegPreferenceFileService;
	readonly copy?: Readonly<Record<string, string | undefined>>;
	readonly initialStatus?: unknown;
}

const STATES = new Set<DesktopFfmpegState>([
	'unconfigured', 'probing', 'ready', 'unsupported', 'quarantined', 'unavailable',
	'installing', 'error',
]);
const DEFAULT_COPY: DesktopFfmpegPreferenceCopy = Object.freeze({
	externalFfmpeg: 'External FFmpeg',
	externalFfmpegDescription: 'Used only when bundled and system media codecs cannot complete an operation.',
	externalFfmpegLocation: 'FFmpeg location',
	externalFfmpegNoLocation: 'No location selected',
	externalFfmpegVersion: 'Detected version',
	externalFfmpegUnconfigured: 'No external FFmpeg is configured.',
	externalFfmpegProbing: 'Checking external FFmpeg…',
	externalFfmpegReady: 'FFmpeg {version} is ready.',
	externalFfmpegUnsupported: 'The selected FFmpeg version is unsupported.',
	externalFfmpegQuarantined: 'The selected FFmpeg installation must be reviewed again.',
	externalFfmpegUnavailable: 'External FFmpeg is unavailable.',
	externalFfmpegInstalling: 'Installing external FFmpeg…',
	externalFfmpegError: 'External FFmpeg could not be configured.',
	externalFfmpegControlsUnavailable: 'External FFmpeg controls are unavailable in this desktop build.',
	externalFfmpegBrowse: 'Browse',
	externalFfmpegClear: 'Clear',
	externalFfmpegRescan: 'Rescan',
	externalFfmpegInstall: 'Install',
});
const PROBING_STATUS: DesktopFfmpegStatus = Object.freeze({
	state: 'probing', location: null, version: null, detail: '',
	canInstall: false, canBrowse: false, canClear: false,
});

export default function DesktopFfmpegPreferencePanel({
	fileService,
	copy: hostCopy,
	initialStatus = PROBING_STATUS,
}: DesktopFfmpegPreferencePanelProps) {
	const copy = useMemo(
		() => resolveCopyCatalogOverrides(DEFAULT_COPY, hostCopy),
		[hostCopy],
	);
	const [status, setStatus] = useState(() => normalizeDesktopFfmpegStatus(initialStatus));
	const getterAvailable = typeof fileService.getExternalFfmpegStatus === 'function';

	useEffect(() => {
		let current = true;
		if (!getterAvailable) {
			setStatus(unavailableStatus());
			return () => { current = false; };
		}
		setStatus((prior) => ({ ...prior, state: 'probing', detail: '' }));
		void fileService.getExternalFfmpegStatus!().then((nextStatus) => {
			if (current) setStatus(normalizeDesktopFfmpegStatus(nextStatus));
		}).catch((error: unknown) => {
			if (current) setStatus(errorStatus(error));
		});
		return () => { current = false; };
	}, [fileService, getterAvailable]);

	const busy = status.state === 'probing' || status.state === 'installing';
	const location = status.location ?? copy.externalFfmpegNoLocation;
	const summary = getterAvailable
		? statusSummary(copy, status)
		: copy.externalFfmpegControlsUnavailable;
	const detail = getterAvailable ? status.detail : '';

	async function perform(
		method: keyof DesktopFfmpegPreferenceFileService,
		pendingState: 'probing' | 'installing',
	): Promise<void> {
		const operation = fileService[method];
		if (typeof operation !== 'function') return;
		setStatus((prior) => ({ ...prior, state: pendingState, detail: '' }));
		try {
			setStatus(normalizeDesktopFfmpegStatus(await operation.call(fileService)));
		} catch (error) {
			setStatus(errorStatus(error));
		}
	}

	return (
		<PreferencePanel title={copy.externalFfmpeg}>
			<div
				className="kw-audio-editor-external-ffmpeg"
				data-external-ffmpeg-preference="true"
				data-external-ffmpeg-state={status.state}
			>
				<p>{copy.externalFfmpegDescription}</p>
				<label>
					<span>{copy.externalFfmpegLocation}</span>
					<input aria-label={copy.externalFfmpegLocation} value={location} readOnly />
				</label>
				{status.version && <p><span>{copy.externalFfmpegVersion}: </span><strong>{status.version}</strong></p>}
				<p
					role={status.state === 'error' || status.state === 'quarantined' ? 'alert' : 'status'}
					aria-live="polite"
					aria-busy={busy ? 'true' : undefined}
				>{summary}</p>
				{detail && <small>{detail}</small>}
				<div className="kw-audio-editor-external-ffmpeg__actions">
					<Button variant="secondary" disabled={busy || !status.canBrowse || typeof fileService.chooseExternalFfmpeg !== 'function'} onClick={() => { void perform('chooseExternalFfmpeg', 'probing'); }}>{copy.externalFfmpegBrowse}</Button>
					<Button variant="secondary" disabled={busy || !status.canClear || typeof fileService.clearExternalFfmpeg !== 'function'} onClick={() => { void perform('clearExternalFfmpeg', 'probing'); }}>{copy.externalFfmpegClear}</Button>
					<Button variant="secondary" disabled={busy || typeof fileService.rescanExternalFfmpeg !== 'function'} onClick={() => { void perform('rescanExternalFfmpeg', 'probing'); }}>{copy.externalFfmpegRescan}</Button>
					<Button variant="secondary" disabled={busy || !status.canInstall || typeof fileService.installExternalFfmpeg !== 'function'} onClick={() => { void perform('installExternalFfmpeg', 'installing'); }}>{copy.externalFfmpegInstall}</Button>
				</div>
			</div>
		</PreferencePanel>
	);
}

export function normalizeDesktopFfmpegStatus(value: unknown): DesktopFfmpegStatus {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailableStatus();
	const candidate = value as Readonly<Record<string, unknown>>;
	if (typeof candidate.state !== 'string' || !STATES.has(candidate.state as DesktopFfmpegState)) {
		return unavailableStatus();
	}
	const state = candidate.state as DesktopFfmpegState;
	return Object.freeze({
		state,
		location: nullableText(candidate.location, 4_096),
		version: nullableText(candidate.version, 256),
		detail: text(candidate.detail, 2_048),
		canInstall: candidate.canInstall === true,
		canBrowse: candidate.canBrowse === true,
		canClear: candidate.canClear === true,
	});
}

function unavailableStatus(): DesktopFfmpegStatus {
	return Object.freeze({
		state: 'unavailable', location: null, version: null, detail: '',
		canInstall: false, canBrowse: false, canClear: false,
	});
}

function errorStatus(error: unknown): DesktopFfmpegStatus {
	return Object.freeze({
		...unavailableStatus(),
		state: 'error',
		detail: error instanceof Error ? text(error.message, 2_048) : '',
	});
}

function nullableText(value: unknown, maximumLength: number): string | null {
	const normalized = text(value, maximumLength);
	return normalized === '' ? null : normalized;
}

function text(value: unknown, maximumLength: number): string {
	return typeof value === 'string' ? value.slice(0, maximumLength) : '';
}

function statusSummary(copy: DesktopFfmpegPreferenceCopy, status: DesktopFfmpegStatus): string {
	switch (status.state) {
		case 'unconfigured': return copy.externalFfmpegUnconfigured;
		case 'probing': return copy.externalFfmpegProbing;
		case 'ready': return copy.externalFfmpegReady.replace('{version}', status.version ?? '');
		case 'unsupported': return copy.externalFfmpegUnsupported;
		case 'quarantined': return copy.externalFfmpegQuarantined;
		case 'unavailable': return copy.externalFfmpegUnavailable;
		case 'installing': return copy.externalFfmpegInstalling;
		case 'error': return copy.externalFfmpegError;
	}
}
