/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import {
	localModelManagerStoreFor,
	type LocalModelManagerSnapshot,
} from '../local-model-manager-store.ts';
import type {
	LocalModelAvailability,
	LocalModelManagerBridge,
	LocalModelManagerModel,
} from '../local-model-manager-bridge.ts';
import './LocalModelManagerDialog.css';

type Copy = Readonly<Record<string, string | undefined>>;

export interface LocalModelManagerDialogProps {
	readonly bridge: LocalModelManagerBridge | null;
	readonly copy: Copy;
	readonly locale: string;
	readonly onClose: () => void;
}

export interface LocalModelManagerDialogViewProps {
	readonly copy: Copy;
	readonly locale: string;
	readonly snapshot: LocalModelManagerSnapshot;
	readonly onClose: () => void;
	readonly onInstall: (modelId: string) => unknown;
	readonly onInstallPreseeded: (modelId: string) => unknown;
	readonly onCancelInstall: (modelId: string) => unknown;
	readonly onRemove: (modelId: string) => unknown;
	readonly onReconcile: () => unknown;
	readonly onGarbageCollect: () => unknown;
	readonly onShowNotices: () => unknown;
	readonly onRelocate: () => unknown;
	readonly onRetry: () => unknown;
}

const subscribeToNothing = (): (() => void) => () => undefined;

export default function LocalModelManagerDialog({
	bridge, copy, locale, onClose,
}: LocalModelManagerDialogProps) {
	const store = useMemo(() => bridge ? localModelManagerStoreFor(bridge) : null, [bridge]);
	const unavailable = useMemo<LocalModelManagerSnapshot>(() => Object.freeze({
		phase: 'error', runtimeAvailable: null, runtimeReason: null,
		models: Object.freeze([]), busyModelIds: Object.freeze([]), progress: Object.freeze([]),
		installingModelIds: Object.freeze([]), cancellingModelIds: Object.freeze([]),
		maintenanceOperation: null, lastResult: null, notices: Object.freeze([]), noticesLoaded: false,
		error: Object.freeze({ modelId: null, message: text(copy, 'localModelsUnavailable',
			'Local-model management is unavailable in this desktop build.') }),
	}), [copy]);
	const snapshot = useSyncExternalStore(
		store?.subscribe ?? subscribeToNothing,
		store?.getSnapshot ?? (() => unavailable),
		store?.getSnapshot ?? (() => unavailable),
	);

	useEffect(() => {
		if (!store) return undefined;
		const disconnect = store.connect();
		void store.load();
		return disconnect;
	}, [store]);

	return <LocalModelManagerDialogView
		copy={copy}
		locale={locale}
		snapshot={snapshot}
		onClose={onClose}
		onInstall={(modelId) => store?.install(modelId)}
		onInstallPreseeded={(modelId) => store?.installPreseeded(modelId)}
		onCancelInstall={(modelId) => store?.cancelInstall(modelId)}
		onRemove={(modelId) => store?.remove(modelId)}
		onReconcile={() => store?.reconcile()}
		onGarbageCollect={() => store?.garbageCollect()}
		onShowNotices={() => store?.showNotices()}
		onRelocate={() => store?.relocate()}
		onRetry={() => store?.load()}
	/>;
}

export function LocalModelManagerDialogView({
	copy, locale, snapshot, onClose, onInstall, onInstallPreseeded, onCancelInstall,
	onRemove, onReconcile, onGarbageCollect, onShowNotices, onRelocate, onRetry,
}: LocalModelManagerDialogViewProps) {
	const progress = new Map(snapshot.progress.map((entry) => [entry.modelId, entry]));
	const busy = new Set(snapshot.busyModelIds);
	const installing = new Set(snapshot.installingModelIds);
	const cancelling = new Set(snapshot.cancellingModelIds);
	const globallyBusy = busy.size > 0 || snapshot.maintenanceOperation !== null;
	const runtimeSummary = snapshot.runtimeAvailable === true
		? text(copy, 'localModelsRuntimeReady', 'The local inference runtime is available.')
		: snapshot.runtimeAvailable === false
			? snapshot.runtimeReason || text(copy, 'localModelsRuntimeUnavailable',
				'The local inference runtime is unavailable.')
			: null;
	return <AudioEditorDialogShell
		title={text(copy, 'localModels', 'Local Models')}
		onClose={onClose}
		width={760}
		initialFocus="dialog"
		dataAttributes={{ 'data-local-model-manager': 'true' }}
		footer={<div className="kw-audio-editor-dialog__actions">
			<button type="button" onClick={onClose}>{text(copy, 'close', 'Close')}</button>
		</div>}
	>
		<p>{text(copy, 'localModelsDescription',
			'Optional models download only when you explicitly request them and run locally on this device.')}</p>
		{runtimeSummary && <section className="kw-local-model-manager__runtime" aria-label={text(
			copy, 'localModelsRuntime', 'Local inference runtime',
		)}>
			<p role="status" aria-live="polite">{runtimeSummary}</p>
		</section>}
		<MaintenanceControls
			copy={copy}
			busy={globallyBusy}
			operation={snapshot.maintenanceOperation}
			onReconcile={onReconcile}
			onGarbageCollect={onGarbageCollect}
			onShowNotices={onShowNotices}
			onRelocate={onRelocate}
		/>
		{snapshot.lastResult && <OperationResult copy={copy} locale={locale} result={snapshot.lastResult} />}
		{snapshot.noticesLoaded && <InstalledNotices copy={copy} notices={snapshot.notices} />}
		{(snapshot.phase === 'idle' || snapshot.phase === 'loading') && <p
			className="kw-local-model-manager__message"
			role="status"
			aria-live="polite"
		>{text(copy, 'localModelsLoading', 'Loading local models…')}</p>}
		{snapshot.error && <div className="kw-local-model-manager__error" role="alert">
			<strong>{snapshot.error.modelId
				? text(copy, 'localModelsOperationError', 'The local-model operation failed.')
				: text(copy, 'localModelsLoadError', 'Local models could not be loaded.')}</strong>
			<p>{snapshot.error.message}</p>
			<button type="button" onClick={() => { void onRetry(); }}>
				{text(copy, 'localModelsRetry', 'Retry')}
			</button>
		</div>}
		{snapshot.models.length > 0 && <ul
			className="kw-local-model-manager__list"
			aria-label={text(copy, 'localModelsList', 'Available local models')}
		>
			{snapshot.models.map((model) => <ModelRow
				key={model.modelId}
				model={model}
				copy={copy}
				locale={locale}
				busy={busy.has(model.modelId)}
				installing={installing.has(model.modelId)}
				cancelling={cancelling.has(model.modelId)}
				maintenanceBusy={snapshot.maintenanceOperation !== null}
				progress={progress.get(model.modelId) ?? null}
				onInstall={onInstall}
				onInstallPreseeded={onInstallPreseeded}
				onCancelInstall={onCancelInstall}
				onRemove={onRemove}
			/>)}
		</ul>}
	</AudioEditorDialogShell>;
}

function ModelRow({
	model, copy, locale, busy, installing, cancelling, maintenanceBusy, progress,
	onInstall, onInstallPreseeded, onCancelInstall, onRemove,
}: Readonly<{
	model: LocalModelManagerModel;
	copy: Copy;
	locale: string;
	busy: boolean;
	installing: boolean;
	cancelling: boolean;
	maintenanceBusy: boolean;
	progress: LocalModelManagerSnapshot['progress'][number] | null;
	onInstall: (modelId: string) => unknown;
	onInstallPreseeded: (modelId: string) => unknown;
	onCancelInstall: (modelId: string) => unknown;
	onRemove: (modelId: string) => unknown;
}>) {
	const installed = model.installedBytes !== null;
	const actionAvailable = installed || model.availability === 'installable';
	const size = installed ? model.installedBytes : model.downloadBytes;
	const sizeLabel = installed
		? text(copy, 'localModelsInstalledSize', 'Installed size')
		: text(copy, 'localModelsDownloadSize', 'Download size');
	return <li aria-busy={busy} data-local-model-id={model.modelId}
		data-local-model-availability={model.availability}>
		<div className="kw-local-model-manager__identity">
			<strong>{model.modelId}</strong>
			<span>{humanizeTask(model.task)} · {model.version}</span>
		</div>
		<dl>
			<div><dt>{text(copy, 'localModelsAvailability', 'Availability')}</dt>
				<dd>{availabilityLabel(copy, model.availability)}</dd></div>
			<div><dt>{sizeLabel}</dt><dd>{formatBytes(size, locale,
				text(copy, 'localModelsSizeUnavailable', 'Unavailable'))}</dd></div>
		</dl>
		{progress && <div className="kw-local-model-manager__progress">
			<label htmlFor={`local-model-progress-${model.modelId}`}>{template(
				text(copy, 'localModelsProgress', '{fileName}: {completed} of {total}'),
				{
					fileName: progress.fileName,
					completed: formatBytes(progress.completedBytes, locale, '0 B'),
					total: formatBytes(progress.totalBytes, locale, '0 B'),
				},
			)}</label>
			<progress id={`local-model-progress-${model.modelId}`}
				value={progress.completedBytes} max={progress.totalBytes} />
		</div>}
		{actionAvailable && <div className="kw-local-model-manager__actions">
			{installed && <button type="button" disabled={busy || maintenanceBusy} onClick={() => {
				void onRemove(model.modelId);
			}}>{busy
				? text(copy, 'localModelsRemoving', 'Removing…')
				: text(copy, 'localModelsRemove', 'Remove')}</button>}
			{!installed && !installing && <>
				<button type="button" disabled={busy || maintenanceBusy} onClick={() => { void onInstall(model.modelId); }}>
					{text(copy, 'localModelsInstall', 'Install')}
				</button>
				<button type="button" disabled={busy || maintenanceBusy} onClick={() => { void onInstallPreseeded(model.modelId); }}>
					{text(copy, 'localModelsInstallFromFolder', 'Install from folder…')}
				</button>
			</>}
			{!installed && installing && <>
				<button type="button" disabled>{text(copy, 'localModelsInstalling', 'Installing…')}</button>
				<button type="button" disabled={cancelling} onClick={() => { void onCancelInstall(model.modelId); }}>
					{cancelling
						? text(copy, 'localModelsCancelling', 'Cancelling…')
						: text(copy, 'localModelsCancelInstall', 'Cancel install')}
				</button>
			</>}
		</div>}
	</li>;
}

function MaintenanceControls({
	copy, busy, operation, onReconcile, onGarbageCollect, onShowNotices, onRelocate,
}: Readonly<{
	copy: Copy;
	busy: boolean;
	operation: LocalModelManagerSnapshot['maintenanceOperation'];
	onReconcile: () => unknown;
	onGarbageCollect: () => unknown;
	onShowNotices: () => unknown;
	onRelocate: () => unknown;
}>) {
	return <section className="kw-local-model-manager__maintenance" aria-labelledby="local-model-maintenance-title">
		<h3 id="local-model-maintenance-title">{text(copy, 'localModelsMaintenance', 'Storage and verification')}</h3>
		<div className="kw-local-model-manager__maintenance-actions">
			<button type="button" disabled={busy} onClick={() => { void onReconcile(); }}>
				{text(copy, 'localModelsReconcile', 'Reconcile pre-seeded files')}
			</button>
			<button type="button" disabled={busy} onClick={() => { void onGarbageCollect(); }}>
				{text(copy, 'localModelsGarbageCollect', 'Collect unused files')}
			</button>
			<button type="button" disabled={busy} onClick={() => { void onRelocate(); }}>
				{text(copy, 'localModelsRelocate', 'Relocate model storage…')}
			</button>
			<button type="button" disabled={busy} onClick={() => { void onShowNotices(); }}>
				{text(copy, 'localModelsShowNotices', 'Show installed notices')}
			</button>
		</div>
		{operation && <p role="status" aria-live="polite">{maintenanceOperationLabel(copy, operation)}</p>}
	</section>;
}

function OperationResult({ copy, locale, result }: Readonly<{
	copy: Copy;
	locale: string;
	result: NonNullable<LocalModelManagerSnapshot['lastResult']>;
}>) {
	let message: string;
	if (result.kind === 'reconcile') {
		message = template(text(copy, 'localModelsReconcileResult',
			'Reconciled {installed}; {incomplete} incomplete; {rejected} rejected.'), {
			installed: String(result.value.installedModelIds.length),
			incomplete: String(result.value.incompleteModelIds.length),
			rejected: String(result.value.rejected.length),
		});
	} else if (result.kind === 'garbage-collect') {
		message = template(text(copy, 'localModelsGarbageCollectResult',
			'Reclaimed {bytes}; removed {partials} incomplete files and {manifests} invalid records.'), {
			bytes: formatBytes(result.value.reclaimedBytes, locale, '0 B'),
			partials: String(result.value.discardedPartialCount),
			manifests: String(result.value.discardedManifestCount),
		});
	} else {
		message = template(text(copy, 'localModelsRelocateResult',
			'Relocated {files} files ({bytes}). The previous store was {sourceState}.'), {
			files: String(result.value.fileCount),
			bytes: formatBytes(result.value.totalBytes, locale, '0 B'),
			sourceState: result.value.sourceRemoved
				? text(copy, 'localModelsRelocateSourceRemoved', 'removed')
				: text(copy, 'localModelsRelocateSourceRetained', 'retained as a verified copy'),
		});
	}
	return <p className="kw-local-model-manager__result" role="status" aria-live="polite">{message}</p>;
}

function InstalledNotices({ copy, notices }: Readonly<{
	copy: Copy;
	notices: LocalModelManagerSnapshot['notices'];
}>) {
	return <section className="kw-local-model-manager__notices" aria-labelledby="local-model-notices-title">
		<h3 id="local-model-notices-title">{text(copy, 'localModelsNotices', 'Installed model notices')}</h3>
		{notices.length === 0
			? <p>{text(copy, 'localModelsNoNotices', 'No authenticated installed-model notices are available.')}</p>
			: <ul>{notices.map((notice) => <li key={notice.modelId}>
				<strong>{notice.modelId} {notice.version}</strong>
				<p>{notice.purpose}</p>
				<dl>
					<div><dt>{text(copy, 'localModelsCodeLicense', 'Code license')}</dt><dd>{notice.codeLicense}</dd></div>
					<div><dt>{text(copy, 'localModelsWeightsLicense', 'Weights license')}</dt><dd>{notice.weightsLicense}</dd></div>
					<div><dt>{text(copy, 'localModelsRevision', 'Upstream revision')}</dt><dd>{notice.upstreamRevision}</dd></div>
				</dl>
				<ul aria-label={text(copy, 'localModelsSources', 'Provenance sources')}>
					{notice.provenanceSources.map((source) => <li key={source}><a href={source} target="_blank" rel="noreferrer">{source}</a></li>)}
				</ul>
			</li>)}</ul>}
	</section>;
}

function maintenanceOperationLabel(
	copy: Copy,
	operation: NonNullable<LocalModelManagerSnapshot['maintenanceOperation']>,
): string {
	const labels = {
		reconcile: text(copy, 'localModelsReconciling', 'Reconciling pre-seeded files…'),
		'garbage-collect': text(copy, 'localModelsGarbageCollecting', 'Collecting unused files…'),
		notices: text(copy, 'localModelsLoadingNotices', 'Loading installed notices…'),
		relocate: text(copy, 'localModelsRelocating', 'Relocating model storage…'),
	};
	return labels[operation];
}

function availabilityLabel(copy: Copy, availability: LocalModelAvailability): string {
	const labels: Record<LocalModelAvailability, string> = {
		installed: text(copy, 'localModelsInstalled', 'Installed'),
		installable: text(copy, 'localModelsInstallable', 'Installable'),
		'unsupported-platform': text(copy, 'localModelsUnsupportedPlatform',
			'Unsupported on this platform'),
		'insufficient-memory': text(copy, 'localModelsInsufficientMemory', 'Insufficient memory'),
	};
	return labels[availability];
}

export function formatLocalModelBytes(value: number | null, locale = 'en'): string | null {
	if (value === null) return null;
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	let amount = value;
	let unitIndex = 0;
	while (amount >= 1024 && unitIndex < units.length - 1) {
		amount /= 1024;
		unitIndex += 1;
	}
	const maximumFractionDigits = unitIndex === 0 ? 0 : 1;
	return `${new Intl.NumberFormat(locale, { maximumFractionDigits }).format(amount)} ${units[unitIndex]}`;
}

function formatBytes(value: number | null, locale: string, unavailable: string): string {
	return formatLocalModelBytes(value, locale) ?? unavailable;
}

function humanizeTask(value: string): string {
	return value.replaceAll('-', ' ').replace(/^./u, (first) => first.toLocaleUpperCase());
}

function text(copy: Copy, key: string, fallback: string): string {
	return copy[key] || fallback;
}

function template(value: string, variables: Readonly<Record<string, string>>): string {
	return Object.entries(variables).reduce(
		(result, [key, replacement]) => result.replaceAll(`{${key}}`, replacement),
		value,
	);
}
