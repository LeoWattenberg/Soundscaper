import { usePresentationFeedback, feedbackFailure, type PresentationFeedback } from '../presentation-feedback.ts';
/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_FINISHING_ADDITIONAL_COPY } from '../../../i18n/editor-framescaper-finishing-additional-copy.ts';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	CaptionSidecarEditor,
	CubeLutControls,
	MotionAnalysisControls,
	record,
	records,
	sequenceIds,
	targetToken,
	text,
} from './FramescaperFinishingPanels.tsx';
import { audioEditorProjectFrameRate } from '../AudioEditorTimeCodeInput.tsx';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';
import {
	createFramescaperFinishingCommand,
	createFramescaperFinishingDialogModel,
	exportFramescaperCaptionSidecar,
	importFramescaperCaptionSidecar,
} from '../framescaper-finishing-dialog-model.ts';
import type { FramescaperFinishingSurface } from '../framescaper-finishing-menu.ts';
import type { VideoCaptionInterchangeFormatV1 } from '../../video-caption-interchange-contract-v27.ts';
import {
	openFramescaperCaptionSidecarFile,
	saveFramescaperCaptionSidecarFile,
	type FramescaperCaptionFileService,
} from '../framescaper-caption-file-interchange.ts';
import {
	createFramescaperDialogueChainAddCommand,
	createFramescaperDialogueChain,
} from '../../../../framescaper/editor-audio-dialogue-chain-finishing.ts';
import {
	framescaperMotionAnalysisActionsFor,
	type FramescaperMotionAnalysisProgress,
} from '../../../../framescaper/editor-motion-analysis-actions-finishing.ts';
import { framescaperCubeLutActionsFor } from '../../../../framescaper/editor-cube-lut-actions-finishing.ts';

interface FramescaperFinishingControllerPort {
	readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): unknown }>;
	}>;
}

interface FramescaperFinishingDialogProps {
	readonly surface: FramescaperFinishingSurface;
	readonly controller: FramescaperFinishingControllerPort;
	readonly project: unknown;
	readonly selectedTrackId?: string | null;
	readonly fileService: FramescaperCaptionFileService;
	readonly editingBlocked: boolean;
	readonly readOnly: boolean;
	readonly copy?: Readonly<Record<string, string>>;
	readonly run: (operation: () => unknown) => unknown;
	readonly onClose: () => void;
}

export default function FramescaperFinishingDialog({
	surface, controller, project, selectedTrackId = null, editingBlocked, readOnly,
	copy = {}, fileService, run, onClose,
}: FramescaperFinishingDialogProps) {
	const model = useMemo(() => createFramescaperFinishingDialogModel({ surface, project, copy }), [
		project, surface, copy,
	]);
	const [documentText, setDocumentText] = useState(model.documentText);
	const [pending, setPending] = useState(false);
	const [status, setStatus] = usePresentationFeedback(copy, FRAMESCAPER_FINISHING_ADDITIONAL_COPY, 'framescaperFinishing');
	const [error, setError] = usePresentationFeedback(copy, FRAMESCAPER_FINISHING_ADDITIONAL_COPY, 'framescaperFinishing');
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
	const motionRuntime = framescaperMotionAnalysisActionsFor(controller);
	const motionTargets = motionRuntime?.targets() ?? [];
	const [motionStackId, setMotionStackId] = useState(() => motionTargets[0]?.stackId ?? '');
	const motionTarget = motionTargets.find(({ stackId }) => stackId === motionStackId)
		?? motionTargets[0] ?? null;
	const [motionStartFrame, setMotionStartFrame] = useState(() => motionTarget?.startFrame ?? 0);
	const [motionEndFrame, setMotionEndFrame] = useState(() => motionTarget?.endFrame ?? 0);
	const [motionProgress, setMotionProgress] = useState<FramescaperMotionAnalysisProgress | null>(null);
	const motionAbortRef = useRef<AbortController | null>(null);
	const cubeLutRuntime = framescaperCubeLutActionsFor(controller);
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
	}, [model.surface, setError, setStatus]);
	useEffect(() => () => { motionAbortRef.current?.abort(); }, []);

	const blocked = pending || editingBlocked || readOnly;
	const perform = (operation: () => unknown, success: PresentationFeedback | (() => PresentationFeedback)): void => {
		if (blocked) return;
		setPending(true);
		setStatus('');
		setError('');
		void runAwaitedAudioEditorOperation(run, operation)
			.then(() => { setStatus(typeof success === 'function' ? success() : success); })
			.catch((operationError: unknown) => {
				setError(feedbackFailure(operationError));
			})
			.finally(() => { setPending(false); });
	};
	const applyDocument = (): void => perform(() => controller.actions.edit.commit(
		createFramescaperFinishingCommand(surface, project, documentText),
	), { key: 'framescaperFinishingApplied' });
	let captionImportSummary: PresentationFeedback = '';
	const importSidecar = (): void => perform(() => {
		const imported = importFramescaperCaptionSidecar({
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
			const opened = await openFramescaperCaptionSidecarFile({
				...(file ? { file } : {}), fileService,
			});
			if (opened === null) {
				captionImportSummary = { key: 'captionFileSelectionCancelled' };
				return;
			}
			setCaptionFormat(opened.format);
			setCaptionSidecar(opened.text);
			const imported = importFramescaperCaptionSidecar({
				project, format: opened.format, text: opened.text,
				trackId: captionTrackId, sequenceId: captionSequenceId,
				trackName: captionTrackName, language: captionLanguage,
			});
			await controller.actions.edit.commit(imported.command);
			setDocumentText(JSON.stringify([
				...captionTracks(project).filter(({ id }) => id !== imported.result.track.id),
				imported.result.track,
			], null, '\t'));
			captionImportSummary = { ...lossSummary(imported.result.losses.length), prefix: `${opened.fileName}: ` };
		}, () => captionImportSummary);
	};
	const exportSidecar = (): void => perform(async () => {
			const exported = exportFramescaperCaptionSidecar({
				project, trackId: captionTrackId, format: captionFormat,
			});
			setCaptionSidecar(exported.text);
			await saveFramescaperCaptionSidecarFile({
				fileService, format: captionFormat, trackId: captionTrackId, text: exported.text,
			});
			captionImportSummary = lossSummary(exported.losses.length);
		}, () => captionImportSummary);
	let cubeLutSummary: PresentationFeedback = '';
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
					cubeLutSummary = { key: 'cubeLutSelectionCancelled' };
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
			setError(feedbackFailure(rangeError));
			return;
		}
		const abort = new AbortController();
		motionAbortRef.current = abort;
		setPending(true);
		setMotionProgress(null);
		setStatus('');
		setError('');
		const operation = runAwaitedAudioEditorOperation(run, () => motionRuntime.analyze({
			processorStackId: motionTarget.stackId,
			startFrame,
			endFrame,
			signal: abort.signal,
			onProgress: setMotionProgress,
		}));
		void operation.then((reference) => {
			setDocumentText(JSON.stringify({
				videoProcessorStacks: processorStacks(project),
				videoMotionAnalyses: [
					...motionAnalyses(project).filter(({ id }) => id !== reference.id),
					reference,
				],
			}, null, '\t'));
			setStatus({ key: 'motionAnalysisPublished' });
		}, (operationError: unknown) => {
			if ((operationError as Error)?.name === 'AbortError') {
				setStatus({ key: 'motionAnalysisCancelled' });
			} else {
				setError(feedbackFailure(operationError));
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
			const chain = createFramescaperDialogueChain({
				id: `dialogue:${selectedTrackId}`,
				sampleRate: projectSampleRate(project),
				...(profile === null ? {} : { noiseReduction: { profile } }),
			});
			return controller.actions.edit.commit(createFramescaperDialogueChainAddCommand(
				{ scope: 'track', trackId: selectedTrackId }, chain,
			));
		},
			{ key: 'dialogueChainApplied' });
	};

	return <AudioEditorDialogShell
		title={model.title}
		onClose={onClose}
		width={820}
		initialFocus={surface === 'dialogue-chain' ? '[data-dialogue-chain-apply] button' : '[data-framescaper-finishing-document]'}
		dataAttributes={{ 'data-framescaper-finishing-dialog': surface }}
		footer={surface !== 'dialogue-chain' ? null : <DialogFooter
			className="audio-editor-dialog-footer"
			rightContent={<span data-dialogue-chain-apply>
				<Button
					variant="primary"
					disabled={blocked || !selectedTrackId || (profiledNoiseReduction && !noiseProfileText.trim())}
					onClick={applyDialogueChain}
				>{text(copy, 'applyDialogueChain', FRAMESCAPER_FINISHING_ADDITIONAL_COPY.applyDialogueChain)}</Button>
			</span>}
		/>}
	>
		<div className="audio-editor-framescaper-finishing">
			<p>{model.description}</p>
			{(editingBlocked || readOnly) && <p role="status">{
				text(copy, 'finishingReadOnly', FRAMESCAPER_FINISHING_ADDITIONAL_COPY.finishingReadOnly)
			}</p>}
			{model.documentEditable && <>
				<label>
					<span>{text(copy, 'finishingDocument', FRAMESCAPER_FINISHING_ADDITIONAL_COPY.finishingDocument)}</span>
					<textarea data-framescaper-finishing-document rows={18} maxLength={4 * 1024 * 1024}
						spellCheck={false} value={documentText} disabled={blocked}
						onChange={(event) => setDocumentText(event.currentTarget.value)} />
				</label>
				<button type="button" disabled={blocked} onClick={applyDocument}>{
					text(copy, 'apply', FRAMESCAPER_FINISHING_ADDITIONAL_COPY.apply)
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
				frameRate={audioEditorProjectFrameRate(project)}
				progress={motionProgress}
				pending={pending && motionAbortRef.current !== null}
				copy={copy}
				onStack={(stackId) => {
					setMotionStackId(stackId);
					const target = motionTargets.find((candidate) => candidate.stackId === stackId);
					setMotionStartFrame(target?.startFrame ?? 0);
					setMotionEndFrame(target?.endFrame ?? 0);
				}}
				onStartFrame={setMotionStartFrame}
				onEndFrame={setMotionEndFrame}
				onAnalyze={analyzeMotion}
				onCancel={() => { motionAbortRef.current?.abort(); }}
			/>}
			{surface === 'dialogue-chain' && <fieldset disabled={blocked}>
				<legend>{text(copy, 'dialogueChain', FRAMESCAPER_FINISHING_ADDITIONAL_COPY.dialogueChain)}</legend>
				<p>{text(copy, 'dialogueChainOrder', FRAMESCAPER_FINISHING_ADDITIONAL_COPY.dialogueChainOrder)}</p>
				<label><input type="checkbox" checked={profiledNoiseReduction}
					onChange={(event) => setProfiledNoiseReduction(event.currentTarget.checked)} /> {
					text(copy, 'profiledNoiseReduction', FRAMESCAPER_FINISHING_ADDITIONAL_COPY.profiledNoiseReduction)
				}</label>
				{profiledNoiseReduction && <label><span>{text(copy, 'noiseProfileDocument',
					FRAMESCAPER_FINISHING_ADDITIONAL_COPY.noiseProfileDocument)}</span><textarea rows={8}
						spellCheck={false} value={noiseProfileText}
						onChange={(event) => setNoiseProfileText(event.currentTarget.value)} /></label>}
				{!selectedTrackId && <p role="status">{text(copy, 'selectAudioTrack', FRAMESCAPER_FINISHING_ADDITIONAL_COPY.selectAudioTrack)}</p>}
			</fieldset>}
			<div role="status" aria-live="polite" aria-atomic="true">{error || status}</div>
		</div>
	</AudioEditorDialogShell>;
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

function lossSummary(count: number): Exclude<PresentationFeedback, string | { failure: unknown }> {
	return count === 0 ? { key: 'captionNoLosses' } : count === 1 ? { key: 'captionOneLoss' }
		: { key: 'captionManyLosses', parameters: { count } };
}

function inputFrame(value: string | number, name: string): number {
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
