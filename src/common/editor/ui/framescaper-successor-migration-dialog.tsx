/* SPDX-License-Identifier: AGPL-3.0-only */
import { framescaperSuccessorCopy } from '../../i18n/framescaper-successor-copy.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { openFramescaperSuccessorRepository, type FramescaperSuccessorRepository } from '../../../framescaper/editor-project-successor-repository.ts';
import { createAudioEditorFileService } from '../file-service.js';
import { saveFramescaperRetainedOriginal } from '../../../framescaper/editor-project-successor-original-save.ts';
import { exportFramescaperSuccessorArchive, type FramescaperMigrationRecord } from '../../../framescaper/editor-project-successor-archive.ts';

let closeActiveDialog: (() => void) | null = null;

/** The workspace is created only by its File menu command. */
export function openFramescaperSuccessorMigrationDialog(openProject?: (id: string) => Promise<void>): void {
	closeActiveDialog?.();
	const host = document.createElement('div'); document.body.append(host);
	const root = createRoot(host);
	const close = () => { root.unmount(); host.remove(); closeActiveDialog = null; };
	closeActiveDialog = close;
	root.render(<MigrationDialog close={close} openProject={openProject} />);
}

function MigrationDialog({ close, openProject }: { readonly close: () => void; readonly openProject?: (id: string) => Promise<void> }) {
	const copy = framescaperSuccessorCopy(document.documentElement.lang);
	const dialog = useRef<HTMLDialogElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const repository = useRef<FramescaperSuccessorRepository | null>(null);
	const controller = useRef(new AbortController());
	const [records, setRecords] = useState<readonly FramescaperMigrationRecord[]>([]);
	const [status, setStatus] = useState(copy.opening);
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(true);
	const [ready, setReady] = useState(false);
	const refresh = useCallback(async (store: FramescaperSuccessorRepository): Promise<void> => {
		const projects = await store.list();
		controller.current.signal.throwIfAborted();
		setRecords(projects);
		setStatus(copy.retained.replace('{count}', String(projects.length)));
	}, [copy.retained]);
	function run(operation: () => Promise<void>): void {
		setBusy(true); setFailed(false);
		void operation().catch((error: unknown) => {
			if (controller.current.signal.aborted) return;
			setStatus(error instanceof Error ? error.message : String(error)); setFailed(true);
		}).finally(() => { if (!controller.current.signal.aborted) setBusy(false); });
	}
	useEffect(() => {
		dialog.current?.showModal();
		const abort = controller.current;
		void (async () => {
			const store = await openFramescaperSuccessorRepository({ line: 'successor' });
			if (abort.signal.aborted) { store.close(); return; }
			repository.current = store;
			await store.recover(abort.signal); await refresh(store); setReady(true);
		})().catch((error: unknown) => {
			if (abort.signal.aborted) return;
			setStatus(error instanceof Error ? error.message : String(error)); setFailed(true);
		}).finally(() => { if (!abort.signal.aborted) setBusy(false); });
		return () => { abort.abort(); repository.current?.close(); };
	}, [refresh]);
	return <dialog ref={dialog} data-framescaper-successor-migration="true" aria-labelledby="framescaper-successor-title"
		style={{ maxWidth: 'min(52rem,90vw)', maxHeight: '80vh', overflow: 'auto', padding: '1.5rem' }} onClose={close}>
		<h2 id="framescaper-successor-title">{copy.title}</h2>
		<p>{copy.description}</p>
		<button type="button" disabled={busy || !ready} onClick={() => input.current?.click()}>{copy.choose}</button>
		<input ref={input} type="file" accept=".fscape,.scape" hidden onChange={(event) => {
			const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
			const store = repository.current; if (!file || !store) return;
			run(async () => {
				setStatus(copy.verifying);
				const prepared = await store.stage(file, controller.current.signal);
				controller.current.signal.throwIfAborted(); await store.complete(prepared.id); await refresh(store);
			});
		}} />
		<p role={failed ? 'alert' : 'status'}>{status}</p>
		<ul>{records.map((record) => <li key={record.id}>
			{record.project.title}{' — '}{copy.schema}{' '}
			{openProject && <button type="button" disabled={busy} onClick={() => run(async () => { await openProject(record.id); close(); })}>{copy.openProject}</button>}
			<button type="button" disabled={busy} onClick={() => run(async () => {
				const retained = await saveFramescaperRetainedOriginal(record.originalArchive, record.archiveDigest, `${record.project.title}-original.fscape`, createAudioEditorFileService({ bridge: null }), controller.current.signal);
				if (retained) void retained.cleanup().catch((error: unknown) => {
					console.error('Retained original download cleanup failed.', error);
					if (!controller.current.signal.aborted) { setStatus(error instanceof Error ? error.message : String(error)); setFailed(true); }
				});
			})}>{copy.original}</button>
			<button type="button" disabled={busy} onClick={() => run(async () => {
				const archive = await exportFramescaperSuccessorArchive(record, controller.current.signal);
				download(archive, `${record.project.title}-v2.fscape`);
			})}>{copy.upgraded}</button>
		</li>)}</ul>
		<button type="button" onClick={() => dialog.current?.close()}>{copy.close}</button>
	</dialog>;
}
function download(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
	anchor.href = url; anchor.download = filename; anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
