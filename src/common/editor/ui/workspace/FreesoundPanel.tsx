/* SPDX-License-Identifier: AGPL-3.0-only */

import { Button } from '@soundscaper/design-system/Button';
import { Icon } from '@soundscaper/design-system/Icon';
import { EditorErrorToast } from '../EditorToast.tsx';

import '../audio-editor-design-system/06a-panels-freesound.css';
import { useEffect, useState } from 'react';

import {
	AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE,
	createFreesoundResultDragPayload,
} from '../../project-bin-dnd.js';
import ccZeroBadge from './assets/cc-zero.svg';
import ccByBadge from './assets/cc-by.svg';
import ccByNcBadge from './assets/cc-by-nc.svg';

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
	readonly licenseCode: 'cc0' | 'cc-by' | 'cc-by-nc' | 'sampling-plus';
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
	readonly previewPaused: boolean;
	readonly results: readonly FreesoundResultPresentation[];
}

export interface FreesoundPanelProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly state: FreesoundPanelState;
	readonly disabled: boolean;
	readonly onSearch: (request: FreesoundSearchRequest) => void;
	readonly onPreview: (soundId: number) => void;
	readonly onPausePreview: () => void;
	readonly onResumePreview: () => void;
	readonly onInsertAtPlayhead: (soundId: number) => void;
	readonly onAddToProjectBin: (soundId: number) => void;
}

const LICENSE_FILTERS: readonly FreesoundLicenseFilter[] = Object.freeze(['all', 'cc0', 'cc-by', 'cc-by-nc']);
const SORTS: readonly FreesoundSort[] = Object.freeze(['relevance', 'newest', 'rating', 'downloads']);
const LICENSE_BADGES: Readonly<Record<Exclude<FreesoundResultPresentation['licenseCode'], 'sampling-plus'>, string>> = Object.freeze({
	cc0: ccZeroBadge,
	'cc-by': ccByBadge,
	'cc-by-nc': ccByNcBadge,
});

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
	onPausePreview,
	onResumePreview,
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
				{state.status === 'ready' && state.results.length > 0 ? <p>{resultSummary}</p> : null}
			</div>
			{state.status === 'error' && <div className="kw-audio-editor__toasts kw-audio-editor__freesound-toasts">
				<EditorErrorToast key={state.errorMessage || copy.searchError} id="freesound-search-error"
					title={copy.searchError} description={state.errorMessage}
					dismissLabel={copy.close} />
			</div>}

			{state.status === 'idle' ? <p className="kw-audio-editor__panel-empty">{copy.searchPrompt}</p> : null}
			{state.status === 'ready' && state.results.length === 0
				? <p className="kw-audio-editor__panel-empty">{copy.noResults}</p>
				: null}
			{state.results.length > 0 ? (
				<ul className="kw-audio-editor__freesound-results" aria-label={copy.results}>
					{state.results.map((result) => {
						const previewing = state.previewingSoundId === result.soundId;
						const playing = previewing && !state.previewPaused;
						const previewLabel = playing ? copy.pausePreview : copy.playPreview;
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
										AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE,
										createFreesoundResultDragPayload(result.soundId),
									);
								}}
							>
								<div className="kw-audio-editor__freesound-result-meta">
									<a className="kw-audio-editor__freesound-result-name" href={result.soundUrl}
										title={result.name} target="_blank" rel="noreferrer">{result.name}</a>
									<span className="kw-audio-editor__freesound-result-author">
										{copy.byInline}{' '}
										{result.userUrl
											? <a href={result.userUrl} target="_blank" rel="noreferrer">{result.username}</a>
											: result.username}
									</span>
									<span className="kw-audio-editor__freesound-result-duration">{result.durationLabel}</span>
									<a className="kw-audio-editor__freesound-result-license" href={result.licenseUrl}
										aria-label={result.licenseName} target="_blank" rel="noreferrer">
										{result.licenseCode === 'sampling-plus'
											? <span aria-hidden="true">{copy.licenseSamplingPlus}</span>
											: <img src={LICENSE_BADGES[result.licenseCode]} alt="" />}
									</a>
								</div>
								<div className="kw-audio-editor__freesound-result-actions">
									<button
										type="button"
										className="kw-audio-editor__freesound-preview-button"
										disabled={result.previewAvailable === false}
										aria-label={`${previewLabel}: ${result.name}`}
										title={previewLabel}
										aria-pressed={playing}
										onClick={() => playing ? onPausePreview() : previewing ? onResumePreview() : onPreview(result.soundId)}
									>
										<Icon name={playing ? 'pause' : 'play'} size={16} />
									</button>
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
