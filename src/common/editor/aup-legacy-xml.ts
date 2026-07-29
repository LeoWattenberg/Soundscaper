/* SPDX-License-Identifier: AGPL-3.0-only */

import { SaxesParser } from 'saxes';

export interface LegacyAupXmlLimits {
	readonly maximumBytes: number;
	readonly maximumElements: number;
	readonly maximumAttributes: number;
	readonly maximumDepth: number;
}

export interface LegacyAupXmlNode {
	readonly name: string;
	readonly attributes: Record<string, string>;
	readonly children: LegacyAupXmlNode[];
}

interface LegacyAupXmlFile {
	readonly size: number;
	text(): Promise<string>;
}

export const LEGACY_AUP_XML_HARD_LIMITS: Readonly<LegacyAupXmlLimits> = Object.freeze({
	maximumBytes: 16 * 1024 * 1024,
	maximumElements: 100_000,
	maximumAttributes: 400_000,
	maximumDepth: 128,
});

const AUDACITY_PUBLIC_DOCTYPE = /^\s*project\s+PUBLIC\s+(["'])-\/\/audacityproject-[^"'<>\[\]]+\/\/DTD\/\/EN\1\s+(["'])[^"'<>\[\]]*audacityproject-[^"'<>\[\]]+\.dtd\2\s*$/iu;

export class LegacyAupError extends Error {
	readonly code: string;
	readonly details: Readonly<Record<string, unknown>>;

	constructor(message: string, code = 'LEGACY_AUP_ERROR', details: Readonly<Record<string, unknown>> = {}) {
		super(message);
		this.name = 'LegacyAupError';
		this.code = code;
		this.details = details;
	}
}

export function resolveLegacyAupXmlLimits(
	overrides: Partial<LegacyAupXmlLimits> = {},
): Readonly<LegacyAupXmlLimits> {
	if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
		throw new TypeError('Legacy AUP XML parse limits must be an object.');
	}
	for (const name of Object.keys(overrides)) {
		if (!Object.hasOwn(LEGACY_AUP_XML_HARD_LIMITS, name)) {
			throw new TypeError(`Unsupported legacy AUP XML parse limit: ${name}.`);
		}
	}
	const limits = { ...LEGACY_AUP_XML_HARD_LIMITS, ...overrides };
	for (const name of Object.keys(LEGACY_AUP_XML_HARD_LIMITS) as (keyof LegacyAupXmlLimits)[]) {
		const value = limits[name];
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError(`Legacy AUP XML ${name} must be a positive safe integer.`);
		}
		if (value > LEGACY_AUP_XML_HARD_LIMITS[name]) {
			throw new RangeError(`Legacy AUP XML ${name} cannot exceed its hard limit.`);
		}
	}
	return Object.freeze(limits);
}

export async function readLegacyAupXml(
	input: unknown,
	overrides: Partial<LegacyAupXmlLimits> = {},
): Promise<LegacyAupXmlNode> {
	const limits = resolveLegacyAupXmlLimits(overrides);
	assertLegacyAupXmlFile(input);
	if (input.size > limits.maximumBytes) {
		throw xmlLimitError(
			'The legacy AUP XML declared size exceeds its byte limit.',
			'PROJECT_XML_TOO_LARGE',
			'maximumBytes',
			limits.maximumBytes,
			input.size,
		);
	}
	const xml = await input.text();
	if (typeof xml !== 'string') throw new TypeError('A legacy Audacity project must return XML text.');
	assertUtf8ByteLimit(xml, limits.maximumBytes);
	return parseLegacyAupXml(xml, limits);
}

function assertLegacyAupXmlFile(input: unknown): asserts input is LegacyAupXmlFile {
	if (!input || typeof input !== 'object' || typeof (input as { text?: unknown }).text !== 'function') {
		throw new TypeError('A legacy Audacity project file is required.');
	}
	const size = (input as { size?: unknown }).size;
	if (!Number.isSafeInteger(size) || (size as number) < 0) {
		throw new RangeError('A legacy Audacity project requires a non-negative safe declared size.');
	}
}

function assertUtf8ByteLimit(xml: string, maximumBytes: number): void {
	let byteLength = 0;
	for (let index = 0; index < xml.length; index += 1) {
		const first = xml.charCodeAt(index);
		let encodedBytes: number;
		if (first <= 0x7f) encodedBytes = 1;
		else if (first <= 0x7ff) encodedBytes = 2;
		else if (first >= 0xd800 && first <= 0xdbff
			&& index + 1 < xml.length
			&& xml.charCodeAt(index + 1) >= 0xdc00
			&& xml.charCodeAt(index + 1) <= 0xdfff) {
			encodedBytes = 4;
			index += 1;
		} else encodedBytes = 3;
		if (encodedBytes > maximumBytes - byteLength) {
			throw xmlLimitError(
				'The legacy AUP XML actual UTF-8 size exceeds its byte limit.',
				'PROJECT_XML_TOO_LARGE',
				'maximumBytes',
				maximumBytes,
				byteLength + encodedBytes,
			);
		}
		byteLength += encodedBytes;
	}
}

function parseLegacyAupXml(xml: string, limits: Readonly<LegacyAupXmlLimits>): LegacyAupXmlNode {
	const roots: LegacyAupXmlNode[] = [];
	const stack: LegacyAupXmlNode[] = [];
	let elementCount = 0;
	let attributeCount = 0;
	const parser = new SaxesParser({ xmlns: false, position: false });

	parser.on('doctype', (doctype) => {
		if (/\[|<!\s*ENTITY\b/iu.test(doctype) || !AUDACITY_PUBLIC_DOCTYPE.test(doctype)) {
			throw invalidXml('Legacy AUP XML contains an unsupported document type declaration.');
		}
	});
	parser.on('processinginstruction', () => {
		throw invalidXml('Legacy AUP XML contains an unsupported processing instruction.');
	});
	parser.on('attribute', () => {
		attributeCount += 1;
		if (attributeCount > limits.maximumAttributes) {
			throw xmlLimitError(
				'The legacy AUP XML contains too many attributes.',
				'PROJECT_XML_ATTRIBUTE_LIMIT',
				'maximumAttributes',
				limits.maximumAttributes,
				attributeCount,
			);
		}
	});
	parser.on('opentag', (tag) => {
		if (elementCount >= limits.maximumElements) {
			throw xmlLimitError(
				'The legacy AUP XML contains too many elements.',
				'PROJECT_XML_NODE_LIMIT',
				'maximumElements',
				limits.maximumElements,
				elementCount + 1,
			);
		}
		if (stack.length >= limits.maximumDepth) {
			throw xmlLimitError(
				'The legacy AUP XML is nested too deeply.',
				'PROJECT_XML_DEPTH_LIMIT',
				'maximumDepth',
				limits.maximumDepth,
				stack.length + 1,
			);
		}
		elementCount += 1;
		const node: LegacyAupXmlNode = {
			name: tag.name,
			attributes: { ...tag.attributes },
			children: [],
		};
		const parent = stack.at(-1);
		if (parent) parent.children.push(node);
		else roots.push(node);
		stack.push(node);
	});
	parser.on('closetag', () => {
		stack.pop();
	});

	try {
		parser.write(xml).close();
	} catch (error) {
		if (error instanceof LegacyAupError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		throw invalidXml(`Legacy AUP XML is not well formed: ${message}`);
	}
	if (roots.length !== 1 || stack.length !== 0) {
		throw invalidXml('Legacy AUP XML must contain exactly one complete root element.');
	}
	return roots[0];
}

function invalidXml(message: string): LegacyAupError {
	return new LegacyAupError(message, 'INVALID_PROJECT_XML');
}

function xmlLimitError(
	message: string,
	code: string,
	limit: keyof LegacyAupXmlLimits,
	maximum: number,
	observed: number,
): LegacyAupError {
	return new LegacyAupError(message, code, { limit, maximum, observed });
}
