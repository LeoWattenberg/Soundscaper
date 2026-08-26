/* SPDX-License-Identifier: AGPL-3.0-only */

/** Accessible Guided workflow reachability; aggregate execution stays behind its explicit seam. */

import {
	assistanceWorkflowStageGraph,
	type AssistanceGuidedWorkflowId,
} from '../../assistance/workflow-recipes.ts';
import { serializeAssistanceWorkflowSettingsV1 } from '../../assistance/workflow-settings-v1.ts';
import type {
	LocalAssistanceGuidedSnapshot,
} from '../local-assistance-guided-session-store.ts';

type Copy = Readonly<Record<string, string | undefined>>;

export interface LocalAssistanceGuidedPanelProps {
	readonly copy: Copy;
	readonly snapshot: LocalAssistanceGuidedSnapshot;
	readonly onSelectWorkflow: (workflowId: AssistanceGuidedWorkflowId) => unknown;
	readonly onRun: () => unknown;
	readonly onCancel: () => unknown;
}

const LABELS: Readonly<Record<AssistanceGuidedWorkflowId, string>> = Object.freeze({
	'transcribe-captions': 'Transcribe & Captions',
	'clean-filler-silence': 'Clean Filler & Silence',
	'identify-speakers': 'Identify Speakers',
	'enhance-dialogue': 'Enhance Dialogue',
	'separate-dialogue-music-effects': 'Separate Dialogue / Music / Effects',
	'mark-reactions': 'Mark Reactions',
	'index-transcript': 'Index Transcript',
	'detect-beats-tempo': 'Detect Beats & Tempo',
	'mark-cuts': 'Mark Cuts',
	'index-video': 'Index Video',
	reframe: 'Reframe',
	'make-highlights': 'Make Highlights',
	'generate-editorial-text': 'Generate Editorial Text',
});

export default function LocalAssistanceGuidedPanel({
	copy, snapshot, onSelectWorkflow, onRun, onCancel,
}: LocalAssistanceGuidedPanelProps) {
	const graph = snapshot.selectedWorkflowId
		? assistanceWorkflowStageGraph(snapshot.selectedWorkflowId) : null;
	const message = statusMessage(copy, snapshot);
	return <section id="local-assistance-guided-panel" className="kw-local-assistance__guided" role="tabpanel"
		aria-label={text(copy, 'localAssistanceGuided', 'Guided')}>
		<label htmlFor="local-assistance-guided-workflow">
			{text(copy, 'localAssistanceGuidedWorkflow', 'Workflow')}
			<select id="local-assistance-guided-workflow"
				value={snapshot.selectedWorkflowId ?? ''} disabled={snapshot.canCancel}
				onChange={(event) => {
					void onSelectWorkflow(event.currentTarget.value as AssistanceGuidedWorkflowId);
				}}>
				<option value="" disabled>{text(copy, 'localAssistanceChoose', 'Choose')}</option>
				{snapshot.workflowIds.map((workflowId) => <option value={workflowId} key={workflowId}>
					{LABELS[workflowId]}
				</option>)}
			</select>
		</label>
		{graph && <div className="kw-local-assistance__guided-recipe">
			<h3>{text(copy, 'localAssistanceGuidedStages', 'Stages')}</h3>
			<ol>{graph.map(({ stageId, required }) => <li key={stageId}>
				<code>{stageId}</code>{required ? '' : ` · ${text(copy,
					'localAssistanceOptional', 'optional')}`}
			</li>)}</ol>
		</div>}
		{snapshot.settings && <details className="kw-local-assistance__guided-settings">
			<summary>{text(copy, 'localAssistanceDefaultSettings', 'Default settings')}</summary>
			<code>{serializeAssistanceWorkflowSettingsV1(snapshot.settings)}</code>
		</details>}
		<div className="kw-local-assistance__run-actions">
			<button type="button" disabled={!snapshot.canRun} onClick={() => { void onRun(); }}>
				{text(copy, 'localAssistanceRunGuided', 'Run Guided workflow')}
			</button>
			<button type="button" disabled={!snapshot.canCancel} onClick={() => { void onCancel(); }}>
				{text(copy, 'localAssistanceCancel', 'Cancel')}
			</button>
		</div>
		{message && <p role={snapshot.phase === 'error' ? 'alert' : 'status'} aria-live="polite">
			{message}
		</p>}
	</section>;
}

function statusMessage(copy: Copy, snapshot: LocalAssistanceGuidedSnapshot): string | null {
	if (snapshot.phase === 'selection-required') {
		return text(copy, 'localAssistanceGuidedChoose', 'Choose one Guided workflow.');
	}
	if (snapshot.phase === 'preparing') return text(copy, 'localAssistanceGuidedPreparing',
		'Preparing the aggregate workflow request.');
	if (snapshot.phase === 'running') return snapshot.progress
		? `${snapshot.progress.stageId} · ${snapshot.progress.phase}`
		: text(copy, 'localAssistanceGuidedRunning', 'Running the Guided workflow.');
	if (snapshot.phase === 'completed') return text(copy, 'localAssistanceGuidedCompleted',
		'The Guided workflow completed.');
	if (snapshot.phase === 'cancelled') return text(copy, 'localAssistanceCancelled',
		'The Guided workflow was cancelled.');
	if (snapshot.phase === 'error') return snapshot.error
		?? text(copy, 'localAssistanceError', 'The Guided workflow failed.');
	if (snapshot.phase !== 'unavailable') return null;
	if (snapshot.unavailableReason === 'workflow-bridge-unavailable') {
		return text(copy, 'localAssistanceWorkflowBridgeUnavailable',
			'This desktop build does not provide aggregate Guided workflows.');
	}
	if (snapshot.unavailableReason === 'aggregate-preparation-unavailable') {
		return text(copy, 'localAssistanceWorkflowPreparationUnavailable',
			'The selected-media controller cannot construct the aggregate fence and staged claims yet.');
	}
	return text(copy, 'localAssistanceWorkflowUnavailable', 'This Guided workflow is unavailable locally.');
}

function text(copy: Copy, key: string, fallback: string): string {
	return copy[key] || fallback;
}
