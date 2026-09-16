/* SPDX-License-Identifier: AGPL-3.0-only */
import {
	createTranslationDraft, parseTranslationContribution,
	type ContributionSnapshot, type TranslationContribution,
} from '../../../i18n/community-translations.ts';

export interface TranslationDraftState {
	readonly draft: TranslationContribution;
	readonly persistenceError: string | null;
}
export interface TranslationDraftStorage {
	readonly loadSetting: (key: string, fallback: unknown) => Promise<unknown>;
	readonly persistSetting: (key: string, value: unknown) => Promise<unknown>;
}

/** Drafts survive failed writes in memory, so contributors can still export their work. */
export function createTranslationDraftStore(storage: TranslationDraftStorage) {
	const memory = new Map<string, TranslationDraftState>();
	let tail = Promise.resolve();
	return Object.freeze({ load, save, clear });

	async function load(snapshot: ContributionSnapshot): Promise<TranslationDraftState> {
		const cached = memory.get(snapshot.locale);
		if (cached) return cached;
		let state: TranslationDraftState;
		try {
			const saved = await storage.loadSetting(settingKey(snapshot.locale), null);
			const draft = saved ? parseTranslationContribution(saved) : createTranslationDraft(snapshot);
			if (draft.locale !== snapshot.locale) throw new TypeError('Saved draft language does not match.');
			state = Object.freeze({ draft, persistenceError: null });
		} catch (error) {
			state = Object.freeze({ draft: createTranslationDraft(snapshot), persistenceError: errorMessage(error) });
		}
		const newer = memory.get(snapshot.locale);
		if (newer) return newer;
		memory.set(snapshot.locale, state);
		return state;
	}

	function save(input: TranslationContribution): Promise<TranslationDraftState> {
		const draft = parseTranslationContribution(input);
		memory.set(draft.locale, Object.freeze({ draft, persistenceError: null }));
		const operation = tail.then(async () => {
			let persistenceError: string | null = null;
			try {
				await storage.persistSetting(settingKey(draft.locale), draft);
			} catch (error) {
				persistenceError = errorMessage(error);
			}
			const state = Object.freeze({ draft, persistenceError });
			if (memory.get(draft.locale)?.draft === draft) memory.set(draft.locale, state);
			return state;
		});
		tail = operation.then(() => undefined);
		return operation;
	}

	function clear(snapshot: ContributionSnapshot): Promise<TranslationDraftState> {
		return save(createTranslationDraft(snapshot));
	}
}

function settingKey(locale: string): string {
	return `soundscaper-community-translations-v1:${locale}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
