/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';

import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import type { VideoCaptionInterchangeFormatV1 } from '../../video-caption-interchange-contract-v27.ts';
import type {
	FramescaperMotionAnalysisProgress,
	FramescaperMotionAnalysisTarget,
} from '../../../../framescaper/editor-motion-analysis-actions-finishing.ts';
import type { FramescaperCubeLutTarget } from '../../../../framescaper/editor-cube-lut-actions-finishing.ts';

/**
 * The field panels the Framescaper finishing dialog composes, split out of the
 * dialog when it outgrew the maintainability ceiling. Each is a fieldset the
 * dialog places in its body; the dialog's own confirm action lives in the
 * shared footer instead.
 */

const CAPTION_FORMATS = Object.freeze([
	Object.freeze({ value: 'srt' as const, label: 'SRT' }),
	Object.freeze({ value: 'webvtt' as const, label: 'WebVTT' }),
	Object.freeze({ value: 'imsc1.1' as const, label: 'IMSC 1.1' }),
]);

export function CubeLutControls(props: Readonly<{
	readonly blocked: boolean;
	readonly targets: readonly FramescaperCubeLutTarget[];
	readonly target: FramescaperCubeLutTarget | null;
	readonly copy: Readonly<Record<string, string>>;
	readonly onTarget: (value: string) => void;
	readonly onChooseFile: (file?: Blob) => void;
	readonly fileRef: React.RefObject<HTMLInputElement | null>;
}>) {
	return <fieldset disabled={props.blocked}>
		<legend>{text(props.copy, 'cubeLutImport', 'Cube LUT import')}</legend>
		<label><span>{text(props.copy, 'cubeLutTarget', 'Cube LUT target')}</span><select
			value={props.target ? targetToken(props.target) : ''}
			disabled={props.blocked || props.targets.length === 0}
			onChange={(event) => props.onTarget(event.currentTarget.value)}>
			{props.targets.map((target) => <option key={targetToken(target)} value={targetToken(target)}>{
				target.label
			}</option>)}
		</select></label>
		<button type="button" disabled={props.blocked || props.target === null}
			onClick={() => { props.onChooseFile(); }}>{
			text(props.copy, 'cubeLutChooseFile', 'Choose .cube LUT…')
		}</button>
		<input ref={props.fileRef} type="file" accept=".cube,text/plain" hidden
			data-framescaper-cube-lut-file onChange={(event) => {
				const file = event.currentTarget.files?.[0] ?? null;
				event.currentTarget.value = '';
				if (file) props.onChooseFile(file);
			}} />
		{props.targets.length === 0 && <p role="status">{
			text(props.copy, 'cubeLutTargetMissing', 'Create a visual presentation or finishing preset first.')
		}</p>}
	</fieldset>;
}

export function CaptionSidecarEditor(props: Readonly<{
	readonly blocked: boolean;
	readonly format: VideoCaptionInterchangeFormatV1;
	readonly trackId: string;
	readonly sequenceId: string;
	readonly trackName: string;
	readonly language: string;
	readonly sidecar: string;
	readonly project: unknown;
	readonly copy: Readonly<Record<string, string>>;
	readonly onFormat: (value: VideoCaptionInterchangeFormatV1) => void;
	readonly onTrackId: (value: string) => void;
	readonly onSequenceId: (value: string) => void;
	readonly onTrackName: (value: string) => void;
	readonly onLanguage: (value: string) => void;
	readonly onSidecar: (value: string) => void;
	readonly onImport: () => void;
	readonly onExport: () => void;
	readonly onChooseFile: (file?: Blob) => void;
	readonly fileRef: React.RefObject<HTMLInputElement | null>;
	}>) {
	return <fieldset disabled={props.blocked}>
		<legend>{text(props.copy, 'captionSidecarInterchange', 'Caption sidecar interchange')}</legend>
		<label><span>{text(props.copy, 'format', 'Format')}</span><select value={props.format} onChange={(event) => props.onFormat(
			event.currentTarget.value as VideoCaptionInterchangeFormatV1,
		)}>{CAPTION_FORMATS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
		<label><span>{text(props.copy, 'captionTrackId', 'Track ID')}</span><input value={props.trackId}
			onChange={(event) => props.onTrackId(event.currentTarget.value)} /></label>
		<label><span>{text(props.copy, 'sequence', 'Sequence')}</span><select value={props.sequenceId}
			onChange={(event) => props.onSequenceId(event.currentTarget.value)}>{
			sequenceIds(props.project).map((id) => <option key={id} value={id}>{id}</option>)
		}</select></label>
		<label><span>{text(props.copy, 'captionTrackName', 'Track name')}</span><input value={props.trackName}
			onChange={(event) => props.onTrackName(event.currentTarget.value)} /></label>
		<label><span>{text(props.copy, 'language', 'Language')}</span><input value={props.language}
			onChange={(event) => props.onLanguage(event.currentTarget.value)} /></label>
		<label><span>{text(props.copy, 'captionSidecarText', 'Sidecar text')}</span><textarea rows={10} maxLength={16 * 1024 * 1024}
			value={props.sidecar} onChange={(event) => props.onSidecar(event.currentTarget.value)} /></label>
		<div><button type="button" onClick={() => { props.onChooseFile(); }}>{
			text(props.copy, 'captionChooseSidecarFile', 'Choose sidecar file…')
		}</button><button type="button" onClick={props.onImport}>{
			text(props.copy, 'captionImportSidecar', 'Import sidecar text')
		}</button><button type="button" onClick={props.onExport}>{
			text(props.copy, 'captionExportSelectedTrack', 'Export selected track…')
		}</button><input ref={props.fileRef} type="file"
			accept=".srt,.vtt,.webvtt,.ttml,.imsc,.xml,text/vtt,application/x-subrip,application/ttml+xml"
			hidden data-framescaper-caption-file onChange={(event) => {
				const file = event.currentTarget.files?.[0] ?? null;
				event.currentTarget.value = '';
				if (file) props.onChooseFile(file);
			}} /></div>
		<p>{text(props.copy, 'captionDeliveryUnavailable',
			'Caption burn-in and mux are intentionally unavailable in Milestones 1–4.')}</p>
	</fieldset>;
}

export function MotionAnalysisControls(props: Readonly<{
	readonly blocked: boolean;
	readonly targets: readonly FramescaperMotionAnalysisTarget[];
	readonly target: FramescaperMotionAnalysisTarget | null;
	readonly stackId: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly frameRate: number;
	readonly progress: FramescaperMotionAnalysisProgress | null;
	readonly pending: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly onStack: (value: string) => void;
	readonly onStartFrame: (value: number) => void;
	readonly onEndFrame: (value: number) => void;
	readonly onAnalyze: () => void;
	readonly onCancel: () => void;
}>) {
	return <fieldset disabled={props.blocked && !props.pending}>
		<legend>{text(props.copy, 'motionAnalysisExecution', 'Built-in motion analysis')}</legend>
		{props.targets.length === 0 ? <p role="status">{
			text(props.copy, 'motionAnalysisTargetMissing', 'Add one enabled tracking processor stack first.')
		}</p> : <>
			<label><span>{text(props.copy, 'motionAnalysisTarget', 'Motion-analysis target')}</span>
				<select value={props.stackId} disabled={props.blocked} onChange={(event) => props.onStack(
					event.currentTarget.value,
				)}>{props.targets.map((target) => <option key={target.stackId} value={target.stackId}>{
					`${target.sourceName} — ${target.stackId}`
				}</option>)}</select></label>
			<label><span>{text(props.copy, 'motionAnalysisStartFrame', 'Start frame')}</span>
				<AudioEditorTimeCodeInput label={text(props.copy, 'motionAnalysisStartFrame', 'Start frame')}
					value={props.startFrame} unit="frames" rate={props.frameRate}
					minimum={props.target?.startFrame ?? 0} maximum={Math.max(
						props.target?.startFrame ?? 0, props.endFrame - 1,
					)} disabled={props.blocked} onChange={props.onStartFrame} /></label>
			<label><span>{text(props.copy, 'motionAnalysisEndFrame', 'End frame')}</span>
				<AudioEditorTimeCodeInput label={text(props.copy, 'motionAnalysisEndFrame', 'End frame')}
					value={props.endFrame} unit="frames" rate={props.frameRate}
					minimum={props.startFrame + 1} maximum={props.target?.endFrame ?? 1}
					disabled={props.blocked} onChange={props.onEndFrame} /></label>
			<p role="status">{freshnessLabel(props.copy, props.target?.freshness ?? 'missing')}</p>
			<button type="button" data-framescaper-motion-analyze disabled={props.blocked} onClick={props.onAnalyze}>{
				props.target?.freshness === 'missing'
					? text(props.copy, 'motionAnalysisAnalyze', 'Analyze motion')
					: text(props.copy, 'motionAnalysisRecompute', 'Recompute motion')
			}</button>
			<button type="button" data-framescaper-motion-cancel disabled={!props.pending} onClick={props.onCancel}>{
				text(props.copy, 'cancel', 'Cancel')
			}</button>
			{props.progress && <div role="status" aria-live="polite"><progress
				value={props.progress.completed} max={Math.max(1, props.progress.total)} /> {
					`${props.progress.phase}: ${String(props.progress.completed)}/${String(props.progress.total)}`
				}</div>}
		</>}
	</fieldset>;
}

export function targetToken(target: Readonly<{ readonly kind: string; readonly id: string }>): string {
	return `${target.kind}:${target.id}`;
}

function freshnessLabel(
	copy: Readonly<Record<string, string>>,
	value: FramescaperMotionAnalysisTarget['freshness'],
): string {
	if (value === 'current') return text(copy, 'motionAnalysisCurrent', 'Analysis current.');
	if (value === 'stale') return text(copy, 'motionAnalysisStale', 'Analysis stale; recompute before export.');
	return text(copy, 'motionAnalysisMissing', 'Analysis missing.');
}

export function sequenceIds(value: unknown): string[] {
	return records(record(value).sequences).flatMap(({ id }) => typeof id === 'string' ? [id] : []);
}

export function records(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => (
		Boolean(item) && typeof item === 'object' && !Array.isArray(item)
	)) : [];
}

export function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown> : {};
}

export function text(copy: Readonly<Record<string, string>>, key: string, fallback: string): string {
	return copy[key] || fallback;
}
