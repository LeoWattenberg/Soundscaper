/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense, useCallback, useMemo, useState } from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import AudioEditorMenuBar from '../AudioEditorMenuBar.jsx';
import { DesignSystemProviders } from '../DesignSystemRuntime.jsx';
import { createMotionscaperShellMenus, type MotionDocumentCommand, type MotionDocumentRequest } from './shell-menu.ts';
import { openMotionscaperDocumentation } from './motionscaper-documentation.ts';
import type { MotionscaperDocumentSnapshot } from '../../../../motionscaper/editor-document-session.ts';
import '../audio-editor-design-system.css';
import './motionscaper-shell.css';

const MotionWorkspace = lazyEditorModule(() => import('./MotionscaperWorkspace.tsx'));
const DocumentRuntime = lazyEditorModule(() => import('./MotionscaperDocumentRuntime.tsx'));
const noAction = () => undefined;

export interface MotionscaperShellProps {
	readonly locale: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly onNewComposition?: () => void;
}

/** Product presentation has no foreign project controller or media runtime. */
export default function MotionscaperShell({ locale, copy, onNewComposition }: MotionscaperShellProps) {
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const [request, setRequest] = useState<MotionDocumentRequest | null>(null);
	const [helpError, setHelpError] = useState(false);
	const [documentState, setDocumentState] = useState<MotionscaperDocumentSnapshot>({
		project: null, savedDigest: null, dirty: false, busy: false, canUndo: false, canRedo: false,
	});
	const onCommand = (command: MotionDocumentCommand) => setRequest((previous) => ({ id: (previous?.id ?? 0) + 1, command }));
	const projectOpened = useCallback(() => setWorkspaceOpen(true), []);
	const menuCopy = useMemo(() => ({
		...copy, applicationMenu: copy.motionscaperApplicationMenu,
		fullscreen: copy.motionscaperFullscreen, options: copy.motionscaperViewMenu,
	}), [copy]);
	const menus = createMotionscaperShellMenus({
		copy, workspaceOpen, onToggleWorkspace: () => setWorkspaceOpen((open) => !open),
		onCommand, hasProject: documentState.project !== null, busy: documentState.busy,
		canUndo: documentState.canUndo, canRedo: documentState.canRedo,
		onDocumentation: destination => { setHelpError(false); void openMotionscaperDocumentation(destination, locale).catch(() => setHelpError(true)); },
		...(onNewComposition ? { onNewComposition: () => { onNewComposition(); setWorkspaceOpen(true); } } : {}),
	});
	const toggleFullscreen = () => {
		const pending = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
		void pending.catch(() => undefined);
	};
	return <DesignSystemProviders copy={menuCopy}>
		<div id="kw-audio-editor-design-system" className="motionscaper-shell" data-motion-editor-bound="true" data-product="motionscaper">
			<AudioEditorMenuBar appName="Motionscaper" productId="motionscaper" locale={locale}
				copy={menuCopy} menus={menus} projectName={documentState.project?.title ?? 'Motionscaper'} projectTabs={null}
				searchEnabled={false} saveState={documentState.dirty ? 'dirty' : 'saved'} saveText="" onAssistanceSearchClose={noAction}
				onSearchActivate={noAction} onFullscreen={toggleFullscreen} />
			{helpError && <p role="alert">{copy.motionscaperHelpFailed}</p>}
			{workspaceOpen && <Suspense fallback={<p role="status">{copy.loading}</p>}>
				<MotionWorkspace copy={copy} document={documentState} />
			</Suspense>}
			{request && <Suspense fallback={<p role="status">{copy.motionscaperWorking}</p>}>
				<DocumentRuntime copy={copy} request={request} onChange={setDocumentState} onProjectOpened={projectOpened} />
			</Suspense>}
		</div>
	</DesignSystemProviders>;
}
