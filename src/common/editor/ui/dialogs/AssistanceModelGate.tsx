/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { localModelManagerStoreFor } from '../local-model-manager-store.ts';
import type { LocalModelManagerBridge, LocalModelManagerModel } from '../local-model-manager-bridge.ts';
import { formatLocalModelBytes } from '../local-model-bytes.ts';
import { localModelDisplayName } from './local-model-display-name.ts';
import AssistanceLoadingDialog from './AssistanceLoadingDialog.tsx';

const LocalModelManagerDialog = lazyEditorModule(() => import('./LocalModelManagerDialog.tsx'));
const subscribeToNothing = (): (() => void) => () => undefined;
const emptySnapshot = () => null;

interface Props {
	readonly title: string;
	readonly copy: Readonly<Record<string, string | undefined>>;
	readonly locale: string;
	readonly bridge: LocalModelManagerBridge | null;
	readonly modelFilter: (model: LocalModelManagerModel) => boolean;
	readonly modelsReady?: (installedModels: readonly LocalModelManagerModel[]) => boolean;
	readonly requiresModel: boolean;
	readonly onClose: () => void;
	readonly children: ReactNode;
}

/** Admit a model-backed dialog before importing its processing and inference graph. */
export default function AssistanceModelGate({
	title, copy, locale, bridge, modelFilter, modelsReady, requiresModel, onClose, children,
}: Props) {
	const store = useMemo(() => bridge ? localModelManagerStoreFor(bridge) : null, [bridge]);
	const snapshot = useSyncExternalStore(store?.subscribe ?? subscribeToNothing,
		store?.getSnapshot ?? emptySnapshot, store?.getSnapshot ?? emptySnapshot);
	const [checked, setChecked] = useState(false);
	const [admitted, setAdmitted] = useState(false);
	const [managingModels, setManagingModels] = useState(false);
	const [downloading, setDownloading] = useState(false);
	const downloads = useRef<AbortController | null>(null);
	const ready = snapshot !== null && (modelsReady
		? modelsReady(snapshot.models.filter(model => model.availability === 'installed'))
		: snapshot.models.some(model => modelFilter(model) && model.availability === 'installed'));
	useEffect(() => {
		if (!store || !requiresModel || managingModels) return undefined;
		let active = true;
		setChecked(false);
		const disconnect = store.connect();
		void store.load().then(() => { if (active) setChecked(true); });
		return () => { active = false; disconnect(); };
	}, [store, requiresModel, managingModels]);
	useEffect(() => {
		if (checked && !downloading && !managingModels && snapshot?.phase === 'ready'
			&& !snapshot.error && ready) {
			setAdmitted(true);
		}
	}, [checked, downloading, managingModels, ready, snapshot]);
	useEffect(() => () => downloads.current?.abort(), []);
	const close = (): void => { downloads.current?.abort(); onClose(); };
	const loading = <AssistanceLoadingDialog title={title} copy={copy} onClose={close} />;
	if (admitted || !requiresModel || !store || !snapshot) return <Suspense fallback={loading}>{children}</Suspense>;
	if (managingModels) return <Suspense fallback={loading}>
		<LocalModelManagerDialog bridge={bridge} copy={copy} locale={locale} modelFilter={modelFilter}
			onClose={() => { setChecked(false); setManagingModels(false); }} />
	</Suspense>;
	if (!checked || snapshot.phase === 'loading' || snapshot.phase === 'idle') return loading;
	const models = snapshot.models.filter(modelFilter);
	if (!downloading && !snapshot.error && ready) {
		return <Suspense fallback={loading}>{children}</Suspense>;
	}
	const available = models.filter(({ availability }) => availability === 'installable');
	const downloadAll = async (): Promise<void> => {
		if (downloading) return;
		const controller = new AbortController();
		downloads.current = controller;
		setDownloading(true);
		try { await store.installAll(available.map(({ modelId }) => modelId), controller.signal); }
		finally {
			if (!controller.signal.aborted) setDownloading(false);
			if (downloads.current === controller) downloads.current = null;
		}
	};
	return <AudioEditorDialogShell title={title} onClose={close} width={640} initialFocus="dialog"
		dataAttributes={{ 'data-assistance-model-prerequisites': 'true' }}
		footer={<DialogFooter rightContent={<>
			<Button variant="secondary" onClick={close}>{copy.cancel || 'Cancel'}</Button>
			<Button variant="secondary" disabled={downloading} onClick={() => setManagingModels(true)}>
				{copy.assistanceOpenModelManager || 'Open Model Manager'}</Button>
			<Button variant="primary" disabled={downloading || available.length === 0}
				onClick={() => { void downloadAll(); }}>{copy.assistanceDownloadAll || 'Download all'}</Button>
		</>} />}>
		<div className="kw-assistance-model-prerequisites">
			<p>{(copy.assistanceModelRequired || '{effect} requires a model to be downloaded before it can be executed:')
				.replaceAll('{effect}', title)}</p>
			<ul>{available.map((model) => {
				const progress = snapshot.progress.find(({ modelId }) => modelId === model.modelId);
				const name = localModelDisplayName(model.modelId, copy);
				return <li key={model.modelId}>
					{name} · {formatLocalModelBytes(model.downloadBytes, locale) || copy.localModelsSizeUnavailable || 'Unavailable'}
					{progress && <div>
						<label htmlFor={`assistance-download-${model.modelId}`}>{progress.fileName}</label>
						<progress id={`assistance-download-${model.modelId}`} aria-label={name}
							value={progress.completedBytes} max={progress.totalBytes} />
					</div>}
				</li>;
			})}</ul>
			{available.length === 0 && !snapshot.error && <p role="status">
				{copy.assistanceNoDownloadableModels || 'No compatible models are available to download on this device.'}</p>}
			{downloading && <progress aria-label={copy.localModelsInstalling || 'Installing'} />}
			{snapshot.error && <div role="alert">
				<p>{snapshot.error.modelId ? copy.localModelsOperationError || 'The local-model operation failed.'
					: copy.localModelsLoadError || 'Local models could not be loaded.'}</p>
				<details><summary>{copy.assistanceTechnicalDetails || 'Technical details'}</summary>
					<p>{snapshot.error.message}</p></details>
				<Button variant="secondary" onClick={() => { void store.load(); }}>
					{copy.localModelsRetry || 'Retry'}</Button>
			</div>}
		</div>
	</AudioEditorDialogShell>;
}
