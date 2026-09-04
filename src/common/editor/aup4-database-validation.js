/* SPDX-License-Identifier: AGPL-3.0-only */

// What Soundscaper refuses to open. An .aup4 file is a SQLite database that can
// contain any schema, any sample block and any document, so every table, column
// and block reference is checked against the pinned Audacity profile before the
// project is built from it, and a file that fails says which object was wrong.
// Split out of aup4-database.js; no behaviour changes here.

import { audacityXmlAttribute, audacityXmlChildren, decodeAudacityBinaryXml } from './audacity-binary-xml.js';
import { inspectAup4ExcludedMetadata } from './aup4-sanitization.js';
import {
	AUP4_HISTORY_DEPTH,
	AUP4_MAX_BLOCK_SAMPLES,
	Aup4Error,
	addAup4CompatibilityItem,
	createAup4CompatibilityReport,
	inspectAup4Header,
	readAup4ProjectSummary,
	validateAup4SchemaObjects,
} from './aup4-profile.js';
import { createAup4DatabaseAdapter, positiveInteger, toBytes } from './aup4-database-sql.js';

export const AUP4_COLUMN_PROFILE = Object.freeze({
	project: Object.freeze([['id', 'INTEGER', 1], ['dict', 'BLOB', 0], ['doc', 'BLOB', 0]]),
	autosave: Object.freeze([['id', 'INTEGER', 1], ['dict', 'BLOB', 0], ['doc', 'BLOB', 0]]),
	sampleblocks: Object.freeze([
		['blockid', 'INTEGER', 1], ['sampleformat', 'INTEGER', 0], ['summin', 'REAL', 0], ['summax', 'REAL', 0],
		['sumrms', 'REAL', 0], ['summary256', 'BLOB', 0], ['summary64k', 'BLOB', 0], ['samples', 'BLOB', 0],
	]),
	project_history: Object.freeze([['generation', 'INTEGER', 1], ['saved_at', 'INTEGER', 0], ['dict', 'BLOB', 0], ['doc', 'BLOB', 0]]),
});
export const SAMPLE_BYTES = Object.freeze({
	0x00020001: 2,
	0x00040001: 4,
	0x0004000f: 4,
});
export const DEFAULT_MAX_BLOCK_REFERENCES = 1_000_000;

function readAup4DocumentCandidates(adapter, tables, options) {
	const output = [];
	for (const source of options.useAutosave === false ? ['project'] : ['autosave', 'project']) {
		if (!tables.has(source)) continue;
		const row = adapter.rows(`SELECT dict, doc FROM ${source} WHERE id = 1 LIMIT 1`)[0];
		if (row?.[0]?.byteLength && row?.[1]?.byteLength) output.push({
			source, dictionary: toBytes(row[0]).slice(), document: toBytes(row[1]).slice(),
		});
	}
	if (options.allowHistoryRecovery !== true || !tables.has('project_history')) return output;
	for (const [generation, dictionary, document] of adapter.rows(`
		SELECT generation, dict, doc FROM project_history
		WHERE length(dict) > 0 AND length(doc) > 0
		ORDER BY generation DESC LIMIT ${AUP4_HISTORY_DEPTH}
	`)) output.push({
		source: 'history', generation: Number(generation), dictionary: toBytes(dictionary).slice(), document: toBytes(document).slice(),
	});
	return output;
}

export function validateAudacityProjectDatabase(database, options = {}) {
	const adapter = createAup4DatabaseAdapter(database);
	adapter.exec('PRAGMA trusted_schema = OFF');
	const applicationId = Number(adapter.value('PRAGMA application_id'));
	const userVersion = Number(adapter.value('PRAGMA user_version'));
	const header = inspectAup4Header({ applicationId, userVersion });
	if (!header.compatible) throw new Aup4Error(header.issues[0]?.message || 'This is not an Audacity project.', header.issues[0]?.code || 'NOT_AUP4');

	const quickCheck = String(adapter.value('PRAGMA quick_check(1)') || '');
	if (quickCheck.toLowerCase() !== 'ok') throw new Aup4Error(`SQLite integrity check failed: ${quickCheck || 'unknown error'}.`, 'CORRUPT_DATABASE');
	const schemaObjects = readSchemaObjects(adapter);
	validateAup4SchemaObjects(schemaObjects);
	validatePinnedTableDefinitions(schemaObjects);
	validatePinnedColumns(adapter);

	const candidates = readAup4DocumentCandidates(adapter, new Set(schemaObjects
		.filter((entry) => entry.type === 'table')
		.map((entry) => entry.name)), options);
	if (!candidates.length) {
		if (!options.allowEmpty) throw new Aup4Error('The Audacity project document is empty.', 'EMPTY_PROJECT');
		return { ...header, source: null, document: null, schemaObjects };
	}
	const failures = [];
	for (const candidate of candidates) {
		try {
			const document = decodeAudacityBinaryXml(candidate.dictionary, candidate.document, options.binaryXml);
			const summary = readAup4ProjectSummary(document.root);
			const profile = inspectAup4Header({ applicationId, userVersion, xmlVersion: summary.xmlVersion });
			if (!profile.compatible) throw new Aup4Error(profile.issues[0]?.message || 'The Audacity document profile is invalid.', profile.issues[0]?.code || 'INVALID_PROJECT_XML');
			const references = profile.readOnly && options.validateReferences !== true
				? null
				: validateAup4References(database, document.root, options.references);
			const excludedMetadata = inspectAup4ExcludedMetadata(document.root);
			const missingSampleBlockIds = references?.missingSampleBlockIds || [];
			const issues = [...profile.issues];
			if (excludedMetadata.discardedEntries) issues.push({
				level: 'warning', code: 'EXCLUDED_CLOUD_METADATA',
				message: `${excludedMetadata.discardedEntries} cloud/account metadata ${excludedMetadata.discardedEntries === 1 ? 'entry is' : 'entries are'} excluded from browser projects.`,
			});
			if (missingSampleBlockIds.length) issues.push({
				level: 'warning', code: 'MISSING_LOCAL_AUDIO',
				message: `${missingSampleBlockIds.length} referenced audio ${missingSampleBlockIds.length === 1 ? 'block is' : 'blocks are'} unavailable locally; no cloud retrieval was attempted.`,
			});
			const recovered = failures.length > 0;
			return {
				...profile,
				readOnly: profile.readOnly || missingSampleBlockIds.length > 0,
				issues: recovered ? [...issues, {
					level: 'warning', code: 'RECOVERED_DOCUMENT',
					message: `The ${failures[0].source} document was corrupt; ${candidate.source} was used instead.`,
				}] : issues,
				source: candidate.source,
				generation: candidate.generation ?? null,
				document,
				summary,
				schemaObjects,
				references,
				compatibilityReport: createCompatibilityReport(excludedMetadata, missingSampleBlockIds),
				recovery: recovered ? { failures, source: candidate.source, generation: candidate.generation ?? null } : null,
			};
		} catch (error) {
			if (!error?.code || options.allowHistoryRecovery !== true) throw error;
			failures.push({ source: candidate.source, generation: candidate.generation ?? null, code: error.code, message: error.message });
		}
	}
	const first = failures[0];
	throw new Aup4Error(first?.message || 'No readable Audacity project document remains.', first?.code || 'INVALID_PROJECT_XML');
}

export function validateAup4References(database, root, options = {}) {
	if (!root || root.name !== 'project') throw new Aup4Error('The Audacity document has no project root.', 'INVALID_PROJECT_XML');
	const adapter = createAup4DatabaseAdapter(database);
	const maxReferences = positiveInteger(options.maxBlockReferences, DEFAULT_MAX_BLOCK_REFERENCES);
	const blockCache = new Map();
	let sequenceCount = 0;
	let blockReferenceCount = 0;
	let sampleBytes = 0;
	const missingSampleBlockIds = new Set();
	for (const sequence of editableAup4Sequences(root)) {
		sequenceCount += 1;
		const expectedSamples = xmlSafeInteger(audacityXmlAttribute(sequence, 'numsamples', 0), 'sequence numsamples', 0);
		const maxSamples = xmlSafeInteger(audacityXmlAttribute(sequence, 'maxsamples', AUP4_MAX_BLOCK_SAMPLES), 'sequence maxsamples', 1);
		let sequenceSamples = 0;
		for (const waveBlock of audacityXmlChildren(sequence, 'waveblock')) {
			blockReferenceCount += 1;
			if (blockReferenceCount > maxReferences) throw new Aup4Error('The AUP4 document contains too many sample-block references.', 'REFERENCE_LIMIT');
			const start = xmlSafeInteger(audacityXmlAttribute(waveBlock, 'start', sequenceSamples), 'waveblock start', 0);
			if (start !== sequenceSamples) throw new Aup4Error('An AUP4 sequence has non-contiguous sample blocks.', 'CORRUPT_SEQUENCE');
			const blockId = xmlSafeInteger(audacityXmlAttribute(waveBlock, 'blockid', 0), 'waveblock blockid', Number.MIN_SAFE_INTEGER);
			const declaredLengthValue = audacityXmlAttribute(waveBlock, 'length', null);
			let sampleCount;
			if (blockId <= 0) {
				if (blockId === 0) throw new Aup4Error('An AUP4 silent block has an invalid zero id.', 'INVALID_SAMPLE_BLOCK');
				sampleCount = -blockId;
				if (declaredLengthValue != null && xmlSafeInteger(declaredLengthValue, 'waveblock length', 1) !== sampleCount) {
					throw new Aup4Error('An AUP4 silent block length does not match its encoded id.', 'CORRUPT_SEQUENCE');
				}
			} else {
				let block = blockCache.get(blockId);
				if (!block) {
					const row = adapter.rows(`
						SELECT sampleformat, summin, summax, sumrms,
						       length(summary256), length(summary64k), length(samples)
						FROM sampleblocks WHERE blockid = ? LIMIT 1
					`, [blockId])[0];
					if (!row) {
						if (!options.allowMissingSampleBlocks) throw new Aup4Error(`AUP4 sample block ${blockId} is missing.`, 'MISSING_SAMPLE_BLOCK');
						const declaredLength = declaredLengthValue == null ? Number.NaN : Number(declaredLengthValue);
						if (!Number.isSafeInteger(declaredLength) || declaredLength < 1) {
							throw new Aup4Error(`Missing AUP4 sample block ${blockId} has no usable declared length.`, 'MISSING_SAMPLE_BLOCK');
						}
						missingSampleBlockIds.add(blockId);
						block = { sampleCount: declaredLength, sampleBytes: 0, missing: true };
					} else {
						block = validateSampleBlockRecord(blockId, row);
						sampleBytes += block.sampleBytes;
					}
					blockCache.set(blockId, block);
				}
				sampleCount = block.sampleCount;
				if (declaredLengthValue != null && xmlSafeInteger(declaredLengthValue, 'waveblock length', 1) !== sampleCount) {
					throw new Aup4Error(`AUP4 sample block ${blockId} has a mismatched length.`, 'CORRUPT_SEQUENCE');
				}
			}
			if (sampleCount > maxSamples) throw new Aup4Error('An AUP4 sample block exceeds its sequence maximum.', 'CORRUPT_SEQUENCE');
			sequenceSamples += sampleCount;
			if (!Number.isSafeInteger(sequenceSamples)) throw new Aup4Error('An AUP4 sequence sample count is too large.', 'CORRUPT_SEQUENCE');
		}
		if (sequenceSamples !== expectedSamples) throw new Aup4Error('An AUP4 sequence sample count does not match its blocks.', 'CORRUPT_SEQUENCE');
	}
	return {
		sequenceCount,
		blockReferenceCount,
		distinctSampleBlockCount: blockCache.size - missingSampleBlockIds.size,
		sampleBytes,
		...(missingSampleBlockIds.size ? {
			missingSampleBlockIds: [...missingSampleBlockIds].sort((left, right) => left - right),
		} : {}),
	};
}

function createCompatibilityReport(excludedMetadata, missingSampleBlockIds) {
	const report = createAup4CompatibilityReport('open', {
		discardedCloudMetadata: excludedMetadata,
		missingAudio: missingSampleBlockIds.map((blockId) => ({
			blockId,
			reason: 'missing-local-sample-block',
			possiblyCloudBacked: excludedMetadata.discardedEntries > 0,
			networkAccessAttempted: false,
		})),
		networkAccessAttempted: false,
	});
	if (excludedMetadata.discardedEntries) addAup4CompatibilityItem(report, {
		code: 'EXCLUDED_CLOUD_METADATA',
		severity: 'warning',
		disposition: 'omitted',
		scope: { kind: 'project' },
		data: { discardedEntries: excludedMetadata.discardedEntries },
	});
	for (const blockId of missingSampleBlockIds) addAup4CompatibilityItem(report, {
		code: 'MISSING_LOCAL_AUDIO',
		severity: 'warning',
		disposition: 'missing',
		scope: { kind: 'sampleblock', blockId },
		data: { blockId, reason: 'missing-local-sample-block' },
	});
	return report;
}

export function validatePinnedColumns(adapter, options = {}) {
	for (const [table, expected] of Object.entries(AUP4_COLUMN_PROFILE)) {
		const actual = adapter.rows(`PRAGMA table_xinfo(${table})`).map((row) => ({
			name: String(row[1]), type: String(row[2]).toUpperCase(), primaryKey: Number(row[5]), hidden: Number(row[6] || 0),
		}));
		if (!actual.length && options.allowMissing?.has(table)) continue;
		const matches = options.allowAdditional
			? expected.every(([name, type, primaryKey]) => actual.some((column) => column.name === name && column.type === type && column.primaryKey === primaryKey && column.hidden === 0))
			: actual.length === expected.length && expected.every(([name, type, primaryKey], index) => {
				const column = actual[index];
				return column?.name === name && column.type === type && column.primaryKey === primaryKey && column.hidden === 0;
			});
		if (!matches) {
			throw new Aup4Error(`Unexpected columns in AUP4 table ${table}.`, 'UNSUPPORTED_SCHEMA');
		}
	}
}

export function validatePinnedTableDefinitions(schemaObjects, options = {}) {
	const definitions = new Map(schemaObjects
		.filter((entry) => entry.type === 'table' && Object.hasOwn(AUP4_COLUMN_PROFILE, entry.name))
		.map((entry) => [entry.name, String(entry.sql || '').toUpperCase().replace(/\s+/g, ' ')]));
	for (const table of Object.keys(AUP4_COLUMN_PROFILE)) {
		const sql = definitions.get(table);
		if (!sql && options.allowMissing?.has(table)) continue;
		if (!sql) throw new Aup4Error(`The AUP4 table ${table} is missing.`, 'UNSUPPORTED_SCHEMA');
		if (/\b(WITHOUT ROWID|STRICT|GENERATED|CHECK|REFERENCES|UNIQUE|COLLATE)\b/.test(sql)) {
			throw new Aup4Error(`The AUP4 table ${table} has unsupported constraints.`, 'UNSUPPORTED_SCHEMA');
		}
	}
	for (const [table, primaryKey] of [['sampleblocks', 'BLOCKID'], ['project_history', 'GENERATION']]) {
		if (!definitions.has(table) && options.allowMissing?.has(table)) continue;
		if (!new RegExp(`\\b${primaryKey}\\s+INTEGER\\s+PRIMARY\\s+KEY\\s+AUTOINCREMENT\\b`).test(definitions.get(table))) {
			throw new Aup4Error(`The AUP4 table ${table} does not use the native autoincrement key.`, 'UNSUPPORTED_SCHEMA');
		}
	}
}

export function readSchemaObjects(adapter) {
	return adapter.rows(`
		SELECT type, name, tbl_name, sql
		FROM sqlite_master
		WHERE name NOT LIKE 'sqlite_stat%'
		ORDER BY type, name
	`).map(([type, name, table, sql]) => ({ type, name, table, sql }));
}

function validateSampleBlockRecord(blockId, row) {
	const sampleformat = Number(row[0]);
	const bytesPerSample = SAMPLE_BYTES[sampleformat];
	if (!bytesPerSample) throw new Aup4Error(`AUP4 sample block ${blockId} uses an unsupported sample format.`, 'INVALID_SAMPLE_BLOCK');
	if (![row[1], row[2], row[3]].every((value) => Number.isFinite(Number(value)))) {
		throw new Aup4Error(`AUP4 sample block ${blockId} has invalid summary statistics.`, 'INVALID_SAMPLE_BLOCK');
	}
	const summary256Bytes = nonNegativeSqlInteger(row[4], blockId, 'summary256');
	const summary64kBytes = nonNegativeSqlInteger(row[5], blockId, 'summary64k');
	const sampleBytes = nonNegativeSqlInteger(row[6], blockId, 'samples');
	if (!sampleBytes || sampleBytes % bytesPerSample) throw new Aup4Error(`AUP4 sample block ${blockId} has misaligned sample data.`, 'INVALID_SAMPLE_BLOCK');
	const sampleCount = sampleBytes / bytesPerSample;
	const frames64k = Math.ceil(sampleCount / 65_536);
	if (summary256Bytes !== frames64k * 256 * 3 * 4 || summary64kBytes !== frames64k * 3 * 4) {
		throw new Aup4Error(`AUP4 sample block ${blockId} has invalid summary lengths.`, 'INVALID_SAMPLE_BLOCK');
	}
	return { sampleCount, sampleBytes };
}

function editableAup4Sequences(root) {
	const output = [];
	for (const waveTrack of audacityXmlChildren(root, 'wavetrack')) {
		for (const waveClip of audacityXmlChildren(waveTrack, 'waveclip')) {
			const sequence = audacityXmlChildren(waveClip, 'sequence')[0];
			if (sequence) output.push(sequence);
		}
	}
	return output;
}

export function descendantNodes(root, name) {
	const output = [];
	const visit = (node) => {
		for (const child of audacityXmlChildren(node)) {
			if (child.name === name) output.push(child);
			visit(child);
		}
	};
	visit(root);
	return output;
}

function xmlSafeInteger(value, name, minimum) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum) throw new Aup4Error(`The AUP4 ${name} is invalid.`, 'CORRUPT_SEQUENCE');
	return number;
}

function nonNegativeSqlInteger(value, blockId, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new Aup4Error(`AUP4 sample block ${blockId} has invalid ${name} data.`, 'INVALID_SAMPLE_BLOCK');
	return number;
}

