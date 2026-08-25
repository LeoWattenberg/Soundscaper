/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { ASSISTANCE_OPERATIONS, type AssistanceOperation } from '../../assistance/operation.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { LocalAssistanceBridge } from '../local-assistance-bridge.ts';
import { localAssistanceModelCompatible,
	type LocalAssistanceSelectedMediaPreparationPort } from '../local-assistance-preparation.ts';
import {
	createLocalAssistanceSessionStore,
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
	readonly reviewOpen?: boolean;
	readonly onClose: () => void;
	readonly onSelectSource: (sourceId: string) => unknown;
	readonly onSelectOperation: (operation: AssistanceOperation) => unknown;
	readonly onSelectModel: (modelId: string) => unknown;
	readonly onConsentChange: (consent: boolean) => unknown;
	readonly onRun: () => unknown;
	readonly onCancel: () => unknown;
	readonly onReview: () => unknown;
	readonly onAccept: () => unknown;
}

export default function LocalAssistanceDialog({
	bridge, preparation, copy, onClose,
}: LocalAssistanceDialogProps) {
	const store = useMemo(() => createLocalAssistanceSessionStore({ bridge, preparation }), [bridge, preparation]);
	const [reviewOpen, setReviewOpen] = useState(false);
	const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	useEffect(() => {
		const disconnect = store.connect();
		void store.load();
		return () => {
			disconnect();
			void store.dispose();
		};
	}, [store]);
	return <LocalAssistanceDialogView
		copy={copy}
		snapshot={snapshot}
		reviewOpen={reviewOpen}
		onClose={onClose}
		onSelectSource={store.selectSource}
		onSelectOperation={store.selectOperation}
		onSelectModel={store.selectModel}
		onConsentChange={store.setConsent}
		onRun={() => store.run()}
		onCancel={() => store.cancel()}
		onReview={() => setReviewOpen(true)}
		onAccept={() => store.accept()}
	/>;
}

export function LocalAssistanceDialogView({
	copy, snapshot, reviewOpen = false, onClose, onSelectSource, onSelectOperation,
	onSelectModel, onConsentChange, onRun, onCancel, onReview, onAccept,
}: LocalAssistanceDialogViewProps) {
	const source = snapshot.sources.find(({ sourceId }) => sourceId === snapshot.selectedSourceId) ?? null;
	const operationSet = new Set(source?.operations ?? []);
	const compatibleModels = snapshot.selectedOperation
		? snapshot.models.filter((model) => localAssistanceModelCompatible(snapshot.selectedOperation!, model))
		: [];
	const message = phaseMessage(copy, snapshot);
	return <AudioEditorDialogShell
		title={text(copy, 'localAssistance', 'Local Assistance')}
		onClose={onClose}
		width={760}
		initialFocus="dialog"
		dataAttributes={{ 'data-local-assistance': 'true' }}
		footer={<div className="kw-audio-editor-dialog__actions">
			<button type="button" disabled={!snapshot.canReview} onClick={() => { void onReview(); }}>
				{text(copy, 'localAssistanceReview', 'Review result')}
			</button>
			<button type="button" disabled={!snapshot.canAccept || !reviewOpen}
				onClick={() => { void onAccept(); }}>
				{text(copy, 'localAssistanceAccept', 'Accept proposal')}
			</button>
			<button type="button" onClick={onClose}>{text(copy, 'close', 'Close')}</button>
		</div>}
	>
		<p>{text(copy, 'localAssistanceDescription',
			'Process explicitly selected media locally with an installed, compatible model.')}</p>
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
			<label>{text(copy, 'localAssistanceModel', 'Installed compatible model')}
				<select value={snapshot.selectedModelId ?? ''}
					disabled={!snapshot.selectedOperation || busy(snapshot)}
					onChange={(event) => { void onSelectModel(event.currentTarget.value); }}>
					<option value="" disabled>{text(copy, 'localAssistanceChoose', 'Choose')}</option>
					{compatibleModels.map((model) => <option value={model.modelId} key={model.modelId}>
						{model.modelId} · {model.version}
					</option>)}
				</select>
			</label>
		</div>
		<label className="kw-local-assistance__consent">
			<input type="checkbox" checked={snapshot.consent} disabled={busy(snapshot)}
				onChange={(event) => { void onConsentChange(event.currentTarget.checked); }} />
			{text(copy, 'localAssistanceConsent', 'I consent to local processing of the selected media.')}
		</label>
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
		{reviewOpen && snapshot.result && <ul className="kw-local-assistance__outputs">
			{snapshot.result.outputs.map(({ claim, review }) => <li key={claim.claimId}>
				{template(text(copy, 'localAssistanceOutputRow', '{role} · {mediaType} · {bytes} B'), {
					role: claim.role, mediaType: claim.mediaType, bytes: String(claim.byteLength),
				})}
				{review.kind === 'transcript' && <ol className="kw-local-assistance__transcript">
					{review.segments.map((segment, index) => <li
						key={`${segment.startSeconds}:${segment.endSeconds}:${index}`}>
						<span>{segment.speaker ? `${segment.speaker}: ${segment.text}` : segment.text}</span>
						<small>{template(text(copy, 'localAssistanceTranscriptTime', '{start}–{end} s'), {
							start: formatSeconds(segment.startSeconds), end: formatSeconds(segment.endSeconds),
						})}</small>
					</li>)}
				</ol>}
			</li>)}
		</ul>}
		<p className="kw-local-assistance__deferred">{text(copy, 'localAssistanceAcceptanceDeferred',
			'Project acceptance is enabled in a separate review step.')}</p>
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

function text(copy: Copy, key: string, fallback: string): string {
	return copy[key] || fallback;
}

function template(value: string, variables: Readonly<Record<string, string>>): string {
	return Object.entries(variables).reduce((result, [key, replacement]) =>
		result.replaceAll(`{${key}}`, replacement), value);
}

function formatSeconds(value: number): string {
	return value.toFixed(3).replace(/(?:\.0+|(\.\d*?)0+)$/u, '$1');
}
