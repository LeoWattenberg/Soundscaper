/* SPDX-License-Identifier: AGPL-3.0-only */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	createFramescaperV27FinishingCommand,
	createFramescaperV27FinishingDialogModel,
	exportFramescaperV27CaptionSidecar,
	importFramescaperV27CaptionSidecar,
} from '../framescaper-v27-finishing-dialog-model.ts';
import type { FramescaperV27FinishingSurface } from '../framescaper-v27-finishing-menu.ts';
import type { VideoCaptionInterchangeFormatV1 } from '../../video-caption-interchange-contract-v27.ts';
import type { VideoMotionAnalysisReferenceV1 } from '../../video-motion-model-v27.ts';
import {
	openFramescaperCaptionSidecarFileV27,
	saveFramescaperCaptionSidecarFileV27,
	type FramescaperCaptionFileServiceV27,
} from '../framescaper-v27-caption-file-interchange.ts';
import {
	createFramescaperDialogueChainAddCommandV27,
	createFramescaperDialogueChainV27,
} from '../../../../framescaper/editor-audio-dialogue-chain-v27.ts';
import {
	framescaperMotionAnalysisActionsV27For,
	type FramescaperMotionAnalysisProgressV27,
	type FramescaperMotionAnalysisTargetV27,
} from '../../../../framescaper/editor-motion-analysis-actions-v27.ts';
import {
	framescaperCubeLutActionsV27For,
	type FramescaperCubeLutTargetV27,
} from '../../../../framescaper/editor-cube-lut-actions-v27.ts';

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
	readonly fileService: FramescaperCaptionFileServiceV27;
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
	copy = {}, fileService, run, onClose,
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
	const captionFileRef = useRef<HTMLInputElement | null>(null);
	const cubeLutFileRef = useRef<HTMLInputElement | null>(null);
	const motionRuntime = framescaperMotionAnalysisActionsV27For(controller);
	const motionTargets = motionRuntime?.targets() ?? [];
	const [motionStackId, setMotionStackId] = useState(() => motionTargets[0]?.stackId ?? '');
	const motionTarget = motionTargets.find(({ stackId }) => stackId === motionStackId)
		?? motionTargets[0] ?? null;
	const [motionStartFrame, setMotionStartFrame] = useState(() => String(motionTarget?.startFrame ?? 0));
	const [motionEndFrame, setMotionEndFrame] = useState(() => String(motionTarget?.endFrame ?? 0));
	const [motionProgress, setMotionProgress] = useState<FramescaperMotionAnalysisProgressV27 | null>(null);
	const motionAbortRef = useRef<AbortController | null>(null);
	const cubeLutRuntime = framescaperCubeLutActionsV27For(controller);
	const cubeLutTargets = cubeLutRuntime?.targets() ?? [];
	const [cubeLutTargetToken, setCubeLutTargetToken] = useState(() => (
		cubeLutTargets[0] ? targetToken(cubeLutTargets[0]) : ''
	));
	const cubeLutTarget = cubeLutTargets.find((target) => targetToken(target) === cubeLutTargetToken)
		?? cubeLutTargets[0] ?? null;

	useEffect(() => {
		setDocumentText(model.documentText);
	}, [model.documentText]);

	useEffect(() => {
		setStatus('');
		setError('');
	}, [model.surface]);
	useEffect(() => () => { motionAbortRef.current?.abort(); }, []);

	const blocked = pending || editingBlocked || readOnly;
	const perform = (operation: () => unknown, success: string | (() => string)): void => {
		if (blocked) return;
		setPending(true);
		setStatus('');
		setError('');
		void Promise.resolve()
			.then(() => run(operation))
			.then(() => { setStatus(typeof success === 'function' ? success() : success); })
			.catch((operationError: unknown) => {
				setError(operationError instanceof Error ? operationError.message : String(operationError));
			})
			.finally(() => { setPending(false); });
	};
	const applyDocument = (): void => perform(() => controller.actions.edit.commit(
		createFramescaperV27FinishingCommand(surface, project, documentText),
	), text(copy, 'framescaperFinishingApplied', 'Finishing state updated.'));
	let captionImportSummary = '';
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
		captionImportSummary = lossSummary(imported.result.losses.length);
		return result;
	}, () => captionImportSummary);
	const applyCaptionFile = (file?: Blob): void => {
		if (!file && !fileService.isDesktop) {
			captionFileRef.current?.click();
			return;
		}
		perform(async () => {
			const opened = await openFramescaperCaptionSidecarFileV27({
				...(file ? { file } : {}), fileService,
			});
			if (opened === null) {
				captionImportSummary = text(copy, 'captionFileSelectionCancelled', 'No sidecar file selected.');
				return;
			}
			setCaptionFormat(opened.format);
			setCaptionSidecar(opened.text);
			const imported = importFramescaperV27CaptionSidecar({
				project, format: opened.format, text: opened.text,
				trackId: captionTrackId, sequenceId: captionSequenceId,
				trackName: captionTrackName, language: captionLanguage,
			});
			await controller.actions.edit.commit(imported.command);
			setDocumentText(JSON.stringify([
				...captionTracks(project).filter(({ id }) => id !== imported.result.track.id),
				imported.result.track,
			], null, '\t'));
			captionImportSummary = `${opened.fileName}: ${lossSummary(imported.result.losses.length)}`;
		}, () => captionImportSummary);
	};
	const exportSidecar = (): void => perform(async () => {
			const exported = exportFramescaperV27CaptionSidecar({
				project, trackId: captionTrackId, format: captionFormat,
			});
			setCaptionSidecar(exported.text);
			await saveFramescaperCaptionSidecarFileV27({
				fileService, format: captionFormat, trackId: captionTrackId, text: exported.text,
			});
			captionImportSummary = lossSummary(exported.losses.length);
		}, () => captionImportSummary);
	let cubeLutSummary = '';
	const importCubeLutFile = (file?: Blob): void => {
		if (!file && !fileService.isDesktop) {
			cubeLutFileRef.current?.click();
			return;
		}
		perform(async () => {
			if (!cubeLutRuntime || !cubeLutTarget) throw new Error('Select one cube LUT target first.');
			let body: unknown = file;
			if (!body) {
				if (typeof fileService.chooseFiles !== 'function') {
					throw new Error('Desktop cube LUT file selection is unavailable.');
				}
				const descriptors = await fileService.chooseFiles({ purpose: 'lut', multiple: false });
				if (descriptors[0] === undefined) {
					cubeLutSummary = text(copy, 'cubeLutSelectionCancelled', 'No cube LUT file selected.');
					return;
				}
				if (typeof fileService.openReadDescriptor !== 'function') {
					throw new Error('Desktop cube LUT file reading is unavailable.');
				}
				body = await fileService.openReadDescriptor(descriptors[0]);
			}
			if (!(body instanceof Blob)) throw new TypeError('The selected cube LUT is not a pathless file body.');
			const reference = await cubeLutRuntime.importCubeLut({ target: cubeLutTarget, file: body });
			cubeLutSummary = `${cubeLutTarget.label}: ${reference.sha256.slice(0, 12)}`;
		}, () => cubeLutSummary);
	};
	const analyzeMotion = (): void => {
		if (!motionRuntime || !motionTarget || blocked) return;
		let startFrame: number;
		let endFrame: number;
		try {
			startFrame = inputFrame(motionStartFrame, 'Motion-analysis start frame');
			endFrame = inputFrame(motionEndFrame, 'Motion-analysis end frame');
		} catch (rangeError) {
			setStatus('');
			setError(rangeError instanceof Error ? rangeError.message : String(rangeError));
			return;
		}
		const abort = new AbortController();
		motionAbortRef.current = abort;
		setPending(true);
		setMotionProgress(null);
		setStatus('');
		setError('');
		const operation = run(() => motionRuntime.analyze({
			processorStackId: motionTarget.stackId,
			startFrame,
			endFrame,
			signal: abort.signal,
			onProgress: setMotionProgress,
		})) as PromiseLike<VideoMotionAnalysisReferenceV1> | VideoMotionAnalysisReferenceV1;
		void Promise.resolve(operation).then((reference) => {
			setDocumentText(JSON.stringify({
				videoProcessorStacks: processorStacks(project),
				videoMotionAnalyses: [
					...motionAnalyses(project).filter(({ id }) => id !== reference.id),
					reference,
				],
			}, null, '\t'));
			setStatus(text(copy, 'motionAnalysisPublished', 'Motion analysis published and current.'));
		}, (operationError: unknown) => {
			if ((operationError as Error)?.name === 'AbortError') {
				setStatus(text(copy, 'motionAnalysisCancelled', 'Motion analysis cancelled.'));
			} else {
				setError(operationError instanceof Error ? operationError.message : String(operationError));
			}
		}).finally(() => {
			if (motionAbortRef.current === abort) motionAbortRef.current = null;
			setPending(false);
			setMotionProgress(null);
		});
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
				onChooseFile={applyCaptionFile}
				fileRef={captionFileRef}
			/>}
			{surface === 'grading-presets' && <CubeLutControls
				blocked={blocked}
				targets={cubeLutTargets}
				target={cubeLutTarget}
				copy={copy}
				onTarget={setCubeLutTargetToken}
				onChooseFile={importCubeLutFile}
				fileRef={cubeLutFileRef}
			/>}
			{surface === 'motion-tracking' && <MotionAnalysisControls
				blocked={blocked}
				targets={motionTargets}
				target={motionTarget}
				stackId={motionStackId}
				startFrame={motionStartFrame}
				endFrame={motionEndFrame}
				progress={motionProgress}
				pending={pending && motionAbortRef.current !== null}
				copy={copy}
				onStack={(stackId) => {
					setMotionStackId(stackId);
					const target = motionTargets.find((candidate) => candidate.stackId === stackId);
					setMotionStartFrame(String(target?.startFrame ?? 0));
					setMotionEndFrame(String(target?.endFrame ?? 0));
				}}
				onStartFrame={setMotionStartFrame}
				onEndFrame={setMotionEndFrame}
				onAnalyze={analyzeMotion}
				onCancel={() => { motionAbortRef.current?.abort(); }}
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

function CubeLutControls(props: Readonly<{
	readonly blocked: boolean;
	readonly targets: readonly FramescaperCubeLutTargetV27[];
	readonly target: FramescaperCubeLutTargetV27 | null;
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
			data-v27-cube-lut-file onChange={(event) => {
				const file = event.currentTarget.files?.[0] ?? null;
				event.currentTarget.value = '';
				if (file) props.onChooseFile(file);
			}} />
		{props.targets.length === 0 && <p role="status">{
			text(props.copy, 'cubeLutTargetMissing', 'Create a visual presentation or finishing preset first.')
		}</p>}
	</fieldset>;
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
			hidden data-v27-caption-file onChange={(event) => {
				const file = event.currentTarget.files?.[0] ?? null;
				event.currentTarget.value = '';
				if (file) props.onChooseFile(file);
			}} /></div>
		<p>{text(props.copy, 'captionDeliveryUnavailable',
			'Caption burn-in and mux are intentionally unavailable in Milestones 1–4.')}</p>
	</fieldset>;
}

function MotionAnalysisControls(props: Readonly<{
	readonly blocked: boolean;
	readonly targets: readonly FramescaperMotionAnalysisTargetV27[];
	readonly target: FramescaperMotionAnalysisTargetV27 | null;
	readonly stackId: string;
	readonly startFrame: string;
	readonly endFrame: string;
	readonly progress: FramescaperMotionAnalysisProgressV27 | null;
	readonly pending: boolean;
	readonly copy: Readonly<Record<string, string>>;
	readonly onStack: (value: string) => void;
	readonly onStartFrame: (value: string) => void;
	readonly onEndFrame: (value: string) => void;
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
				<input type="number" min={props.target?.startFrame ?? 0} step={1} value={props.startFrame}
					disabled={props.blocked} onChange={(event) => props.onStartFrame(event.currentTarget.value)} /></label>
			<label><span>{text(props.copy, 'motionAnalysisEndFrame', 'End frame')}</span>
				<input type="number" min={1} max={props.target?.endFrame ?? 1} step={1} value={props.endFrame}
					disabled={props.blocked} onChange={(event) => props.onEndFrame(event.currentTarget.value)} /></label>
			<p role="status">{freshnessLabel(props.copy, props.target?.freshness ?? 'missing')}</p>
			<button type="button" data-v27-motion-analyze disabled={props.blocked} onClick={props.onAnalyze}>{
				props.target?.freshness === 'missing'
					? text(props.copy, 'motionAnalysisAnalyze', 'Analyze motion')
					: text(props.copy, 'motionAnalysisRecompute', 'Recompute motion')
			}</button>
			<button type="button" data-v27-motion-cancel disabled={!props.pending} onClick={props.onCancel}>{
				text(props.copy, 'cancel', 'Cancel')
			}</button>
			{props.progress && <div role="status" aria-live="polite"><progress
				value={props.progress.completed} max={Math.max(1, props.progress.total)} /> {
					`${props.progress.phase}: ${String(props.progress.completed)}/${String(props.progress.total)}`
				}</div>}
		</>}
	</fieldset>;
}

function captionTracks(value: unknown): Array<Record<string, unknown>> {
	return records(record(value).videoCaptionTracks);
}

function processorStacks(value: unknown): Array<Record<string, unknown>> {
	return records(record(value).videoProcessorStacks);
}

function motionAnalyses(value: unknown): Array<Record<string, unknown>> {
	return records(record(value).videoMotionAnalyses);
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

function freshnessLabel(
	copy: Readonly<Record<string, string>>,
	value: FramescaperMotionAnalysisTargetV27['freshness'],
): string {
	if (value === 'current') return text(copy, 'motionAnalysisCurrent', 'Analysis current.');
	if (value === 'stale') return text(copy, 'motionAnalysisStale', 'Analysis stale; recompute before export.');
	return text(copy, 'motionAnalysisMissing', 'Analysis missing.');
}

function targetToken(target: Readonly<{ readonly kind: string; readonly id: string }>): string {
	return `${target.kind}:${target.id}`;
}

function inputFrame(value: string, name: string): number {
	const frame = Number(value);
	if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError(`${name} must be a non-negative integer.`);
	return frame;
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
