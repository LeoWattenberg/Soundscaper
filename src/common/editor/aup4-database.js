import {
	audacityXmlAttribute,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from './audacity-binary-xml.js';
import {
	mergeAup4SanitizationReports,
	sanitizeAup4Document,
} from './aup4-sanitization.js';
import {
	AUP4_APPLICATION_ID,
	AUP4_BINARY_XML_VERSION,
	AUP4_HISTORY_DEPTH,
	AUP4_SCHEMA_SQL,
	AUP4_USER_VERSION,
	Aup4Error,
	validateAup4SchemaObjects,
} from './aup4-profile.js';
import {
	createAup4DatabaseAdapter,
	toBytes,
	unixSeconds,
} from './aup4-database-sql.js';
import {
	descendantNodes,
	readSchemaObjects,
	validateAudacityProjectDatabase,
	validatePinnedColumns,
	validatePinnedTableDefinitions,
} from './aup4-database-validation.js';

export { createAup4DatabaseAdapter } from './aup4-database-sql.js';
export {
	validateAudacityProjectDatabase,
	validateAup4References,
} from './aup4-database-validation.js';

const SQLITE_HEADER = Uint8Array.of(0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00);


/**
 * sqlite3_deserialize cannot open a standalone main-database image whose
 * header still requests WAL, because no companion `-wal` VFS file exists.
 * Native portable AUP4 snapshots are checkpointed but retain that flag. A
 * private copy may safely request rollback journaling before deserialization;
 * the source File/ArrayBuffer is never modified.
 */
export function prepareAudacitySerializedDatabase(input) {
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

export function initializeAup4Database(database) {
	const adapter = createAup4DatabaseAdapter(database);
	adapter.exec('PRAGMA trusted_schema = OFF');
	adapter.exec(AUP4_SCHEMA_SQL);
	return validateAudacityProjectDatabase(database, { allowEmpty: true });
}

/**
 * Checkpoint and validate a standalone AUP4 image before it is handed to a
 * browser download or desktop file writer. This is intentionally stricter
 * than open-time validation: a newly-authored file must have no autosave row,
 * no missing audio, and no dependency on a WAL sidecar.
 */
export function prepareAup4PortableExport(database) {
	const adapter = createAup4DatabaseAdapter(database);
	adapter.exec('PRAGMA trusted_schema = OFF');
	const integrityRows = adapter.rows('PRAGMA integrity_check').map(([value]) => String(value || ''));
	if (integrityRows.length !== 1 || integrityRows[0].toLowerCase() !== 'ok') {
		throw new Aup4Error(
			`SQLite integrity check failed: ${integrityRows.filter(Boolean).join('; ') || 'unknown error'}.`,
			'CORRUPT_DATABASE',
		);
	}
	const autosaveRows = Number(adapter.value('SELECT count(*) FROM autosave'));
	if (autosaveRows !== 0) {
		throw new Aup4Error('A portable AUP4 export still contains an autosave document.', 'UNCOMMITTED_AUTOSAVE');
	}
	const committedHistoryRows = Number(adapter.value(`
		SELECT count(*)
		FROM project AS current
		JOIN project_history AS history
		  ON history.generation = (SELECT max(generation) FROM project_history)
		 AND history.dict = current.dict
		 AND history.doc = current.doc
		WHERE current.id = 1
	`));
	if (committedHistoryRows !== 1) {
		throw new Aup4Error(
			'A portable AUP4 export does not have a committed history snapshot.',
			'UNCOMMITTED_HISTORY',
		);
	}
	const validation = validateAudacityProjectDatabase(database, {
		allowHistoryRecovery: false,
		validateReferences: true,
		references: { allowMissingSampleBlocks: false },
	});
	if (validation.source !== 'project') {
		throw new Aup4Error('A portable AUP4 export was not certified from the committed project document.', 'UNCOMMITTED_HISTORY');
	}
	if (validation.readOnly || validation.applicationId !== AUP4_APPLICATION_ID
		|| validation.userVersion !== AUP4_USER_VERSION
		|| validation.summary?.xmlVersion !== AUP4_BINARY_XML_VERSION) {
		throw new Aup4Error('A portable AUP4 export does not use the pinned writable profile.', 'UNSUPPORTED_SCHEMA');
	}
	const checkpoint = adapter.rows('PRAGMA wal_checkpoint(TRUNCATE)')[0] || [];
	if (checkpoint.length && Number(checkpoint[0]) !== 0) {
		throw new Aup4Error('The AUP4 write-ahead log could not be checkpointed.', 'WAL_CHECKPOINT_FAILED');
	}
	return validation;
}

/**
 * Upgrade an older Audacity AUP4 schema in the browser-owned database copy.
 * The pinned native loader has one schema migration: add project_history and
 * advance user_version. The transaction is validated before commit, so a
 * malformed legacy file remains byte-for-byte untouched by its caller.
 */
export function upgradeAudacityProjectDatabase(database, options = {}) {
	const adapter = createAup4DatabaseAdapter(database);
	adapter.exec('PRAGMA trusted_schema = OFF');
	const applicationId = Number(adapter.value('PRAGMA application_id'));
	const userVersion = Number(adapter.value('PRAGMA user_version'));
	if (applicationId !== AUP4_APPLICATION_ID || userVersion >= AUP4_USER_VERSION) {
		return {
			upgraded: false,
			fromVersion: userVersion,
			toVersion: userVersion,
			validation: validateAudacityProjectDatabase(database, options),
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
		return validateAudacityProjectDatabase(database, options);
	});
	return {
		upgraded: true,
		fromVersion: userVersion,
		toVersion: AUP4_USER_VERSION,
		validation,
	};
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

export const AUP4_DATABASE_PROFILE = Object.freeze({
	applicationId: AUP4_APPLICATION_ID,
	userVersion: AUP4_USER_VERSION,
	historyDepth: AUP4_HISTORY_DEPTH,
});

export { prepareAudacitySerializedDatabase as prepareAup4SerializedDatabase, upgradeAudacityProjectDatabase as upgradeAup4Database, validateAudacityProjectDatabase as validateAup4Database };
