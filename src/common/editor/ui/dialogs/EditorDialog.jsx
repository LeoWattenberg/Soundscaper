import { useRef } from 'react';
import readmeMarkdown from '../../../../../README.md?raw';
import { Button } from '@soundscaper/design-system/Button';
import { NumberStepper } from '@soundscaper/design-system/NumberStepper';
import { TextInput } from '@soundscaper/design-system/TextInput';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import { runAwaitedAudioEditorOperation } from '../workspace/audio-editor-workspace-runner.ts';
import { formatDate } from '../workspace-runtime.js';
import {
	applyTrackRateDialog,
	aup4CompatibilityItems,
	compatibilityCount,
	formatAup4CompatibilityItem,
	formatAup4CompatibilityScope,
	formatAup4CompatibilitySummary,
	formatDeliveryReportItem,
	formatDeliveryReportItemDetail,
	formatDeliveryReportSubject,
	formatDeliveryReportSummary,
	deliveryReportItems,
	recordingOffsetSources,
	TRACK_RATE_DIALOG_MISSING_TRACK,
} from './editor-dialog-model.js';

export default function EditorDialog({ type, value, onValueChange, sourceKey = 'global', onSourceKeyChange, trackId, controller, snapshot, copy, aboutLabel, locale, run, showArmControls = false, onClose }) {
	const cancelTimedRecordingOnClose = useRef(false);
	const projectIdAtOpen = useRef(snapshot.project?.id ?? null);
	cancelTimedRecordingOnClose.current = type === 'timed-recording' && snapshot.recordingScheduling;
	const closeDialog = () => {
		if (cancelTimedRecordingOnClose.current) run(() => controller.actions.recording.cancelScheduled());
		onClose();
	};
	const runThenClose = (operation, shouldClose = () => true) => {
		void runAwaitedAudioEditorOperation(run, operation)
			.then((result) => { if (shouldClose(result)) onClose(); })
			.catch(() => undefined);
	};
	const title = {
		projects: copy.projectsTitle,
		rename: copy.renameProject,
		'track-rename': copy.trackName,
		'timed-recording': copy.timedRecording,
		'recording-offset': copy.recordingOffset,
		'track-rate': copy.sampleRate,
		resample: copy.resample,
		'aup4-compatibility': copy.aup4CompatibilityReport,
		'delivery-report': copy.deliveryReport,
		about: aboutLabel,
		'revert-factory': copy.revertFactorySettings,
		clear: copy.clearData,
	}[type] || copy.deleteTitle;
	const offsetSources = recordingOffsetSources(snapshot, copy);
	return (
		<AudioEditorDialogShell
			title={title}
			onClose={closeDialog}
			width={540}
			initialFocus={['rename', 'track-rename'].includes(type) ? 'input' : 'first'}
			bodyClassName="kw-audio-editor-dialog__body"
		>
					{type === 'projects' && (
						<>
							<p>{copy.projectsDescription}</p>
							<ul className="kw-audio-editor-project-list" data-project-list>
								{snapshot.projects?.map((project) => (
									<li key={project.id}>
										<Button variant="secondary" onClick={() => runThenClose(() => controller.actions.project.openById(project.id))}>
											<span>{project.title}</span>
											<small>{copy.lastEdited}: {formatDate(project.updatedAt, locale)}</small>
										</Button>
									</li>
								))}
							</ul>
							{!snapshot.projects?.length && <p data-project-list-empty>{copy.noProjects}</p>}
						</>
					)}
					{type === 'rename' && (
						<form onSubmit={(event) => {
							event.preventDefault();
							if (!value.trim()) return;
							runThenClose(() => controller.actions.project.rename(value));
						}}>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.projectName}</span>
								<span data-project-name-input>
									<TextInput value={value} onChange={onValueChange} width="100%" />
								</span>
							</label>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button type="submit" disabled={!value.trim()}>{copy.saveName}</Button>
							</div>
						</form>
					)}
					{type === 'track-rename' && (
						<form onSubmit={(event) => {
							event.preventDefault();
							if (!value.trim() || !snapshot.selectedTrackId) return;
							runThenClose(() => controller.actions.track.update(snapshot.selectedTrackId, { name: value.trim() }));
						}}>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.trackName}</span>
								<TextInput value={value} onChange={onValueChange} width="100%" />
							</label>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button type="submit" disabled={!value.trim()}>{copy.saveName}</Button>
							</div>
						</form>
					)}
					{type === 'timed-recording' && (
						<form data-timed-recording-dialog onSubmit={(event) => {
							event.preventDefault();
							const startTimeMs = new Date(value).getTime();
							if (!Number.isFinite(startTimeMs) || startTimeMs <= Date.now()) return;
							const trackId = showArmControls
								? undefined
								: (() => {
									const selectedTrack = snapshot.project?.tracks.find((track) => track.id === snapshot.selectedTrackId);
									if (selectedTrack?.type === 'audio') return selectedTrack.id;
									if (selectedTrack?.type === 'video' && selectedTrack.laneGroupId) {
										const pairedTrack = snapshot.project?.tracks.find((track) => (
											track.type === 'audio' && track.laneGroupId === selectedTrack.laneGroupId
										));
										if (pairedTrack) return pairedTrack.id;
									}
									return snapshot.project?.tracks.find((track) => track.type === 'audio')?.id;
								})();
							runThenClose(
								() => controller.actions.recording.schedule(startTimeMs, { trackId }),
								(scheduled) => Boolean(scheduled),
							);
						}}>
							<p>{copy.timedRecordingDescription}</p>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.timedRecordingStartTime}</span>
								<input
									type="datetime-local"
									step="1"
									value={value}
									onChange={(event) => onValueChange(event.currentTarget.value)}
								/>
							</label>
							{snapshot.scheduledRecording && <p>{copy.timedRecordingCurrent.replace(
								'{time}',
								new Date(snapshot.scheduledRecording.startTimeMs).toLocaleString(locale),
							)}</p>}
							<div className="kw-audio-editor-dialog__actions">
								{snapshot.scheduledRecording && <Button variant="secondary" onClick={() => {
									runThenClose(() => controller.actions.recording.cancelScheduled());
								}}>{copy.timedRecordingCancel}</Button>}
								<Button variant="secondary" onClick={closeDialog}>{copy.cancel}</Button>
								<Button type="submit" disabled={Boolean(snapshot.scheduledRecording) || !Number.isFinite(new Date(value).getTime()) || new Date(value).getTime() <= Date.now()}>
									{copy.timedRecordingSchedule}
								</Button>
							</div>
						</form>
					)}
					{type === 'recording-offset' && (
						<form onSubmit={(event) => {
							event.preventDefault();
							runThenClose(() => sourceKey === 'global'
								? controller.actions.recording.setLatencyOffset(value)
								: controller.actions.recording.setSourceOffset(sourceKey, value));
						}}>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.recordingOffsetSource}</span>
								<select value={sourceKey} onChange={(event) => {
									const nextSourceKey = event.currentTarget.value;
									onSourceKeyChange?.(nextSourceKey);
									onValueChange(String(nextSourceKey === 'global'
										? snapshot.monitor?.latencyOffsetMs ?? 0
										: snapshot.recordingInputs?.offsets?.[nextSourceKey] ?? 0));
								}}>
									{offsetSources.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
								</select>
							</label>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.latencyOffset}</span>
								<AudioEditorTimeCodeInput label={copy.latencyOffset}
									value={Number(value)} unit="milliseconds" minimum={-500} maximum={500}
									onChange={(next) => onValueChange(String(next))} />
							</label>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button type="submit">{copy.save}</Button>
							</div>
						</form>
					)}
					{type === 'resample' && (
						<form onSubmit={(event) => {
							event.preventDefault();
							const trackId = snapshot.selectedTrackId;
							if (!trackId) return;
							runThenClose(() => controller.actions.track.resample(trackId, Number(value)));
						}}>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.sampleRate} (Hz)</span>
								<NumberStepper value={String(value)} min={8_000} max={384_000} step={1_000} width="100%" onChange={onValueChange} />
							</label>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button type="submit">{copy.resample}</Button>
							</div>
						</form>
					)}
					{type === 'track-rate' && (
						<form onSubmit={(event) => {
							event.preventDefault();
							runThenClose(
								() => applyTrackRateDialog({ trackId, value,
									run: (operation) => operation(),
									setRate: controller.actions.track.setRate,
								}),
								(result) => result !== TRACK_RATE_DIALOG_MISSING_TRACK,
							);
						}}>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.sampleRate} (Hz)</span>
								<NumberStepper value={String(value)} min={8_000} max={384_000} step={1_000} width="100%" onChange={onValueChange} />
							</label>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button type="submit">{copy.save}</Button>
							</div>
						</form>
					)}
					{type === 'about' && (
						<>
							<pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit' }}>{readmeMarkdown}</pre>
							<div className="kw-audio-editor-dialog__actions"><Button onClick={onClose}>{copy.close}</Button></div>
						</>
					)}
					{type === 'aup4-compatibility' && (
						<Aup4CompatibilityReport
							report={snapshot.aup4Compatibility?.report}
							copy={copy}
							onClose={onClose}
						/>
					)}
					{type === 'delivery-report' && (
						<DeliveryReport
							report={snapshot.deliveryReport}
							copy={copy}
							controller={controller}
							run={run}
							onClose={onClose}
						/>
					)}
					{type === 'revert-factory' && (
						<>
							<p>{copy.revertFactorySettingsDescription}</p>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button onClick={() => {
									runThenClose(() => controller.actions.preferences.revertFactorySettings());
								}}>{copy.confirmRevertFactorySettings}</Button>
							</div>
						</>
					)}
					{(type === 'delete' || type === 'clear') && (
						<>
							<p>{type === 'delete' ? copy.deleteDescription : copy.clearData}</p>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button onClick={() => {
									if (type === 'delete' && snapshot.project?.id !== projectIdAtOpen.current) {
										onClose();
										return;
									}
									runThenClose(() => type === 'delete'
										? controller.actions.project.remove(projectIdAtOpen.current)
										: controller.actions.project.clear());
								}}>{type === 'delete' ? copy.confirmDelete : copy.clearData}</Button>
							</div>
						</>
					)}
		</AudioEditorDialogShell>
	);
}

function Aup4CompatibilityReport({ report, copy, onClose }) {
	const visibleItems = aup4CompatibilityItems(report);
	const counts = report?.counts || {};
	const visibleCount = (disposition) => visibleItems.filter((item) => item?.disposition === disposition).length;
	const displayCount = (disposition) => Math.max(compatibilityCount(counts[disposition]), visibleCount(disposition));
	return (
		<div data-aup4-compatibility-report>
			<p>{copy.aup4CompatibilityDescription}</p>
			<p>{formatAup4CompatibilitySummary(report, copy)}</p>
			<dl className="kw-audio-editor-compatibility-counts">
				<div><dt>{copy.aup4CompatibilityPreserved}</dt><dd>{displayCount('preserved')}</dd></div>
				<div><dt>{copy.aup4CompatibilityConverted}</dt><dd>{displayCount('converted')}</dd></div>
				<div><dt>{copy.aup4CompatibilityMissing}</dt><dd>{displayCount('missing')}</dd></div>
				<div><dt>{copy.aup4CompatibilityOmitted}</dt><dd>{displayCount('omitted')}</dd></div>
			</dl>
			<h3>{copy.aup4CompatibilityDetails}</h3>
			{visibleItems.length ? (
				<ul className="kw-audio-editor-compatibility-items">
					{visibleItems.map((item, index) => (
						<li key={`${item?.code || 'AUP4'}-${index}`} data-severity={item?.severity || 'info'}>
							<strong>{formatAup4CompatibilityItem(item, copy)}</strong>
							{item?.scope && <small>{formatAup4CompatibilityScope(item.scope)}</small>}
						</li>
					))}
				</ul>
			) : <p>{copy.aup4CompatibilityNoIssues}</p>}
			<div className="kw-audio-editor-dialog__actions">
				<Button onClick={onClose}>{copy.close}</Button>
			</div>
		</div>
	);
}

function DeliveryReport({ report, copy, controller, run, onClose }) {
	const items = deliveryReportItems(report);
	const counts = report?.counts || {};
	const displayCount = (disposition) => compatibilityCount(counts[disposition], items, disposition);
	const converting = items.filter(
		(item) => item?.disposition === 'converted' || item?.disposition === 'omitted',
	);
	return (
		<div data-delivery-report>
			<p>{copy.deliveryReportDescription}</p>
			<p>{formatDeliveryReportSubject(report, copy)}</p>
			<p>{formatDeliveryReportSummary(report, copy)}</p>
			<dl className="kw-audio-editor-compatibility-counts">
				<div><dt>{copy.aup4CompatibilityPreserved}</dt><dd>{displayCount('preserved')}</dd></div>
				<div><dt>{copy.aup4CompatibilityConverted}</dt><dd>{displayCount('converted')}</dd></div>
				<div><dt>{copy.aup4CompatibilityMissing}</dt><dd>{displayCount('missing')}</dd></div>
				<div><dt>{copy.aup4CompatibilityOmitted}</dt><dd>{displayCount('omitted')}</dd></div>
			</dl>
			<h3>{copy.aup4CompatibilityDetails}</h3>
			{items.length ? (
				<ul className="kw-audio-editor-compatibility-items">
					{items.map((item, index) => (
						<li key={`${item?.code || 'delivery'}-${index}`} data-severity={item?.severity || 'info'}>
							<strong>{formatDeliveryReportItem(item)}</strong>
							{formatDeliveryReportItemDetail(item) && (
								<small>{formatDeliveryReportItemDetail(item)}</small>
							)}
						</li>
					))}
				</ul>
			) : <p>{copy.deliveryReportNoConversions}</p>}
			{items.length > 0 && converting.length === 0 && <p>{copy.deliveryReportNoConversions}</p>}
			<div className="kw-audio-editor-dialog__actions">
				<Button
					variant="secondary"
					onClick={() => run(() => controller.actions.export.saveReport())}
				>
					{copy.deliveryReportSave}
				</Button>
				<Button onClick={onClose}>{copy.close}</Button>
			</div>
		</div>
	);
}
