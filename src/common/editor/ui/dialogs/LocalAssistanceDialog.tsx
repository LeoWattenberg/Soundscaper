/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { ASSISTANCE_OPERATIONS, type AssistanceOperation } from '../../assistance/operation.ts';
import type { LocalAssistanceShotDetectionMode } from '../../assistance/shot-detection-mode.ts';
import type { AssistanceGuidedWorkflowId } from '../../assistance/workflow-recipes.ts';
import type { AssistanceWorkflowSettingsV1 } from '../../assistance/workflow-settings-v1.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import LocalAssistanceCleanupReview from './LocalAssistanceCleanupReview.tsx';
import LocalAssistanceGuidedPanel from './LocalAssistanceGuidedPanel.tsx';
import type { LocalAssistanceTranscriptCleanupPreset } from '../local-assistance-cleanup.ts';
import LocalAssistanceOutputReviewList from './LocalAssistanceOutputReview.tsx';
import type { LocalAssistanceBridge } from '../local-assistance-bridge.ts';
import { createLocalAssistanceAdvancedWorkflowSessionStore } from
	'../local-assistance-advanced-session-store.ts';
import {
	createLocalAssistanceGuidedSessionStore,
	INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT,
	type LocalAssistanceDialogSurface,
	type LocalAssistanceGuidedSnapshot,
} from '../local-assistance-guided-session-store.ts';
import { localAssistanceModelCompatible, localAssistanceModelTaskSlots,
	type LocalAssistanceSelectedMediaPreparationPort } from '../local-assistance-preparation.ts';
import {
	type LocalAssistanceSnapshot,
	type LocalAssistanceUiUnavailableReason,
} from '../local-assistance-session-store.ts';
import './LocalAssistanceDialog.css';

type Copy = Readonly<Record<string, string | undefined>>;

export interface LocalAssistanceDialogProps {
	readonly bridge: LocalAssistanceBridge | null;
	readonly preparation: LocalAssistanceSelectedMediaPreparationPort | null;
	readonly copy: Copy;
	readonly onClose: () => void;
}

export interface LocalAssistanceDialogViewProps {
	readonly copy: Copy;
	readonly snapshot: LocalAssistanceSnapshot;
	readonly guided?: LocalAssistanceGuidedSnapshot;
	readonly surface?: LocalAssistanceDialogSurface;
	readonly reviewOpen?: boolean;
	readonly onClose: () => void;
	readonly onSurfaceChange?: (surface: LocalAssistanceDialogSurface) => unknown;
	readonly onSelectWorkflow?: (workflowId: AssistanceGuidedWorkflowId) => unknown;
	readonly onGuidedSettingsChange?: (settings: AssistanceWorkflowSettingsV1) => unknown;
	readonly onRunGuided?: () => unknown;
	readonly onCancelGuided?: () => unknown;
	readonly onReviewGuided?: () => unknown;
	readonly onAcceptGuided?: () => unknown;
	readonly onGuidedChoiceChange?: (choiceId: string, selected: boolean) => unknown;
	readonly onGuidedReframeCropChange?: (sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>) => unknown;
	readonly onGuidedHighlightTitleChange?: (proposalId: string, title: string) => unknown;
	readonly onGuidedHighlightTrimChange?: (
		proposalId: string, startFrame: number, endFrame: number,
	) => unknown;
	readonly onGuidedHighlightCropChange?: (proposalId: string, sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>) => unknown;
	readonly onSelectSource: (sourceId: string) => unknown;
	readonly onSelectOperation: (operation: AssistanceOperation) => unknown;
	readonly onShotDetectionModeChange?: (mode: LocalAssistanceShotDetectionMode) => unknown;
	readonly onSelectModel: (modelId: string) => unknown;
	readonly onConsentChange: (consent: boolean) => unknown;
	readonly onRun: () => unknown;
	readonly onCancel: () => unknown;
	readonly onReview: () => unknown;
	readonly onAccept: () => unknown;
	readonly onCleanupSelectionChange?: (proposalId: string, selected: boolean) => unknown;
	readonly onCleanupPresetChange?: (preset: LocalAssistanceTranscriptCleanupPreset) => unknown;
	readonly onCleanupAccept?: () => unknown;
	readonly onCleanupReject?: () => unknown;
}

export default function LocalAssistanceDialog({
	bridge, preparation, copy, onClose,
}: LocalAssistanceDialogProps) {
	const store = useMemo(() => createLocalAssistanceAdvancedWorkflowSessionStore({
		bridge, preparation,
	}), [bridge, preparation]);
	const guidedStore = useMemo(() => createLocalAssistanceGuidedSessionStore({
		bridge, preparation,
	}), [bridge, preparation]);
	const [reviewOpen, setReviewOpen] = useState(false);
	const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	const guided = useSyncExternalStore(
		guidedStore.subscribe, guidedStore.getSnapshot, guidedStore.getSnapshot,
	);
	useEffect(() => {
		const disconnect = store.connect();
		void store.load();
		return () => {
			disconnect();
			void Promise.all([store.dispose(), guidedStore.dispose()]);
		};
	}, [guidedStore, store]);
	return <LocalAssistanceDialogView
		copy={copy}
		snapshot={snapshot}
		guided={guided}
		reviewOpen={reviewOpen}
		onClose={onClose}
		onSurfaceChange={guidedStore.selectSurface}
		onSelectWorkflow={guidedStore.selectWorkflow}
		onGuidedSettingsChange={guidedStore.setSettings}
		onRunGuided={() => guidedStore.run()}
		onCancelGuided={() => guidedStore.cancel()}
		onReviewGuided={() => guidedStore.review()}
		onAcceptGuided={() => guidedStore.accept()}
		onGuidedChoiceChange={guidedStore.setReviewChoiceSelected}
		onGuidedReframeCropChange={guidedStore.setReframeCrop}
		onGuidedHighlightTitleChange={guidedStore.setHighlightTitle}
		onGuidedHighlightTrimChange={guidedStore.setHighlightTrim}
		onGuidedHighlightCropChange={guidedStore.setHighlightCrop}
		onSelectSource={store.selectSource}
		onSelectOperation={store.selectOperation}
		onShotDetectionModeChange={store.selectShotDetectionMode}
		onSelectModel={store.selectModel}
		onConsentChange={store.setConsent}
		onRun={() => store.run()}
		onCancel={() => store.cancel()}
		onReview={() => {
			setReviewOpen(true);
			if (store.getSnapshot().canPrepareTranscriptCleanup) {
				return store.prepareTranscriptCleanup();
			}
		}}
		onAccept={() => store.accept()}
		onCleanupSelectionChange={store.setTranscriptCleanupProposalSelected}
		onCleanupPresetChange={(preset) => store.prepareTranscriptCleanup(preset)}
		onCleanupAccept={() => store.acceptTranscriptCleanup()}
		onCleanupReject={() => store.rejectTranscriptCleanup()}
	/>;
}

export function LocalAssistanceDialogView({
	copy, snapshot, guided = INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT,
	surface, reviewOpen = false, onClose,
	onSurfaceChange = () => undefined, onSelectWorkflow = () => undefined,
	onGuidedSettingsChange = () => undefined,
	onRunGuided = () => undefined, onCancelGuided = () => undefined,
	onReviewGuided = () => undefined, onAcceptGuided = () => undefined,
	onGuidedChoiceChange = () => undefined,
	onGuidedReframeCropChange = () => undefined,
	onGuidedHighlightTitleChange = () => undefined,
	onGuidedHighlightTrimChange = () => undefined,
	onGuidedHighlightCropChange = () => undefined,
	onSelectSource, onSelectOperation,
	onShotDetectionModeChange = () => undefined, onSelectModel,
	onRun, onCancel, onReview, onAccept,
	onCleanupSelectionChange = () => undefined,
	onCleanupPresetChange = () => undefined,
	onCleanupAccept = () => undefined, onCleanupReject = () => undefined,
}: LocalAssistanceDialogViewProps) {
	const activeSurface = surface ?? guided.surface;
	const source = snapshot.sources.find(({ sourceId }) => sourceId === snapshot.selectedSourceId) ?? null;
	const operationSet = new Set(source?.operations ?? []);
	const shotDetectionMode = snapshot.selectedOperation === 'shot-detection'
		? snapshot.shotDetectionMode : undefined;
	const modelTaskSlots = snapshot.selectedOperation
		? localAssistanceModelTaskSlots(snapshot.selectedOperation, shotDetectionMode)
		: EMPTY_MODEL_TASK_SLOTS;
	const message = phaseMessage(copy, snapshot);
	return <AudioEditorDialogShell
		title={text(copy, 'localAssistance', 'Local Assistance')}
		onClose={onClose}
		width={760}
		initialFocus="dialog"
		dataAttributes={{ 'data-local-assistance': 'true' }}
		footer={activeSurface === 'advanced' ? <div className="kw-audio-editor-dialog__actions">
			<button type="button" disabled={!snapshot.canReview} onClick={() => { void onReview(); }}>
				{text(copy, 'localAssistanceReview', 'Review result')}
			</button>
			<button type="button" disabled={!snapshot.canAccept || !reviewOpen}
				onClick={() => { void onAccept(); }}>
				{text(copy, 'localAssistanceAccept', 'Accept proposal')}
			</button>
			<button type="button" onClick={onClose}>{text(copy, 'close', 'Close')}</button>
		</div> : <div className="kw-audio-editor-dialog__actions">
			<button type="button" onClick={onClose}>{text(copy, 'close', 'Close')}</button>
		</div>}
	>
		<p>{text(copy, 'localAssistanceDescription',
			'Process explicitly selected media locally with an installed, compatible model.')}</p>
		<div className="kw-local-assistance__tabs" role="tablist"
			aria-label={text(copy, 'localAssistanceMode', 'Local Assistance mode')}>
			<button type="button" role="tab" aria-selected={activeSurface === 'guided'}
				aria-controls="local-assistance-guided-panel"
				disabled={guided.canCancel || busy(snapshot)} onClick={() => {
					void onSurfaceChange('guided');
				}}>{text(copy, 'localAssistanceGuided', 'Guided')}</button>
			<button type="button" role="tab" aria-selected={activeSurface === 'advanced'}
				aria-controls="local-assistance-advanced-panel"
				disabled={guided.canCancel || busy(snapshot)} onClick={() => {
					void onSurfaceChange('advanced');
				}}>{text(copy, 'localAssistanceAdvanced', 'Advanced')}</button>
		</div>
		{activeSurface === 'guided' && <LocalAssistanceGuidedPanel copy={copy} snapshot={guided}
			onSelectWorkflow={onSelectWorkflow} onSettingsChange={onGuidedSettingsChange}
			onRun={onRunGuided} onCancel={onCancelGuided} onReview={onReviewGuided}
			onAccept={onAcceptGuided}
			onChoiceChange={onGuidedChoiceChange}
			onReframeCropChange={onGuidedReframeCropChange}
			onHighlightTitleChange={onGuidedHighlightTitleChange}
			onHighlightTrimChange={onGuidedHighlightTrimChange}
			onHighlightCropChange={onGuidedHighlightCropChange} />}
		{activeSurface === 'advanced' && <section id="local-assistance-advanced-panel"
			className="kw-local-assistance__advanced" role="tabpanel"
			aria-label={text(copy, 'localAssistanceAdvanced', 'Advanced')}>
		<div className="kw-local-assistance__selections">
			<label>{text(copy, 'localAssistanceSource', 'Selected media')}
				<select value={snapshot.selectedSourceId ?? ''} disabled={busy(snapshot)}
					onChange={(event) => { void onSelectSource(event.currentTarget.value); }}>
					<option value="" disabled>{text(copy, 'localAssistanceChoose', 'Choose')}</option>
					{snapshot.sources.map((candidate) => <option value={candidate.sourceId} key={candidate.sourceId}>
						{candidate.label}
					</option>)}
				</select>
			</label>
			<label>{text(copy, 'localAssistanceOperation', 'Operation')}
				<select value={snapshot.selectedOperation ?? ''} disabled={!source || busy(snapshot)}
					onChange={(event) => { void onSelectOperation(event.currentTarget.value as AssistanceOperation); }}>
					<option value="" disabled>{text(copy, 'localAssistanceChoose', 'Choose')}</option>
					{ASSISTANCE_OPERATIONS.map((operation) => <option value={operation} key={operation}
						disabled={!operationSet.has(operation)}>{operation}</option>)}
				</select>
			</label>
			{snapshot.selectedOperation === 'shot-detection' && <fieldset
				className="kw-local-assistance__shot-mode" disabled={busy(snapshot)}>
				<legend>{text(copy, 'localAssistanceShotDetectionMode', 'Mark Cuts mode')}</legend>
				<label><input type="radio" name="local-assistance-shot-mode" value="fast"
					checked={snapshot.shotDetectionMode === 'fast'} onChange={() => {
						void onShotDetectionModeChange('fast');
					}} />{text(copy, 'localAssistanceShotDetectionFast', 'Fast · model-free')}</label>
				<label><input type="radio" name="local-assistance-shot-mode" value="accurate"
					checked={snapshot.shotDetectionMode === 'accurate'} onChange={() => {
						void onShotDetectionModeChange('accurate');
					}} />{text(copy, 'localAssistanceShotDetectionAccurate', 'Accurate · TransNetV2')}</label>
			</fieldset>}
			{modelTaskSlots.map((slot) => {
				const compatibleModels = snapshot.models.filter((model) => slot.includes(model.task)
					&& localAssistanceModelCompatible(snapshot.selectedOperation!, model, shotDetectionMode));
				const selectedModelId = snapshot.selectedModelIds.find(
					(modelId) => compatibleModels.some((model) => model.modelId === modelId),
				) ?? '';
				return <label key={slot.join('|') || 'unselected-operation'}>
					{text(copy, 'localAssistanceModel', 'Installed compatible model')}
					{modelTaskSlots.length > 1 && ` · ${slot.join(' / ')}`}
					<select value={selectedModelId}
						disabled={!snapshot.selectedOperation || busy(snapshot)}
						onChange={(event) => { void onSelectModel(event.currentTarget.value); }}>
						<option value="" disabled>{text(copy, 'localAssistanceChoose', 'Choose')}</option>
						{compatibleModels.map((model) => <option value={model.modelId} key={model.modelId}>
							{model.modelId} · {model.version}
						</option>)}
					</select>
				</label>;
			})}
			{snapshot.selectedOperation && modelTaskSlots.length === 0 && <p>
				{text(copy, 'localAssistanceNoModelRequired', 'This operation requires no installed model binding.')}
			</p>}
		</div>
		<p>{text(copy, 'localAssistanceWorkflowConsent',
			'Run locally opens one consent dialog for this exact operation, model, input, and output selection.')}</p>
		<div className="kw-local-assistance__run-actions">
			<button type="button" disabled={!snapshot.canRun} onClick={() => { void onRun(); }}>
				{text(copy, 'localAssistanceRun', 'Run locally')}
			</button>
			<button type="button" disabled={!snapshot.canCancel} onClick={() => { void onCancel(); }}>
				{text(copy, 'localAssistanceCancel', 'Cancel')}
			</button>
		</div>
		{message && <p className={snapshot.phase === 'error' ? 'kw-local-assistance__error' : undefined}
			role={snapshot.phase === 'error' ? 'alert' : 'status'} aria-live="polite">{message}</p>}
		{snapshot.progress && <Progress copy={copy} progress={snapshot.progress} />}
		{snapshot.result && <p role="status">{template(text(copy, 'localAssistanceOutputs',
			'{count} validated outputs'), { count: String(snapshot.result.outputs.length) })}</p>}
		{reviewOpen && snapshot.result && <LocalAssistanceOutputReviewList
			copy={copy} outputs={snapshot.result.outputs} />}
		{reviewOpen && snapshot.cleanup && <LocalAssistanceCleanupReview
			copy={copy}
			cleanup={snapshot.cleanup}
			onPresetChange={onCleanupPresetChange}
			onSelectionChange={onCleanupSelectionChange}
			onAccept={onCleanupAccept}
			onReject={onCleanupReject}
		/>}
		<p className="kw-local-assistance__deferred">{text(copy, 'localAssistanceAcceptanceDeferred',
			'Project acceptance is enabled in a separate review step.')}</p>
		</section>}
	</AudioEditorDialogShell>;
}

function Progress({ copy, progress }: Readonly<{
	copy: Copy;
	progress: NonNullable<LocalAssistanceSnapshot['progress']>;
}>) {
	if (progress.completed === null || progress.total === null) {
		return <p role="status" aria-live="polite">{progress.phase}</p>;
	}
	return <div className="kw-local-assistance__progress">
		<label htmlFor="local-assistance-progress">{template(text(copy, 'localAssistanceProgress',
			'{phase}: {completed} of {total}'), { phase: progress.phase,
			completed: String(progress.completed), total: String(progress.total) })}</label>
		<progress id="local-assistance-progress" value={progress.completed} max={progress.total} />
	</div>;
}

function phaseMessage(copy: Copy, snapshot: LocalAssistanceSnapshot): string | null {
	if (snapshot.phase === 'idle' || snapshot.phase === 'loading') {
		return text(copy, 'localAssistanceLoading', 'Preparing Local Assistance.');
	}
	if (snapshot.phase === 'selection-required') {
		return text(copy, 'localAssistanceSourceRequired', 'Select media in the timeline first.');
	}
	if (snapshot.phase === 'preparing') return text(copy, 'localAssistancePreparing', 'Staging the selected media.');
	if (snapshot.phase === 'running') return text(copy, 'localAssistanceRunning', 'Running the local model.');
	if (snapshot.phase === 'cancelling') return text(copy, 'localAssistanceCancelling', 'Cancelling the local operation.');
	if (snapshot.phase === 'completed') return text(copy, 'localAssistanceCompleted', 'A validated local result is available.');
	if (snapshot.phase === 'accepting') return text(copy, 'localAssistanceAccepting', 'Accepting the reviewed proposal.');
	if (snapshot.phase === 'accepted') return text(copy, 'localAssistanceAccepted', 'The proposal was accepted.');
	if (snapshot.phase === 'cancelled') return text(copy, 'localAssistanceCancelled', 'The local operation was cancelled.');
	if (snapshot.phase === 'error') return snapshot.error || text(copy, 'localAssistanceError', 'The local-assistance operation failed.');
	if (snapshot.phase === 'unavailable') return unavailableMessage(copy, snapshot.unavailableReason);
	return null;
}

function unavailableMessage(copy: Copy, reason: LocalAssistanceUiUnavailableReason | null): string {
	const messages: Partial<Record<LocalAssistanceUiUnavailableReason, string>> = {
		'bridge-unavailable': text(copy, 'localAssistanceBridgeUnavailable',
			'This desktop build does not provide Local Assistance.'),
		'selection-required': text(copy, 'localAssistanceSourceRequired', 'Select media in the timeline first.'),
		'no-compatible-model': text(copy, 'localAssistanceNoModel',
			'No installed compatible model is available for this operation.'),
		'adapter-unavailable': text(copy, 'localAssistanceAdapterUnavailable',
			'No local adapter is available for this operation yet.'),
		'runtime-unavailable': text(copy, 'localAssistanceRuntimeUnavailable',
			'The local runtime is unavailable on this device.'),
		'model-unavailable': text(copy, 'localAssistanceModelUnavailable',
			'The selected model is no longer available.'),
	};
	return reason ? messages[reason] ?? text(copy, 'localAssistanceUnavailable',
		'Local Assistance is unavailable for this selection.') : text(copy,
		'localAssistanceUnavailable', 'Local Assistance is unavailable for this selection.');
}

function busy(snapshot: LocalAssistanceSnapshot): boolean {
	return snapshot.phase === 'preparing' || snapshot.phase === 'running'
		|| snapshot.phase === 'cancelling' || snapshot.phase === 'accepting';
}

const EMPTY_MODEL_TASK_SLOTS = Object.freeze([Object.freeze([])]) as readonly (readonly string[])[];

function text(copy: Copy, key: string, fallback: string): string {
	return copy[key] || fallback;
}

function template(value: string, variables: Readonly<Record<string, string>>): string {
	return Object.entries(variables).reduce((result, [key, replacement]) =>
		result.replaceAll(`{${key}}`, replacement), value);
}
