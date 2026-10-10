/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense, useMemo, useState } from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import AudioEditorMenuBar from '../AudioEditorMenuBar.jsx';
import { DesignSystemProviders } from '../DesignSystemRuntime.jsx';
import { createMotionscaperShellMenus } from './shell-menu.ts';
import '../audio-editor-design-system.css';
import './motionscaper-shell.css';

const MotionWorkspace = lazyEditorModule(() => import('./MotionscaperWorkspace.tsx'));
const noAction = () => undefined;

export interface MotionscaperShellProps {
	readonly locale: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly onNewComposition?: () => void;
}

/** Product presentation has no foreign project controller or media runtime. */
export default function MotionscaperShell({ locale, copy, onNewComposition }: MotionscaperShellProps) {
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const menuCopy = useMemo(() => ({
		...copy, applicationMenu: copy.motionscaperApplicationMenu,
		fullscreen: copy.motionscaperFullscreen, options: copy.motionscaperViewMenu,
	}), [copy]);
	const menus = createMotionscaperShellMenus({
		copy, workspaceOpen, onToggleWorkspace: () => setWorkspaceOpen((open) => !open),
		...(onNewComposition ? { onNewComposition: () => { onNewComposition(); setWorkspaceOpen(true); } } : {}),
	});
	const toggleFullscreen = () => {
		const pending = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
		void pending.catch(() => undefined);
	};
	return <DesignSystemProviders copy={menuCopy}>
		<div id="kw-audio-editor-design-system" className="motionscaper-shell" data-motion-editor-bound="true" data-product="motionscaper">
			<AudioEditorMenuBar appName="Motionscaper" productId="motionscaper" locale={locale}
				copy={menuCopy} menus={menus} projectName="Motionscaper" projectTabs={null}
				saveState="idle" saveText="" onAssistanceSearchClose={noAction}
				onSearchActivate={noAction} onFullscreen={toggleFullscreen} />
			{workspaceOpen && <Suspense fallback={<p role="status">{copy.loading}</p>}>
				<MotionWorkspace copy={copy} />
			</Suspense>}
		</div>
	</DesignSystemProviders>;
}
