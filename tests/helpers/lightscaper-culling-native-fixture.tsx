/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import React, { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PhotoLibraryPageV1, PhotoLibraryPreviewOutcomeV1, PhotoLibraryRowV1 } from '../../src/common/editor/photo-library-session-port-v1.ts';
import PhotoPreviewPresentation from '../../src/common/editor/ui/lightscaper/PhotoPreviewPresentation.tsx';
import { usePhotoLibrarySelection } from '../../src/common/editor/ui/lightscaper/use-photo-library-selection.ts';
import '../../src/common/editor/ui/lightscaper/photo-culling.css';

const PIXELS = new Uint8Array([19, 47, 91, 255]);
const BODY = new Blob([PIXELS], { type: 'application/vnd.scaper.rgba8' }), DIGEST = bytesToHex(sha256(PIXELS));
const descriptor = Object.freeze({ schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const });
const readPreview = async (photoId: string, tier: 'thumbnail' | 'fit-screen'): Promise<PhotoLibraryPreviewOutcomeV1> => {
	previewCalls++; return { outcome: 'ready', cache: 'hit', notices: [], preview: { photoId, tier, descriptor, byteLength: 4, body: BODY, outputSha256: DIGEST } };
};
function page(start = 1, count = 64): PhotoLibraryPageV1 {
	return Object.freeze({ catalogName: 'Qualification', totalCount: 65, cursor: start === 1 ? 'next' : null,
		rows: Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({ id: `photo-${start + index}`,
			fileName: `Photo ${start + index}.png`, width: 1, height: 1, rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const }))) });
}

type Selection = ReturnType<typeof usePhotoLibrarySelection>;
type SaveMode = 'saved' | 'failed' | 'refresh-failed' | 'held-saved';
let previewCalls = 0, active = 0, maximumActive = 0;
let release: (() => void) | null = null, heldSignal: AbortSignal | null = null;
let latest: Selection | null = null;
const saves: Readonly<{ photoId: string; rating: number }>[] = [];

export function cullingNativeStateV1() {
	return Object.freeze({ previewCalls, active, maximumActive, saves: Object.freeze([...saves]),
		selection: latest?.snapshot ?? null, heldAborted: heldSignal?.aborted ?? false });
}

/** Native hook qualification; the root product suite owns real catalog/database menu integration. */
export function CullingNativeHarnessV1() {
	const [published, setPublished] = useState(() => page()), [generation, setGeneration] = useState(0);
	const [filmstrip, setFilmstrip] = useState(false), [thumbnails, setThumbnails] = useState(false), [advance, setAdvance] = useState(false);
	const [mode, setMode] = useState<SaveMode>('saved');
	const selection = usePhotoLibrarySelection({ photoIds: published.rows.map(row => row.id), generation, pageIdentity: published, autoAdvance: advance });
	latest = selection;
	const rate = (photoId: string, rating: number) => {
		void selection.cull(photoId, async signal => {
			active++; maximumActive = Math.max(maximumActive, active); saves.push(Object.freeze({ photoId, rating }));
			try {
				if (mode === 'held-saved') { heldSignal = signal; await new Promise<void>(resolve => { release = resolve; }); release = null; }
				if (mode === 'failed') return { outcome: 'failed' };
				const next = Object.freeze({ ...published, cursor: null,
					rows: Object.freeze(published.rows.map(row => row.id === photoId ? Object.freeze({ ...row, rating }) : row)) });
				if (mode !== 'held-saved' || !signal.aborted) setPublished(next);
				return mode === 'refresh-failed' ? { outcome: 'saved', photoId, page: null, notice: 'refresh-failed' }
					: { outcome: 'saved', photoId, page: next, notice: null };
			} finally { active--; }
		}).catch(() => undefined);
	};
	return <main>
		<details><summary>View</summary><button type="button" aria-pressed={filmstrip} onClick={() => { setFilmstrip(previous => !previous); }}>Filmstrip</button>
			<button type="button" aria-pressed={thumbnails} onClick={() => { setThumbnails(previous => !previous); }}>Thumbnails</button></details>
		<details><summary>Photo</summary><button type="button" aria-pressed={advance} onClick={() => { setAdvance(previous => !previous); }}>Auto advance</button></details>
		<label>Save behavior<select value={mode} onChange={event => { setMode(event.currentTarget.value as SaveMode); }}>
			<option value="saved">Saved</option><option value="failed">Failed</option><option value="refresh-failed">Refresh failed</option><option value="held-saved">Held then saved</option>
		</select></label>
		<button type="button" onClick={() => { setPublished(page(65, 1)); }}>Next page</button>
		<button type="button" onClick={() => { setGeneration(previous => previous + 1); }}>Replace generation</button>
		<button type="button" onClick={() => { release?.(); }}>Release save</button>
		<output aria-label="Selected photo IDs">{selection.snapshot.selectedIds.join(',')}</output>
		<output aria-label="Pending cull">{selection.pendingPhotoId ?? 'none'}</output>
		<output aria-label="Cull notice">{selection.notice ?? 'none'}</output>
		<PhotoPreviewPresentation readPreview={readPreview} photoIds={published.rows.map(row => row.id)} thumbnailsVisible={thumbnails} fitScreenPhotoId={null}>
			{view => <section className="lightscaper-library" data-photo-layout={filmstrip ? 'filmstrip' : 'grid'}>
				<ul className="lightscaper-photo-grid">{published.rows.map(row => <NativeRow key={row.id} row={row} selection={selection} rate={rate}
					preview={view.renderThumbnail(row.id, `Thumbnail ${row.fileName}`)} />)}</ul>
				<output aria-label="Preview target count">{view.snapshot.targets.length}</output>
				<output aria-label="Preview ready count">{view.snapshot.targets.filter(target => target.status === 'ready').length}</output>
			</section>}
		</PhotoPreviewPresentation>
	</main>;
}

function NativeRow({ row, selection, rate, preview }: Readonly<{ row: PhotoLibraryRowV1; selection: Selection;
	rate: (photoId: string, rating: number) => void; preview: React.ReactNode }>) {
	const { attach } = selection, id = row.id;
	const ref = useCallback((button: HTMLButtonElement | null) => { attach(id, button); }, [attach, id]);
	return <li><button type="button" ref={ref} aria-label={row.fileName} aria-pressed={selection.snapshot.selectedIds.includes(id)}
		onFocus={() => { selection.focus(id); }} onClick={event => { selection.select(id, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey }); }}
		onKeyDown={event => {
			const toggle = event.ctrlKey || event.metaKey;
			if (toggle && event.key.toLowerCase() === 'a') { event.preventDefault(); selection.selectAll(); return; }
			if (event.key === 'Escape') { event.preventDefault(); selection.clear(); return; }
			if (/^[0-5]$/u.test(event.key)) { event.preventDefault(); if (selection.pendingPhotoId === null) rate(id, Number(event.key)); return; }
			if (selection.navigate(id, event.key, { toggle, range: event.shiftKey }) !== null) event.preventDefault();
		}}>{preview}<strong>{row.fileName}</strong><span>Rating: {row.rating}</span></button></li>;
}

export function mountCullingNativeV1() {
	previewCalls = 0; active = 0; maximumActive = 0; saves.length = 0; heldSignal = null; release = null;
	const mount = document.createElement('div'); document.body.append(mount);
	createRoot(mount).render(<StrictMode><CullingNativeHarnessV1 /></StrictMode>);
}
