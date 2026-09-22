/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { DialogFooter } from '@soundscaper/design-system/Footer';

import {
	fetchNyquistArchiveManifest,
	installNyquistArchivePlugin,
} from '../../nyquist/archive-catalog.js';
import { nyquistArchiveStore } from '../../nyquist/archive-store.js';
import { resolveNyquistArchiveCopy } from '../../../i18n/editor-nyquist-archive-copy.ts';
import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';

export default function NyquistGetEffectsDialog({ copy, onClose }) {
	const archiveCopy = resolveNyquistArchiveCopy(copy);
	const [manifest, setManifest] = useState(null);
	const [query, setQuery] = useState('');
	const [installed, setInstalled] = useState(() => nyquistArchiveStore.list());
	const [busy, setBusy] = useState(null);
	const [error, setError] = useState('');
	const requestRef = useRef(null);

	useEffect(() => {
		const request = new AbortController();
		requestRef.current = request;
		void fetchNyquistArchiveManifest({ signal: request.signal }).then(setManifest).catch((reason) => {
			if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
		});
		return () => requestRef.current?.abort();
	}, []);

	const filtered = useMemo(() => manifest?.artifacts.filter((artifact) => (
		artifact.fileName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
	)) ?? [], [manifest, query]);
	const installedIds = useMemo(() => new Set(installed.map((plugin) => plugin.id)), [installed]);
	const close = () => {
		requestRef.current?.abort();
		onClose();
	};
	const install = async (artifact) => {
		const request = new AbortController();
		requestRef.current = request;
		setBusy(artifact.fileName);
		setError('');
		try {
			await installNyquistArchivePlugin(nyquistArchiveStore, artifact, { signal: request.signal });
			if (!request.signal.aborted) setInstalled(nyquistArchiveStore.list());
		} catch (reason) {
			if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			if (!request.signal.aborted) setBusy(null);
		}
	};
	const remove = (id) => {
		try {
			nyquistArchiveStore.remove(id);
			setInstalled(nyquistArchiveStore.list());
			setError('');
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		}
	};

	return <AudioEditorDialogShell
		title={archiveCopy.getEffects}
		onClose={close}
		width={740}
		dataAttributes={{ 'data-nyquist-get-effects': true }}
		footer={<DialogFooter rightContent={<Button variant="secondary" onClick={close}>{copy.close}</Button>} />}
	>
		<p>{archiveCopy.description}</p>
		<label className="kw-audio-editor-dialog__field">
			<span>{archiveCopy.searchEffects}</span>
			<input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
		</label>
		{error && <p role="alert">{error}</p>}
		{!manifest && !error && <p role="status">{copy.loading}</p>}
		{manifest && <>
			<p>{archiveCopy.effectCount.replace('{count}', String(filtered.length))}</p>
			<div style={{ maxHeight: 400, overflowY: 'auto' }}>
				<ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
					{filtered.map((artifact) => {
						const id = `nyquist:archive:${artifact.fileName}`;
						const plugin = installed.find((candidate) => candidate.id === id);
						return <li key={artifact.fileName} style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', padding: '8px 0' }}>
							<span>{plugin?.name || artifact.fileName}</span>
							{installedIds.has(id)
								? <Button variant="secondary" disabled={Boolean(busy)} onClick={() => remove(id)}>{archiveCopy.removeEffect}</Button>
								: <Button variant="secondary" disabled={Boolean(busy)} onClick={() => { void install(artifact); }}>
									{busy === artifact.fileName ? copy.loading : archiveCopy.installEffect}
								</Button>}
						</li>;
					})}
				</ul>
			</div>
		</>}
	</AudioEditorDialogShell>;
}
