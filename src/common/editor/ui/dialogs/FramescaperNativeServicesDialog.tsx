/* SPDX-License-Identifier: AGPL-3.0-only */

import React, {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useState,
	useSyncExternalStore,
} from 'react';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import FramescaperNativeProjectActionPanel from './FramescaperNativeProjectActionPanel.tsx';
import FramescaperOpenFxAddPanel from './FramescaperOpenFxAddPanel.tsx';
import FramescaperOpenFxManagePanel from './FramescaperOpenFxManagePanel.tsx';
import FramescaperOpenFxInteractPanel from './FramescaperOpenFxInteractPanel.tsx';
import type {
	FramescaperNativeOpenFxAuthoringRuntimeV28,
} from '../../../../framescaper/editor-native-openfx-action-v28.ts';
import {
	DEFAULT_FRAMESCAPER_NATIVE_SERVICE_PREFERENCES,
	framescaperNativeServicesStoreFor,
	type FramescaperNativeQueueProjection,
	type FramescaperNativeServicePreference,
	type FramescaperNativeServicesBridge,
	type FramescaperNativeServicesRendererSnapshot,
} from '../framescaper-native-services-bridge.ts';
import {
	availableFramescaperNativeServicesLifecycleMethods,
	type FramescaperNativeServicesLifecycleMethod,
} from '../framescaper-native-services-lifecycle-bridge.ts';
import {
	EMPTY_FRAMESCAPER_NATIVE_SERVICES_DIALOG_STATE,
	framescaperNativeQueueUiActions,
	reduceFramescaperNativeServicesDialog,
	runFramescaperNativeServicesAction,
	type FramescaperNativeQueueUiAction,
	type FramescaperNativeServicesDialogAction,
} from '../framescaper-native-services-dialog-model.ts';
import {
	resolveFramescaperNativeServicesCopy,
	type FramescaperNativeServicesCopy,
} from '../framescaper-native-services-copy.ts';
import {
	hasFramescaperNativeCarrierRegeneration,
	isFramescaperNativeProjectActionSurface,
	type FramescaperNativeProjectActionRuntime,
} from '../framescaper-native-project-actions.ts';
import type { FramescaperNativeServiceSurface } from '../framescaper-native-services-menu.ts';

export interface FramescaperNativeServicesDialogProps {
	readonly bridge: FramescaperNativeServicesBridge;
	readonly initialSurface: FramescaperNativeServiceSurface;
	readonly initialSnapshot?: FramescaperNativeServicesRendererSnapshot | null;
	readonly copy?: Readonly<Record<string, string | undefined>>;
	readonly context?: FramescaperNativeServicesDialogContext;
	readonly projectActions?: FramescaperNativeProjectActionRuntime | null;
	readonly openFxAuthoring?: FramescaperNativeOpenFxAuthoringRuntimeV28 | null;
	readonly onClose: () => void;
}

export interface FramescaperNativeServicesDialogContext {
	readonly projectId: string | null;
	readonly binId: string | null;
	readonly allowProxyGeneration: boolean;
}

export default function FramescaperNativeServicesDialog({
	bridge,
	initialSurface,
	initialSnapshot = null,
	copy: hostCopy,
	context = Object.freeze({ projectId: null, binId: null, allowProxyGeneration: false }),
	projectActions = null,
	openFxAuthoring = null,
	onClose,
}: FramescaperNativeServicesDialogProps) {
	const copy = useMemo(() => resolveFramescaperNativeServicesCopy(hostCopy), [hostCopy]);
	const store = useMemo(() => framescaperNativeServicesStoreFor(bridge), [bridge]);
	const lifecycleMethods = useMemo(
		() => availableFramescaperNativeServicesLifecycleMethods(bridge),
		[bridge],
	);
	const externalSnapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const [state, dispatch] = useReducer(reduceFramescaperNativeServicesDialog, {
		...EMPTY_FRAMESCAPER_NATIVE_SERVICES_DIALOG_STATE,
		snapshot: initialSnapshot,
	});
	const snapshot = externalSnapshot ?? state.snapshot ?? pendingSnapshot();
	const perform = useCallback((action: FramescaperNativeServicesDialogAction): void => {
		dispatch({ type: 'begin', action });
		void runFramescaperNativeServicesAction(store, action, projectActions).then(dispatch);
	}, [projectActions, store]);
	useEffect(() => { perform({ type: 'refresh' }); }, [perform]);
	const busy = state.pending !== null;

	return <AudioEditorDialogShell
		title={surfaceTitle(copy, initialSurface)}
		onClose={onClose}
		width={760}
		initialFocus="first"
		dataAttributes={{ 'data-framescaper-native-services-dialog': 'true' }}
	>
		<div className="audio-editor-framescaper-native-services">
			<p role="status" aria-live="polite" aria-busy={busy ? 'true' : undefined}>
				{state.error || (busy ? copy.working : state.completed === null ? '' : copy.operationComplete)}
			</p>
			<p>
				<button
					type="button"
					disabled={busy}
					data-framescaper-native-refresh="true"
					onClick={() => perform({ type: 'refresh' })}
				>{copy.refresh}</button>
			</p>
			<RuntimeNotice copy={copy} snapshot={snapshot} />
			<SurfacePanel
				bridge={bridge}
				surface={initialSurface}
				copy={copy}
				snapshot={snapshot}
				busy={busy}
				perform={perform}
				context={context}
				lifecycleMethods={lifecycleMethods}
				projectActions={projectActions}
				openFxAuthoring={openFxAuthoring}
			/>
		</div>
	</AudioEditorDialogShell>;
}

function SurfacePanel({
	bridge, surface, copy, snapshot, busy, perform, context, lifecycleMethods, projectActions,
	openFxAuthoring,
}: Readonly<{
	bridge: FramescaperNativeServicesBridge;
	surface: FramescaperNativeServiceSurface;
	copy: FramescaperNativeServicesCopy;
	snapshot: FramescaperNativeServicesRendererSnapshot;
	busy: boolean;
	perform: (action: FramescaperNativeServicesDialogAction) => void;
	context: FramescaperNativeServicesDialogContext;
	lifecycleMethods: readonly FramescaperNativeServicesLifecycleMethod[];
	projectActions: FramescaperNativeProjectActionRuntime | null;
	openFxAuthoring: FramescaperNativeOpenFxAuthoringRuntimeV28 | null;
}>) {
	if (surface === 'background-jobs') {
		return <QueuePanel copy={copy} snapshot={snapshot} busy={busy} perform={perform}
			projectActions={projectActions} />;
	}
	if (surface === 'watch-folders') {
		return <WatchPanel {...{ copy, snapshot, busy, perform, context, lifecycleMethods }} />;
	}
	if (surface === 'native-media-preferences') {
		return <PreferencesPanel {...{ copy, snapshot, busy, perform, lifecycleMethods }} />;
	}
	if (surface === 'ofx-manage') {
		return <>
			<FramescaperOpenFxManagePanel {...{ bridge, copy, snapshot, busy }} setConsent={(enabled) => perform({
				type: 'set-preference', preference: 'ofx-consent', enabled,
			})} />
			<CapabilityReport copy={copy} snapshot={snapshot} />
		</>;
	}
	if (surface === 'ofx-add' && openFxAuthoring !== null) {
		return <FramescaperOpenFxAddPanel runtime={openFxAuthoring} copy={copy} />;
	}
	if (surface === 'ofx-interact' && openFxAuthoring !== null) {
		return <FramescaperOpenFxInteractPanel bridge={bridge} runtime={openFxAuthoring} copy={copy} />;
	}
	if (isFramescaperNativeProjectActionSurface(surface)) {
		return projectActions?.surfaces.includes(surface) === true
			? <FramescaperNativeProjectActionPanel {...{ copy, surface, projectActions }}
				title={surfaceTitle(copy, surface)} />
			: <CapabilityPanel copy={copy} snapshot={snapshot} surface={surface} />;
	}
	return <CapabilityPanel copy={copy} snapshot={snapshot} surface={surface} />;
}

function RuntimeNotice({ copy, snapshot }: Readonly<{
	copy: FramescaperNativeServicesCopy;
	snapshot: FramescaperNativeServicesRendererSnapshot;
}>) {
	if (!snapshot.services.runtimeAvailable) return <p>{copy.runtimeUnavailable}</p>;
	if (!snapshot.services.nativeMediaEnabled) return <p>{copy.nativeMediaDisabled}</p>;
	return null;
}

function QueuePanel({ copy, snapshot, busy, perform, projectActions }: Readonly<{
	copy: FramescaperNativeServicesCopy;
	snapshot: FramescaperNativeServicesRendererSnapshot;
	busy: boolean;
	perform: (action: FramescaperNativeServicesDialogAction) => void;
	projectActions: FramescaperNativeProjectActionRuntime | null;
}>) {
	const queue = snapshot.services.queue;
	if (queue.length === 0) return <p>{copy.noQueueJobs}</p>;
	const runtimeUsable = snapshot.services.runtimeAvailable && snapshot.services.nativeMediaEnabled;
	return <ol aria-label={copy.backgroundJobs}>
		{queue.map((job, index) => <li key={job.jobId} data-native-queue-job={job.jobId}>
			<p><strong>{job.relativeDestination}</strong></p>
			<p>{`${copy.queueState}: ${job.state}`}</p>
			{job.progress !== null && <p>{`${copy.queueProgress}: ${String(Math.round(job.progress * 100))}%`}</p>}
			{job.lastFailureCode !== null && <p>{job.lastFailureCode === 'web-core-required'
				? copy.queueWebCoreRequired : job.lastFailureCode}</p>}
			<div className="kw-audio-editor-dialog__actions">
				{framescaperNativeQueueUiActions(job, runtimeUsable).map((action) => (
					<QueueActionButton
						key={action}
						action={action}
						job={job}
						copy={copy}
							disabled={busy || action === 'regenerate-carrier'
								&& !hasFramescaperNativeCarrierRegeneration(projectActions)}
						perform={perform}
					/>
				))}
				<button
					type="button"
					disabled={busy || !runtimeUsable || index === 0 || !reorderable(job)}
					onClick={() => perform({ type: 'queue-reorder', jobId: job.jobId, index: index - 1 })}
				>{copy.queueMoveEarlier}</button>
				<button
					type="button"
					disabled={busy || !runtimeUsable || index === queue.length - 1 || !reorderable(job)}
					onClick={() => perform({ type: 'queue-reorder', jobId: job.jobId, index: index + 1 })}
				>{copy.queueMoveLater}</button>
			</div>
		</li>)}
	</ol>;
}

function QueueActionButton({ action, job, copy, disabled, perform }: Readonly<{
	action: FramescaperNativeQueueUiAction;
	job: FramescaperNativeQueueProjection;
	copy: FramescaperNativeServicesCopy;
	disabled: boolean;
	perform: (action: FramescaperNativeServicesDialogAction) => void;
}>) {
	return <button
		type="button"
		disabled={disabled}
		data-native-queue-action={action}
		onClick={() => perform(action === 'remove'
			? { type: 'queue-remove', jobId: job.jobId }
			: action === 'regenerate-carrier'
				? { type: 'queue-regenerate-carrier', jobId: job.jobId }
			: action === 'reauthorize-root'
				? { type: 'queue-reauthorize-root', jobId: job.jobId }
			: { type: 'queue-control', jobId: job.jobId, action })}
	>{queueActionLabel(copy, action)}</button>;
}

function WatchPanel({ copy, snapshot, busy, perform, context, lifecycleMethods }: Readonly<{
	copy: FramescaperNativeServicesCopy;
	snapshot: FramescaperNativeServicesRendererSnapshot;
	busy: boolean;
	perform: (action: FramescaperNativeServicesDialogAction) => void;
	context: FramescaperNativeServicesDialogContext;
	lifecycleMethods: readonly FramescaperNativeServicesLifecycleMethod[];
}>) {
	const [extensions, setExtensions] = useState('wav, mp3, mp4, mov');
	const [selectedRootId, setSelectedRootId] = useState('');
	const [importMode, setImportMode] = useState<'link' | 'copy'>('link');
	const [generateProxies, setGenerateProxies] = useState(false);
	const roots = snapshot.services.roots.filter((root) => !root.revoked);
	const grantId = selectedRootId || roots[0]?.grantId || '';
	const canCreate = lifecycleMethods.includes('createWatch')
		&& context.projectId !== null && grantId !== '';
	const create = (): void => {
		if (!canCreate || context.projectId === null) return;
		perform({
			type: 'watch-create', grantId, projectId: context.projectId, binId: context.binId,
			extensions: extensions.split(',').map((value) => value.trim()).filter(Boolean),
			importMode,
			generateProxies: context.allowProxyGeneration && generateProxies,
		});
	};
	return <>
		<form onSubmit={(event) => { event.preventDefault(); create(); }}>
			<label className="kw-audio-editor-dialog__field">
				<span>{copy.nativeRoots}</span>
				<select value={grantId} disabled={busy || roots.length === 0}
					onChange={(event) => setSelectedRootId(event.currentTarget.value)}>
					{roots.map((root) => <option key={root.grantId} value={root.grantId}>
						{root.displayName}
					</option>)}
				</select>
			</label>
			<label className="kw-audio-editor-dialog__field">
				<span>{copy.watchExtensions}</span>
				<input value={extensions} disabled={busy}
					onChange={(event) => setExtensions(event.currentTarget.value)} />
			</label>
			<label className="kw-audio-editor-dialog__field">
				<span>{copy.watchImportMode}</span>
				<select value={importMode} disabled={busy}
					onChange={(event) => setImportMode(event.currentTarget.value === 'copy' ? 'copy' : 'link')}>
					<option value="link">{copy.watchLinked}</option>
					<option value="copy">{copy.watchCopied}</option>
				</select>
			</label>
			{context.allowProxyGeneration && <label className="kw-audio-editor-dialog__field">
				<span>{copy.watchGenerateProxies}</span>
				<input type="checkbox" checked={generateProxies} disabled={busy}
					onChange={(event) => setGenerateProxies(event.currentTarget.checked)} />
			</label>}
			<p>{context.projectId === null
				? copy.watchProjectUnavailable
				: roots.length === 0 ? copy.watchRootUnavailable : ''}</p>
			<div className="kw-audio-editor-dialog__actions">
				<button type="submit" disabled={busy || !canCreate}>{copy.watchCreate}</button>
				<button type="button" disabled={busy || !lifecycleMethods.includes('reconcileWatch')}
					onClick={() => perform({ type: 'watch-reconcile' })}>{copy.watchReconcile}</button>
			</div>
		</form>
		{snapshot.services.watchRules.length === 0
			? <p>{copy.noWatchFolders}</p>
			: <ul aria-label={copy.watchFolders}>
				{snapshot.services.watchRules.map((rule) => <li key={rule.ruleId}>
					<strong>{rule.extensions.map((extension) => `.${extension}`).join(', ')}</strong>
					{' — '}{rule.importMode === 'link' ? copy.watchLinked : copy.watchCopied}
					{rule.generateProxies ? ` — ${copy.proxyGenerate}` : ''}
					<div className="kw-audio-editor-dialog__actions">
						<button type="button" disabled={busy || !lifecycleMethods.includes('setWatchEnabled')}
							onClick={() => perform({ type: 'watch-set-enabled', ruleId: rule.ruleId,
								enabled: !rule.enabled })}>
							{rule.enabled ? copy.watchDisable : copy.watchEnable}
						</button>
						<button type="button" disabled={busy || !lifecycleMethods.includes('removeWatch')}
							onClick={() => perform({ type: 'watch-remove', ruleId: rule.ruleId })}>
							{copy.watchRemove}
						</button>
					</div>
				</li>)}
			</ul>}
	</>;
}

function PreferencesPanel({ copy, snapshot, busy, perform, lifecycleMethods }: Readonly<{
	copy: FramescaperNativeServicesCopy;
	snapshot: FramescaperNativeServicesRendererSnapshot;
	busy: boolean;
	perform: (action: FramescaperNativeServicesDialogAction) => void;
	lifecycleMethods: readonly FramescaperNativeServicesLifecycleMethod[];
}>) {
	return <>
		<fieldset>
			<legend>{copy.preferenceStatus}</legend>
			{preferenceRows(copy, snapshot).map((row) => {
				const controllable = snapshot.controllablePreferences.includes(row.preference);
				return <label key={row.preference} className="kw-audio-editor-dialog__field">
					<span>{row.label}</span>
					<input
						type="checkbox"
						checked={row.enabled}
						disabled={busy || !controllable}
						data-native-service-preference={row.preference}
						onChange={(event) => perform({
							type: 'set-preference',
							preference: row.preference,
							enabled: event.currentTarget.checked,
						})}
					/>
					{!controllable && <small>{copy.preferenceControlUnavailable}</small>}
				</label>;
			})}
		</fieldset>
		<RootsPanel {...{ copy, snapshot, busy, perform, lifecycleMethods }} />
		<p><button type="button" disabled={busy || !lifecycleMethods.includes('cleanupScratch')}
			onClick={() => perform({ type: 'scratch-cleanup' })}>{copy.scratchCleanup}</button></p>
		<CapabilityReport copy={copy} snapshot={snapshot} />
	</>;
}

function RootsPanel({ copy, snapshot, busy, perform, lifecycleMethods }: Readonly<{
	copy: FramescaperNativeServicesCopy;
	snapshot: FramescaperNativeServicesRendererSnapshot;
	busy: boolean;
	perform: (action: FramescaperNativeServicesDialogAction) => void;
	lifecycleMethods: readonly FramescaperNativeServicesLifecycleMethod[];
}>) {
	return <section aria-label={copy.nativeRoots}>
		<h3>{copy.nativeRoots}</h3>
		<p><button type="button" disabled={busy || !lifecycleMethods.includes('selectRoot')}
			onClick={() => perform({ type: 'root-select' })}>{copy.rootAuthorize}</button></p>
		{snapshot.services.roots.length === 0
			? <p>{copy.noNativeRoots}</p>
			: <ul>{snapshot.services.roots.map((root) => <li key={root.grantId}>
				{`${root.displayName} — ${root.revoked ? copy.rootRevoked : copy.rootAvailable}`}
				<div className="kw-audio-editor-dialog__actions">
					<button type="button" disabled={busy || !lifecycleMethods.includes('revalidateRoot')}
						onClick={() => perform({ type: 'root-revalidate', grantId: root.grantId })}>
						{copy.rootRevalidate}
					</button>
					<button type="button" disabled={busy || root.revoked
						|| !lifecycleMethods.includes('revokeRoot')}
						onClick={() => perform({ type: 'root-revoke', grantId: root.grantId })}>
						{copy.rootRevoke}
					</button>
				</div>
			</li>)}</ul>}
	</section>;
}

function CapabilityPanel({ copy, snapshot, surface }: Readonly<{
	copy: FramescaperNativeServicesCopy;
	snapshot: FramescaperNativeServicesRendererSnapshot;
	surface: FramescaperNativeServiceSurface;
}>) {
	return <section aria-label={surfaceTitle(copy, surface)}>
		<p>{copy.capabilityUnavailable}</p>
		<CapabilityReport copy={copy} snapshot={snapshot} />
	</section>;
}

function CapabilityReport({ copy, snapshot }: Readonly<{
	copy: FramescaperNativeServicesCopy;
	snapshot: FramescaperNativeServicesRendererSnapshot;
}>) {
	const capability = snapshot.capabilitySnapshot;
	return <section aria-label={copy.capabilityStatus}>
		<h3>{copy.capabilityStatus}</h3>
		{capability === null || capability.entries.length === 0
			? <p>{copy.noCapabilityReport}</p>
			: <dl>{capability.entries.map((entry) => <React.Fragment key={`${entry.domain}/${entry.id}`}>
				<dt>{`${entry.domain}/${entry.id}`}</dt>
				<dd>{`${entry.state} — ${entry.reason}`}</dd>
			</React.Fragment>)}</dl>}
	</section>;
}

function preferenceRows(
	copy: FramescaperNativeServicesCopy,
	snapshot: FramescaperNativeServicesRendererSnapshot,
): readonly Readonly<{
	preference: FramescaperNativeServicePreference;
	label: string;
	enabled: boolean;
}>[] {
	return Object.freeze([
		{ preference: 'native-media', label: copy.nativeMediaMaster,
			enabled: snapshot.preferences.nativeMediaEnabled },
		{ preference: 'hardware-decode', label: copy.hardwareDecode,
			enabled: snapshot.preferences.hardwareDecodeEnabled },
		{ preference: 'hardware-encode', label: copy.hardwareEncode,
			enabled: snapshot.preferences.hardwareEncodeEnabled },
		{ preference: 'ofx-consent', label: copy.ofxConsent,
			enabled: snapshot.preferences.ofxConsentEnabled },
	]);
}

function queueActionLabel(
	copy: FramescaperNativeServicesCopy,
	action: FramescaperNativeQueueUiAction,
): string {
	if (action === 'pause') return copy.queuePause;
	if (action === 'resume') return copy.queueResume;
	if (action === 'cancel') return copy.queueCancel;
	if (action === 'retry') return copy.queueRetry;
	if (action === 'regenerate-carrier') return copy.queueRegenerateCarrier;
	if (action === 'reauthorize-root') return copy.queueReauthorizeRoot;
	return copy.queueRemove;
}

function reorderable(job: FramescaperNativeQueueProjection): boolean {
	return job.state !== 'running' && !['completed', 'failed', 'cancelled'].includes(job.state);
}

function surfaceTitle(
	copy: FramescaperNativeServicesCopy,
	surface: FramescaperNativeServiceSurface,
): string {
	if (surface === 'image-sequence-import') return copy.importImageSequence;
	if (surface === 'render-queue-enqueue') return copy.addToRenderQueue;
	if (surface === 'background-jobs') return copy.backgroundJobs;
	if (surface === 'watch-folders') return copy.watchFolders;
	if (surface === 'proxy-generate') return copy.proxyGenerate;
	if (surface === 'proxy-attach') return copy.proxyAttach;
	if (surface === 'proxy-detach') return copy.proxyDetach;
	if (surface === 'proxy-relink') return copy.proxyRelink;
	if (surface === 'native-media-preferences') return copy.nativeMediaPreferences;
	if (surface === 'ofx-add') return copy.ofxAdd;
	if (surface === 'ofx-manage') return copy.ofxManage;
	if (surface === 'ofx-interact') return copy.ofxInteract;
	return copy.nativeServices;
}

function pendingSnapshot(): FramescaperNativeServicesRendererSnapshot {
	return Object.freeze({
		services: Object.freeze({
			snapshotVersion: 1,
			runtimeAvailable: false,
			nativeMediaEnabled: false,
			queue: Object.freeze([]),
			roots: Object.freeze([]),
			watchRules: Object.freeze([]),
		}),
		capabilitySnapshot: null,
		preferences: DEFAULT_FRAMESCAPER_NATIVE_SERVICE_PREFERENCES,
		controllablePreferences: Object.freeze([]),
		externalDisplays: Object.freeze([]),
		activeExternalDisplayId: null,
	});
}
