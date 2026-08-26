import { useMemo, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { createDeliveryBatch } from '../../delivery-batch.ts';
import { summarizeDeliveryBatchReport } from '../../delivery-batch-report.ts';
import {
	deliveryBatchTargetOptions,
	selectableDeliveryBatchTargets,
} from '../delivery-batch-dialog-model.ts';
import { DesignCheckbox, LabeledDropdown } from './inspector-controls.jsx';

/**
 * The delivery queue, and the batch that fills it.
 *
 * A batch is chosen the way it is built: things to deliver crossed with formats
 * to deliver them in. The dialog greys out a target it cannot use rather than
 * offering it and then refusing the batch, and a target that is unavailable says
 * why — "why can I not deliver the loop" should be answerable here rather than
 * from the absence of a row.
 */

const STATE_COPY_KEYS = Object.freeze({
	queued: 'deliveryQueueStateQueued',
	running: 'deliveryQueueStateRunning',
	completed: 'deliveryQueueStateCompleted',
	failed: 'deliveryQueueStateFailed',
	cancelled: 'deliveryQueueStateCancelled',
});

export function DeliveryQueueDialog({ isOpen, controller, snapshot, copy, onClose }) {
	const queueActions = controller.actions.export.queue;
	// Read on every render rather than memoized: the preset store publishes
	// through the snapshot, and a stale list would offer a format that no longer
	// exists or hide one that was just saved.
	const presets = controller.actions.export.presets.list('audio');
	const targets = useMemo(() => deliveryBatchTargetOptions({
		hasSelection: Boolean(snapshot.selection),
		hasLoop: Boolean(snapshot.project?.loop?.enabled),
		masteringSequences: snapshot.masteringSequences ?? null,
	}, {
		entireProject: copy.entireProject,
		currentSelection: copy.currentSelection,
		loopRegion: copy.loopRegion,
		noSelection: copy.deliveryTargetNoSelection,
		noLoop: copy.deliveryTargetNoLoop,
		undeliverableSequence: copy.deliveryTargetSequenceUndeliverable,
		stemsUnsupported: copy.deliveryTargetStemsUnsupported,
	}), [copy, snapshot.masteringSequences, snapshot.project?.loop?.enabled, snapshot.selection]);

	const [mode, setMode] = useState('mix');
	const [targetKeys, setTargetKeys] = useState(['project']);
	const [presetIds, setPresetIds] = useState([]);
	const [batchId, setBatchId] = useState(null);
	const [error, setError] = useState('');
	const [status, setStatus] = useState('');

	const selectable = selectableDeliveryBatchTargets(targets, mode);
	const chosenTargets = selectable.filter(({ key }) => targetKeys.includes(key));
	const chosenPresets = presets.filter(({ id }) => presetIds.includes(id));
	const queue = queueActions.list();
	const report = batchId ? queueActions.batchReport(batchId) : null;

	const toggle = (setValues, value, checked) => setValues((current) => (
		checked ? [...new Set([...current, value])] : current.filter((entry) => entry !== value)
	));

	const queueBatch = () => {
		try {
			const batch = createDeliveryBatch(snapshot.project, {
				batchId: `delivery-batch-${queue.entries.length + 1}-${chosenTargets.length}x${chosenPresets.length}`,
				presets: chosenPresets,
				targets: chosenTargets.map(({ target }) => target),
				mode,
			});
			queueActions.enqueueBatch(batch);
			setBatchId(batch.batchId);
			setError('');
			setStatus(copy.deliveryBatchQueued.replace('{members}', String(batch.members.length)));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			setStatus('');
		}
	};

	return (
		<AudioEditorDialogShell
			isOpen={isOpen}
			title={copy.deliveryQueue}
			onClose={onClose}
			width={640}
			className="audio-editor-delivery-queue-dialog"
			dataAttributes={{ 'data-delivery-queue-dialog': '' }}
			footer={(
				<DialogFooter
					className="audio-editor-dialog-footer"
					leftContent={(
						<Button
							variant="secondary"
							onClick={() => (queue.paused ? queueActions.resume() : queueActions.pause())}
						>
							{queue.paused ? copy.deliveryQueueResume : copy.deliveryQueuePause}
						</Button>
					)}
					rightContent={(
						<>
							<Button variant="secondary" onClick={onClose}>{copy.close}</Button>
							<Button
								variant="primary"
								disabled={!chosenTargets.length || !chosenPresets.length}
								onClick={queueBatch}
							>
								{copy.deliveryBatchQueue}
							</Button>
						</>
					)}
				/>
			)}
		>
			<section aria-label={copy.deliveryBatch}>
				<LabeledDropdown
					label={copy.exportMode}
					hook="delivery-batch-mode"
					value={mode}
					onChange={setMode}
					options={[{ value: 'mix', label: copy.mix }, { value: 'stems', label: copy.stems }]}
				/>
				<fieldset>
					<legend>{copy.deliveryBatchTargets}</legend>
					{targets.map((target) => {
						const excluded = mode === 'stems' && !target.stemmable;
						const reason = excluded ? target.stemsReason : target.reason;
						return (
							<div key={target.key} data-delivery-batch-target={target.key}>
								<DesignCheckbox
									label={target.label}
									checked={targetKeys.includes(target.key) && !excluded && target.available}
									disabled={excluded || !target.available}
									onChange={(checked) => toggle(setTargetKeys, target.key, checked)}
								/>
								{reason && <p className="audio-editor-panel-hint">{reason}</p>}
							</div>
						);
					})}
					{!chosenTargets.length && <p role="status">{copy.deliveryBatchNoTargets}</p>}
				</fieldset>
				<fieldset>
					<legend>{copy.deliveryBatchFormats}</legend>
					{presets.map((preset) => (
						<div key={preset.id} data-delivery-batch-preset={preset.id}>
							<DesignCheckbox
								label={preset.label}
								checked={presetIds.includes(preset.id)}
								onChange={(checked) => toggle(setPresetIds, preset.id, checked)}
							/>
						</div>
					))}
					{!presets.length && <p role="status">{copy.deliveryBatchNoFormats}</p>}
				</fieldset>
			</section>

			<section aria-label={copy.deliveryQueue}>
				{queue.entries.length === 0 && <p>{copy.deliveryQueueEmpty}</p>}
				<ul>
					{queue.entries.map((entry) => (
						<li key={entry.jobId} data-delivery-queue-job={entry.jobId}>
							<span>{entry.label}</span>
							<span data-delivery-queue-state={entry.state}>{copy[STATE_COPY_KEYS[entry.state]]}</span>
							{(entry.state === 'queued' || entry.state === 'running') && (
								<Button variant="secondary" onClick={() => queueActions.cancel(entry.jobId)}>
									{copy.deliveryQueueCancelJob}
								</Button>
							)}
							{entry.state === 'failed' && (
								<Button variant="secondary" onClick={() => queueActions.retry(entry.jobId)}>
									{copy.deliveryQueueRetryJob}
								</Button>
							)}
						</li>
					))}
				</ul>
				{report && <>
					<p role="status">{deliverySummary(copy, report)}</p>
					<Button variant="secondary" onClick={() => queueActions.retryBatchFailures(batchId)}>
						{copy.deliveryBatchRetryFailures}
					</Button>
				</>}
			</section>
			{error && <p className="audio-editor-field-error" role="alert">{error}</p>}
			{!error && status && <p role="status">{status}</p>}
		</AudioEditorDialogShell>
	);
}

function deliverySummary(copy, report) {
	const counts = summarizeDeliveryBatchReport(report);
	return copy.deliveryBatchSummary
		.replace('{delivered}', String(counts.delivered))
		.replace('{failed}', String(counts.failed))
		.replace('{cancelled}', String(counts.cancelled))
		.replace('{notStarted}', String(counts.notStarted));
}

export default DeliveryQueueDialog;
