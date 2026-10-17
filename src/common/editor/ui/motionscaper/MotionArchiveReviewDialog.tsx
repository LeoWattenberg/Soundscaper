/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import type { MotionscaperDocumentOpen } from '../../../../motionscaper/editor-document-open.ts';
import type { MotionArchiveOpenAction } from '../../../../motionscaper/editor-document-import.ts';
export default function MotionArchiveReviewDialog({ pending, copy, initialError, onOpened, onClose }: Readonly<{
	pending: MotionscaperDocumentOpen; initialError?: string | null; copy: Readonly<Record<string, string>>;
	onOpened: () => void; onClose: () => Promise<void>;
}>) {
	const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(initialError ?? null);
	const { review } = pending, accepted = pending.accepted();
	const run = async (action: () => Promise<void>) => { setBusy(true); setError(null); try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : copy.motionscaperFailed); } finally { setBusy(false); } };
	const open = (action: MotionArchiveOpenAction) => { void run(async () => { await pending.open(action); onOpened(); }); };
	const close = () => { void run(onClose); };
	return <AudioEditorDialogShell title={review.existing ? copy.motionscaperArchiveReview : copy.motionscaperOpen} onClose={busy ? undefined : close} width={620} initialFocus=".motionscaper-archive-cancel"
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<Button variant="secondary" className="motionscaper-archive-cancel" disabled={busy} onClick={close}>{copy.motionscaperCancel}</Button>} />}>
		<p>{accepted ? copy.motionscaperArchiveAccepted : review.existing ? copy.motionscaperArchiveReviewHint : copy.motionscaperOpen}</p>
		<dl><dt>{copy.motionscaperArchiveIncoming}</dt><dd>{pending.fileName} — {review.incoming.title}</dd>
			{review.existing?.saved && <><dt>{copy.motionscaperArchiveSaved}</dt><dd>{review.existing.saved.project.title}</dd></>}
			{review.existing?.recovery && <><dt>{copy.motionscaperArchiveRecovery}</dt><dd>{review.existing.recovery.title}</dd></>}
		</dl>
		<fieldset disabled={busy} className="motionscaper-timeline-actions"><legend>{copy.motionscaperOpen}</legend>
			{accepted ? <Button onClick={() => open(accepted.action)}>{copy.motionscaperArchiveRetry}</Button> : <>
				{!review.existing && <Button onClick={() => open('import')}>{copy.motionscaperOpen}</Button>}
				{review.existing?.active ? <Button onClick={() => open('keep')}>{copy.motionscaperArchiveKeep}</Button> : <>
					{review.existing?.saved && <Button onClick={() => open('saved')}>{copy.motionscaperArchiveOpenSaved}</Button>}
					{review.existing?.recovery && <Button onClick={() => open('recover')}>{copy.motionscaperArchiveRecover}</Button>}
				</>}
				<Button onClick={() => open('copy')}>{copy.motionscaperArchiveCopy}</Button><p>{copy.motionscaperArchiveCopyHint}</p>
				{review.existing && <><Button onClick={() => open('replace')}>{copy.motionscaperArchiveReplace}</Button><p>{copy.motionscaperArchiveReplaceHint}</p></>}
			</>}
		</fieldset>
		{busy && <p role="status">{copy.motionscaperWorking}</p>}{error && <p role="alert">{error}</p>}
	</AudioEditorDialogShell>;
}
