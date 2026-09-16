/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createTranslationDraftStore } from '../../controller/preferences/translation-drafts.ts';
import {
	assessTranslationContribution, mergeTranslationContributions, parseTranslationContribution, previewTranslationDraft,
	type ContributionSnapshot, type TranslationContribution,
} from '../../../i18n/community-translations.ts';
import { loadCommunityTranslationSnapshot } from './community-translation-files.ts';
import { isTranslatableMessageKey } from '../../../i18n/translation-scope.ts';
import { feedbackFailure, usePresentationFeedback } from '../presentation-feedback.ts';
import type { CommunityTranslationPresentationPort } from './community-translation-presentation.ts';

export interface CommunityTranslationLoadedDraft {
	readonly snapshot: ContributionSnapshot;
	readonly published: Readonly<Record<string, string>>;
	readonly draft: TranslationContribution;
	readonly persistenceError: string | null;
}

export function useCommunityTranslationDraft(port: CommunityTranslationPresentationPort, initialLocale: string, feedbackCopy: Readonly<Record<string, string>>) {
	const [locale, setLocale] = useState(initialLocale);
	const [loaded, setLoaded] = useState<CommunityTranslationLoadedDraft | null>(null);
	const [error, setError] = usePresentationFeedback(feedbackCopy);
	const [preview, setPreview] = useState(false);
	const activeLoad = useRef(0);
	const currentLoaded = useRef<CommunityTranslationLoadedDraft | null>(null);
	const currentLocale = useRef(locale);
	currentLocale.current = locale;
	const publishLoaded = useCallback((value: CommunityTranslationLoadedDraft | null): void => {
		currentLoaded.current = value;
		setLoaded(value);
	}, []);
	const store = useMemo(() => createTranslationDraftStore({
		loadSetting: async (key: string, fallback: unknown): Promise<unknown> => {
			const raw = globalThis.localStorage.getItem(key);
			return raw === null ? fallback : JSON.parse(raw) as unknown;
		},
		persistSetting: async (key: string, value: unknown): Promise<unknown> => {
			globalThis.localStorage.setItem(key, JSON.stringify(value));
			return value;
		},
	}), []);
	useEffect(() => {
		let active = true;
		const sequence = ++activeLoad.current;
		publishLoaded(null);
		setError('');
		void loadCommunityTranslationSnapshot(locale).then(async ({ snapshot, published }) => {
			const result = await store.load(snapshot);
			if (active && activeLoad.current === sequence) publishLoaded({ snapshot, published, ...result });
		}).catch((failure: unknown) => {
			if (active) setError(feedbackFailure(failure));
		});
		return () => { active = false; };
	}, [locale, store, publishLoaded]);
	useEffect(() => {
		if (preview && loaded?.snapshot.locale === locale) port.applyPreview(locale, {
			...Object.fromEntries(Object.entries(loaded.published).filter(([key]) => isTranslatableMessageKey(key))),
			...previewTranslationDraft(loaded.draft, loaded.snapshot),
		});
		else port.resetPreview();
	}, [port, locale, loaded, preview]);
	useEffect(() => () => port.resetPreview(), [port]);
	const save = useCallback(async (draft: TranslationContribution): Promise<void> => {
		const current = currentLoaded.current;
		if (!current || current.snapshot.locale !== draft.locale || currentLocale.current !== draft.locale) return;
		publishLoaded({ ...current, draft });
		const result = await store.save(draft);
		const latest = currentLoaded.current;
		if (latest?.snapshot === current.snapshot && latest.draft === draft) publishLoaded({ ...latest, ...result });
	}, [store, publishLoaded]);
	const importContributionFile = useCallback(async (file: { text(): Promise<string> }): Promise<boolean> => {
		const started = currentLoaded.current;
		if (!started || started.snapshot.locale !== currentLocale.current) return false;
		const incoming = parseTranslationContribution(await file.text());
		const current = currentLoaded.current;
		if (!current || current.snapshot !== started.snapshot || currentLocale.current !== started.snapshot.locale) return false;
		await save(mergeTranslationContributions(current.draft, incoming));
		return true;
	}, [save]);
	const assessment = useMemo(() => loaded
		? assessTranslationContribution(loaded.draft, loaded.snapshot) : null, [loaded]);
	return { locale, setLocale, loaded, assessment, error, setError, preview, setPreview, save, importContributionFile };
}

export function errorText(failure: unknown): string {
	return failure instanceof Error ? failure.message : String(failure);
}
