import {
	audacityXmlAttribute,
	audacityXmlChildren,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from './audacity-binary-xml.js';
import {
	inspectAup4ExcludedMetadata,
	mergeAup4SanitizationReports,
	sanitizeAup4Document,
} from './aup4-sanitization.js';
import {
	AUP4_APPLICATION_ID,
	AUP4_HISTORY_DEPTH,
	AUP4_MAX_BLOCK_SAMPLES,
	AUP4_SCHEMA_SQL,
	AUP4_USER_VERSION,
	Aup4Error,
	inspectAup4Header,
	readAup4ProjectSummary,
	validateAup4SchemaObjects,
} from './aup4-profile.js';

const AUP4_COLUMN_PROFILE = Object.freeze({
	project: Object.freeze([['id', 'INTEGER', 1], ['dict', 'BLOB', 0], ['doc', 'BLOB', 0]]),
	autosave: Object.freeze([['id', 'INTEGER', 1], ['dict', 'BLOB', 0], ['doc', 'BLOB', 0]]),
	sampleblocks: Object.freeze([
		['blockid', 'INTEGER', 1], ['sampleformat', 'INTEGER', 0], ['summin', 'REAL', 0], ['summax', 'REAL', 0],
		['sumrms', 'REAL', 0], ['summary256', 'BLOB', 0], ['summary64k', 'BLOB', 0], ['samples', 'BLOB', 0],
	]),
	project_history: Object.freeze([['generation', 'INTEGER', 1], ['saved_at', 'INTEGER', 0], ['dict', 'BLOB', 0], ['doc', 'BLOB', 0]]),
});
const SAMPLE_BYTES = Object.freeze({
	0x00020001: 2,
	0x00040001: 4,
	0x0004000f: 4,
});
const DEFAULT_MAX_BLOCK_REFERENCES = 1_000_000;
const SQLITE_HEADER = Uint8Array.of(0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00);

/**
 * sqlite3_deserialize cannot open a standalone main-database image whose
 * header still requests WAL, because no companion `-wal` VFS file exists.
 * Native portable AUP4 snapshots are checkpointed but retain that flag. A
 * private copy may safely request rollback journaling before deserialization;
 * the source File/ArrayBuffer is never modified.
 */
export function prepareAup4SerializedDatabase(input) {
	const source = toBytes(input);
	if (source.byteLength < 100 || SQLITE_HEADER.some((byte, index) => source[index] !== byte)) {
		throw new Aup4Error('The file is not a SQLite database image.', 'INVALID_DATABASE');
	}
	const bytes = source.slice();
	if (bytes[18] === 2 && bytes[19] === 2) {
		bytes[18] = 1;
		bytes[19] = 1;
	}
	return bytes;
}

export function createAup4DatabaseAdapter(database) {
	if (!database || (typeof database.exec !== 'function' && typeof database.prepare !== 'function')) {
		throw new TypeError('An open SQLite database is required.');
	}
	return {
		database,
		exec(sql, bind) { return execute(database, sql, bind); },
		rows(sql, bind) { return queryRows(database, sql, bind); },
		value(sql, bind) { return queryRows(database, sql, bind)[0]?.[0]; },
		transaction(callback) { return transaction(database, callback); },
	};
}

export function initializeAup4Database(database) {
	const adapter = createAup4DatabaseAdapter(database);
	adapter.exec('PRAGMA trusted_schema = OFF');
	adapter.exec(AUP4_SCHEMA_SQL);
	return validateAup4Database(database, { allowEmpty: true });
}

/**
 * Upgrade an older Audacity AUP4 schema in the browser-owned database copy.
 * The pinned native loader has one schema migration: add project_history and
 * advance user_version. The transaction is validated before commit, so a
 * malformed legacy file remains byte-for-byte untouched by its caller.
 */
export function upgradeAup4Database(database, options = {}) {
	const adapter = createAup4DatabaseAdapter(database);
	adapter.exec('PRAGMA trusted_schema = OFF');
	const applicationId = Number(adapter.value('PRAGMA application_id'));
	const userVersion = Number(adapter.value('PRAGMA user_version'));
	if (applicationId !== AUP4_APPLICATION_ID || userVersion <= 0 || userVersion >= AUP4_USER_VERSION) {
		return {
			upgraded: false,
			fromVersion: userVersion,
			toVersion: userVersion,
			validation: validateAup4Database(database, options),
		};
	}
	const quickCheck = String(adapter.value('PRAGMA quick_check(1)') || '');
	if (quickCheck.toLowerCase() !== 'ok') {
		throw new Aup4Error(`SQLite integrity check failed: ${quickCheck || 'unknown error'}.`, 'CORRUPT_DATABASE');
	}
	const schemaObjects = readSchemaObjects(adapter);
	validateAup4SchemaObjects(schemaObjects);
	const optionalHistory = new Set(['project_history']);
	validatePinnedTableDefinitions(schemaObjects, { allowMissing: optionalHistory });
	validatePinnedColumns(adapter, { allowMissing: optionalHistory });
	const validation = adapter.transaction(() => {
		adapter.exec(`
			CREATE TABLE IF NOT EXISTS project_history (
				generation INTEGER PRIMARY KEY AUTOINCREMENT,
				saved_at INTEGER,
				dict BLOB,
				doc BLOB
			)
		`);
		adapter.exec(`PRAGMA user_version = ${AUP4_USER_VERSION}`);
		return validateAup4Database(database, options);
	});
	return {
		upgraded: true,
		fromVersion: userVersion,
		toVersion: AUP4_USER_VERSION,
		validation,
	};
}

export function validateAup4Database(database, options = {}) {
	const adapter = createAup4DatabaseAdapter(database);
	adapter.exec('PRAGMA trusted_schema = OFF');
	const applicationId = Number(adapter.value('PRAGMA application_id'));
	const userVersion = Number(adapter.value('PRAGMA user_version'));
	const header = inspectAup4Header({ applicationId, userVersion });
	if (!header.compatible) throw new Aup4Error(header.issues[0]?.message || 'This is not an Audacity project.', header.issues[0]?.code || 'NOT_AUP4');

	const quickCheck = String(adapter.value('PRAGMA quick_check(1)') || '');
	if (quickCheck.toLowerCase() !== 'ok') throw new Aup4Error(`SQLite integrity check failed: ${quickCheck || 'unknown error'}.`, 'CORRUPT_DATABASE');
	const schemaObjects = readSchemaObjects(adapter);
	const futureReadOnly = header.readOnly && userVersion > AUP4_USER_VERSION;
	validateAup4SchemaObjects(schemaObjects, { futureReadOnly });
	if (!futureReadOnly) validatePinnedTableDefinitions(schemaObjects);
	validatePinnedColumns(adapter, {
		allowAdditional: futureReadOnly,
		allowMissing: futureReadOnly ? new Set(['autosave', 'project_history']) : new Set(),
	});

	const candidates = readAup4DocumentCandidates(adapter, new Set(schemaObjects
		.filter((entry) => entry.type === 'table')
		.map((entry) => entry.name)));
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
			if (!error?.code || options.allowHistoryRecovery === false) throw error;
			failures.push({ source: candidate.source, generation: candidate.generation ?? null, code: error.code, message: error.message });
		}
	}
	const first = failures[0];
	throw new Aup4Error(first?.message || 'No readable Audacity project document remains.', first?.code || 'INVALID_PROJECT_XML');
}

export function readAup4Document(database) {
	const adapter = createAup4DatabaseAdapter(database);
	for (const source of ['autosave', 'project']) {
		const row = adapter.rows(`SELECT dict, doc FROM ${source} WHERE id = 1 LIMIT 1`)[0];
		if (row?.[0]?.byteLength && row?.[1]?.byteLength) {
			return { source, dictionary: toBytes(row[0]).slice(), document: toBytes(row[1]).slice() };
		}
	}
	return null;
}

function readAup4DocumentCandidates(adapter, tables) {
	const output = [];
	for (const source of ['autosave', 'project']) {
		if (!tables.has(source)) continue;
		const row = adapter.rows(`SELECT dict, doc FROM ${source} WHERE id = 1 LIMIT 1`)[0];
		if (row?.[0]?.byteLength && row?.[1]?.byteLength) output.push({
			source, dictionary: toBytes(row[0]).slice(), document: toBytes(row[1]).slice(),
		});
	}
	if (!tables.has('project_history')) return output;
	for (const [generation, dictionary, document] of adapter.rows(`
		SELECT generation, dict, doc FROM project_history
		WHERE length(dict) > 0 AND length(doc) > 0
		ORDER BY generation DESC LIMIT ${AUP4_HISTORY_DEPTH}
	`)) output.push({
		source: 'history', generation: Number(generation), dictionary: toBytes(dictionary).slice(), document: toBytes(document).slice(),
	});
	return output;
}

export function writeAup4Document(database, encoded, options = {}) {
	const dictionary = toBytes(encoded?.dictionary);
	const document = toBytes(encoded?.document);
	if (!dictionary.byteLength || !document.byteLength) throw new Aup4Error('The Audacity project document cannot be empty.', 'EMPTY_PROJECT');
	const table = options.autosave === false ? 'project' : 'autosave';
	const adapter = createAup4DatabaseAdapter(database);
	adapter.exec(`INSERT OR REPLACE INTO ${table}(id, dict, doc) VALUES(1, ?, ?)`, [dictionary, document]);
	if (table === 'project' && options.journal !== false) {
		adapter.exec('INSERT INTO project_history(saved_at, dict, doc) SELECT ?, dict, doc FROM project WHERE id = 1', [unixSeconds(options.now)]);
		pruneHistory(adapter);
		pruneOrphanSampleBlocks(adapter);
	}
	return { table, dictionaryBytes: dictionary.byteLength, documentBytes: document.byteLength };
}

/**
 * Remove excluded cloud/account state from every retained document in the
 * browser-owned database copy. Audio and all other opaque Audacity nodes stay
 * typed and ordered; imported bytes supplied by the user are never mutated.
 */
export function discardExcludedAup4Metadata(database) {
	const adapter = createAup4DatabaseAdapter(database);
	adapter.exec('PRAGMA secure_delete = ON');
	const reports = [];
	let rewrittenDocuments = 0;
	adapter.transaction(() => {
		const tables = new Set(adapter.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map(([name]) => String(name)));
		for (const [table, key] of [['project', 'id'], ['autosave', 'id'], ['project_history', 'generation']]) {
			if (!tables.has(table)) continue;
			for (const [rowKey, dictionary, document] of adapter.rows(`
				SELECT ${key}, dict, doc FROM ${table}
				WHERE length(dict) > 0 AND length(doc) > 0
			`)) {
				const decoded = decodeAudacityBinaryXml(toBytes(dictionary), toBytes(document));
				const sanitized = sanitizeAup4Document(decoded);
				reports.push(sanitized.report);
				if (!sanitized.report.discardedEntries) continue;
				const encoded = encodeAudacityBinaryXml(sanitized.document);
				adapter.exec(`UPDATE ${table} SET dict = ?, doc = ? WHERE ${key} = ?`, [
					encoded.dictionary, encoded.document, rowKey,
				]);
				rewrittenDocuments += 1;
			}
		}
	});
	return { ...mergeAup4SanitizationReports(reports), rewrittenDocuments };
}

export function commitAup4Autosave(database, options = {}) {
	const adapter = createAup4DatabaseAdapter(database);
	return adapter.transaction(() => {
		const autosave = adapter.rows('SELECT dict, doc FROM autosave WHERE id = 1 LIMIT 1')[0];
		if (!autosave?.[0]?.byteLength || !autosave?.[1]?.byteLength) return false;
		adapter.exec('INSERT OR REPLACE INTO project(id, dict, doc) VALUES(1, ?, ?)', autosave);
		adapter.exec(`
			INSERT INTO project_history(saved_at, dict, doc)
			SELECT ?, dict, doc FROM project WHERE id = 1
		`, [unixSeconds(options.now)]);
		adapter.exec('DELETE FROM autosave WHERE id = 1');
		pruneHistory(adapter);
		pruneOrphanSampleBlocks(adapter);
		return true;
	});
}

export function restoreAup4History(database, generation) {
	if (!Number.isSafeInteger(Number(generation)) || Number(generation) < 1) throw new Aup4Error('A valid project-history generation is required.', 'INVALID_HISTORY');
	const adapter = createAup4DatabaseAdapter(database);
	return adapter.transaction(() => {
		const row = adapter.rows('SELECT dict, doc FROM project_history WHERE generation = ? LIMIT 1', [Number(generation)])[0];
		if (!row) throw new Aup4Error(`Unknown project-history generation: ${generation}.`, 'MISSING_HISTORY');
		adapter.exec('INSERT OR REPLACE INTO autosave(id, dict, doc) VALUES(1, ?, ?)', row);
		return true;
	});
}

export function listAup4History(database) {
	return createAup4DatabaseAdapter(database).rows(
		'SELECT generation, saved_at FROM project_history ORDER BY generation DESC',
	).map(([generation, savedAt]) => ({ generation: Number(generation), savedAt: Number(savedAt) }));
}

export function insertAup4SampleBlock(database, block) {
	const adapter = createAup4DatabaseAdapter(database);
	for (const key of ['summary256', 'summary64k', 'samples']) if (!block?.[key]) throw new Aup4Error(`AUP4 sample block is missing ${key}.`, 'INVALID_SAMPLE_BLOCK');
	adapter.exec(`
		INSERT INTO sampleblocks(sampleformat, summin, summax, sumrms, summary256, summary64k, samples)
		VALUES(?, ?, ?, ?, ?, ?, ?)
	`, [
		Number(block.sampleformat), Number(block.summin), Number(block.summax), Number(block.sumrms),
		toBytes(block.summary256), toBytes(block.summary64k), toBytes(block.samples),
	]);
	return Number(adapter.value('SELECT last_insert_rowid()'));
}

export function readAup4SampleBlock(database, blockId) {
	const id = Number(blockId);
	if (!Number.isSafeInteger(id) || id < 1) throw new Aup4Error('A valid sample block id is required.', 'INVALID_BLOCK_ID');
	const row = createAup4DatabaseAdapter(database).rows(`
		SELECT blockid, sampleformat, summin, summax, sumrms, summary256, summary64k, samples
		FROM sampleblocks WHERE blockid = ? LIMIT 1
	`, [id])[0];
	if (!row) return null;
	return {
		blockId: Number(row[0]), sampleformat: Number(row[1]), summin: Number(row[2]), summax: Number(row[3]), sumrms: Number(row[4]),
		summary256: toBytes(row[5]).slice(), summary64k: toBytes(row[6]).slice(), samples: toBytes(row[7]).slice(),
	};
}

export function deleteAup4SampleBlocks(database, blockIds) {
	const ids = [...new Set(blockIds || [])].map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
	if (!ids.length) return 0;
	const adapter = createAup4DatabaseAdapter(database);
	return adapter.transaction(() => {
		let deleted = 0;
		for (const id of ids) {
			adapter.exec('DELETE FROM sampleblocks WHERE blockid = ?', [id]);
			deleted += Number(adapter.value('SELECT changes()'));
		}
		return deleted;
	});
}

/**
 * Delete sampleblocks unreachable from project, autosave, or the retained ten
 * history documents. A corrupt document makes collection fail closed so audio
 * is never discarded merely because recovery metadata cannot be decoded.
 */
export function pruneAup4OrphanSampleBlocks(database) {
	const adapter = createAup4DatabaseAdapter(database);
	return adapter.transaction(() => pruneOrphanSampleBlocks(adapter));
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
	for (const sequence of descendantNodes(root, 'sequence')) {
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
	return {
		discardedCloudMetadata: excludedMetadata,
		missingAudio: missingSampleBlockIds.map((blockId) => ({
			blockId,
			reason: 'missing-local-sample-block',
			possiblyCloudBacked: excludedMetadata.discardedEntries > 0,
			networkAccessAttempted: false,
		})),
		networkAccessAttempted: false,
	};
}

function validatePinnedColumns(adapter, options = {}) {
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

function validatePinnedTableDefinitions(schemaObjects, options = {}) {
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

function readSchemaObjects(adapter) {
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

function descendantNodes(root, name) {
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

function positiveInteger(value, fallback) {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function execute(database, sql, bind) {
	if (typeof database.run === 'function' && bind != null) {
		database.run(sql, bind || []);
		return database;
	}
	if (typeof database.run === 'function') {
		database.exec(sql);
		return database;
	}
	database.exec(bind == null ? sql : { sql, bind, returnValue: 'this' });
	return database;
}

function queryRows(database, sql, bind) {
	if (typeof database.prepare === 'function' && typeof database.run === 'function') {
		const statement = database.prepare(sql);
		try {
			if (bind != null) statement.bind(bind);
			const rows = [];
			while (statement.step()) rows.push(statement.get());
			return rows;
		} finally {
			statement.free();
		}
	}
	return database.exec({ sql, ...(bind == null ? {} : { bind }), rowMode: 'array', returnValue: 'resultRows' }) || [];
}

function transaction(database, callback) {
	execute(database, 'BEGIN IMMEDIATE');
	try {
		const result = callback();
		if (result && typeof result.then === 'function') throw new TypeError('AUP4 SQLite transactions must be synchronous inside their worker operation.');
		execute(database, 'COMMIT');
		return result;
	} catch (error) {
		try { execute(database, 'ROLLBACK'); } catch { /* Preserve the original error. */ }
		throw error;
	}
}

function unixSeconds(value = Date.now()) {
	const milliseconds = value instanceof Date ? value.getTime() : Number(value);
	if (!Number.isFinite(milliseconds)) throw new TypeError('A valid save timestamp is required.');
	return Math.floor(milliseconds / 1000);
}

function pruneHistory(adapter) {
	adapter.exec(`
		DELETE FROM project_history
		WHERE generation NOT IN (
			SELECT generation FROM project_history ORDER BY generation DESC LIMIT ${AUP4_HISTORY_DEPTH}
		)
	`);
}

function pruneOrphanSampleBlocks(adapter) {
	const referenced = new Set();
	const documents = [];
	for (const table of ['project', 'autosave']) {
		for (const [dictionary, document] of adapter.rows(`SELECT dict, doc FROM ${table} WHERE length(dict) > 0 AND length(doc) > 0`)) {
			documents.push({ table, dictionary, document });
		}
	}
	for (const [generation, dictionary, document] of adapter.rows(`
		SELECT generation, dict, doc FROM project_history
		WHERE length(dict) > 0 AND length(doc) > 0
		ORDER BY generation DESC LIMIT ${AUP4_HISTORY_DEPTH}
	`)) documents.push({ table: 'project_history', generation: Number(generation), dictionary, document });
	try {
		for (const candidate of documents) {
			const decoded = decodeAudacityBinaryXml(toBytes(candidate.dictionary), toBytes(candidate.document));
			for (const waveBlock of descendantNodes(decoded.root, 'waveblock')) {
				const blockId = Number(audacityXmlAttribute(waveBlock, 'blockid', 0));
				if (Number.isSafeInteger(blockId) && blockId > 0) referenced.add(blockId);
			}
		}
	} catch (error) {
		return { deleted: 0, skipped: true, reason: error?.code || 'INVALID_PROJECT_XML' };
	}
	const orphanIds = adapter.rows('SELECT blockid FROM sampleblocks ORDER BY blockid')
		.map(([blockId]) => Number(blockId))
		.filter((blockId) => !referenced.has(blockId));
	for (const blockId of orphanIds) adapter.exec('DELETE FROM sampleblocks WHERE blockid = ?', [blockId]);
	return { deleted: orphanIds.length, skipped: false, referenced: referenced.size };
}

function toBytes(value) {
	if (value instanceof Uint8Array) return value;
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError('A binary SQLite value is required.');
}

export const AUP4_DATABASE_PROFILE = Object.freeze({
	applicationId: AUP4_APPLICATION_ID,
	userVersion: AUP4_USER_VERSION,
	historyDepth: AUP4_HISTORY_DEPTH,
});
