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
import type { MotionKeyframeClipboard } from '../../motion-keyframe-edit.ts';
import type { MotionDocumentRequest } from './shell-menu.ts';

const MotionOperatorsDialog = lazy(() => import('./MotionOperatorsDialog.tsx'));
const MotionPathsDialog = lazy(() => import('./MotionPathsDialog.tsx'));
const MotionPropertyDialog = lazy(() => import('./MotionPropertyDialog.tsx'));
const MotionTimelineDialog = lazy(() => import('./MotionTimelineDialog.tsx'));
const MotionRenderDialog = lazy(() => import('./MotionRenderDialog.tsx'));
const MotionPreviewDialog = lazy(() => import('./MotionPreviewDialog.tsx'));
const MotionLayerDialog = lazy(() => import('./MotionLayerDialog.tsx'));
const layerKinds: readonly MotionAuthoredLayerKind[] = ['solid', 'text', 'rectangle', 'ellipse', 'star'];

export interface MotionscaperDocumentRuntimeProps {
	readonly copy: Readonly<Record<string, string>>; readonly request: MotionDocumentRequest;
	readonly onChange: (snapshot: MotionscaperDocumentSnapshot) => void; readonly onProjectOpened: () => void;
}

/** Storage, scene validation and archive code are loaded only after a document menu command. */
export default function MotionscaperDocumentRuntime({ copy, request, onChange, onProjectOpened }: MotionscaperDocumentRuntimeProps) {
	const [store] = useState(() => createMotionscaperProjectStore());
	const [session] = useState(() => new MotionscaperDocumentSession(store));
	const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
	const [dialog, setDialog] = useState<'new' | 'settings' | 'open' | 'library' | 'preview' | 'render' | 'import' | 'timeline' | 'properties' | 'paths' | 'operators' | MotionAuthoredLayerKind | null>(null);
	const [keyframeClipboard, setKeyframeClipboard] = useState<MotionKeyframeClipboard | null>(null);
	const [projects, setProjects] = useState<readonly MotionProjectSummary[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const lastRequest = useRef(0);
	const busy = pending || snapshot.busy;
	useEffect(() => { onChange({ ...snapshot, busy }); }, [snapshot, busy, onChange]);
	useEffect(() => () => { void store.close().catch(() => undefined); }, [store]);
	const run = useCallback(async (operation: () => Promise<void>, failureCopy?: string) => {
		setError(null); setPending(true);
		try { await operation(); }
		catch (failure) {
			setError(failure instanceof MotionProjectConflictError ? copy.motionscaperConflict
				: failure instanceof UnsupportedMotionArchiveError ? copy.motionscaperUnsupported : failureCopy ?? copy.motionscaperFailed);
		} finally { setPending(false); }
	}, [copy]);
	useEffect(() => {
		if (request.id === lastRequest.current) return;
		lastRequest.current = request.id;
		setError(null);
		const command = request.command;
		const kind = layerKinds.find((entry) => entry === command);
		if (kind) { setDialog(kind); return; }
		if (command === 'new' || command === 'settings' || command === 'preview' || command === 'render' || command === 'import' || command === 'timeline' || command === 'properties' || command === 'paths' || command === 'operators') { setDialog(command); return; }
		if (command === 'open') {
			void run(async () => {
				const { openMotionscaperDesktopProject } = await import('../../../../motionscaper/editor-document-desktop.ts');
				const result = await openMotionscaperDesktopProject(session);
				if (result === 'browser') setDialog('open');
				else if (result === 'opened') { setDialog(null); onProjectOpened(); }
			});
		} else if (command === 'library') {
			setDialog('library');
			void run(async () => { setProjects(await store.list()); });
		} else if (command === 'save') void run(() => session.save(async (project) => {
			const { writeMotionscaperDesktopProject } = await import('../../../../motionscaper/editor-document-desktop.ts');
			return writeMotionscaperDesktopProject(project, store);
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
	}, [request, run, session, store, onProjectOpened]);
	const close = () => { if (!busy) { setDialog(null); setError(null); } };
	const opened = () => { setDialog(null); onProjectOpened(); };
	const submit = (settings: MotionProjectSettings) => {
		void run(async () => {
			if (dialog === 'new') await session.create(settings);
			else await session.changeSettings(settings);
			opened();
		});
	};
	if (dialog === 'operators' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionOperatorsDialog copy={copy} project={snapshot.project} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
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
		<MotionTimelineDialog copy={copy} project={snapshot.project} busy={busy} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
			onEdit={(commands) => session.edit(commands)} onUndo={() => session.undo()} onRedo={() => session.redo()} onClose={close} />
	</Suspense>;
	if (dialog === 'render' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionRenderDialog copy={copy} project={snapshot.project} store={store} onClose={close} />
	</Suspense>;
	if (dialog === 'preview' && snapshot.project) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionPreviewDialog copy={copy} project={snapshot.project} store={store} onClose={close} />
	</Suspense>;
	const layerKind = layerKinds.find((entry) => entry === dialog);
	const primary = snapshot.project?.compositions.find((entry) => entry.id === snapshot.project?.primaryCompositionId);
	if (layerKind && primary) return <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
		<MotionLayerDialog key={request.id} copy={copy} kind={layerKind} composition={primary} busy={busy} error={error} onClose={close}
			onSubmit={(draft) => { void run(async () => { await session.addLayer(draft); opened(); }); }} />
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
		<p>{copy.motionscaperMediaAdmission}</p>
		<label>{copy.motionscaperMediaFile}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/*,audio/*" disabled={busy} onChange={(event) => {
			const file = event.currentTarget.files?.[0];
			if (file) void run(async () => { await session.importMedia(file, file.name); opened(); }, copy.motionscaperMediaFailed);
		}} /></label>
		{busy && <p role="status">{copy.motionscaperWorking}</p>}
		{error && <p role="alert">{error}</p>}
	</AudioEditorDialogShell>;
	if (dialog === 'open') return <AudioEditorDialogShell title={copy.motionscaperOpen} onClose={busy ? undefined : close} width={460}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" disabled={busy} onClick={close}>{copy.motionscaperCancel}</Button>} />}>
		<label>{copy.motionscaperOpenFile}<input type="file" accept=".mscape" disabled={busy} onChange={(event) => {
			const file = event.currentTarget.files?.[0];
			if (file) void run(async () => { await session.importArchive(file); opened(); });
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
