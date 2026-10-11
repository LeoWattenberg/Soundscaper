/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState, useSyncExternalStore } from 'react';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MotionscaperLinkSender } from '../../../../motionscaper/editor-link-sender.ts';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
export default function MotionSendCompositionDialog({ sender, project, copy, onClose }: {
	readonly sender: MotionscaperLinkSender; readonly project: MotionscaperProject; readonly copy: Readonly<Record<string, string>>; readonly onClose: () => void;
}) {
	const state = useSyncExternalStore(sender.subscribe, sender.getSnapshot); const [url, setUrl] = useState(''); const [compositionId, setCompositionId] = useState(project.primaryCompositionId);
	const [error, setError] = useState<string | null>(null); const connected = state.status !== 'idle';
	const status = { idle: copy.motionscaperLinkIdle, connecting: copy.motionscaperLinkConnecting, sending: copy.motionscaperLinkSending, connected: copy.motionscaperLinkConnected }[state.status];
	function run(action: () => Promise<void>) { setError(null); void action().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))); }
	return <AudioEditorDialogShell title={copy.motionscaperSendComposition} onClose={onClose} width={600}>
		<p>{copy.motionscaperLinkDescription}</p><p>{copy.motionscaperLinkSavedOnly}</p>
		<label>{copy.motionscaperTargetComposition}<select disabled={connected} value={state.compositionId ?? compositionId} onChange={event => setCompositionId(event.currentTarget.value)}>{project.compositions.map(composition => <option key={composition.id} value={composition.id}>{composition.name}</option>)}</select></label>
		<label>{copy.motionscaperLinkPairing}<input type="url" value={url} disabled={connected} onChange={event => setUrl(event.currentTarget.value)} /></label>
		<p role="status">{status}</p>{state.lastDigest && <p>{copy.motionscaperLinkLastDigest}: <code>{state.lastDigest}</code></p>}
		{(error ?? state.error) && <p role="alert">{error ?? state.error}</p>}
		<button type="button" disabled={connected || !url.trim()} onClick={() => run(() => sender.connect(url.trim(), compositionId))}>{copy.motionscaperLinkConnect}</button>{' '}
		<button type="button" disabled={!connected} onClick={() => run(() => sender.disconnect())}>{copy.motionscaperLinkDisconnect}</button>
		<p>{copy.motionscaperLinkKeepOpen}</p><button type="button" onClick={onClose}>{copy.motionscaperClose}</button>
	</AudioEditorDialogShell>;
}
