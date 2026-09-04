/* SPDX-License-Identifier: AGPL-3.0-only */

// Reading Audacity's Qt translation catalogs. A .ts file is untrusted XML from
// an upstream workflow, so the parser is bounded in catalogs and messages,
// admits only the elements it models, and identifies every message by the exact
// context, source and comment triple Qt keys it on. Split out of
// audacity-qt-translations.mjs; no behaviour changes here.

import { SaxesParser } from 'saxes';

import { AUDACITY_TO_BCP47 } from '../../src/common/i18n/locales.js';
import { TranslationArtifactError, inspectVerifiedZip } from './verified-zip.mjs';
import { fail } from './audacity-qt-values.mjs';

export const MAX_QT_CATALOGS = 128;
export const MAX_QT_MESSAGES = 50_000;
export const QT_CATALOG_NAME = /^audacity_([A-Za-z0-9][A-Za-z0-9_@-]*)\.ts$/u;

export function parseQtTs(input, options = {}) {
	const fileName = options.fileName || '<Qt TS>';
	const xml = decodeUtf8(input, fileName);
	let root = null;
	let doctypeSeen = false;
	let currentContext = null;
	let currentMessage = null;
	let capture = null;
	let messageCount = 0;
	let contextCount = 0;
	const stack = [];
	const messages = [];
	const parser = new SaxesParser({ fileName, xmlns: false });

	parser.on('doctype', (doctype) => {
		if (doctypeSeen || String(doctype).trim() !== 'TS') {
			fail('QT_TS_DOCTYPE', `${fileName} must contain only the standard <!DOCTYPE TS> declaration.`);
		}
		doctypeSeen = true;
	});
	parser.on('processinginstruction', ({ target }) => {
		fail('QT_TS_PROCESSING_INSTRUCTION', `${fileName} contains unsupported processing instruction ${target}.`);
	});
	parser.on('opentag', (node) => {
		stack.push(node.name);
		const depth = stack.length;
		if (depth === 1) {
			if (node.name !== 'TS' || root) fail('QT_TS_ROOT', `${fileName} must have one TS root element.`);
			root = {
				version: attribute(node, 'version'),
				language: attribute(node, 'language'),
			};
			return;
		}
		if (depth === 2 && node.name === 'context') {
			if (currentContext) fail('QT_TS_CONTEXT_NESTING', `${fileName} contains nested contexts.`);
			contextCount += 1;
			if (contextCount > MAX_QT_MESSAGES) fail('QT_TS_CONTEXT_LIMIT', `${fileName} has too many contexts.`);
			currentContext = { name: null };
			return;
		}
		if (depth === 3 && currentContext && node.name === 'name') {
			startCapture('contextName', depth);
			return;
		}
		if (depth === 3 && currentContext && node.name === 'message') {
			if (currentMessage) fail('QT_TS_MESSAGE_NESTING', `${fileName} contains nested messages.`);
			messageCount += 1;
			if (messageCount > (options.maxMessages || MAX_QT_MESSAGES)) {
				fail('QT_TS_MESSAGE_LIMIT', `${fileName} has too many messages.`);
			}
			currentMessage = {
				comment: null,
				context: currentContext.name,
				numerus: attribute(node, 'numerus').toLowerCase() === 'yes',
				source: null,
				translation: null,
				translationType: '',
				unsupportedMarkup: false,
			};
			return;
		}
		if (depth === 4 && currentMessage) {
			if (node.name === 'source') startCapture('source', depth);
			else if (node.name === 'comment') startCapture('comment', depth);
			else if (node.name === 'translation') {
				currentMessage.translationType = attribute(node, 'type');
				if (attribute(node, 'variants').toLowerCase() === 'yes') currentMessage.unsupportedMarkup = true;
				startCapture('translation', depth);
			}
			return;
		}
		if (currentMessage && (node.name === 'numerusform' || node.name === 'lengthvariant')) {
			if (node.name === 'numerusform') currentMessage.numerus = true;
			currentMessage.unsupportedMarkup = true;
		}
		if (capture && depth > capture.depth) {
			if (capture.kind === 'contextName') {
				fail('QT_TS_CONTEXT_NAME_MARKUP', `${fileName} contains markup inside a context name.`);
			}
			currentMessage.unsupportedMarkup = true;
		}
	});
	parser.on('text', appendCapturedText);
	parser.on('cdata', appendCapturedText);
	parser.on('closetag', (node) => {
		const depth = stack.length;
		if (capture && capture.depth === depth && capture.element === node.name) finishCapture();
		if (depth === 3 && node.name === 'message' && currentMessage) {
			if (currentMessage.context == null || currentMessage.source == null || currentMessage.translation == null) {
				fail('QT_TS_MESSAGE_SHAPE', `${fileName} contains a message without context, source, or translation.`);
			}
			messages.push(Object.freeze({ ...currentMessage, comment: currentMessage.comment || '' }));
			currentMessage = null;
		}
		if (depth === 2 && node.name === 'context' && currentContext) {
			if (!currentContext.name) fail('QT_TS_CONTEXT_NAME', `${fileName} contains an unnamed context.`);
			currentContext = null;
		}
		if (stack.pop() !== node.name) fail('QT_TS_NESTING', `${fileName} contains mismatched elements.`);
	});

	try {
		parser.write(xml).close();
	} catch (error) {
		if (error instanceof TranslationArtifactError) throw error;
		throw new TranslationArtifactError('QT_TS_XML', `${fileName} is not well-formed XML: ${error.message}`);
	}
	if (!root || root.version !== '2.1' || !root.language || !doctypeSeen) {
		fail('QT_TS_SCHEMA', `${fileName} must be a Qt TS 2.1 catalog with a language and standard doctype.`);
	}
	return Object.freeze({
		version: root.version,
		language: root.language,
		messages: Object.freeze(messages),
	});

	function startCapture(kind, depth) {
		if (capture) fail('QT_TS_TEXT_NESTING', `${fileName} contains nested translatable text elements.`);
		capture = { kind, depth, element: stack.at(-1), chunks: [] };
	}

	function appendCapturedText(text) {
		if (capture) capture.chunks.push(text);
	}

	function finishCapture() {
		const value = capture.chunks.join('');
		if (capture.kind === 'contextName') {
			if (currentContext.name != null) fail('QT_TS_CONTEXT_NAME', `${fileName} repeats a context name.`);
			currentContext.name = value;
		} else {
			if (currentMessage[capture.kind] != null) {
				fail('QT_TS_MESSAGE_SHAPE', `${fileName} repeats message ${capture.kind}.`);
			}
			currentMessage[capture.kind] = value;
		}
		capture = null;
	}
}


export function readAudacityQtCatalogsFromZip(archiveBytes, options = {}) {
	const archive = inspectVerifiedZip(archiveBytes, options);
	const tsEntries = archive.entries.filter((entry) => entry.name.endsWith('.ts'));
	if (tsEntries.length === 0 || tsEntries.length > (options.maxCatalogs || MAX_QT_CATALOGS)) {
		fail('QT_CATALOG_COUNT', 'Audacity artifact has an invalid number of Qt TS catalogs.');
	}
	const catalogs = new Map();
	for (const entry of tsEntries) {
		const match = QT_CATALOG_NAME.exec(entry.name);
		if (!match || entry.name.includes('/')) fail('QT_CATALOG_NAME', `Unexpected Qt TS catalog path ${entry.name}.`);
		const fileLocale = normalizeQtLocale(match[1]);
		const locale = AUDACITY_TO_BCP47[match[1]] || fileLocale;
		if (catalogs.has(locale)) fail('QT_CATALOG_LOCALE_DUPLICATE', `Duplicate normalized Qt locale ${locale}.`);
		const catalog = parseQtTs(archive.readEntry(entry.name), { fileName: entry.name });
		const declaredLocale = normalizeQtLocale(catalog.language);
		if (baseLanguage(locale) !== baseLanguage(declaredLocale)) {
			fail('QT_CATALOG_LANGUAGE', `${entry.name} declares unrelated locale ${catalog.language}.`);
		}
		const fileTokenHasRegionOrScript = /[_-]/u.test(match[1]);
		if (fileTokenHasRegionOrScript && !match[1].includes('@') && fileLocale !== declaredLocale) {
			fail('QT_CATALOG_LANGUAGE', `${entry.name} declares mismatched locale ${catalog.language}.`);
		}
		catalogs.set(locale, Object.freeze({ ...catalog, archivePath: entry.name, locale }));
	}
	return Object.freeze({ archive, catalogs });
}


export function normalizeQtLocale(input) {
	if (typeof input !== 'string' || !input || !/^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*(?:@[A-Za-z0-9]+)?$/u.test(input)) {
		fail('QT_LOCALE', `Invalid Qt locale ${JSON.stringify(input)}.`);
	}
	const [base, rawModifier] = input.split('@');
	let parts = base.replaceAll('_', '-').split('-');
	if (rawModifier) {
		const modifier = rawModifier.toLowerCase();
		if (modifier === 'latin') parts.splice(1, 0, 'Latn');
		else if (/^[a-z0-9]{5,8}$/u.test(modifier)) parts.push(modifier);
		else fail('QT_LOCALE_MODIFIER', `Qt locale modifier ${rawModifier} is not BCP-47 compatible.`);
	}
	try {
		return new Intl.Locale(parts.join('-')).toString();
	} catch {
		fail('QT_LOCALE', `Qt locale ${input} cannot be normalized to BCP-47.`);
	}
}


export function qtIdentity(context, source, comment) {
	return JSON.stringify([context, source, comment]);
}


export function attribute(node, name) {
	const value = node.attributes?.[name];
	return typeof value === 'string' ? value : '';
}

export function decodeUtf8(input, fileName) {
	if (typeof input === 'string') return input;
	const bytes = asBytes(input, 'QT_TS_INPUT');
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		fail('QT_TS_ENCODING', `${fileName} is not valid UTF-8.`);
	}
}

export function asBytes(input, code) {
	if (Buffer.isBuffer(input)) return input;
	if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	if (input instanceof ArrayBuffer) return Buffer.from(input);
	fail(code, 'Expected byte input.');
}

export function baseLanguage(locale) {
	return new Intl.Locale(locale).language;
}

