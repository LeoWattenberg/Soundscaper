/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionscaperProject } from '../../../../motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../../../../motionscaper/editor-project-commands.ts';
import { copyMotionscaperLayers, pasteMotionscaperLayers, type MotionscaperLayerClipboard } from '../../../../motionscaper/editor-layer-clipboard.ts';
import { parseMotionExactInput } from './motion-exact-input.ts';

export default function MotionTimelineClipboard({ copy, project, compositionId, selection, clipboard, busy, onCopy, onSelect, onEdit }: Readonly<{
	copy: Readonly<Record<string, string>>; project: MotionscaperProject; compositionId: string; selection: readonly string[]; clipboard: MotionscaperLayerClipboard | null; busy: boolean;
	onCopy: (clipboard: MotionscaperLayerClipboard) => void; onSelect: (ids: readonly string[]) => void; onEdit: (commands: readonly MotionscaperProjectCommand[]) => Promise<void>;
}>) {
	const [dependencies, setDependencies] = useState(false); const [originalTime, setOriginalTime] = useState(true); const [at, setAt] = useState('0');
	const [working, setWorking] = useState(false); const [error, setError] = useState<string | null>(null); const [copied, setCopied] = useState(false);
	const failed = (failure: unknown) => setError(failure instanceof Error ? failure.message : copy.motionscaperEditFailed!);
	const copyLayers = () => { setError(null); try { onCopy(copyMotionscaperLayers({ project, compositionId, layerIds: selection, includeDependencies: dependencies })); setCopied(true); } catch (failure) { failed(failure); } };
	const paste = async () => {
		if (!clipboard) return; setWorking(true); setError(null);
		try {
			const result = pasteMotionscaperLayers({ project, compositionId, clipboard, index: 0, ...(originalTime ? {} : { atFrame: parseMotionExactInput(at) }), createId: () => crypto.randomUUID() });
			// This clipboard is local to the document runtime's store. Session.edit retains its
			// existing digest bodies atomically before publishing the destination history.
			await onEdit(result.commands); onSelect(result.layerIds);
		} catch (failure) { failed(failure); } finally { setWorking(false); }
	};
	return <fieldset disabled={busy || working} className="motionscaper-timeline-actions"><legend>{copy.motionscaperLayerClipboard}</legend>
		<label><input type="checkbox" checked={dependencies} onChange={(event) => setDependencies(event.currentTarget.checked)} />{copy.motionscaperCopyDependencies}</label>
		<Button variant="secondary" disabled={selection.length === 0} onClick={copyLayers}>{copy.motionscaperCopyLayers}</Button>
		<label><input type="checkbox" checked={originalTime} onChange={(event) => setOriginalTime(event.currentTarget.checked)} />{copy.motionscaperPasteOriginalTiming}</label>
		<label>{copy.motionscaperPasteFrame}<input value={at} disabled={originalTime} onChange={(event) => setAt(event.currentTarget.value)} /></label>
		<Button variant="secondary" disabled={!clipboard} onClick={() => { void paste(); }}>{copy.motionscaperPasteLayers}</Button>
		<p>{copy.motionscaperLayerClipboardHint}</p>{copied && <p role="status">{copy.motionscaperLayersCopied}</p>}
		{error && <p role="alert">{copy.motionscaperEditFailed} {error}</p>}
	</fieldset>;
}
