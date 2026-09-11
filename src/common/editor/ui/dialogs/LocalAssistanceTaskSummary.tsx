/* SPDX-License-Identifier: AGPL-3.0-only */
import { Button } from '@soundscaper/design-system/Button';
import type { LocalAssistanceSnapshot } from '../local-assistance-session-store.ts';
import type { AssistanceWorkflowSettingsV1 } from '../../assistance/workflow-settings-v1.ts';
import { assistanceTaskModelsReady } from '../../controller/assistance/local-assistance-task-models.ts';

type Copy = Readonly<Record<string, string | undefined>>;
export default function LocalAssistanceTaskSummary({ snapshot, settings, copy, disabled, onManageModels }: {
	readonly snapshot: LocalAssistanceSnapshot;
	readonly settings: AssistanceWorkflowSettingsV1 | null;
	readonly copy: Copy;
	readonly disabled: boolean;
	readonly onManageModels?: () => void;
}) {
	const ready = settings && assistanceTaskModelsReady(settings, snapshot.models, snapshot.sources);
	return <section className="kw-processing-summary">
		<div><strong>{copy.localAssistanceSource || 'Selected media'}</strong>
			<p>{snapshot.sources.map(({ label }) => label).join(', ') || copy.localAssistanceSourceRequired
				|| 'Select media in the timeline first.'}</p></div>
		<div className="kw-processing-summary__models">
			<p role="status">{snapshot.phase === 'loading' || snapshot.phase === 'idle'
				? copy.localModelsLoading || 'Loading local models…'
				: ready ? copy.assistanceModelsReady || 'Required models are installed.'
					: copy.assistanceModelsMissing || 'Required models are missing. Open Model Manager to install them.'}</p>
			{onManageModels && <span data-assistance-manage-models="true"><Button variant="secondary" disabled={disabled} onClick={onManageModels}>
				{copy.assistanceManageModels || 'Manage Models'}
			</Button></span>}
		</div>
	</section>;
}

export function LocalAssistanceTaskActions({ copy, canRun, canCancel, canReview, canAccept,
	onRun, onCancel, onReview, onAccept, onClose, reviewReady,
}: {
	readonly copy: Copy;
	readonly reviewReady: boolean;
	readonly canRun: boolean; readonly canCancel: boolean;
	readonly canReview: boolean; readonly canAccept: boolean;
	readonly onRun: () => unknown; readonly onCancel: () => unknown;
	readonly onReview: () => unknown; readonly onAccept: () => unknown; readonly onClose: () => void;
}) {
	return <>
		<Button variant="secondary" onClick={onClose}>{copy.close || 'Close'}</Button>
		{canCancel ? <Button variant="primary" onClick={() => { void onCancel(); }}>
			{copy.assistanceCancelProcessing || 'Cancel processing'}</Button>
			: reviewReady ? <Button variant="primary" disabled={!canAccept} onClick={() => { void onAccept(); }}>
				{copy.localAssistanceAcceptSelected || 'Apply selected'}</Button>
				: canReview ? <Button variant="primary" onClick={() => { void onReview(); }}>
					{copy.localAssistanceReview || 'Review result'}</Button>
					: <Button variant="primary" disabled={!canRun} onClick={() => { void onRun(); }}>
						{copy.localAssistanceRun || 'Run locally'}</Button>}
	</>;
}
