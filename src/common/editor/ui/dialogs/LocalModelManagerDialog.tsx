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
	readonly onRemove: (modelId: string) => unknown;
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
		onRemove={(modelId) => store?.remove(modelId)}
		onRetry={() => store?.load()}
	/>;
}

export function LocalModelManagerDialogView({
	copy, locale, snapshot, onClose, onInstall, onRemove, onRetry,
}: LocalModelManagerDialogViewProps) {
	const progress = new Map(snapshot.progress.map((entry) => [entry.modelId, entry]));
	const busy = new Set(snapshot.busyModelIds);
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
				progress={progress.get(model.modelId) ?? null}
				onInstall={onInstall}
				onRemove={onRemove}
			/>)}
		</ul>}
	</AudioEditorDialogShell>;
}

function ModelRow({
	model, copy, locale, busy, progress, onInstall, onRemove,
}: Readonly<{
	model: LocalModelManagerModel;
	copy: Copy;
	locale: string;
	busy: boolean;
	progress: LocalModelManagerSnapshot['progress'][number] | null;
	onInstall: (modelId: string) => unknown;
	onRemove: (modelId: string) => unknown;
}>) {
	const installed = model.availability === 'installed';
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
			<button type="button" disabled={busy} onClick={() => {
				void (installed ? onRemove(model.modelId) : onInstall(model.modelId));
			}}>{busy
				? installed
					? text(copy, 'localModelsRemoving', 'Removing…')
					: text(copy, 'localModelsInstalling', 'Installing…')
				: installed
					? text(copy, 'localModelsRemove', 'Remove')
					: text(copy, 'localModelsInstall', 'Install')}</button>
		</div>}
	</li>;
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
