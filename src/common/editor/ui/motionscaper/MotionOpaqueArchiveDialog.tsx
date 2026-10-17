/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { saveMotionscaperOpaqueCopy, type MotionscaperOpaqueArchive } from '../../../../motionscaper/editor-opaque-archive.ts';

export default function MotionOpaqueArchiveDialog({ archive, copy, onClose }: {
	readonly archive: MotionscaperOpaqueArchive; readonly copy: Readonly<Record<string, string>>; readonly onClose: () => Promise<void>;
}) {
	const [pending, setPending] = useState(false); const [error, setError] = useState(false); const [saved, setSaved] = useState(false);
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => { controller.current?.abort(); }, []);
	const run = async (operation: () => Promise<void>) => {
		setPending(true); setError(false);
		try { await operation(); } catch { setError(true); } finally { setPending(false); }
	};
	const close = () => { void run(onClose); };
	const saveCopy = () => { void run(async () => {
		setSaved(false); const abort = new AbortController(); controller.current = abort;
		try { setSaved(await saveMotionscaperOpaqueCopy(archive, undefined, abort.signal)); }
		finally { controller.current = null; }
	}); };
	return <AudioEditorDialogShell title={copy.motionscaperOpaqueTitle} onClose={pending ? undefined : close} width={520}
		footer={<DialogFooter className="audio-editor-dialog-footer" rightContent={<>
			{pending && controller.current && <Button variant="secondary" onClick={() => controller.current?.abort()}>{copy.motionscaperCancel}</Button>}
			<Button variant="secondary" disabled={pending} onClick={close}>{copy.motionscaperClose}</Button>
			<Button disabled={pending} onClick={saveCopy}>{copy.motionscaperSaveCopy}</Button>
		</>} />}>
		<p>{copy.motionscaperOpaqueNotice}</p>
		<dl><dt>{copy.motionscaperOpaqueFile}</dt><dd>{archive.fileName}</dd>
			<dt>{copy.motionscaperOpaqueIdentity}</dt><dd>{archive.identity.schemaFamily} / {archive.identity.schemaVersion}</dd></dl>
		{pending && <p role="status">{copy.motionscaperWorking}</p>}
		{saved && <p role="status">{copy.motionscaperOpaqueCopied}</p>}
		{error && <p role="alert">{copy.motionscaperFailed}</p>}
	</AudioEditorDialogShell>;
}
