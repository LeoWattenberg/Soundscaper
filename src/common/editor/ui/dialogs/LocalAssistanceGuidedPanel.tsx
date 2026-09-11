/* SPDX-License-Identifier: AGPL-3.0-only */

/** Accessible Guided workflow reachability; aggregate execution stays behind its explicit seam. */

import { Button } from '@soundscaper/design-system/Button';
import { assistanceTaskLabel } from '../assistance-task-catalog.ts';
import { Suspense } from 'react';

import {
	assistanceWorkflowStageGraph,
	type AssistanceGuidedWorkflowId,
} from '../../assistance/workflow-recipes.ts';
import { serializeAssistanceWorkflowSettingsV1 } from '../../assistance/workflow-settings-v1.ts';
import type { AssistanceWorkflowSettingsV1 } from '../../assistance/workflow-settings-v1.ts';
import {
	localAssistanceGuidedConfigurationLocked,
	type LocalAssistanceGuidedSnapshot,
} from '../local-assistance-guided-session-store.ts';
import LocalAssistanceGuidedSettings from './LocalAssistanceGuidedSettings.tsx';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';

const LocalAssistanceGuidedReview = lazyEditorModule(() => import('./LocalAssistanceGuidedReview.tsx'));

type Copy = Readonly<Record<string, string | undefined>>;

export interface LocalAssistanceGuidedPanelProps {
	readonly focusedTask?: boolean;
	readonly copy: Copy;
	readonly snapshot: LocalAssistanceGuidedSnapshot;
	readonly onSelectWorkflow: (workflowId: AssistanceGuidedWorkflowId) => unknown;
	readonly onSettingsChange: (settings: AssistanceWorkflowSettingsV1) => unknown;
	readonly onRun: () => unknown;
	readonly onCancel: () => unknown;
	readonly onReview: () => unknown;
	readonly onAccept: () => unknown;
	readonly onChoiceChange: (choiceId: string, selected: boolean) => unknown;
	readonly onReframeCropChange: (sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>) => unknown;
	readonly onHighlightTitleChange: (proposalId: string, title: string) => unknown;
	readonly onHighlightTrimChange: (
		proposalId: string, startFrame: number, endFrame: number,
	) => unknown;
	readonly onHighlightCropChange: (proposalId: string, sourceFrame: number,
		crop: Readonly<{ left: number; top: number; right: number; bottom: number }>) => unknown;
}

export default function LocalAssistanceGuidedPanel({
	copy, snapshot, focusedTask = false, onSelectWorkflow, onSettingsChange, onRun, onCancel, onReview, onAccept,
	onChoiceChange, onReframeCropChange, onHighlightTitleChange, onHighlightTrimChange,
	onHighlightCropChange,
}: LocalAssistanceGuidedPanelProps) {
	const graph = snapshot.selectedWorkflowId
		? assistanceWorkflowStageGraph(snapshot.selectedWorkflowId) : null;
	const message = statusMessage(copy, snapshot);
	const configurationLocked = localAssistanceGuidedConfigurationLocked(snapshot.phase);
	return <section id="local-assistance-guided-panel" className="kw-local-assistance__guided" role={focusedTask ? 'region' : 'tabpanel'}
		aria-label={text(copy, 'localAssistanceGuided', 'Guided')}>
		{!focusedTask && <label htmlFor="local-assistance-guided-workflow">
			{text(copy, 'localAssistanceGuidedWorkflow', 'Workflow')}
			<select id="local-assistance-guided-workflow"
				value={snapshot.selectedWorkflowId ?? ''} disabled={configurationLocked}
				onChange={(event) => {
					void onSelectWorkflow(event.currentTarget.value as AssistanceGuidedWorkflowId);
				}}>
				<option value="" disabled>{text(copy, 'localAssistanceChoose', 'Choose')}</option>
				{snapshot.workflowIds.map((workflowId) => <option value={workflowId} key={workflowId}>
					{assistanceTaskLabel(workflowId, copy)}
				</option>)}
			</select>
		</label>}
		{graph && <details className="kw-local-assistance__guided-recipe">
			<summary>{text(copy, 'assistanceTechnicalDetails', 'Technical details')}</summary>
			<h3>{text(copy, 'localAssistanceGuidedStages', 'Stages')}</h3>
			<ol>{graph.map(({ stageId, required }) => <li key={stageId}>
				<code>{stageId}</code>{required ? '' : ` · ${text(copy,
					'localAssistanceOptional', 'optional')}`}
			</li>)}</ol>
			{snapshot.error && <p>{snapshot.error}</p>}
			{snapshot.progress && <code>{JSON.stringify(snapshot.progress)}</code>}
		</details>}
		{snapshot.settings && <>
			<LocalAssistanceGuidedSettings copy={copy} settings={snapshot.settings}
				disabled={configurationLocked} onChange={onSettingsChange} />
			<details className="kw-local-assistance__guided-settings">
				<summary>{text(copy, 'localAssistanceExactSettings', 'Exact settings')}</summary>
				<code>{serializeAssistanceWorkflowSettingsV1(snapshot.settings)}</code>
			</details>
		</>}
		{!focusedTask && <div className="kw-local-assistance__run-actions">
			<Button variant="secondary" disabled={!snapshot.canRun} onClick={() => { void onRun(); }}>
				{text(copy, 'localAssistanceRunGuided', 'Run Guided workflow')}
			</Button>
			<Button variant="secondary" disabled={!snapshot.canCancel} onClick={() => { void onCancel(); }}>
				{text(copy, 'localAssistanceCancel', 'Cancel')}
			</Button>
			<Button variant="secondary" disabled={!snapshot.canReview} onClick={() => { void onReview(); }}>
				{text(copy, 'localAssistanceReview', 'Review result')}
			</Button>
			<Button variant="secondary" disabled={!snapshot.canAccept} onClick={() => { void onAccept(); }}>
				{text(copy, 'localAssistanceAcceptSelected', 'Accept selected')}
			</Button>
		</div>}
		{snapshot.review && <Suspense fallback={<p role="status">
			{text(copy, 'localAssistanceReviewLoading', 'Opening review…')}
		</p>}><LocalAssistanceGuidedReview copy={copy} review={snapshot.review}
			selectedChoiceIds={snapshot.selectedChoiceIds} onChoiceChange={onChoiceChange}
			auditionAudio={snapshot.auditionAudio}
			auditionSourceStartFrame={snapshot.auditionSourceStartFrame}
			auditionSourceSampleRate={snapshot.auditionSourceSampleRate}
			previewVideo={snapshot.previewVideo}
			highlightSourceTimeAuthority={snapshot.highlightSourceTimeAuthority}
			reframeDraft={snapshot.reframeDraft} onReframeCropChange={onReframeCropChange}
			highlightDraft={snapshot.highlightDraft}
			onHighlightTitleChange={onHighlightTitleChange}
			onHighlightTrimChange={onHighlightTrimChange}
			onHighlightCropChange={onHighlightCropChange} /></Suspense>}
		{message && <p role={snapshot.phase === 'error' ? 'alert' : 'status'} aria-label={text(copy, 'assistanceProcessingStatus', 'Processing status')} aria-live="polite">
			{message}
		</p>}
	</section>;
}

function statusMessage(copy: Copy, snapshot: LocalAssistanceGuidedSnapshot): string | null {
	if (snapshot.error) return text(copy, 'assistanceTaskFailed', 'Processing could not finish. Open technical details for more information.');
	if (snapshot.phase === 'selection-required') {
		return text(copy, 'localAssistanceGuidedChoose', 'Choose one Guided workflow.');
	}
	if (snapshot.phase === 'preparing') return text(copy, 'localAssistanceGuidedPreparing',
		'Preparing selected media…');
	if (snapshot.phase === 'running') return text(copy, 'localAssistanceGuidedRunning',
		'Processing selected media locally');
	if (snapshot.phase === 'completed') return text(copy, 'localAssistanceGuidedCompleted',
		'Processing finished. Review the result before applying it.');
	if (snapshot.phase === 'reviewing') return text(copy, 'localAssistanceGuidedReviewing',
		'Preparing the result for review.');
	if (snapshot.phase === 'review-ready') return text(copy,
		'localAssistanceGuidedReviewReady', 'Choose the results to apply.');
	if (snapshot.phase === 'accepting') return text(copy, 'localAssistanceAccepting',
		'Accepting the reviewed selection.');
	if (snapshot.phase === 'accepted') return text(copy, 'localAssistanceAccepted',
		'The reviewed selection was accepted as one undoable edit.');
	if (snapshot.phase === 'cancelled') return text(copy, 'localAssistanceCancelled',
		'The Guided workflow was cancelled.');
	if (snapshot.phase === 'error') return text(copy, 'localAssistanceError', 'Processing failed.');
	if (snapshot.phase !== 'unavailable') return null;
	if (snapshot.unavailableReason === 'workflow-bridge-unavailable') {
		return text(copy, 'localAssistanceWorkflowBridgeUnavailable',
			'This desktop build does not support this task.');
	}
	if (snapshot.unavailableReason === 'aggregate-preparation-unavailable') {
		return text(copy, 'localAssistanceWorkflowPreparationUnavailable',
			'This task is unavailable for the selected media.');
	}
	return text(copy, 'localAssistanceWorkflowUnavailable', 'This task is unavailable on this device.');
}

function text(copy: Copy, key: string, fallback: string): string {
	return copy[key] || fallback;
}
