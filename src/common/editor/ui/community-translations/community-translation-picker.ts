/* SPDX-License-Identifier: AGPL-3.0-only */

export interface TranslationPickedText {
	readonly text: string;
	readonly attribute: string;
}

export interface TranslationCandidate extends TranslationPickedText {
	readonly key: string;
	readonly parameters: Readonly<Record<string, string>>;
}

/** Suggest every matching key: equal display text never establishes identity. */
export function findTranslationCandidates(
	texts: readonly TranslationPickedText[],
	englishCopy: Readonly<Record<string, string>>,
	currentCopy: Readonly<Record<string, string>>,
): readonly TranslationCandidate[] {
	const result: TranslationCandidate[] = [];
	const seen = new Set<string>();
	for (const picked of texts) {
		for (const [key, source] of Object.entries(englishCopy)) {
			const identity = `${key}:${picked.attribute}`;
			if (seen.has(identity)) continue;
			const parameters = matchTemplate(currentCopy[key] ?? source, picked.text)
				?? matchTemplate(source, picked.text);
			if (!parameters) continue;
			seen.add(identity);
			result.push({ key, ...picked, parameters });
		}
	}
	return result;
}

/** Inspect authored labels and accessibility copy, never user-entered values. */
export function translationTextsForElement(element: Element): readonly TranslationPickedText[] {
	const result: TranslationPickedText[] = [];
	let candidate: Element | null = element;
	for (let depth = 0; candidate && depth < 4; depth += 1, candidate = candidate.parentElement) {
		if (candidate.closest('[data-community-translation-surface]')) break;
		for (const attribute of ['title', 'aria-label', 'placeholder']) {
			const text = candidate.getAttribute(attribute)?.trim();
			if (text) result.push({ attribute, text });
		}
		if (!candidate.matches('input, textarea, [contenteditable="true"]')) {
			const text = candidate.textContent?.trim();
			if (text && text.length <= 2_000) result.push({ attribute: 'text', text });
		}
		if (candidate.matches('[data-audio-editor], [role="dialog"]')) break;
	}
	return result;
}

function matchTemplate(template: string, text: string): Readonly<Record<string, string>> | null {
	if (template.trim() === text.trim()) return {};
	const tokens = [...template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu)];
	if (!tokens.length) return null;
	if (!/\p{L}/u.test(template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, ''))) return null;
	let pattern = '^';
	let offset = 0;
	for (const token of tokens) {
		pattern += escapeRegExp(template.slice(offset, token.index)) + '(.+?)';
		offset = token.index + token[0].length;
	}
	pattern += escapeRegExp(template.slice(offset)) + '$';
	const match = new RegExp(pattern, 'u').exec(text);
	if (!match) return null;
	const parameters: Record<string, string> = {};
	for (const [index, token] of tokens.entries()) {
		const key = token[1];
		const value = match[index + 1];
		if (parameters[key] !== undefined && parameters[key] !== value) return null;
		parameters[key] = value;
	}
	return parameters;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
