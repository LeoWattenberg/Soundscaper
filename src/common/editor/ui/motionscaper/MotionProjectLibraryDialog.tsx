/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MotionProjectSummary } from '../../../../motionscaper/editor-project-store.ts';

export default function MotionProjectLibraryDialog({ copy, projects, busy, error, onOpen, onClose }: Readonly<{
	copy: Readonly<Record<string, string>>; projects: readonly MotionProjectSummary[];
	busy: boolean; error: string | null; onOpen: (id: string, recover: boolean) => void; onClose: () => void;
}>) {
	return <AudioEditorDialogShell title={copy.motionscaperLibrary} width={560} onClose={busy ? undefined : onClose}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={
			<Button variant="secondary" disabled={busy} onClick={onClose}>{copy.motionscaperClose}</Button>
		} />}>
		{busy && <p role="status">{copy.motionscaperWorking}</p>}
		{!busy && projects.length === 0 && <p>{copy.motionscaperLibraryEmpty}</p>}
		<ul className="motionscaper-project-list">{projects.map((project) => <li key={project.id}>
			<Button variant="secondary" disabled={busy || project.savedDigest === null} onClick={() => onOpen(project.id, false)}>{project.title}</Button>
			{project.hasRecovery && <>
				<p>{copy.motionscaperRecoveryAvailable}</p>
				<Button variant="secondary" disabled={busy} onClick={() => onOpen(project.id, true)}>{copy.motionscaperRecover}</Button>
			</>}
		</li>)}</ul>
		{error && <p role="alert">{error}</p>}
	</AudioEditorDialogShell>;
}
