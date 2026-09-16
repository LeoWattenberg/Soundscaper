/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { ROUTE_LOCALES, getLocaleDescriptor } from '../../../i18n/locales.js';
import { COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE } from '../../../i18n/community-translations-copy.ts';
import { EDITOR_ENGLISH_COPY, EDITOR_COPY_METADATA } from '../../../i18n/editor-copy-inventory.ts';
import { isTranslatableMessageKey } from '../../../i18n/translation-scope.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
import { acceptableTranslation } from '../../../i18n/translation-catalog.js';
import {
	updateTranslationDraft, publishedTranslationOrigin,
	type TranslationContribution,
} from '../../../i18n/community-translations.ts';
import {
	exportCommunityTranslationJson, exportCommunityTranslationPo, type CommunityTranslationFileService,
} from './community-translation-files.ts';
import {
	findTranslationCandidates, translationTextsForElement, type TranslationCandidate,
} from './community-translation-picker.ts';
import type { CommunityTranslationPresentationPort } from './community-translation-presentation.ts';
import { useCommunityTranslationDraft } from './useCommunityTranslationDraft.ts';
import { communityTranslationMessageKeys } from './community-translation-message-filter.ts';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import { useAudioEditorThemeVariables } from '../DesignSystemRuntime.jsx';
import './community-translations.css';

interface CommunityTranslationSurfaceProps {
	readonly port: CommunityTranslationPresentationPort;
	readonly initialLocale: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly fileService: CommunityTranslationFileService;
	readonly onClose: () => void;
}

const translationLocales = ROUTE_LOCALES as readonly { readonly locale: string; readonly nativeName: string }[];

export default function CommunityTranslationSurface({ port, initialLocale, copy: hostCopy, fileService, onClose }: CommunityTranslationSurfaceProps) {
	const copy = useMemo(() => resolveEditorCopyScope('communityTranslations', COMMUNITY_TRANSLATIONS_COPY_BY_LOCALE.en, hostCopy), [hostCopy]);
	const themeVariables = useAudioEditorThemeVariables();
	const state = useCommunityTranslationDraft(port, initialLocale, copy);
	const { loaded, assessment, locale, setLocale, preview, setPreview, save, error, setError } = state;
	const [query, setQuery] = useState('');
	const [filter, setFilter] = useState('all');
	const [selectedKey, setSelectedKey] = useState('');
	const [translation, setTranslation] = useState('');
	const [note, setNote] = useState('');
	const [message, setMessage] = usePresentationFeedback(copy);
	const [picking, setPicking] = useState(false);
	const [side, setSide] = useState('right');
	const [candidates, setCandidates] = useState<readonly TranslationCandidate[]>([]);
	const [pickedObject, setPickedObject] = useState<Element | null>(null);
	const panelRef = useRef<HTMLElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const importRef = useRef<HTMLInputElement>(null);
	const baseline = loaded?.snapshot.entries[selectedKey];
	const selectedDraft = loaded?.draft.entries.find(({ key }) => key === selectedKey);
	const source = baseline?.source ?? selectedDraft?.source ?? '';
	const metadata = EDITOR_COPY_METADATA[selectedKey];
	const origin = publishedTranslationOrigin(baseline, locale === 'de' ? metadata?.bundledGerman : undefined);
	const originText = { human: copy.originHuman, machine: copy.originMachine, audacity: copy.originAudacity,
		bundled: copy.originBundled, missing: copy.originMissing }[origin];
	const reviewKeys = useMemo(() => new Set([
		...(assessment?.stale ?? []), ...(assessment?.conflicts ?? []), ...(assessment?.invalid ?? []),
	].map(({ key }) => key)), [assessment]);
	const keys = useMemo(() => {
		if (!loaded) return [];
		return communityTranslationMessageKeys(loaded.snapshot, loaded.draft,
			{ query, filter, reviewKeys, locale }, EDITOR_COPY_METADATA);
	}, [loaded, query, filter, reviewKeys, locale]);
	const displayedKeys = keys.slice(0, 200);
	useEffect(() => {
		if (!displayedKeys.includes(selectedKey)) setSelectedKey(displayedKeys[0] ?? '');
	}, [displayedKeys, selectedKey]);
	useEffect(() => {
		setTranslation(selectedDraft?.translation ?? baseline?.baselineText ?? '');
		setNote(selectedDraft?.note ?? '');
		setMessage('');
	}, [baseline?.baselineText, selectedDraft?.translation, selectedDraft?.note, selectedKey, setMessage]);
	useEffect(() => {
		searchRef.current?.focus({ preventScroll: true });
	}, []);
	useEffect(() => {
		if (!pickedObject) return undefined;
		pickedObject.classList.add('community-translations__target');
		return () => pickedObject.classList.remove('community-translations__target');
	}, [pickedObject]);
	useEffect(() => {
		if (!picking) return undefined;
		const inspect = (event: MouseEvent): void => {
			if (!(event.target instanceof Element) || panelRef.current?.contains(event.target)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			setPickedObject(event.target.closest('button, input, select, textarea, a, [role="menuitem"], [role="option"]') ?? event.target);
			const matches = findTranslationCandidates(translationTextsForElement(event.target), EDITOR_ENGLISH_COPY, port.getSnapshot().copy)
				.filter(({ key }) => isTranslatableMessageKey(key));
			setCandidates(matches);
			setPicking(false);
			const target = matches.find(({ isTarget }) => isTarget);
			if (target) chooseCandidate(target);
			else if (matches.length === 1) chooseCandidate(matches[0]!);
			else if (!matches.length) setMessage({ key: 'noMatch' });
			searchRef.current?.focus({ preventScroll: true });
		};
		const cancel = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopImmediatePropagation();
			setPicking(false);
			searchRef.current?.focus({ preventScroll: true });
		};
		document.addEventListener('click', inspect, true);
		document.addEventListener('keydown', cancel, true);
		return () => {
			document.removeEventListener('click', inspect, true);
			document.removeEventListener('keydown', cancel, true);
		};
	}, [picking, port, setMessage]);
	function chooseCandidate(candidate: TranslationCandidate): void {
		setFilter('all');
		setQuery(candidate.key);
		setSelectedKey(candidate.key);
	}
	function run(operation: () => Promise<void>): void {
		setError('');
		void operation().catch((failure: unknown) => setError(feedbackFailure(failure)));
	}
	async function importFile(file: File): Promise<void> {
		if (!loaded) return;
		if (file.size > 8 * 1024 * 1024) throw new Error(copy.invalid);
		if (!await state.importContributionFile(file)) return;
		setFilter('changed');
		setQuery('');
		setMessage({ key: 'imported' });
	}
	function removeChange(): void {
		if (!loaded) return;
		const draft: TranslationContribution = { ...loaded.draft, entries: loaded.draft.entries.filter(({ key }) => key !== selectedKey) };
		run(() => save(draft));
	}
	function saveChange(): void {
		if (!loaded || !baseline) return;
		if (!acceptableTranslation(source, translation)) { setError({ key: 'invalid' }); return; }
		const draft = updateTranslationDraft(loaded.draft, loaded.snapshot, selectedKey, translation, note);
		run(async () => { await save(draft); setMessage({ key: 'saved' }); });
	}
	function useCurrentBaseline(): void {
		if (!loaded || !baseline) return;
		if (!acceptableTranslation(source, translation)) { setError({ key: 'invalid' }); return; }
		const rebased = { ...loaded.draft, entries: loaded.draft.entries.filter(({ key }) => key !== selectedKey) };
		run(() => save(updateTranslationDraft(rebased, loaded.snapshot, selectedKey, translation, note)));
	}
	const reviewMessage = assessment?.stale.some(({ key }) => key === selectedKey) ? copy.stale
		: assessment?.conflicts.some(({ key }) => key === selectedKey) ? copy.conflict
			: assessment?.invalid.some(({ key }) => key === selectedKey) ? copy.invalid : '';
	return <section ref={panelRef} role="dialog" aria-label={copy.title} tabIndex={-1}
		data-community-translation-surface data-side={side} dir={getLocaleDescriptor(locale)?.direction ?? 'ltr'}
		className="community-translations" style={themeVariables as CSSProperties} onKeyDown={(event) => {
			if (event.key === 'Tab') event.stopPropagation();
			if (event.key === 'Escape' && !picking) { event.preventDefault(); event.stopPropagation(); onClose(); }
		}}>
		<header><h2>{copy.title}</h2><button type="button" aria-label={copy.close} onClick={onClose}>×</button></header>
		<button type="button" onClick={() => setSide(side === 'right' ? 'left' : 'right')}>{side === 'right' ? copy.moveLeft : copy.moveRight}</button>
		<label>{copy.language}<select value={locale} onChange={(event) => {
			setLocale(event.target.value); setQuery(''); setFilter('all'); setCandidates([]); setPickedObject(null);
		}}>{translationLocales.filter(({ locale: tag }) => tag !== 'en').map(({ locale: tag, nativeName }) =>
			<option key={tag} value={tag}>{nativeName}</option>)}</select></label>
		<label className="community-translations__preview"><input type="checkbox" checked={preview}
			onChange={(event) => setPreview(event.target.checked)} />{copy.preview}</label>
		<button type="button" aria-pressed={picking} onClick={() => { setPicking(!picking); setCandidates([]); setPickedObject(null); setMessage(''); }}>{copy.pick}</button>
		{picking && <p role="status">{copy.picking}</p>}
		{candidates.length > 1 && <fieldset><legend>{copy.candidates}</legend><p>{candidates.some(({ isTarget }) => isTarget) ? copy.identified : copy.ambiguous}</p>
			{candidates.map((candidate) => <button key={`${candidate.key}:${candidate.attribute}`} type="button"
				aria-pressed={candidate.key === selectedKey} onClick={() => chooseCandidate(candidate)}>
				{candidate.key} ({candidate.attribute}) — {EDITOR_ENGLISH_COPY[candidate.key]}
				{candidate.isTarget && <> — <strong>{copy.clicked}</strong></>}</button>)}
		</fieldset>}
		<label>{copy.search}<input ref={searchRef} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setCandidates([]); setPickedObject(null); }} /></label>
		<label>{copy.filter}<select value={filter} onChange={(event) => { setFilter(event.target.value); setCandidates([]); setPickedObject(null); }}>
			<option value="all">{copy.all}</option><option value="changed">{copy.changed}</option>
			<option value="missing">{copy.missing}</option><option value="review">{copy.review}</option>
		</select></label>
		{!loaded && !error && <p role="status">{copy.loading}</p>}
		{loaded && <><label>{copy.messages} ({keys.length})<select size={6} value={selectedKey}
			onChange={(event) => setSelectedKey(event.target.value)}>{displayedKeys.map((key) =>
				<option key={key} value={key}>{key} — {(loaded.snapshot.entries[key]?.source ?? loaded.draft.entries.find((entry) => entry.key === key)?.source ?? '').slice(0, 100)}</option>)}</select></label>
			{!keys.length && <p>{copy.empty}</p>}
			{selectedKey && <form onSubmit={(event) => { event.preventDefault(); saveChange(); }}>
				<label>{copy.key}<input readOnly value={selectedKey} dir="ltr" /></label>
				<dl><dt>{copy.owner}</dt><dd>{metadata?.owner ?? ''}</dd><dt>{copy.origin}</dt><dd>{originText}</dd></dl>
				<label>{copy.source}<textarea readOnly value={source} dir="ltr" rows={2} /></label>
				<label>{copy.published}<textarea readOnly value={baseline?.baselineText ?? ''} rows={2} /></label>
				<label>{copy.translation}<textarea value={translation} rows={3} onChange={(event) => setTranslation(event.target.value)} /></label>
				<label>{copy.note}<textarea value={note} rows={2} onChange={(event) => setNote(event.target.value)} /></label>
				<p>{copy.validation}</p>
				{reviewMessage && <p role="alert">{reviewMessage}</p>}
				<div className="community-translations__actions"><button type="submit" disabled={!baseline}>{copy.save}</button>
					<button type="button" disabled={!selectedDraft} onClick={removeChange}>{copy.remove}</button>
					{reviewMessage && baseline && <button type="button" onClick={useCurrentBaseline}>{copy.useCurrent}</button>}</div>
			</form>}
			<label>{copy.contributor}<input value={loaded.draft.contributor ?? ''} onChange={(event) => {
				const contributor = event.target.value;
				run(() => save({ ...loaded.draft, contributor }));
			}} /></label>
			<p role="status">{copy.status.replace('{count}', String(loaded.draft.entries.length)).replace('{reviewCount}', String(reviewKeys.size))}</p>
			<div className="community-translations__actions">
				<button type="button" onClick={() => importRef.current?.click()}>{copy.import}</button>
				<button type="button" onClick={() => run(() => exportCommunityTranslationJson(fileService, loaded.draft))}>{copy.export}</button>
				<button type="button" onClick={() => run(() => exportCommunityTranslationPo(fileService, loaded.snapshot, copy.poInstructions, loaded.draft))}>{copy.po}</button>
			</div>
		</>}
		<input ref={importRef} type="file" accept=".json,application/json" aria-label={copy.import} hidden onChange={(event) => {
			const file = event.target.files?.[0]; event.target.value = ''; if (file) run(() => importFile(file));
		}} />
		{loaded?.persistenceError && <p role="alert">{copy.storageFailed}</p>}
		{error && <p role="alert">{copy.error.replace('{message}', error)}</p>}
		{message && <p role="status">{message}</p>}
		<footer><p>{copy.handoff}</p><a href="https://github.com/LeoWattenberg/Soundscaper/issues/new" target="_blank" rel="noreferrer">{copy.issue}</a></footer>
	</section>;
}
