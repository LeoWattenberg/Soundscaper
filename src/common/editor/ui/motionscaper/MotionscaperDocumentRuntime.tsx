/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { MotionscaperDocumentSession, UnsupportedMotionArchiveError, type MotionscaperDocumentSnapshot, type MotionProjectSettings } from '../../../../motionscaper/editor-document-session.ts';
import { createMotionscaperProjectStore, MotionProjectConflictError, type MotionProjectSummary } from '../../../../motionscaper/editor-project-store.ts';
import MotionProjectSettingsDialog from './MotionProjectSettingsDialog.tsx';
import MotionProjectLibraryDialog from './MotionProjectLibraryDialog.tsx';
import type { MotionAuthoredLayerKind } from '../../../../motionscaper/editor-layer-authoring.ts';
import type { MotionscaperLayerClipboard } from '../../../../motionscaper/editor-layer-clipboard.ts';
import type { MotionKeyframeClipboard } from '../../motion-keyframe-edit.ts';
import type { MotionscaperDeliveryQueue } from '../../../../motionscaper/editor-delivery-queue.ts';
import type { MotionscaperLinkSender } from '../../../../motionscaper/editor-link-sender.ts';
import type { MotionDocumentRequest } from './shell-menu.ts';
import type { MotionDesktopArchiveInput } from '../../../../motionscaper/desktop-file-adapter.ts';
import type { MotionscaperOpaqueArchive } from '../../../../motionscaper/editor-opaque-archive.ts';
import { MotionProjectLeaseError } from '../../../../motionscaper/editor-project-write-lease.ts';
import { ACCEPTED_PROJECT_FILE_EXTENSION_LIST } from '../../../project-file-extensions.ts';

const MotionOpaqueArchiveDialog = lazy(() => import('./MotionOpaqueArchiveDialog.tsx'));
const MotionSendCompositionDialog = lazy(() => import('./MotionSendCompositionDialog.tsx'));
const MotionCompositionsDialog = lazy(() => import('./MotionCompositionsDialog.tsx'));
const MotionAeBridgeDialog = lazy(() => import('./MotionAeBridgeDialog.tsx'));
const MotionSceneDialog = lazy(() => import('./MotionSceneDialog.tsx'));
const MotionAppearanceDialog = lazy(() => import('./MotionAppearanceDialog.tsx'));
const MotionExpressionDialog = lazy(() => import('./MotionExpressionDialog.tsx'));
const MotionCompositingDialog = lazy(() => import('./MotionCompositingDialog.tsx'));
const MotionTrackingDialog = lazy(() => import('./MotionTrackingDialog.tsx'));
const MotionOperatorsDialog = lazy(() => import('./MotionOperatorsDialog.tsx'));
const MotionCanvasDialog = lazy(() => import('./MotionCanvasDialog.tsx'));
const MotionPathsDialog = lazy(() => import('./MotionPathsDialog.tsx'));
const MotionPropertyDialog = lazy(() => import('./MotionPropertyDialog.tsx'));
const MotionTimelineDialog = lazy(() => import('./MotionTimelineDialog.tsx'));
const MotionRenderQueueDialog = lazy(() => import('./MotionRenderQueueDialog.tsx'));
const MotionRenderDialog = lazy(() => import('./MotionRenderDialog.tsx'));
const MotionPreviewDialog = lazy(() => import('./MotionPreviewDialog.tsx'));
const MotionArchiveReviewDialog = lazy(() => import('./MotionArchiveReviewDialog.tsx'));
const MotionLayerDialog = lazy(() => import('./MotionLayerDialog.tsx'));
const layerKinds: readonly MotionAuthoredLayerKind[] = ['solid', 'text', 'rectangle', 'ellipse', 'star'];

import type { MotionscaperDocumentOpen } from '../../../../motionscaper/editor-document-open.ts';

export interface MotionscaperDocumentRuntimeProps {
	readonly copy: Readonly<Record<string, string>>; readonly request: MotionDocumentRequest;
	readonly onChange: (snapshot: MotionscaperDocumentSnapshot) => void; readonly onProjectOpened: () => void;
}

/** Storage, scene validation and archive code are loaded only after a document menu command. */
export default function MotionscaperDocumentRuntime({ copy, request, onChange, onProjectOpened }: MotionscaperDocumentRuntimeProps) {
	const [store] = useState(() => createMotionscaperProjectStore());
	const [session] = useState(() => new MotionscaperDocumentSession(store));
	const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
	const [dialog, setDialog] = useState<'new' | 'settings' | 'open' | 'library' | 'preview' | 'render' | 'canvas' | 'render-queue' | 'import' | 'timeline' | 'properties' | 'paths' | 'operators' | 'tracking' | 'compositing' | 'expressions' | 'appearance' | 'compositions' | 'scene' | 'after-effects' | 'send' | MotionAuthoredLayerKind | null>(null);
	const [targetCompositionId, setTargetCompositionId] = useState('');
	const [bridgeFile, setBridgeFile] = useState<File | undefined>();
	const [layerClipboard, setLayerClipboard] = useState<MotionscaperLayerClipboard | null>(null);
	const [keyframeClipboard, setKeyframeClipboard] = useState<MotionKeyframeClipboard | null>(null);
	const [projects, setProjects] = useState<readonly MotionProjectSummary[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [opaqueArchive, setOpaqueArchive] = useState<MotionscaperOpaqueArchive | null>(null);
	const [archiveReview, setArchiveReview] = useState<MotionscaperDocumentOpen | null>(null);
	const [nativeSelection, setNativeSelection] = useState<MotionDesktopArchiveInput | null>(null);
	const retainedNative = useRef<MotionDesktopArchiveInput | null>(null);
	const retainedOpen = useRef<MotionscaperDocumentOpen | null>(null);
	const retainedArchive = useRef<MotionscaperOpaqueArchive | null>(null);
	const lastRequest = useRef(0);
	const linkSender = useRef<MotionscaperLinkSender | null>(null);
	const renderQueue = useRef<MotionscaperDeliveryQueue | null>(null);
	const runtimeMounted = useRef(true);
	const busy = pending || snapshot.busy;
	useEffect(() => { onChange({ ...snapshot, busy: busy || opaqueArchive !== null || archiveReview !== null || nativeSelection !== null }); }, [snapshot, busy, opaqueArchive, archiveReview, nativeSelection, onChange]);
	useEffect(() => { runtimeMounted.current = true; return () => { runtimeMounted.current = false; void (async () => {
		try { await renderQueue.current?.dispose(); } finally {
			try { await linkSender.current?.dispose(); } finally {
				try { await retainedOpen.current?.close(); } finally { try { await retainedArchive.current?.close(); } finally { try { await retainedNative.current?.release(); } finally { try { await session.dispose(); } finally { await store.close(); } } } }
			}
		}
	})().catch(() => undefined); }; }, [session, store]);
	const retainOpaque = useCallback(async (archive: MotionscaperOpaqueArchive) => {
		await retainedArchive.current?.close(); retainedArchive.current = archive; setOpaqueArchive(archive); setDialog(null);
	}, []);
	const run = useCallback(async (operation: () => Promise<void>, failureCopy?: string) => {
		setError(null); setPending(true);
		try { await operation(); }
		catch (failure) {
			setError(failure instanceof MotionProjectLeaseError ? copy.motionscaperLeaseLost : failure instanceof MotionProjectConflictError ? copy.motionscaperConflict
				: failure instanceof UnsupportedMotionArchiveError ? copy.motionscaperUnsupported : failureCopy ?? copy.motionscaperFailed);
		} finally { setPending(false); }
	}, [copy]);
	const reviewOpen = useCallback(async (pending: MotionscaperDocumentOpen) => {
		retainedOpen.current = pending;
		if (pending.review.existing) { setArchiveReview(pending); setDialog(null); return; }
		try { await pending.open('import'); retainedOpen.current = null; setDialog(null); onProjectOpened(); }
		catch (failure) { setArchiveReview(pending); setDialog(null); throw failure; }
	}, [onProjectOpened]);
	const openNativeSelection = useCallback(async (native: MotionDesktopArchiveInput, complete?: () => void) => {
		let completed = false;
		const selected: MotionDesktopArchiveInput = { ...native, release: async () => {
			await native.release(); if (completed) return; completed = true;
			retainedNative.current = null; setNativeSelection(null); complete?.();
		} };
		retainedNative.current = selected; setNativeSelection(selected);
		const { openMotionscaperDesktopArchiveSelection } = await import('../../../../motionscaper/editor-document-desktop.ts');
		await openMotionscaperDesktopArchiveSelection(session, selected, retainOpaque, reviewOpen);
	}, [session, retainOpaque, reviewOpen]);
	const openBrowserFile = useCallback(async (file: File) => {
		if (/\.aepx?$/iu.test(file.name)) { setBridgeFile(file); setDialog('after-effects'); return; }
		const { inspectMotionscaperOpaqueArchive } = await import('../../../../motionscaper/editor-opaque-archive.ts');
		const opaque = await inspectMotionscaperOpaqueArchive(file, file.name);
		if (opaque) await retainOpaque(opaque); else {
			const { prepareMotionscaperDocumentOpen } = await import('../../../../motionscaper/editor-document-open.ts');
			await reviewOpen(await prepareMotionscaperDocumentOpen(session, file, file.name));
		}
	}, [retainOpaque, session, reviewOpen]);
	useEffect(() => {
		if (request.id === lastRequest.current) return;
		lastRequest.current = request.id;
		setError(null);
		const command = request.command;
		setTargetCompositionId('');
		setBridgeFile(undefined);
		const kind = layerKinds.find((entry) => entry === command);
		if (kind) { setDialog(kind); return; }
		if (command === 'render' || command === 'render-queue') {
			void run(async () => {
				const { createMotionscaperDeliveryQueue } = await import('../../../../motionscaper/editor-delivery-queue.ts');
				if (!runtimeMounted.current) return;
				renderQueue.current ??= createMotionscaperDeliveryQueue({ store }); setDialog(command);
			}); return;
		}
		if (command === 'canvas' || command === 'new' || command === 'settings' || command === 'preview' || command === 'import' || command === 'timeline' || command === 'properties' || command === 'paths' || command === 'operators' || command === 'tracking' || command === 'compositing' || command === 'expressions' || command === 'appearance' || command === 'compositions' || command === 'scene' || command === 'after-effects') { setDialog(command); return; }
		if (command === 'send') {
			void run(async () => {
				if (!linkSender.current) {
					const [{ createMotionscaperLinkSender }, { resolveMotionLinkOrigins }] = await Promise.all([import('../../../../motionscaper/editor-link-sender.ts'), import('../../motion-link-connection-urls.ts')]);
					linkSender.current = createMotionscaperLinkSender({ session, store, ...resolveMotionLinkOrigins('motionscaper', location.origin, import.meta.env.PUBLIC_MOTION_LINK_PEER_ORIGIN), locale: document.documentElement.lang.startsWith('de') ? 'de' : 'en' });
				}
				setDialog('send');
			});
		} else if (command === 'open') {
			const native = request.nativeArchive;
			if (native) { void run(() => openNativeSelection(native, () => request.onComplete?.(false))); return; }
			const file = request.file;
			if (file) {
				void run(() => openBrowserFile(file)).finally(() => request.onComplete?.(Boolean(retainedArchive.current || retainedOpen.current))); return;
			}
			void run(async () => {
				const { motionscaperDesktopFiles, selectMotionscaperDesktopArchive } = await import('../../../../motionscaper/desktop-file-adapter.ts');
				const files = motionscaperDesktopFiles(); if (!files) { setDialog('open'); return; }
				const selected = await selectMotionscaperDesktopArchive(files); if (selected) await openNativeSelection(selected);
			});
		} else if (command === 'library') {
			setDialog('library');
			void run(async () => { setProjects(await store.list()); });
		} else if (command === 'save') void run(() => session.save(async (project, assertCurrent) => {
			const { writeMotionscaperDesktopProject } = await import('../../../../motionscaper/editor-document-desktop.ts');
			return writeMotionscaperDesktopProject(project, store, undefined, false, assertCurrent);
		}));
		else if (command === 'undo') void run(() => session.undo());
		else if (command === 'redo') void run(() => session.redo());
		else if (command === 'copy') void run(async () => {
			const { motionscaperDesktopFiles } = await import('../../../../motionscaper/desktop-file-adapter.ts');
			const files = motionscaperDesktopFiles();
			if (files) {
				const { writeMotionscaperDesktopProject } = await import('../../../../motionscaper/editor-document-desktop.ts');
				await session.exportSnapshot(async (project) => { await writeMotionscaperDesktopProject(project, store, files, true); });
				return;
			}
			const { blob, fileName } = await session.saveCopy();
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a'); link.href = url; link.download = fileName;
			document.body.append(link); link.click(); link.remove();
			globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
		});
	}, [request, run, session, store, onProjectOpened, retainOpaque, openBrowserFile, reviewOpen, openNativeSelection]);
	const close = () => { if (!busy) { setDialog(null); setError(null); } };
	const opened = () => { setDialog(null); onProjectOpened(); };
	const submit = (settings: MotionProjectSettings) => {
		void run(async () => {
			if (dialog === 'new') await session.create(settings);
			else await session.changeSettings(settings);
			opened();
		});
	};
	if (archiveReview) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionArchiveReviewDialog pending={archiveReview} copy={copy} initialError={error} onOpened={() => {
			retainedOpen.current = null; setArchiveReview(null); setError(null); opened();
		}} onClose={async () => { await archiveReview.close(); retainedOpen.current = null; setArchiveReview(null); setError(null); setDialog(null); }} />
	</Suspense>;
	if (opaqueArchive) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionOpaqueArchiveDialog archive={opaqueArchive} copy={copy} onClose={async () => {
			await opaqueArchive.close(); retainedArchive.current = null; setOpaqueArchive(null); setError(null);
		}} />
	</Suspense>;
	if (nativeSelection && error) return <AudioEditorDialogShell title={copy.motionscaperOpen} onClose={busy ? undefined : () => { void run(() => nativeSelection.release()); }} width={460}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button disabled={busy} onClick={() => { void run(() => nativeSelection.release()); }}>{copy.motionscaperArchiveRetry}</Button>} />}>
		<p role="alert">{error}</p><p>{copy.motionscaperArchiveNativeCleanup}</p>
	</AudioEditorDialogShell>;
	if (dialog === 'after-effects') return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionAeBridgeDialog copy={copy} store={store} busy={busy} initialFile={bridgeFile} project={snapshot.project ?? undefined}
			onOpen={async (id) => { await session.open(id); opened(); }} onClose={close} />
	</Suspense>;
	if (dialog === 'compositions' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionCompositionsDialog copy={copy} project={snapshot.project} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
			onEdit={(commands) => session.edit(commands)} onUndo={() => session.undo()} onRedo={() => session.redo()} onClose={close} />
	</Suspense>;
	if (dialog === 'scene' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionSceneDialog copy={copy} project={snapshot.project} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
			onEdit={(commands) => session.edit(commands)} onUndo={() => session.undo()} onRedo={() => session.redo()} onClose={close} />
	</Suspense>;
	if (dialog === 'appearance' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionAppearanceDialog copy={copy} project={snapshot.project} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
			onEdit={(commands, assets) => session.edit(commands, assets)} onUndo={() => session.undo()} onRedo={() => session.redo()} onClose={close} />
	</Suspense>;
	if (dialog === 'expressions' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionExpressionDialog copy={copy} project={snapshot.project} store={store} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
			onEdit={(commands) => session.edit(commands)} onUndo={() => session.undo()} onRedo={() => session.redo()} onClose={close} />
	</Suspense>;
	if (dialog === 'compositing' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionCompositingDialog copy={copy} project={snapshot.project} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
			onEdit={(commands) => session.edit(commands)} onUndo={() => session.undo()} onRedo={() => session.redo()} onClose={close} />
	</Suspense>;
	if (dialog === 'tracking' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionTrackingDialog copy={copy} project={snapshot.project} store={store} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo} cornerPin={true}
			onEdit={(commands) => session.edit(commands)} onUndo={() => session.undo()} onRedo={() => session.redo()} onClose={close} />
	</Suspense>;
	if (dialog === 'operators' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionOperatorsDialog copy={copy} project={snapshot.project} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
			onEdit={(commands) => session.edit(commands)} onUndo={() => session.undo()} onRedo={() => session.redo()} onClose={close} />
	</Suspense>;
	if (dialog === 'canvas' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionCanvasDialog copy={copy} project={snapshot.project} store={store} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
			onEdit={(commands) => session.edit(commands)} onUndo={() => session.undo()} onRedo={() => session.redo()} onClose={close} />
	</Suspense>;
	if (dialog === 'paths' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionPathsDialog clipboard={keyframeClipboard} onCopyKeys={setKeyframeClipboard} copy={copy} project={snapshot.project} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
			onEdit={(commands) => session.edit(commands)} onUndo={() => session.undo()} onRedo={() => session.redo()} onClose={close} />
	</Suspense>;
	if (dialog === 'properties' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionPropertyDialog copy={copy} project={snapshot.project} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
			clipboard={keyframeClipboard} onCopyKeys={setKeyframeClipboard} onEdit={(commands) => session.edit(commands)} onUndo={() => session.undo()} onRedo={() => session.redo()} onClose={close} />
	</Suspense>;
	if (dialog === 'timeline' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionTimelineDialog clipboard={layerClipboard} onCopyLayers={setLayerClipboard} copy={copy} project={snapshot.project} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
			onEdit={(commands) => session.edit(commands)} onUndo={() => session.undo()} onRedo={() => session.redo()} onClose={close} />
	</Suspense>;
	if (dialog === 'send' && snapshot.project && linkSender.current) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionSendCompositionDialog sender={linkSender.current} project={snapshot.project} copy={copy} onClose={close} />
	</Suspense>;
	if (dialog === 'render-queue' && renderQueue.current) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionRenderQueueDialog copy={copy} queue={renderQueue.current} onClose={close} />
	</Suspense>;
	if (dialog === 'render' && snapshot.project && renderQueue.current) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionRenderDialog copy={copy} project={snapshot.project} queue={renderQueue.current} onClose={close} />
	</Suspense>;
	if (dialog === 'preview' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionPreviewDialog copy={copy} project={snapshot.project} store={store} onClose={close} />
	</Suspense>;
	const layerKind = layerKinds.find((entry) => entry === dialog);
	const primary = snapshot.project?.compositions.find((entry) => entry.id === snapshot.project?.primaryCompositionId);
	const targetComposition = snapshot.project?.compositions.find((entry) => entry.id === targetCompositionId) ?? primary;
	if (layerKind && targetComposition) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionLayerDialog key={`${request.id}/${targetComposition.id}`} copy={copy} kind={layerKind} composition={targetComposition} compositionChoices={snapshot.project!.compositions} onCompositionChange={setTargetCompositionId} busy={busy} error={error} onClose={close}
			onSubmit={(draft) => { void run(async () => { await session.addLayer(draft, targetComposition.id); opened(); }); }} />
	</Suspense>;
	if (dialog === 'new' || dialog === 'settings') {
		const composition = snapshot.project?.compositions.find((item) => item.id === snapshot.project?.primaryCompositionId);
		const settings = dialog === 'settings' && composition && snapshot.project
			? { ...composition, title: snapshot.project.title }
			: { title: copy.motionscaperUntitled, width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, durationFrames: 300 };
		return <MotionProjectSettingsDialog key={`${dialog}-${request.id}`} copy={copy} settings={settings}
			create={dialog === 'new'} busy={busy} error={error} onSubmit={submit} onClose={close} />;
	}
	if (dialog === 'library') return <MotionProjectLibraryDialog copy={copy} projects={projects} busy={busy} error={error}
		onClose={close} onOpen={(id, recover) => { void run(async () => { await session.open(id, recover); opened(); }); }} />;
	if (dialog === 'import') return <AudioEditorDialogShell title={copy.motionscaperImportMedia} onClose={busy ? undefined : close} width={460}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={busy} onClick={close}>{copy.motionscaperCancel}</Button>} />}>
		{snapshot.project && snapshot.project.compositions.length > 1 && <label>{copy.motionscaperTargetComposition}<select value={targetComposition?.id ?? ''} disabled={busy} onChange={(event) => setTargetCompositionId(event.currentTarget.value)}>{snapshot.project.compositions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
		<p>{copy.motionscaperMediaAdmission}</p>
		<label>{copy.motionscaperMediaFile}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/*,audio/*" disabled={busy} onChange={(event) => {
			const file = event.currentTarget.files?.[0];
			if (file) void run(async () => { await session.importMedia(file, file.name, targetComposition?.id); opened(); }, copy.motionscaperMediaFailed);
		}} /></label>
		{busy && <p role="status">{copy.motionscaperWorking}</p>}
		{error && <p role="alert">{error}</p>}
	</AudioEditorDialogShell>;
	if (dialog === 'open') return <AudioEditorDialogShell title={copy.motionscaperOpen} onClose={busy ? undefined : close} width={460}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={busy} onClick={close}>{copy.motionscaperCancel}</Button>} />}>
		<label>{copy.motionscaperOpenFile}<input type="file" accept={`${ACCEPTED_PROJECT_FILE_EXTENSION_LIST},.aep,.aepx`} disabled={busy} onChange={(event) => {
			const file = event.currentTarget.files?.[0];
			if (file) void run(() => openBrowserFile(file));
		}} /></label>
		{busy && <p role="status">{copy.motionscaperWorking}</p>}
		{error && <p role="alert">{error}</p>}
	</AudioEditorDialogShell>;
	if (error) return <AudioEditorDialogShell title={copy.motionscaperTitle} onClose={close} width={460}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" onClick={close}>{copy.motionscaperClose}</Button>} />}>
		<p role="alert">{error}</p>
	</AudioEditorDialogShell>;
	return null;
}
