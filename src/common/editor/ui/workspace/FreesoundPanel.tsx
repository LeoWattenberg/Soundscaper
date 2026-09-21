/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';

import '../audio-editor-design-system/06a-panels-freesound-attribution.css';
import { useEffect, useState } from 'react';

import {
	FREESOUND_RESULT_DRAG_MIME_TYPE,
	encodeFreesoundResultDragPayload,
} from './freesound-result-drag.ts';

export type FreesoundLicenseFilter = 'all' | 'cc0' | 'cc-by' | 'cc-by-nc';
export type FreesoundSort = 'relevance' | 'newest' | 'rating' | 'downloads';
export type FreesoundPanelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface FreesoundSearchRequest {
	readonly query: string;
	readonly license: FreesoundLicenseFilter;
	readonly sort: FreesoundSort;
	readonly page: number;
}

export interface FreesoundResultPresentation {
	readonly soundId: number;
	readonly name: string;
	readonly username: string;
	readonly userUrl?: string;
	readonly soundUrl: string;
	readonly licenseName: string;
	readonly licenseUrl: string;
	readonly durationLabel: string;
	readonly previewAvailable?: boolean;
	readonly actionPending?: boolean;
}

export interface FreesoundPanelState {
	readonly query: string;
	readonly license: FreesoundLicenseFilter;
	readonly sort: FreesoundSort;
	readonly page: number;
	readonly pageCount: number;
	readonly totalResults: number;
	readonly status: FreesoundPanelStatus;
	readonly errorMessage?: string;
	readonly previewingSoundId: number | null;
	readonly results: readonly FreesoundResultPresentation[];
}

export interface FreesoundPanelProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly state: FreesoundPanelState;
	readonly disabled: boolean;
	readonly onSearch: (request: FreesoundSearchRequest) => void;
	readonly onPreview: (soundId: number) => void;
	readonly onStopPreview: () => void;
	readonly onInsertAtPlayhead: (soundId: number) => void;
	readonly onAddToProjectBin: (soundId: number) => void;
}

const LICENSE_FILTERS: readonly FreesoundLicenseFilter[] = Object.freeze(['all', 'cc0', 'cc-by', 'cc-by-nc']);
const SORTS: readonly FreesoundSort[] = Object.freeze(['relevance', 'newest', 'rating', 'downloads']);

function fill(template: string, replacements: Readonly<Record<string, string | number>>): string {
	return Object.entries(replacements).reduce(
		(value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)),
		template,
	);
}

function licenseLabel(copy: Readonly<Record<string, string>>, license: FreesoundLicenseFilter): string {
	return {
		all: copy.licenseAll,
		cc0: copy.licenseCc0,
		'cc-by': copy.licenseAttribution,
		'cc-by-nc': copy.licenseAttributionNoncommercial,
	}[license];
}

function sortLabel(copy: Readonly<Record<string, string>>, sort: FreesoundSort): string {
	return {
		relevance: copy.sortRelevance,
		newest: copy.sortNewest,
		downloads: copy.sortDownloads,
		rating: copy.sortRating,
	}[sort];
}

export function FreesoundPanel({
	copy,
	state,
	disabled,
	onSearch,
	onPreview,
	onStopPreview,
	onInsertAtPlayhead,
	onAddToProjectBin,
}: FreesoundPanelProps) {
	const [query, setQuery] = useState(state.query);
	useEffect(() => setQuery(state.query), [state.query]);
	const loading = state.status === 'loading';
	const search = (request: Partial<FreesoundSearchRequest> = {}) => onSearch({
		query: request.query ?? query.trim(),
		license: request.license ?? state.license,
		sort: request.sort ?? state.sort,
		page: request.page ?? 1,
	});
	const resultSummary = fill(copy.resultsCount, { count: state.totalResults });
	const pageLabel = fill(copy.page, {
		page: Math.max(1, state.page),
		pages: Math.max(1, state.pageCount),
	});

	return (
		<section className="kw-audio-editor__freesound" data-freesound-panel="true" aria-busy={loading}>
			<form className="kw-audio-editor__freesound-search" role="search" onSubmit={(event) => {
				event.preventDefault();
				search({ query: query.trim(), page: 1 });
			}}>
				<label className="kw-audio-editor__freesound-query">
					<span className="kw-audio-editor-sr-only">{copy.searchLabel}</span>
					<input
						type="search"
						value={query}
						placeholder={copy.searchPlaceholder}
						disabled={loading}
						onChange={(event) => setQuery(event.currentTarget.value)}
					/>
				</label>
				<Button type="submit" variant="primary" size="small" disabled={loading || !query.trim()}>
					{copy.search}
				</Button>
				<div className="kw-audio-editor__freesound-filters">
					<label>
						<span>{copy.filterLicense}</span>
						<select
							aria-label={copy.filterLicense}
							value={state.license}
							disabled={loading || !query.trim()}
							onChange={(event) => search({
								license: event.currentTarget.value as FreesoundLicenseFilter,
								page: 1,
							})}
						>
							{LICENSE_FILTERS.map((license) => (
								<option key={license} value={license}>{licenseLabel(copy, license)}</option>
							))}
						</select>
					</label>
					<label>
						<span>{copy.sort}</span>
						<select
							aria-label={copy.sort}
							value={state.sort}
							disabled={loading || !query.trim()}
							onChange={(event) => search({
								sort: event.currentTarget.value as FreesoundSort,
								page: 1,
							})}
						>
							{SORTS.map((sort) => <option key={sort} value={sort}>{sortLabel(copy, sort)}</option>)}
						</select>
					</label>
				</div>
			</form>

			<div className="kw-audio-editor__freesound-status" aria-live="polite">
				{loading ? <p role="status">{copy.searching}</p> : null}
				{state.status === 'error' ? (
					<p role="alert">{state.errorMessage || copy.searchError}</p>
				) : null}
				{state.status === 'ready' && state.results.length > 0 ? <p>{resultSummary}</p> : null}
			</div>

			{state.status === 'idle' ? <p className="kw-audio-editor__panel-empty">{copy.searchPrompt}</p> : null}
			{state.status === 'ready' && state.results.length === 0
				? <p className="kw-audio-editor__panel-empty">{copy.noResults}</p>
				: null}
			{state.results.length > 0 ? (
				<ul className="kw-audio-editor__freesound-results" aria-label={copy.results}>
					{state.results.map((result) => {
						const previewing = state.previewingSoundId === result.soundId;
						const mutationDisabled = disabled || result.actionPending === true;
						return (
							<li
								key={result.soundId}
								className="kw-audio-editor__freesound-result"
								data-freesound-sound-id={result.soundId}
								draggable={!mutationDisabled}
								onDragStart={(event) => {
									if (mutationDisabled) {
										event.preventDefault();
										return;
									}
									event.dataTransfer.clearData();
									event.dataTransfer.effectAllowed = 'copy';
									event.dataTransfer.setData(
										FREESOUND_RESULT_DRAG_MIME_TYPE,
										encodeFreesoundResultDragPayload(result.soundId),
									);
								}}
							>
								<div className="kw-audio-editor__freesound-result-heading">
									<a href={result.soundUrl} target="_blank" rel="noreferrer">{result.name}</a>
									<span>{result.durationLabel}</span>
								</div>
								<p className="kw-audio-editor__freesound-result-attribution">
									{copy.byInline}{' '}
									{result.userUrl
										? <a href={result.userUrl} target="_blank" rel="noreferrer">{result.username}</a>
										: result.username}
									{' · '}
									<a href={result.licenseUrl} target="_blank" rel="noreferrer">{result.licenseName}</a>
								</p>
								<div className="kw-audio-editor__freesound-result-actions">
									<Button
										size="small"
										disabled={result.previewAvailable === false}
										onClick={() => previewing ? onStopPreview() : onPreview(result.soundId)}
									>
										{previewing ? copy.stopPreview : copy.preview}
										<span className="kw-audio-editor-sr-only">: {result.name}</span>
									</Button>
									<Button
										size="small"
										disabled={mutationDisabled}
										onClick={() => onInsertAtPlayhead(result.soundId)}
									>
										{copy.insertAtPlayhead}
										<span className="kw-audio-editor-sr-only">: {result.name}</span>
									</Button>
									<Button
										size="small"
										disabled={mutationDisabled}
										onClick={() => onAddToProjectBin(result.soundId)}
									>
										{copy.addToProjectBin}
										<span className="kw-audio-editor-sr-only">: {result.name}</span>
									</Button>
								</div>
							</li>
						);
					})}
				</ul>
			) : null}

			{state.pageCount > 1 ? (
				<nav className="kw-audio-editor__freesound-pagination" aria-label={copy.pagination}>
					<Button
						size="small"
						disabled={loading || state.page <= 1}
						onClick={() => search({ page: state.page - 1 })}
					>{copy.previousPage}</Button>
					<span aria-live="polite">{pageLabel}</span>
					<Button
						size="small"
						disabled={loading || state.page >= state.pageCount}
						onClick={() => search({ page: state.page + 1 })}
					>{copy.nextPage}</Button>
				</nav>
			) : null}
			<p className="kw-audio-editor__freesound-credit">
				{copy.resultsProvidedBy}{' '}
				<a href="https://freesound.org/" target="_blank" rel="noreferrer">{copy.siteName}</a>
			</p>
		</section>
	);
}

export default FreesoundPanel;
