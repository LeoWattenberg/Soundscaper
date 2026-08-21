import { createHash } from 'node:crypto';

const PROVENANCE_PATTERN = /<!-- docs-ai-provenance: (\{[^\n]*\}) -->\r?\n?/u;

export function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function canonicalValue(value) {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
	}
	return value;
}

export function canonicalJson(value) {
	return JSON.stringify(canonicalValue(value));
}

export function createProvenance(options) {
	const provenance = {
		schemaVersion: 1,
		operation: options.operation,
		model: options.model,
		modelDigest: options.modelDigest,
		promptVersion: options.promptVersion,
		sourceSha256: sha256(options.source),
		sourceLocale: options.sourceLocale,
		targetLocale: options.targetLocale,
	};
	if (options.factPacketSha256) provenance.factPacketSha256 = options.factPacketSha256;
	if (options.usedFactIds) provenance.usedFactIds = [...new Set(options.usedFactIds)].sort();
	return provenance;
}

export function stripProvenance(document) {
	return document.replace(PROVENANCE_PATTERN, '');
}

export function embedProvenance(document, provenance) {
	const cleanDocument = stripProvenance(document);
	const serialized = canonicalJson(provenance);
	if (serialized.includes('-->')) throw new Error('Docs AI provenance contains an invalid comment terminator.');
	const comment = `<!-- docs-ai-provenance: ${serialized} -->\n`;
	const frontmatter = cleanDocument.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u);
	if (!frontmatter) return `${comment}\n${cleanDocument.replace(/^\s+/u, '')}`;
	return `${frontmatter[0]}${comment}\n${cleanDocument.slice(frontmatter[0].length).replace(/^\s+/u, '')}`;
}

export function parseProvenance(document) {
	const match = document.match(PROVENANCE_PATTERN);
	if (!match) return null;
	let value;
	try {
		value = JSON.parse(match[1]);
	} catch (error) {
		throw new Error('Docs AI provenance is not valid JSON.', { cause: error });
	}
	if (!value || value.schemaVersion !== 1 || typeof value.sourceSha256 !== 'string') {
		throw new Error('Docs AI provenance has an unsupported shape.');
	}
	return value;
}

export function translationStatus({ source, target }) {
	const provenance = parseProvenance(target);
	if (!provenance) return { status: 'missing-provenance' };
	if (provenance.operation !== 'translate') return { status: 'wrong-operation' };
	if (provenance.promptVersion !== 'docs-translate-v1') return { status: 'stale-prompt' };
	if (provenance.sourceSha256 !== sha256(source)) return { status: 'stale-source' };
	return { status: 'current' };
}

export function cacheKey(identity) {
	for (const field of ['operation', 'modelDigest', 'promptVersion', 'sourceSha256']) {
		if (!identity[field]) throw new Error(`Cache identity is missing ${field}.`);
	}
	return sha256(canonicalJson(identity));
}
