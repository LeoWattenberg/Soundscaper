/* SPDX-License-Identifier: AGPL-3.0-only */
import { po } from 'gettext-parser';
import {
	parseContributionSnapshot, parseTranslationContribution,
	type ContributionEntry, type TranslationContribution,
} from '../src/common/i18n/community-translations.ts';

export function importTranslationPo(poContents: string | Buffer, manifestContents: unknown, contributor?: string): TranslationContribution {
	const snapshot = parseContributionSnapshot(manifestContents);
	assertCompletePoStrings(poContents.toString());
	const table = po.parse(poContents, { validation: true, defaultCharset: 'utf-8' });
	const headers = Object.fromEntries(Object.entries(table.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
	if (headers.language !== snapshot.locale
		|| headers['x-soundscaper-snapshot'] !== snapshot.snapshotId) {
		throw new TypeError('PO language or snapshot header does not match its manifest.');
	}
	const entries: ContributionEntry[] = [];
	for (const [context, translations] of Object.entries(table.translations)) {
		for (const [source, entry] of Object.entries(translations)) {
			if (!context && !source) continue;
			const baseline = snapshot.entries[context];
			if (!baseline || source !== baseline.source) throw new TypeError(`PO source or context does not match manifest: ${context}`);
			if (entry.msgid_plural !== undefined || entry.msgstr.length !== 1) throw new TypeError('Plural PO entries are not supported by the application catalog.');
			if (entry.comments?.flag?.split(/[,\s]+/u).includes('fuzzy')) continue;
			const translation = entry.msgstr[0]!;
			if (!translation || translation === baseline.baselineText) continue;
			const attribution = entry.comments?.extracted?.split('\n').find(line => line.startsWith('Soundscaper-Contributor: '));
			const author: unknown = attribution ? JSON.parse(attribution.slice('Soundscaper-Contributor: '.length)) : undefined;
			if (author !== undefined && typeof author !== 'string') throw new TypeError('PO entry contributor must be a string.');
			entries.push({ ...baseline, translation, ...(entry.comments?.translator ? { note: entry.comments.translator } : {}),
				...(typeof author === 'string' ? { contributor: author } : {}) });
		}
	}
	return parseTranslationContribution({ version: 1, locale: snapshot.locale, snapshotId: snapshot.snapshotId,
		...(contributor ? { contributor } : {}), entries });
}

// gettext-parser validates duplicate/context/plural structure, but its lexer also
// accepts unterminated strings at EOF. Reject incomplete quoted lines before it runs.
function assertCompletePoStrings(contents: string): void {
	for (const line of contents.split(/\r?\n/u)) {
		if (!line.trim() || line.trimStart().startsWith('#')) continue;
		let quoted = false;
		let escaped = false;
		for (const character of line) {
			if (escaped) { escaped = false; continue; }
			if (quoted && character === '\\') { escaped = true; continue; }
			if (character === '"') quoted = !quoted;
		}
		if (quoted || escaped) throw new SyntaxError('PO strings must close on their own line.');
	}
}
