/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useMemo, useState } from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	createFramescaperV27FinishingCommand,
	createFramescaperV27FinishingDialogModel,
	exportFramescaperV27CaptionSidecar,
	importFramescaperV27CaptionSidecar,
} from '../framescaper-v27-finishing-dialog-model.ts';
import type { FramescaperV27FinishingSurface } from '../framescaper-v27-finishing-menu.ts';
import type { VideoCaptionInterchangeFormatV1 } from '../../video-caption-interchange-contract-v27.ts';
import {
	createFramescaperDialogueChainAddCommandV27,
	createFramescaperDialogueChainV27,
} from '../../../../framescaper/editor-audio-dialogue-chain-v27.ts';

interface FramescaperV27FinishingControllerPort {
	readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): unknown }>;
	}>;
}

interface FramescaperV27FinishingDialogProps {
	readonly surface: FramescaperV27FinishingSurface;
	readonly controller: FramescaperV27FinishingControllerPort;
	readonly project: unknown;
	readonly selectedTrackId?: string | null;
	readonly editingBlocked: boolean;
	readonly readOnly: boolean;
	readonly copy?: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

const CAPTION_FORMATS = Object.freeze([
	Object.freeze({ value: 'srt' as const, label: 'SRT' }),
	Object.freeze({ value: 'webvtt' as const, label: 'WebVTT' }),
	Object.freeze({ value: 'imsc1.1' as const, label: 'IMSC 1.1' }),
]);

export default function FramescaperV27FinishingDialog({
	surface, controller, project, selectedTrackId = null, editingBlocked, readOnly,
	copy = {}, run, onClose,
}: FramescaperV27FinishingDialogProps) {
	const model = useMemo(() => createFramescaperV27FinishingDialogModel({ surface, project }), [
		project, surface,
	]);
	const [documentText, setDocumentText] = useState(model.documentText);
	const [pending, setPending] = useState(false);
	const [status, setStatus] = useState('');
	const [error, setError] = useState('');
	const [captionFormat, setCaptionFormat] = useState<VideoCaptionInterchangeFormatV1>('srt');
	const [captionTrackId, setCaptionTrackId] = useState(() => firstCaptionTrackId(project) ?? 'captions-1');
	const [captionSequenceId, setCaptionSequenceId] = useState(() => primarySequenceId(project));
	const [captionTrackName, setCaptionTrackName] = useState('Captions');
	const [captionLanguage, setCaptionLanguage] = useState('und');
	const [captionSidecar, setCaptionSidecar] = useState('');
	const [profiledNoiseReduction, setProfiledNoiseReduction] = useState(false);
	const [noiseProfileText, setNoiseProfileText] = useState('');

	useEffect(() => {
		setDocumentText(model.documentText);
		setStatus('');
		setError('');
	}, [model.documentText, model.surface]);

	const blocked = pending || editingBlocked || readOnly;
	const perform = (operation: () => unknown, success: string): void => {
		if (blocked) return;
		setPending(true);
		setStatus('');
		setError('');
		void Promise.resolve()
			.then(() => run(operation))
			.then(() => { setStatus(success); })
			.catch((operationError: unknown) => {
				setError(operationError instanceof Error ? operationError.message : String(operationError));
			})
			.finally(() => { setPending(false); });
	};
	const applyDocument = (): void => perform(() => controller.actions.edit.commit(
		createFramescaperV27FinishingCommand(surface, project, documentText),
	), text(copy, 'framescaperFinishingApplied', 'Finishing state updated.'));
	const importSidecar = (): void => perform(() => {
		const imported = importFramescaperV27CaptionSidecar({
			project, format: captionFormat, text: captionSidecar,
			trackId: captionTrackId, sequenceId: captionSequenceId,
			trackName: captionTrackName, language: captionLanguage,
		});
		const result = controller.actions.edit.commit(imported.command);
		setDocumentText(JSON.stringify([
			...captionTracks(project).filter(({ id }) => id !== imported.result.track.id),
			imported.result.track,
		], null, '\t'));
		setStatus(lossSummary(imported.result.losses.length));
		return result;
	}, text(copy, 'captionImportComplete', 'Caption sidecar imported.'));
	const exportSidecar = (): void => {
		try {
			const exported = exportFramescaperV27CaptionSidecar({
				project, trackId: captionTrackId, format: captionFormat,
			});
			setCaptionSidecar(exported.text);
			setError('');
			setStatus(lossSummary(exported.losses.length));
		} catch (exportError: unknown) {
			setStatus('');
			setError(exportError instanceof Error ? exportError.message : String(exportError));
		}
	};
	const applyDialogueChain = (): void => {
		if (!selectedTrackId) return;
		perform(() => {
			const profile = profiledNoiseReduction ? parseNoiseProfile(noiseProfileText) : null;
			const chain = createFramescaperDialogueChainV27({
				id: `dialogue:${selectedTrackId}`,
				sampleRate: projectSampleRate(project),
				...(profile === null ? {} : { noiseReduction: { profile } }),
			});
			return controller.actions.edit.commit(createFramescaperDialogueChainAddCommandV27(
				{ scope: 'track', trackId: selectedTrackId }, chain,
			));
		},
			text(copy, 'dialogueChainApplied', 'Dialogue chain applied.'));
	};

	return <AudioEditorDialogShell
		title={model.title}
		onClose={onClose}
		width={820}
		initialFocus={surface === 'dialogue-chain' ? '[data-dialogue-chain-apply]' : '[data-v27-finishing-document]'}
		dataAttributes={{ 'data-framescaper-v27-finishing-dialog': surface }}
	>
		<div className="audio-editor-framescaper-v27-finishing">
			<p>{model.description}</p>
			{(editingBlocked || readOnly) && <p role="status">{
				text(copy, 'finishingReadOnly', 'Finishing changes are unavailable while the project is read-only or busy.')
			}</p>}
			{model.documentEditable && <>
				<label>
					<span>{text(copy, 'finishingDocument', 'Canonical finishing document')}</span>
					<textarea data-v27-finishing-document rows={18} maxLength={4 * 1024 * 1024}
						spellCheck={false} value={documentText} disabled={blocked}
						onChange={(event) => setDocumentText(event.currentTarget.value)} />
				</label>
				<button type="button" disabled={blocked} onClick={applyDocument}>{
					text(copy, 'apply', 'Apply')
				}</button>
			</>}
			{surface === 'captions' && <CaptionSidecarEditor
				blocked={blocked}
				format={captionFormat}
				trackId={captionTrackId}
				sequenceId={captionSequenceId}
				trackName={captionTrackName}
				language={captionLanguage}
				sidecar={captionSidecar}
				project={project}
				copy={copy}
				onFormat={setCaptionFormat}
				onTrackId={setCaptionTrackId}
				onSequenceId={setCaptionSequenceId}
				onTrackName={setCaptionTrackName}
				onLanguage={setCaptionLanguage}
				onSidecar={setCaptionSidecar}
				onImport={importSidecar}
				onExport={exportSidecar}
			/>}
			{surface === 'dialogue-chain' && <fieldset disabled={blocked}>
				<legend>{text(copy, 'dialogueChain', 'Dialogue chain')}</legend>
				<p>{text(copy, 'dialogueChainOrder', 'Highpass → gate → EQ → compressor → limiter')}</p>
				<label><input type="checkbox" checked={profiledNoiseReduction}
					onChange={(event) => setProfiledNoiseReduction(event.currentTarget.checked)} /> {
					text(copy, 'profiledNoiseReduction', 'Include profiled noise reduction after highpass')
				}</label>
				{profiledNoiseReduction && <label><span>{text(copy, 'noiseProfileDocument',
					'Canonical Audacity noise-profile document')}</span><textarea rows={8}
						spellCheck={false} value={noiseProfileText}
						onChange={(event) => setNoiseProfileText(event.currentTarget.value)} /></label>}
				<button type="button" data-dialogue-chain-apply
					disabled={blocked || !selectedTrackId || (profiledNoiseReduction && !noiseProfileText.trim())}
					onClick={applyDialogueChain}>{text(copy, 'applyDialogueChain', 'Apply dialogue chain')}</button>
				{!selectedTrackId && <p role="status">{text(copy, 'selectAudioTrack', 'Select an audio track first.')}</p>}
			</fieldset>}
			<div role="status" aria-live="polite" aria-atomic="true">{error || status}</div>
		</div>
	</AudioEditorDialogShell>;
}

function CaptionSidecarEditor(props: Readonly<{
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
		<div><button type="button" onClick={props.onImport}>{text(props.copy, 'captionImportSidecar', 'Import sidecar')}</button>
			<button type="button" onClick={props.onExport}>{text(props.copy, 'captionExportSelectedTrack', 'Export selected track')}</button></div>
		<p>{text(props.copy, 'captionDeliveryUnavailable',
			'Caption burn-in and mux are intentionally unavailable in Milestones 1–4.')}</p>
	</fieldset>;
}

function captionTracks(value: unknown): Array<Record<string, unknown>> {
	return records(record(value).videoCaptionTracks);
}

function firstCaptionTrackId(value: unknown): string | null {
	const id = captionTracks(value)[0]?.id;
	return typeof id === 'string' ? id : null;
}

function primarySequenceId(value: unknown): string {
	const project = record(value);
	return typeof project.primarySequenceId === 'string'
		? project.primarySequenceId
		: sequenceIds(value)[0] ?? '';
}

function sequenceIds(value: unknown): string[] {
	return records(record(value).sequences).flatMap(({ id }) => typeof id === 'string' ? [id] : []);
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown> : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => (
		Boolean(item) && typeof item === 'object' && !Array.isArray(item)
	)) : [];
}

function lossSummary(count: number): string {
	return count === 0 ? 'No interchange losses.' : `${String(count)} interchange loss${count === 1 ? '' : 'es'} recorded.`;
}

function parseNoiseProfile(value: string): Readonly<Record<string, unknown>> {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new TypeError('The noise profile must be a JSON object.');
		}
		return parsed as Readonly<Record<string, unknown>>;
	} catch (error) {
		if (error instanceof TypeError) throw error;
		throw new SyntaxError('The noise profile must be valid JSON.', { cause: error });
	}
}

function projectSampleRate(value: unknown): number {
	const sampleRate = record(value).sampleRate;
	if (!Number.isSafeInteger(sampleRate) || Number(sampleRate) < 1) {
		throw new RangeError('The project sample rate is unavailable.');
	}
	return Number(sampleRate);
}

function text(copy: Readonly<Record<string, string>>, key: string, fallback: string): string {
	return copy[key] || fallback;
}
