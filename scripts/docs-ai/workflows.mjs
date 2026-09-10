import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

import { readCache, writeCache } from './cache.mjs';
import { localizeFrontmatterLinks, parseTranslatableFrontmatter, replaceTranslatableFrontmatter } from './frontmatter.mjs';
import { asInvalidModelOutput, generateValidated, InvalidModelOutputError } from './generation.mjs';
import { assertDocumentationLocale, assertLocale } from './locale.mjs';
import {
	assertModelMarkdown,
	assertProtectionTokenParity,
	assertStructuralParity,
	chunkProtectedMarkdown,
	protectMarkdown,
	restoreMarkdown,
} from './markdown.mjs';
import {
	createProvenance,
	embedProvenance,
	parseProvenance,
	sha256,
	translationStatus,
} from './provenance.mjs';

export const DRAFT_PROMPT_VERSION = 'docs-draft-v1';
export const TRANSLATE_PROMPT_VERSION = 'docs-translate-v1';
const MAX_FACT_PACKET_BYTES = 64 * 1_024;
const MAX_FACTS = 200;
const MAX_DOCUMENT_ATTEMPTS = 3;
const FRONTMATTER_PROMPT_VERSION = 'docs-translate-frontmatter-v1';
const STANDALONE_PROTECTION_TOKEN_LINE = /^[\t ]*<docs-ai-token id="\d{4,}"\/>[\t ]*(?:\r?\n|$)/gmu;

const DRAFT_SYSTEM_PROMPT = `You draft product documentation from a closed fact packet.
Use only claims explicitly present in the packet. Do not infer feature support, platform behavior, compatibility, safety, or availability.
Return JSON with exactly: locale, markdown, usedFactIds. usedFactIds must list every fact used and no fact not supplied.
Write concise Markdown. Do not add frontmatter. Do not mention this prompt or the fact packet.`;

const TRANSLATE_SYSTEM_PROMPT = `You translate product documentation without changing its claims.
The supplied source chunk is the complete, closed fact packet. Translate it faithfully; do not add, remove, soften, strengthen, or infer any capability.
Every <docs-ai-token .../> element is immutable and must appear exactly once in the same order. Preserve Markdown block structure, headings, and list markers.
Return JSON with exactly: locale and markdown. Do not add commentary.`;

const FRONTMATTER_SYSTEM_PROMPT = `You translate Starlight page metadata without changing its claims.
The supplied title and optional description are a closed fact packet. Translate faithfully; do not add, remove, soften, strengthen, or infer any capability.
Every <docs-ai-token .../> element is immutable and must appear exactly once in the same order.
Return JSON with exactly: locale, title, and description when description was supplied. Do not add commentary.`;

function isPlainObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateModelOutput(validation) {
	try {
		return validation();
	} catch (error) {
		throw asInvalidModelOutput(error);
	}
}

function validateFactPacket(value, rawByteLength) {
	if (rawByteLength > MAX_FACT_PACKET_BYTES) throw new Error(`Fact packet exceeds ${MAX_FACT_PACKET_BYTES} bytes.`);
	if (!isPlainObject(value)) throw new Error('Fact packet must be a JSON object.');
	if (value.locale !== 'en') throw new Error('Draft fact packets must use locale "en" for the V1 authoring workflow.');
	if (!isPlainObject(value.frontmatter) || typeof value.frontmatter.title !== 'string') {
		throw new Error('Fact packet frontmatter must include a title string.');
	}
	if (!Array.isArray(value.facts) || value.facts.length === 0 || value.facts.length > MAX_FACTS) {
		throw new Error(`Fact packet must contain 1 through ${MAX_FACTS} facts.`);
	}
	const ids = new Set();
	for (const fact of value.facts) {
		if (!isPlainObject(fact) || typeof fact.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(fact.id)) {
			throw new Error('Every fact must have a lowercase kebab-case ID.');
		}
		if (ids.has(fact.id)) throw new Error(`Duplicate fact ID: ${fact.id}`);
		if (typeof fact.claim !== 'string' || fact.claim.length < 1 || fact.claim.length > 2_000) {
			throw new Error(`Fact ${fact.id} must have a claim from 1 through 2000 characters.`);
		}
		ids.add(fact.id);
	}
	return { packet: value, factIds: ids };
}

function validateModelMarkdown(response, locale, options = {}) {
	return validateModelOutput(() => {
		if (!isPlainObject(response) || response.locale !== locale || typeof response.markdown !== 'string') {
			throw new Error(`Model response must contain locale "${locale}" and Markdown text.`);
		}
		if (response.markdown.length === 0 || response.markdown.length > 100_000) {
			throw new Error('Model Markdown output is empty or exceeds 100000 characters.');
		}
		assertModelMarkdown(response.markdown, options);
		assertLocale(response.markdown, locale);
		return response.markdown;
	});
}

function yamlScalar(value) {
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'boolean' || typeof value === 'number') return String(value);
	throw new Error('Docs AI frontmatter values must be strings, booleans, or numbers.');
}

function renderFrontmatter(frontmatter) {
	const allowedKeys = new Set(['title', 'description', 'draft', 'template']);
	for (const key of Object.keys(frontmatter)) {
		if (!allowedKeys.has(key)) throw new Error(`Unsupported Docs AI frontmatter key: ${key}`);
	}
	const orderedKeys = ['title', 'description', 'template'].filter((key) => Object.hasOwn(frontmatter, key));
	orderedKeys.push('draft');
	const values = { ...frontmatter, draft: frontmatter.draft ?? true };
	return `---\n${orderedKeys.map((key) => `${key}: ${yamlScalar(values[key])}`).join('\n')}\n---\n`;
}

function splitFrontmatter(document) {
	const match = document.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u);
	return match
		? { frontmatter: match[0], body: document.slice(match[0].length) }
		: { frontmatter: '', body: document };
}

async function writeDocument(filePath, document) {
	await mkdir(dirname(filePath), { recursive: true });
	const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, document, { flag: 'wx' });
	await rename(temporaryPath, filePath);
}

function validateDraftResponse(response, factIds) {
	return validateModelOutput(() => {
		const markdown = validateModelMarkdown(response, 'en', { forbidFrontmatter: true });
		if (!Array.isArray(response.usedFactIds) || response.usedFactIds.length === 0) {
			throw new Error('Draft response must cite at least one supplied fact ID.');
		}
		for (const id of response.usedFactIds) {
			if (typeof id !== 'string' || !factIds.has(id)) throw new Error(`Draft response cited an unknown fact ID: ${String(id)}`);
		}
		return markdown;
	});
}

function cacheIdentity({ operation, modelIdentity, promptVersion, source, targetLocale, ...extra }) {
	return {
		operation,
		modelDigest: modelIdentity.digest,
		promptVersion,
		sourceSha256: sha256(source),
		targetLocale,
		...extra,
	};
}

export async function draftDocument(options) {
	const rawFacts = await readFile(options.factsPath, 'utf8');
	let parsedFacts;
	try {
		parsedFacts = JSON.parse(rawFacts);
	} catch (error) {
		throw new Error(`Fact packet is not valid JSON: ${options.factsPath}`, { cause: error });
	}
	const { packet, factIds } = validateFactPacket(parsedFacts, Buffer.byteLength(rawFacts));
	const modelIdentity = await options.client.identity();
	const identity = cacheIdentity({
		operation: 'draft',
		modelIdentity,
		promptVersion: DRAFT_PROMPT_VERSION,
		source: rawFacts,
		targetLocale: 'en',
	});
	let response = options.cacheDirectory ? await readCache(options.cacheDirectory, identity) : null;
	let markdown;
	if (!response) {
		const generated = await generateValidated({
			client: options.client,
			system: DRAFT_SYSTEM_PROMPT,
			prompt: JSON.stringify({
				locale: packet.locale,
				outline: packet.outline ?? [],
				facts: packet.facts,
				instructions: packet.instructions ?? [],
			}),
			validate: (candidate) => validateDraftResponse(candidate, factIds),
		});
		response = generated.response;
		markdown = generated.value;
		if (options.cacheDirectory) await writeCache(options.cacheDirectory, identity, response);
	} else {
		markdown = validateDraftResponse(response, factIds);
	}
	const bareDocument = `${renderFrontmatter(packet.frontmatter)}\n${markdown.trim()}\n`;
	const provenance = createProvenance({
		operation: 'draft',
		model: modelIdentity.model,
		modelDigest: modelIdentity.digest,
		promptVersion: DRAFT_PROMPT_VERSION,
		source: rawFacts,
		factPacketSha256: sha256(rawFacts),
		sourceLocale: 'en',
		targetLocale: 'en',
		usedFactIds: response.usedFactIds,
	});
	const document = embedProvenance(bareDocument, provenance);
	if (options.mode !== 'stdout') await writeDocument(options.outputPath, document);
	return { document, provenance, cacheIdentity: identity };
}

async function translateChunk({
	chunk,
	chunkIndex,
	sourceHash,
	targetLocale,
	client,
	modelIdentity,
	cacheDirectory,
	useCache,
	documentFeedback,
	pendingCacheWrites,
}) {
	if (!chunk.trim()) return chunk;
	const identity = cacheIdentity({
		operation: 'translate',
		modelIdentity,
		promptVersion: TRANSLATE_PROMPT_VERSION,
		source: chunk,
		targetLocale,
		documentSourceSha256: sourceHash,
		chunkIndex,
	});
	const cachedResponse = cacheDirectory && useCache ? await readCache(cacheDirectory, identity) : null;
	const validate = (candidate) => validateModelOutput(() => {
		const modelMarkdown = validateModelMarkdown(candidate, targetLocale, { allowProtectionTokens: true });
		const candidateMarkdown = preserveBoundaryWhitespace(chunk, modelMarkdown);
		assertProtectionTokenParity(chunk, candidateMarkdown);
		assertStructuralParity(chunk, candidateMarkdown);
		return candidateMarkdown;
	});
	if (cachedResponse) {
		try {
			return validate(cachedResponse);
		} catch (error) {
			if (!(error instanceof InvalidModelOutputError)) throw error;
			// A validation rule may have tightened since this response was cached.
			// Regenerate it and replace the entry only after the whole page passes.
		}
	}
	const prompt = JSON.stringify({ sourceLocale: 'en', targetLocale, markdown: chunk });
	const generated = await generateValidated({
		client,
		system: TRANSLATE_SYSTEM_PROMPT,
		prompt: documentFeedback
			? `${prompt}\n\nPrevious complete document failed final validation: ${documentFeedback}\nRegenerate this chunk carefully so the complete document preserves every Markdown structure.`
			: prompt,
		validate,
	});
	if (cacheDirectory) pendingCacheWrites.push({ identity, response: generated.response });
	return generated.value;
}

/** A model may trim an otherwise valid response; chunk joins must still match the source document. */
function preserveBoundaryWhitespace(source, translated) {
	const leading = source.match(/^[\t \r\n]*/u)?.[0] ?? '';
	const trailing = source.match(/[\t \r\n]*$/u)?.[0] ?? '';
	return `${leading}${translated.replace(/^[\t \r\n]*/u, '').replace(/[\t \r\n]*$/u, '')}${trailing}`;
}

/** Keep opaque block lines out of the model request instead of asking it to echo placeholders. */
function translationSegments(markdown) {
	const segments = [];
	let offset = 0;
	STANDALONE_PROTECTION_TOKEN_LINE.lastIndex = 0;
	for (const match of markdown.matchAll(STANDALONE_PROTECTION_TOKEN_LINE)) {
		if (match.index > offset) segments.push({ markdown: markdown.slice(offset, match.index), translate: true });
		segments.push({ markdown: match[0], translate: false });
		offset = match.index + match[0].length;
	}
	if (offset < markdown.length) segments.push({ markdown: markdown.slice(offset), translate: true });
	return segments;
}

function validateTranslatedFrontmatter(response, sourceFields, protectedFields, targetLocale) {
	return validateModelOutput(() => {
		const expectedKeys = sourceFields.description === undefined
			? ['locale', 'title']
			: ['description', 'locale', 'title'];
		if (!isPlainObject(response) || JSON.stringify(Object.keys(response).sort()) !== JSON.stringify(expectedKeys)) {
			throw new Error(`Translated frontmatter response must contain exactly: ${expectedKeys.join(', ')}.`);
		}
		if (response.locale !== targetLocale || typeof response.title !== 'string'
			|| (sourceFields.description !== undefined && typeof response.description !== 'string')) {
			throw new Error(`Translated frontmatter response must use locale "${targetLocale}" and string fields.`);
		}
		assertProtectionTokenParity(protectedFields.title.markdown, response.title);
		const restored = {
			title: restoreMarkdown(response.title, protectedFields.title.tokens),
		};
		if (sourceFields.description !== undefined) {
			assertProtectionTokenParity(protectedFields.description.markdown, response.description);
			restored.description = restoreMarkdown(response.description, protectedFields.description.tokens);
		}
		assertLocale([restored.title, restored.description].filter(Boolean).join('\n'), targetLocale);
		return restored;
	});
}

async function translateFrontmatter({ frontmatter, sourceHash, targetLocale, client, modelIdentity, cacheDirectory }) {
	const sourceFields = parseTranslatableFrontmatter(frontmatter);
	const protectedFields = {
		title: protectMarkdown(sourceFields.title),
		description: sourceFields.description === undefined ? undefined : protectMarkdown(sourceFields.description),
	};
	const promptFields = {
		sourceLocale: 'en',
		targetLocale,
		title: protectedFields.title.markdown,
	};
	if (protectedFields.description) promptFields.description = protectedFields.description.markdown;
	const identity = cacheIdentity({
		operation: 'translate-frontmatter',
		modelIdentity,
		promptVersion: FRONTMATTER_PROMPT_VERSION,
		source: JSON.stringify(sourceFields),
		targetLocale,
		documentSourceSha256: sourceHash,
	});
	const cachedResponse = cacheDirectory ? await readCache(cacheDirectory, identity) : null;
	const validate = (candidate) => validateModelOutput(() => {
		const translatedFields = validateTranslatedFrontmatter(candidate, sourceFields, protectedFields, targetLocale);
		return replaceTranslatableFrontmatter(frontmatter, translatedFields);
	});
	if (cachedResponse) {
		try {
			return { translatedFrontmatter: validate(cachedResponse), pendingCacheWrite: null };
		} catch (error) {
			if (!(error instanceof InvalidModelOutputError)) throw error;
		}
	}
	const generated = await generateValidated({
		client,
		system: FRONTMATTER_SYSTEM_PROMPT,
		prompt: JSON.stringify(promptFields),
		validate,
	});
	return {
		translatedFrontmatter: generated.value,
		pendingCacheWrite: cacheDirectory ? { identity, response: generated.response } : null,
	};
}

function finalValidationFeedback(error) {
	const message = error instanceof Error && error.message ? error.message : String(error);
	const concise = message.replace(/\s+/gu, ' ').trim();
	return concise.length <= 500 ? concise : `${concise.slice(0, 499)}…`;
}

async function translateProtectedBody(options) {
	const translatedChunks = [];
	const pendingCacheWrites = [];
	let chunkIndex = 0;
	for (const segment of translationSegments(options.protectedDocument.markdown)) {
		if (!segment.translate) {
			translatedChunks.push(segment.markdown);
			continue;
		}
		for (const chunk of chunkProtectedMarkdown(segment.markdown, options.maxChunkChars)) {
			translatedChunks.push(await translateChunk({
				chunk,
				chunkIndex,
				sourceHash: options.sourceHash,
				targetLocale: options.targetLocale,
				client: options.client,
				modelIdentity: options.modelIdentity,
				cacheDirectory: options.cacheDirectory,
				useCache: options.useCache,
				documentFeedback: options.documentFeedback,
				pendingCacheWrites,
			}));
			chunkIndex += 1;
		}
	}
	return {
		restoredBody: restoreMarkdown(translatedChunks.join(''), options.protectedDocument.tokens),
		pendingCacheWrites,
	};
}

export async function translateDocument(options) {
	if (resolve(options.sourcePath) === resolve(options.targetPath)) throw new Error('Translation source and target paths must differ.');
	const targetLocale = assertDocumentationLocale(options.targetLocale);
	if (targetLocale === 'en') throw new Error('A translation target locale must differ from the English source.');
	const source = await readFile(options.sourcePath, 'utf8');
	const { frontmatter, body } = splitFrontmatter(source);
	if (!frontmatter) throw new Error('A Starlight Markdown translation requires YAML frontmatter.');
	const protectedDocument = protectMarkdown(body);
	const modelIdentity = await options.client.identity();
	const sourceHash = sha256(source);
	const frontmatterResult = await translateFrontmatter({
		frontmatter,
		sourceHash,
		targetLocale,
		client: options.client,
		modelIdentity,
		cacheDirectory: options.cacheDirectory,
	});
	// A hero action's link is data no Markdown transform ever sees, so the page
	// carries the language in it itself or the reader leaves the language they
	// are reading the moment they follow one.
	const localizedFrontmatter = localizeFrontmatterLinks(frontmatterResult.translatedFrontmatter, targetLocale);
	let bareDocument;
	let acceptedCacheWrites;
	let documentFeedback = '';
	for (let attempt = 1; attempt <= MAX_DOCUMENT_ATTEMPTS; attempt += 1) {
		const bodyResult = await translateProtectedBody({
			protectedDocument,
			sourceHash,
			targetLocale,
			client: options.client,
			modelIdentity,
			cacheDirectory: options.cacheDirectory,
			maxChunkChars: options.maxChunkChars ?? 6_000,
			useCache: attempt === 1,
			documentFeedback,
		});
		const candidateDocument = `${localizedFrontmatter}${bodyResult.restoredBody}`;
		try {
			assertLocale(bodyResult.restoredBody, targetLocale);
			assertStructuralParity(`${localizedFrontmatter}${body}`, candidateDocument);
			bareDocument = candidateDocument;
			acceptedCacheWrites = bodyResult.pendingCacheWrites;
			break;
		} catch (error) {
			if (attempt === MAX_DOCUMENT_ATTEMPTS) throw error;
			documentFeedback = finalValidationFeedback(error);
		}
	}
	if (!bareDocument || !acceptedCacheWrites) throw new Error('Unreachable Docs AI document retry state.');
	const provenance = createProvenance({
		operation: 'translate',
		model: modelIdentity.model,
		modelDigest: modelIdentity.digest,
		promptVersion: TRANSLATE_PROMPT_VERSION,
		source,
		factPacketSha256: sourceHash,
		sourceLocale: 'en',
		targetLocale,
	});
	const document = embedProvenance(bareDocument, provenance);
	const pendingCacheWrites = [frontmatterResult.pendingCacheWrite, ...acceptedCacheWrites].filter(Boolean);
	for (const { identity, response } of pendingCacheWrites) {
		await writeCache(options.cacheDirectory, identity, response);
	}
	if (options.mode !== 'stdout') await writeDocument(options.targetPath, document);
	return { document, provenance };
}

export async function checkTranslation(options) {
	const source = await readFile(options.sourcePath, 'utf8');
	let target;
	try {
		target = await readFile(options.targetPath, 'utf8');
	} catch (error) {
		if (error && typeof error === 'object' && error.code === 'ENOENT') return { status: 'missing-target' };
		throw error;
	}
	const result = translationStatus({ source, target });
	if (result.status !== 'current') return result;
	const provenance = parseProvenance(target);
	const sourceParts = splitFrontmatter(source);
	const targetParts = splitFrontmatter(target);
	const sourceFields = parseTranslatableFrontmatter(sourceParts.frontmatter);
	const targetFields = parseTranslatableFrontmatter(targetParts.frontmatter);
	const expectedSourceFrontmatter = localizeFrontmatterLinks(
		replaceTranslatableFrontmatter(sourceParts.frontmatter, targetFields),
		provenance.targetLocale,
	);
	assertStructuralParity(`${expectedSourceFrontmatter}${sourceParts.body}`, target);
	if (sourceFields.description === undefined && targetFields.description !== undefined) {
		throw new Error('Translation added a frontmatter description.');
	}
	assertLocale(splitFrontmatter(target).body, provenance.targetLocale);
	return result;
}

export async function checkDraft(options) {
	const source = await readFile(options.factsPath, 'utf8');
	let target;
	try {
		target = await readFile(options.outputPath, 'utf8');
	} catch (error) {
		if (error && typeof error === 'object' && error.code === 'ENOENT') return { status: 'missing-target' };
		throw error;
	}
	const provenance = parseProvenance(target);
	if (!provenance) return { status: 'missing-provenance' };
	if (provenance.operation !== 'draft') return { status: 'wrong-operation' };
	if (provenance.promptVersion !== DRAFT_PROMPT_VERSION) return { status: 'stale-prompt' };
	if (provenance.sourceSha256 !== sha256(source)) return { status: 'stale-source' };
	return { status: 'current' };
}
