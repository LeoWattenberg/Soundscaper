/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import { Icon } from '@soundscaper/design-system/Icon';

import type {
	AudiocomPanelSnapshot,
	AudiocomSearchResult,
	AudiocomUploadDraft,
} from '../../controller/import/audiocom-panel-session.ts';
import AudiocomUploadArea from './AudiocomUploadArea.tsx';
import AudiocomLink from './AudiocomLink.tsx';
import '../audio-editor-design-system/06a-panels-audiocom.css';

export interface AudiocomPanelProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly state: AudiocomPanelSnapshot;
	readonly disabled?: boolean;
	readonly linkError?: string;
	readonly onOpenLink?: (url: string) => void;
	readonly onSearch: (request: Readonly<{ query: string; page: number }>) => void;
	readonly onPreview: (id: string) => void;
	readonly onStopPreview: () => void;
	readonly onConnect: () => void;
	readonly onDisconnect: () => void;
	readonly onUploadFiles: (files: readonly File[]) => void;
	readonly onPublish: (id: string, draft: AudiocomUploadDraft) => Promise<void> | void;
	readonly onRetry: (id: string) => void;
	readonly onCancel: (id: string) => void;
	readonly onRemove: (id: string) => void;
}

export default function AudiocomPanel({
	copy, state, disabled = false, linkError, onOpenLink, onSearch, onPreview, onStopPreview,
	onConnect, onDisconnect, onUploadFiles, onPublish, onRetry, onCancel, onRemove,
}: AudiocomPanelProps) {
	const [query, setQuery] = useState(state.search.query);
	useEffect(() => setQuery(state.search.query), [state.search.query]);
	const loading = state.search.status === 'loading';
	const connected = state.auth.status === 'connected';
	const searchDisabled = loading || !connected;
	return <section className="kw-audio-editor__audiocom" data-audiocom-panel="true" aria-busy={loading}>
		<form className="kw-audio-editor__audiocom-search" role="search" onSubmit={(event) => {
			event.preventDefault();
			if (query.trim() && !searchDisabled) onSearch({ query: query.trim(), page: 1 });
		}}>
			<label>
				<span className="kw-audio-editor-sr-only">{copy.searchLabel}</span>
				<input type="search" value={query} maxLength={200} placeholder={copy.searchPlaceholder} disabled={searchDisabled}
					onChange={(event) => setQuery(event.currentTarget.value)} />
			</label>
			<Button type="submit" variant="primary" size="small" disabled={searchDisabled || !query.trim()}>{copy.search}</Button>
		</form>
		<div className="kw-audio-editor__audiocom-status" aria-live="polite">
			{loading ? <p role="status">{copy.searching}</p> : null}
			{state.search.errorMessage ? <p role="alert">{state.search.errorMessage}</p> : null}
			{state.auth.errorMessage ? <p role="alert">{state.auth.errorMessage}</p> : null}
			{state.previewError ? <p role="alert">{state.previewError}</p> : null}
			{linkError ? <p role="alert">{linkError}</p> : null}
		</div>
		{state.search.status === 'idle' ? <p className="kw-audio-editor__panel-empty">{copy.searchPrompt}</p> : null}
		{state.search.status === 'ready' && !state.search.results.length
			? <p className="kw-audio-editor__panel-empty">{copy.noResults}</p> : null}
		{state.search.results.length ? <ul className="kw-audio-editor__audiocom-results" aria-label={copy.results}>
			{state.search.results.map((result) => <SearchResult key={result.id} result={result} copy={copy}
				previewing={state.previewingId === result.id} onPreview={onPreview} onStopPreview={onStopPreview} onOpenLink={onOpenLink} />)}
		</ul> : null}
		{state.search.page > 1 || state.search.hasNext ? <nav className="kw-audio-editor__audiocom-pagination"
			aria-label={copy.pagination}>
			<Button size="small" disabled={loading || state.search.page <= 1}
				onClick={() => onSearch({ query: state.search.query, page: state.search.page - 1 })}>{copy.previousPage}</Button>
			<span aria-live="polite">{copy.pageNumber.replaceAll('{page}', String(state.search.page))}</span>
			<Button size="small" disabled={loading || !state.search.hasNext}
				onClick={() => onSearch({ query: state.search.query, page: state.search.page + 1 })}>{copy.nextPage}</Button>
		</nav> : null}
		<p className="kw-audio-editor__audiocom-credit">
			{copy.resultsProvidedBy}{' '}<AudiocomLink href="https://audio.com/" onOpen={onOpenLink}>{copy.siteName}</AudiocomLink>{' · '}
			{connected ? <>
				<span>{state.auth.user?.username
					? copy.connectedAs.replaceAll('{username}', state.auth.user.username) : copy.connected}</span>{' '}
				<button type="button" className="kw-audio-editor__audiocom-text-action" onClick={onDisconnect}>{copy.disconnect}</button>
			</> : state.auth.status === 'loading' ? <span>{copy.checkingAccount}</span>
				: <button type="button" className="kw-audio-editor__audiocom-text-action"
					disabled={state.auth.status === 'connecting'} onClick={onConnect}>
					{state.auth.status === 'connecting' ? copy.connecting : copy.connect}
				</button>}
		</p>
		{connected ? <AudiocomUploadArea copy={copy} disabled={disabled} queue={state.uploadQueue}
			onFiles={onUploadFiles} onPublish={onPublish} onRetry={onRetry} onCancel={onCancel} onRemove={onRemove} onOpenLink={onOpenLink} /> : null}
	</section>;
}

function SearchResult({ result, copy, previewing, onPreview, onStopPreview, onOpenLink }: Readonly<{
	result: AudiocomSearchResult;
	copy: Readonly<Record<string, string>>;
	previewing: boolean;
	onPreview: (id: string) => void;
	onStopPreview: () => void;
	onOpenLink?: (url: string) => void;
}>) {
	const seconds = Math.max(0, Math.round(result.durationSeconds));
	const licenseUrl = creativeCommonsLicenseUrl(result.license);
	return <li className="kw-audio-editor__audiocom-result" data-audiocom-audio-id={result.id}>
		<div className="kw-audio-editor__audiocom-result-meta">
			<AudiocomLink className="kw-audio-editor__audiocom-result-title" href={result.url} onOpen={onOpenLink}>
				{result.title}
			</AudiocomLink>
			<span>{copy.byInline}{' '}{result.authorName || result.username}</span>
			<span>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
		</div>
		<div className="kw-audio-editor__audiocom-result-actions">
			<button type="button" className="kw-audio-editor__audiocom-preview" disabled={!result.previewUrl} aria-pressed={previewing}
				aria-label={`${previewing ? copy.stopPreview : copy.playPreview}: ${result.title}`}
				onClick={() => previewing ? onStopPreview() : onPreview(result.id)}>
				<Icon name={previewing ? 'stop' : 'play'} size={16} />
				{previewing ? copy.stopPreview : copy.playPreview}
			</button>
			{licenseUrl ? <AudiocomLink href={licenseUrl} onOpen={onOpenLink}>{licenseLabel(copy, result.license)}</AudiocomLink>
				: <span>{licenseLabel(copy, result.license)}</span>}
		</div>
	</li>;
}

function creativeCommonsLicenseUrl(license: string): string | undefined {
	if (license === 'cc-0') return 'https://creativecommons.org/publicdomain/zero/1.0/';
	if (/^cc-by(?:-nc)?(?:-sa|-nd)?$/u.test(license)) return `https://creativecommons.org/licenses/${license.slice(3)}/4.0/`;
	return undefined;
}

export function licenseLabel(copy: Readonly<Record<string, string>>, license: string): string {
	return copy[{
		none: 'licenseNone', arr: 'licenseArr', 'cc-0': 'licenseCc0', 'cc-by': 'licenseCcBy',
		'cc-by-sa': 'licenseCcBySa', 'cc-by-nc': 'licenseCcByNc', 'cc-by-nc-sa': 'licenseCcByNcSa',
		'cc-by-nd': 'licenseCcByNd', 'cc-by-nc-nd': 'licenseCcByNcNd',
	}[license] ?? 'licenseNone'];
}
