/* SPDX-License-Identifier: AGPL-3.0-only */

import { SaxesParser } from 'saxes';

/**
 * The XML layer the DAWproject reader and writer share.
 *
 * DAWproject is two XML documents inside a ZIP, and its reference
 * implementation is a JAXB object model, so what a file really is comes down to
 * element names, attribute names, and the order of children. This module holds
 * one plain element tree for both directions: the writer builds it and
 * serializes it, the reader parses into it and walks it. Nothing here knows
 * what a Track or a Clip means; that is the two modules beside it.
 *
 * Parsing is bounded. A project file is user-supplied bytes, so the element
 * count, depth, and text size are capped before anything is allocated on
 * their behalf, and the document is refused rather than truncated when a cap
 * is exceeded — a silently truncated arrangement would import as an edit the
 * user never made.
 */

export interface XmlElement {
	readonly name: string;
	readonly attributes: Readonly<Record<string, string>>;
	readonly children: readonly XmlElement[];
	/** Concatenated character data, trimmed; element content only. */
	readonly text: string;
}

export type XmlAttributeValue = string | number | boolean | null | undefined;

export interface XmlParseLimits {
	readonly maximumBytes: number;
	readonly maximumDepth: number;
	readonly maximumElements: number;
	readonly maximumTextBytes: number;
}

export const DAWPROJECT_XML_LIMITS: XmlParseLimits = Object.freeze({
	maximumBytes: 64 * 1024 * 1024,
	maximumDepth: 64,
	maximumElements: 2_000_000,
	maximumTextBytes: 1024 * 1024,
});

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Build one element. Null and undefined attribute values are omitted, not written as "null". */
export function xmlElement(
	name: string,
	attributes: Readonly<Record<string, XmlAttributeValue>> = {},
	children: readonly (XmlElement | null | undefined)[] = [],
	text = '',
): XmlElement {
	if (!isXmlName(name)) throw new TypeError(`Invalid XML element name: ${name}.`);
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(attributes)) {
		if (value === null || value === undefined) continue;
		if (!isXmlName(key)) throw new TypeError(`Invalid XML attribute name: ${key}.`);
		normalized[key] = typeof value === 'number' ? formatXmlNumber(value) : String(value);
	}
	return Object.freeze({
		name,
		attributes: Object.freeze(normalized),
		children: Object.freeze(children.filter((child): child is XmlElement => Boolean(child))),
		text: String(text ?? ''),
	});
}

/**
 * Numbers at full precision, integers without a fraction so `xs:int` attributes
 * stay integers. The reference marshaller writes six decimals for
 * note and automation times and full precision elsewhere; the schema mandates
 * neither, and a reader that wants exactness is better served by the shortest
 * round-tripping form. Exponent notation is avoided because not every XML
 * consumer parses `1e-7` as xs:double claims it should.
 */
export function formatXmlNumber(value: number): string {
	if (!Number.isFinite(value)) throw new RangeError('XML numbers must be finite.');
	const text = String(value);
	if (!/e/iu.test(text)) return text;
	return value.toFixed(20).replace(/0+$/u, '').replace(/\.$/u, '.0');
}

export function serializeXmlDocument(root: XmlElement): string {
	const lines: string[] = [XML_DECLARATION];
	serializeInto(root, 0, lines);
	return `${lines.join('\n')}\n`;
}

function serializeInto(element: XmlElement, depth: number, lines: string[]): void {
	const indent = '  '.repeat(depth);
	const attributes = Object.entries(element.attributes)
		.map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
		.join('');
	if (element.children.length === 0) {
		lines.push(element.text
			? `${indent}<${element.name}${attributes}>${escapeXml(element.text)}</${element.name}>`
			: `${indent}<${element.name}${attributes}/>`);
		return;
	}
	lines.push(`${indent}<${element.name}${attributes}>`);
	for (const child of element.children) serializeInto(child, depth + 1, lines);
	lines.push(`${indent}</${element.name}>`);
}

/** Escape for both attribute and element content; strip characters XML 1.0 cannot carry. */
export function escapeXml(value: string): string {
	return value
		// XML 1.0 cannot carry these code points at all; the rule guards against typos, this is the point.
		// eslint-disable-next-line no-control-regex
		.replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/gu, '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

interface OpenElement {
	readonly name: string;
	readonly attributes: Record<string, string>;
	readonly children: XmlElement[];
	textBytes: number;
	text: string[];
}

export function parseXmlDocument(text: string, limits: XmlParseLimits = DAWPROJECT_XML_LIMITS): XmlElement {
	if (typeof text !== 'string') throw new TypeError('An XML document must be a string.');
	if (text.length > limits.maximumBytes) {
		throw new RangeError(`The XML document exceeds the ${String(limits.maximumBytes)}-byte limit.`);
	}
	const parser = new SaxesParser({ xmlns: false, position: true });
	const stack: OpenElement[] = [];
	let root: XmlElement | null = null;
	let elements = 0;
	let failure: Error | null = null;
	const fail = (error: Error): void => {
		failure ??= error;
	};
	parser.on('error', (error) => { fail(error instanceof Error ? error : new Error(String(error))); });
	parser.on('opentag', (tag) => {
		if (failure) return;
		elements += 1;
		if (elements > limits.maximumElements) {
			fail(new RangeError(`The XML document exceeds ${String(limits.maximumElements)} elements.`));
			return;
		}
		if (stack.length >= limits.maximumDepth) {
			fail(new RangeError(`The XML document nests deeper than ${String(limits.maximumDepth)} levels.`));
			return;
		}
		if (root && stack.length === 0) {
			fail(new SyntaxError('The XML document has more than one root element.'));
			return;
		}
		const attributes: Record<string, string> = {};
		for (const [key, value] of Object.entries(tag.attributes)) attributes[key] = String(value);
		stack.push({ name: tag.name, attributes, children: [], textBytes: 0, text: [] });
	});
	parser.on('text', (value) => {
		if (failure) return;
		const open = stack.at(-1);
		if (!open) return;
		open.textBytes += value.length;
		if (open.textBytes > limits.maximumTextBytes) {
			fail(new RangeError(`An XML element carries more than ${String(limits.maximumTextBytes)} bytes of text.`));
			return;
		}
		open.text.push(value);
	});
	parser.on('closetag', () => {
		if (failure) return;
		const open = stack.pop();
		if (!open) return;
		const element: XmlElement = Object.freeze({
			name: open.name,
			attributes: Object.freeze(open.attributes),
			children: Object.freeze(open.children),
			text: open.text.join('').trim(),
		});
		const parent = stack.at(-1);
		if (parent) parent.children.push(element);
		else root = element;
	});
	parser.write(text).close();
	if (failure) throw failure;
	if (!root) throw new SyntaxError('The XML document has no root element.');
	return root;
}

export function childElement(element: XmlElement, name: string): XmlElement | null {
	return element.children.find((child) => child.name === name) ?? null;
}

export function childElements(element: XmlElement, name: string): readonly XmlElement[] {
	return element.children.filter((child) => child.name === name);
}

export function attribute(element: XmlElement, name: string): string | null {
	return Object.hasOwn(element.attributes, name) ? element.attributes[name]! : null;
}

/** A finite number, or null when absent. Malformed values are errors, not zeros. */
export function numberAttribute(element: XmlElement, name: string): number | null {
	const value = attribute(element, name);
	if (value === null || value.trim() === '') return null;
	const trimmed = value.trim();
	if (trimmed === 'inf') return Number.POSITIVE_INFINITY;
	if (trimmed === '-inf') return Number.NEGATIVE_INFINITY;
	const number = Number(trimmed);
	if (!Number.isFinite(number)) {
		throw new RangeError(`<${element.name} ${name}="${value}"> is not a number.`);
	}
	return number;
}

export function integerAttribute(element: XmlElement, name: string): number | null {
	const number = numberAttribute(element, name);
	if (number === null) return null;
	if (!Number.isSafeInteger(number)) throw new RangeError(`<${element.name} ${name}> must be an integer.`);
	return number;
}

export function booleanAttribute(element: XmlElement, name: string): boolean | null {
	const value = attribute(element, name);
	if (value === null) return null;
	const trimmed = value.trim().toLowerCase();
	if (trimmed === 'true' || trimmed === '1') return true;
	if (trimmed === 'false' || trimmed === '0') return false;
	throw new RangeError(`<${element.name} ${name}="${value}"> is not a boolean.`);
}

/** Every element in document order, for id indexes and feature counts. */
export function* walkXml(element: XmlElement): Generator<XmlElement> {
	yield element;
	for (const child of element.children) yield* walkXml(child);
}

const XML_NAME = /^[A-Za-z_][\w.-]*$/u;

function isXmlName(value: string): boolean {
	return XML_NAME.test(value);
}
