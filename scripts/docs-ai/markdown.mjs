import assert from 'node:assert/strict';

import { stripProvenance } from './provenance.mjs';

const TOKEN_PATTERN = /<docs-ai-token id="(\d{4,})"\/>/gu;

function protectMatches(state, pattern, replacer = (match) => match[0]) {
	state.markdown = state.markdown.replace(pattern, (...values) => {
		const match = values.slice(0, -2);
		const protectedValue = replacer(match);
		return addToken(state, protectedValue);
	});
}

function addToken(state, protectedValue) {
	const id = String(state.tokens.size + 1).padStart(4, '0');
	const token = `<docs-ai-token id="${id}"/>`;
	state.tokens.set(token, protectedValue);
	return token;
}

export function protectMarkdown(markdown) {
	const state = { markdown: stripProvenance(markdown), tokens: new Map() };
	protectMatches(state, /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u);
	protectMatches(state, /^ {0,3}(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^ {0,3}\1[ \t]*(?:\r?\n|$)/gmu);
	protectMatches(state, /<!--[\s\S]*?-->/gu);
	protectMatches(state, /^\[[^\]\r\n]+\]:[ \t]+\S+(?:[ \t]+["'(].*["')])?[ \t]*(?:\r?\n|$)/gmu);
	protectMatches(state, /<\/?(?!docs-ai-token\b)[A-Za-z][^>\r\n]*>/gu);
	protectMatches(state, /\{#[A-Za-z][\w-]*\}/gu);
	protectMatches(state, /(`+)([^`\r\n]*?)\1/gu);
	state.markdown = state.markdown.replace(
		/(!?\[[^\]\r\n]*\])(\((?:\\.|[^)\r\n])+\)|\[[^\]\r\n]+\])/gu,
		(_full, label, destination) => `${label}${addToken(state, destination)}`,
	);
	protectMatches(state, /https?:\/\/[^\s<>"')\]]+/gu);
	protectMatches(state, /\b[a-z][a-z0-9_-]*(?:[.:/][a-z][a-z0-9_-]*)+\b/giu);
	protectMatches(state, /(?<![\w/])\.[a-z][a-z0-9]{1,9}\b/giu);
	TOKEN_PATTERN.lastIndex = 0;
	state.tokens = new Map(
		[...state.markdown.matchAll(TOKEN_PATTERN)].flatMap((match) => (
			state.tokens.has(match[0])
				? [[match[0], expandProtectedValue(match[0], state.tokens, new Set())]]
				: []
		)),
	);
	return state;
}

export function restoreMarkdown(markdown, tokens) {
	TOKEN_PATTERN.lastIndex = 0;
	const counts = new Map([...tokens.keys()].map((token) => [token, 0]));
	const returnedTokens = [];
	for (const match of markdown.matchAll(TOKEN_PATTERN)) {
		const token = match[0];
		if (!tokens.has(token)) throw new Error(`Model returned an unknown protection token: ${token}`);
		counts.set(token, (counts.get(token) ?? 0) + 1);
		returnedTokens.push(token);
	}
	for (const [token, count] of counts) {
		if (count !== 1) throw new Error(`Protection token is missing or duplicated: ${token}`);
	}
	assert.deepEqual(returnedTokens, [...tokens.keys()], 'Model changed the order of protected Markdown tokens.');
	let restored = markdown;
	for (const [token, value] of tokens) restored = restored.replace(token, () => value);
	TOKEN_PATTERN.lastIndex = 0;
	if (TOKEN_PATTERN.test(restored)) throw new Error('Restored Markdown still contains a protection token.');
	return restored;
}

function expandProtectedValue(token, tokens, visiting) {
	if (visiting.has(token)) throw new Error(`Protection token cycle detected: ${token}`);
	if (!tokens.has(token)) throw new Error(`Unknown nested protection token: ${token}`);
	const nextVisiting = new Set(visiting).add(token);
	return String(tokens.get(token)).replace(/<docs-ai-token id="\d{4,}"\/>/gu, (nested) => (
		expandProtectedValue(nested, tokens, nextVisiting)
	));
}

function protectionTokenSequence(markdown) {
	TOKEN_PATTERN.lastIndex = 0;
	return [...markdown.matchAll(TOKEN_PATTERN)].map((match) => match[0]);
}

export function assertProtectionTokenParity(source, target) {
	assert.deepEqual(
		protectionTokenSequence(target),
		protectionTokenSequence(source),
		'Model changed protected Markdown tokens.',
	);
}

export function assertModelMarkdown(markdown, options = {}) {
	const hasDisallowedControl = [...markdown].some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint === 0 || codePoint === 8 || codePoint === 11 || codePoint === 12
			|| (codePoint >= 14 && codePoint <= 31);
	});
	if (hasDisallowedControl) {
		throw new Error('Model Markdown contains control characters.');
	}
	if (options.forbidFrontmatter && /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.test(markdown)) {
		throw new Error('Model Markdown must not add frontmatter.');
	}
	TOKEN_PATTERN.lastIndex = 0;
	if (!options.allowProtectionTokens && TOKEN_PATTERN.test(markdown)) {
		TOKEN_PATTERN.lastIndex = 0;
		throw new Error('Model Markdown invented a protection token.');
	}
	TOKEN_PATTERN.lastIndex = 0;
	let openFence = null;
	for (const line of markdown.split(/\r?\n/u)) {
		const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
		if (!match) continue;
		if (!openFence) {
			openFence = { marker: match[1][0], length: match[1].length };
			continue;
		}
		if (match[1][0] === openFence.marker && match[1].length >= openFence.length && !match[2].trim()) {
			openFence = null;
		}
	}
	if (openFence) throw new Error('Model Markdown contains an unclosed fenced code block.');
}

function tokenSpanning(markdown, position) {
	TOKEN_PATTERN.lastIndex = 0;
	for (const match of markdown.matchAll(TOKEN_PATTERN)) {
		const start = match.index;
		const end = start + match[0].length;
		if (start < position && position < end) return { start, end };
		if (start >= position) break;
	}
	return null;
}

function preferredBreak(markdown, start, end, maxChars) {
	const minimum = start + Math.floor(maxChars / 2);
	for (const separator of ['\n\n', '\n', ' ']) {
		const found = markdown.lastIndexOf(separator, end - 1);
		if (found >= minimum) return found + separator.length;
	}
	return end;
}

export function chunkProtectedMarkdown(markdown, maxChars) {
	if (!Number.isSafeInteger(maxChars) || maxChars < 32) throw new Error('Chunk size must be an integer of at least 32.');
	const chunks = [];
	let offset = 0;
	while (offset < markdown.length) {
		if (markdown.length - offset <= maxChars) {
			chunks.push(markdown.slice(offset));
			break;
		}
		let end = offset + maxChars;
		const spanning = tokenSpanning(markdown, end);
		if (spanning) end = spanning.start > offset ? spanning.start : spanning.end;
		end = preferredBreak(markdown, offset, end, maxChars);
		if (end <= offset) end = Math.min(markdown.length, offset + maxChars);
		const chunk = markdown.slice(offset, end);
		if (chunk.length > maxChars && !TOKEN_PATTERN.test(chunk)) {
			throw new Error('Unable to create a bounded Markdown chunk.');
		}
		TOKEN_PATTERN.lastIndex = 0;
		chunks.push(chunk);
		offset = end;
	}
	return chunks;
}

function frontmatterOf(markdown) {
	return markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u)?.[0] ?? '';
}

function structuralSignature(markdown) {
	const clean = stripProvenance(markdown);
	return {
		frontmatter: frontmatterOf(clean),
		fences: [...clean.matchAll(/^ {0,3}(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^ {0,3}\1[ \t]*$/gmu)].map((match) => match[0]),
		inlineCode: [...clean.matchAll(/(`+)([^`\r\n]*?)\1/gu)].map((match) => match[0]),
		linkDestinations: [...clean.matchAll(/!?\[[^\]\r\n]*\](\((?:\\.|[^)\r\n])+\)|\[[^\]\r\n]+\])/gu)].map((match) => match[1]),
		urls: [...clean.matchAll(/https?:\/\/[^\s<>"')\]]+/gu)].map((match) => match[0]),
		identifiers: [...clean.matchAll(/\b[a-z][a-z0-9_-]*(?:[.:/][a-z][a-z0-9_-]*)+\b|(?<![\w/])\.[a-z][a-z0-9]{1,9}\b/giu)].map((match) => match[0]),
		headings: [...clean.matchAll(/^ {0,3}(#{1,6})\s+/gmu)].map((match) => match[1].length),
		lists: [...clean.matchAll(/^\s*(?:([-+*])|(\d+)[.)])\s+/gmu)].map((match) => match[1] ?? '#'),
		tables: clean.split(/\r?\n/u)
			.filter((line) => /^\s*\|.*\|\s*$/u.test(line))
			.map((line) => (line.match(/\|/gu) ?? []).length),
		comments: [...clean.matchAll(/<!--[\s\S]*?-->/gu)].map((match) => match[0]),
	};
}

export function assertStructuralParity(source, target) {
	assert.deepEqual(
		structuralSignature(target),
		structuralSignature(source),
		'Translated Markdown changed protected content or document structure.',
	);
}

const LOCALE_WORDS = {
	de: new Set(['aber', 'auf', 'das', 'dem', 'den', 'der', 'die', 'ein', 'eine', 'für', 'ist', 'mit', 'nicht', 'oder', 'sie', 'sind', 'und', 'werden', 'wird', 'zu']),
	en: new Set(['and', 'are', 'for', 'from', 'is', 'not', 'or', 'the', 'this', 'to', 'with', 'will']),
};

function proseWords(markdown) {
	const protectedDocument = protectMarkdown(markdown);
	return protectedDocument.markdown
		.replace(TOKEN_PATTERN, ' ')
		.toLocaleLowerCase('en')
		.match(/\p{L}+/gu) ?? [];
}

export function assertLocale(markdown, locale) {
	if (!Object.hasOwn(LOCALE_WORDS, locale)) throw new Error(`Unsupported locale: ${locale}. Supported locales are en and de.`);
	const words = proseWords(markdown);
	if (words.length < 8) return;
	const expected = words.filter((word) => LOCALE_WORDS[locale].has(word)).length;
	const competingLocale = locale === 'de' ? 'en' : 'de';
	const competing = words.filter((word) => LOCALE_WORDS[competingLocale].has(word)).length;
	if (competing >= 3 && competing > expected * 2) {
		throw new Error(`Model response does not appear to use the expected ${locale === 'de' ? 'German' : 'English'} locale.`);
	}
}
