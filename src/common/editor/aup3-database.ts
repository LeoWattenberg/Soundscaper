/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	audacityXmlAttribute,
	decodeAudacityBinaryXml,
} from './audacity-binary-xml.js';
import {
	createAup4DatabaseAdapter,
	toBytes,
} from './aup4-database-sql.js';
import { descendantNodes, validateAup4References } from './aup4-database-validation.js';
import { readAup4ProjectSummary } from './aup4-profile.js';
import {
	AUP3_APPLICATION_ID,
	AUP3_AUDACITY_VERSION,
	AUP3_BINARY_XML_VERSION,
	AUP3_COLUMN_PROFILE,
	AUP3_PAGE_SIZE,
	AUP3_SCHEMA_SQL,
	AUP3_USER_VERSION,
	Aup3Error,
	type Aup3ProjectDocument,
	type Aup3XmlEntry,
} from './aup3-profile.ts';

interface SqliteAdapter {
	exec(sql: string, bind?: unknown[]): unknown;
	rows(sql: string, bind?: unknown[]): unknown[][];
	value(sql: string, bind?: unknown[]): unknown;
	transaction<T>(callback: () => T): T;
}

export interface Aup3SchemaObject {
	readonly type: string;
	readonly name: string;
	readonly table: string;
	readonly sql: string;
}

export interface Aup3EncodedDocument {
	readonly dictionary: ArrayBuffer | ArrayBufferView;
	readonly document: ArrayBuffer | ArrayBufferView;
}

export interface Aup3SampleBlock {
	readonly sampleformat: number;
	readonly summin: number;
	readonly summax: number;
	readonly sumrms: number;
	readonly summary256: ArrayBuffer | ArrayBufferView;
	readonly summary64k: ArrayBuffer | ArrayBufferView;
	readonly samples: ArrayBuffer | ArrayBufferView;
}

export interface Aup3DatabaseValidation {
	readonly applicationId: number;
	readonly userVersion: number;
	readonly xmlVersion: string | null;
	readonly source: 'autosave' | 'project' | null;
	readonly document: ReturnType<typeof decodeAudacityBinaryXml> | null;
	readonly summary: ReturnType<typeof readAup4ProjectSummary> | null;
	readonly schemaObjects: readonly Aup3SchemaObject[];
	readonly references: ReturnType<typeof validateAup4References> | null;
	readonly readOnly: false;
}

export interface ValidateAup3DatabaseOptions {
	readonly allowEmpty?: boolean;
	readonly useAutosave?: boolean;
	readonly validateReferences?: boolean;
}

export function initializeAup3Database(database: unknown): Aup3DatabaseValidation {
	const adapter = databaseAdapter(database);
	adapter.exec('PRAGMA trusted_schema = OFF');
	adapter.exec('PRAGMA secure_delete = ON');
	const hasProjectTable = Number(adapter.value(`
		SELECT EXISTS(
			SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project'
		)
	`)) === 1;
	if (!hasProjectTable) {
		adapter.exec(`PRAGMA page_size = ${String(AUP3_PAGE_SIZE)}`);
		adapter.exec('VACUUM');
	}
	adapter.exec(AUP3_SCHEMA_SQL);
	assertPinnedPageSize(adapter);
	return validateAup3Database(database, { allowEmpty: true });
}

export function validateAup3Database(
	database: unknown,
	options: ValidateAup3DatabaseOptions = {},
): Aup3DatabaseValidation {
	const adapter = databaseAdapter(database);
	adapter.exec('PRAGMA trusted_schema = OFF');
	const applicationId = Number(adapter.value('PRAGMA application_id'));
	const userVersion = Number(adapter.value('PRAGMA user_version'));
	assertPinnedHeader(applicationId, userVersion);
	assertPinnedPageSize(adapter);
	const quickCheck = String(adapter.value('PRAGMA quick_check(1)') ?? '');
	if (quickCheck.toLowerCase() !== 'ok') {
		throw new Aup3Error(`SQLite integrity check failed: ${quickCheck || 'unknown error'}.`, 'CORRUPT_DATABASE');
	}
	const schemaObjects = readSchemaObjects(adapter);
	validateAup3SchemaObjects(schemaObjects);
	validateAup3Columns(adapter);

	const candidate = readDocumentCandidate(adapter, options.useAutosave !== false);
	if (candidate === null) {
		if (!options.allowEmpty) throw new Aup3Error('The Audacity project document is empty.', 'EMPTY_PROJECT');
		return {
			applicationId, userVersion, source: null, document: null, summary: null,
			xmlVersion: null, schemaObjects, references: null, readOnly: false,
		};
	}
	try {
		const document = decodeAudacityBinaryXml(candidate.dictionary, candidate.document);
		assertAup3DocumentProfile(document as Aup3ProjectDocument & ReturnType<typeof decodeAudacityBinaryXml>);
		const summary = readAup4ProjectSummary(document.root);
		if (summary.xmlVersion !== AUP3_BINARY_XML_VERSION
			|| summary.audacityVersion !== AUP3_AUDACITY_VERSION) {
			throw new Aup3Error('The Audacity document does not use the pinned 3.7.9 profile.', 'UNSUPPORTED_PROFILE');
		}
		const references = options.validateReferences === false
			? null
			: validateAup4References(database, document.root, {
				allowMissingSampleBlocks: false,
				includeNestedWaveClips: true,
				profileName: 'AUP3',
			});
		return {
			applicationId, userVersion, source: candidate.source, document, summary,
			xmlVersion: summary.xmlVersion, schemaObjects, references, readOnly: false,
		};
	} catch (error: unknown) {
		throw asAup3Error(error);
	}
}

/**
 * Certify the standalone database image before it is serialized. Unlike AUP4,
 * Audacity 3 commits autosave directly into `project` and has no history table.
 */
export function prepareAup3PortableExport(database: unknown): Aup3DatabaseValidation {
	const adapter = databaseAdapter(database);
	adapter.exec('PRAGMA trusted_schema = OFF');
	adapter.exec('PRAGMA secure_delete = ON');
	const integrityRows = adapter.rows('PRAGMA integrity_check').map(([value]) => String(value ?? ''));
	if (integrityRows.length !== 1 || integrityRows[0]?.toLowerCase() !== 'ok') {
		throw new Aup3Error(
			`SQLite integrity check failed: ${integrityRows.filter(Boolean).join('; ') || 'unknown error'}.`,
			'CORRUPT_DATABASE',
		);
	}
	assertPinnedHeader(
		Number(adapter.value('PRAGMA application_id')),
		Number(adapter.value('PRAGMA user_version')),
	);
	assertPinnedPageSize(adapter);
	const schemaObjects = readSchemaObjects(adapter);
	validateAup3SchemaObjects(schemaObjects);
	validateAup3Columns(adapter);
	if (Number(adapter.value('SELECT count(*) FROM autosave')) !== 0) {
		throw new Aup3Error('A portable AUP3 export still contains an autosave document.', 'UNCOMMITTED_AUTOSAVE');
	}
	const committedRows = Number(adapter.value(`
		SELECT count(*) FROM project
		WHERE id = 1 AND length(dict) > 0 AND length(doc) > 0
	`));
	const projectRows = Number(adapter.value('SELECT count(*) FROM project'));
	if (committedRows !== 1 || projectRows !== 1) {
		throw new Aup3Error('A portable AUP3 export has no committed project document.', 'UNCOMMITTED_PROJECT');
	}
	const validation = validateAup3Database(database, {
		useAutosave: false,
		validateReferences: true,
	});
	if (validation.source !== 'project' || validation.references === null) {
		throw new Aup3Error('The portable AUP3 export was not certified from the committed project.', 'UNCOMMITTED_PROJECT');
	}
	adapter.transaction(() => pruneOrphanSampleBlocks(adapter));
	const sampleBlockCount = Number(adapter.value('SELECT count(*) FROM sampleblocks'));
	if (sampleBlockCount !== validation.references.distinctSampleBlockCount) {
		throw new Aup3Error('The portable AUP3 export contains unreferenced audio blocks.', 'ORPHAN_SAMPLE_BLOCK');
	}
	const checkpoint = adapter.rows('PRAGMA wal_checkpoint(TRUNCATE)')[0] ?? [];
	if (checkpoint.length > 0 && Number(checkpoint[0]) !== 0) {
		throw new Aup3Error('The AUP3 write-ahead log could not be checkpointed.', 'WAL_CHECKPOINT_FAILED');
	}
	return validation;
}

export function writeAup3Document(
	database: unknown,
	encoded: Aup3EncodedDocument,
	options: { readonly autosave?: boolean } = {},
): { readonly table: 'autosave' | 'project'; readonly dictionaryBytes: number; readonly documentBytes: number } {
	const dictionary = toBytes(encoded?.dictionary).slice();
	const document = toBytes(encoded?.document).slice();
	if (dictionary.byteLength === 0 || document.byteLength === 0) {
		throw new Aup3Error('The Audacity project document cannot be empty.', 'EMPTY_PROJECT');
	}
	const table = options.autosave === false ? 'project' : 'autosave';
	const adapter = databaseAdapter(database);
	adapter.exec(
		`INSERT OR REPLACE INTO ${table}(id, dict, doc) VALUES(1, ?, ?)`,
		[dictionary, document],
	);
	if (table === 'project') pruneOrphanSampleBlocks(adapter);
	return { table, dictionaryBytes: dictionary.byteLength, documentBytes: document.byteLength };
}

export function commitAup3Autosave(database: unknown): boolean {
	const adapter = databaseAdapter(database);
	adapter.exec('PRAGMA secure_delete = ON');
	return adapter.transaction(() => {
		const autosave = adapter.rows('SELECT dict, doc FROM autosave WHERE id = 1 LIMIT 1')[0];
		if (!hasBytes(autosave?.[0]) || !hasBytes(autosave?.[1])) return false;
		adapter.exec('INSERT OR REPLACE INTO project(id, dict, doc) VALUES(1, ?, ?)', autosave);
		adapter.exec('DELETE FROM autosave WHERE id = 1');
		pruneOrphanSampleBlocks(adapter);
		return true;
	});
}

export function pruneAup3OrphanSampleBlocks(database: unknown): Readonly<{
	deleted: number;
	referenced: number;
}> {
	const adapter = databaseAdapter(database);
	adapter.exec('PRAGMA secure_delete = ON');
	return adapter.transaction(() => pruneOrphanSampleBlocks(adapter));
}

export function insertAup3SampleBlock(database: unknown, block: Aup3SampleBlock): number {
	for (const key of ['summary256', 'summary64k', 'samples'] as const) {
		if (!block?.[key]) throw new Aup3Error(`AUP3 sample block is missing ${key}.`, 'INVALID_SAMPLE_BLOCK');
	}
	const values = [block.sampleformat, block.summin, block.summax, block.sumrms];
	if (!values.every(Number.isFinite)) {
		throw new Aup3Error('AUP3 sample block has invalid numeric metadata.', 'INVALID_SAMPLE_BLOCK');
	}
	const adapter = databaseAdapter(database);
	adapter.exec(`
		INSERT INTO sampleblocks(sampleformat, summin, summax, sumrms, summary256, summary64k, samples)
		VALUES(?, ?, ?, ?, ?, ?, ?)
	`, [
		block.sampleformat, block.summin, block.summax, block.sumrms,
		toBytes(block.summary256), toBytes(block.summary64k), toBytes(block.samples),
	]);
	return Number(adapter.value('SELECT last_insert_rowid()'));
}

function assertPinnedHeader(applicationId: number, userVersion: number): void {
	if (applicationId !== AUP3_APPLICATION_ID) {
		throw new Aup3Error('The SQLite application id is not Audacity.', 'NOT_AUDACITY_PROJECT');
	}
	if (userVersion !== AUP3_USER_VERSION) {
		throw new Aup3Error('The Audacity database does not use the pinned 3.7 profile.', 'UNSUPPORTED_PROFILE');
	}
}

function assertPinnedPageSize(adapter: SqliteAdapter): void {
	if (Number(adapter.value('PRAGMA page_size')) !== AUP3_PAGE_SIZE) {
		throw new Aup3Error('The Audacity database does not use the native 64 KiB page size.', 'UNSUPPORTED_PROFILE');
	}
}

function validateAup3SchemaObjects(objects: readonly Aup3SchemaObject[]): void {
	for (const object of objects) {
		if (object.type === 'table' && ['project', 'autosave', 'sampleblocks', 'sqlite_sequence'].includes(object.name)) continue;
		if (object.type === 'index' && object.name.startsWith('sqlite_autoindex_')
			&& Object.hasOwn(AUP3_COLUMN_PROFILE, object.table)) continue;
		throw new Aup3Error(`Unexpected SQLite schema object: ${object.type} ${object.name}.`, 'UNSUPPORTED_SCHEMA');
	}
	const definitions = new Map(objects
		.filter((entry) => entry.type === 'table')
		.map((entry) => [entry.name, entry.sql.toUpperCase().replace(/\s+/gu, ' ')]));
	if (!definitions.has('sqlite_sequence')) {
		throw new Aup3Error('The native AUP3 autoincrement table is missing.', 'UNSUPPORTED_SCHEMA');
	}
	for (const table of Object.keys(AUP3_COLUMN_PROFILE)) {
		const sql = definitions.get(table);
		if (!sql) throw new Aup3Error(`The AUP3 table ${table} is missing.`, 'UNSUPPORTED_SCHEMA');
		if (/\b(WITHOUT ROWID|STRICT|GENERATED|CHECK|REFERENCES|UNIQUE|COLLATE|DEFAULT)\b|\bNOT\s+NULL\b/u.test(sql)) {
			throw new Aup3Error(`The AUP3 table ${table} has unsupported constraints.`, 'UNSUPPORTED_SCHEMA');
		}
	}
	for (const table of ['project', 'autosave']) {
		if (/\bID\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/u.test(definitions.get(table) ?? '')) {
			throw new Aup3Error(`The AUP3 table ${table} has a non-native autoincrement key.`, 'UNSUPPORTED_SCHEMA');
		}
	}
	if (!/\bBLOCKID\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/u.test(definitions.get('sampleblocks') ?? '')) {
		throw new Aup3Error('The AUP3 sampleblocks table does not use the native autoincrement key.', 'UNSUPPORTED_SCHEMA');
	}
}

function validateAup3Columns(adapter: SqliteAdapter): void {
	for (const [table, expected] of Object.entries(AUP3_COLUMN_PROFILE)) {
		const actual = adapter.rows(`PRAGMA table_xinfo(${table})`).map((row) => ({
			name: String(row[1]), type: String(row[2]).toUpperCase(),
			primaryKey: Number(row[5]), hidden: Number(row[6] ?? 0),
		}));
		const matches = actual.length === expected.length && expected.every(([name, type, primaryKey], index) => {
			const column = actual[index];
			return column?.name === name && column.type === type
				&& column.primaryKey === primaryKey && column.hidden === 0;
		});
		if (!matches) throw new Aup3Error(`Unexpected columns in AUP3 table ${table}.`, 'UNSUPPORTED_SCHEMA');
	}
}

function assertAup3DocumentProfile(document: Aup3ProjectDocument): void {
	const roots = document.roots ?? [];
	const visit = (entry: Aup3XmlEntry): void => {
		if (entry.kind === 'blob') {
			throw new Aup3Error('Audacity 3 binary XML cannot contain blob fields.', 'UNSUPPORTED_PROFILE');
		}
		if (entry.kind === 'node') for (const child of entry.node.content) visit(child);
	};
	for (const entry of roots) visit(entry);
}

function readSchemaObjects(adapter: SqliteAdapter): Aup3SchemaObject[] {
	return adapter.rows(`
		SELECT type, name, tbl_name, sql FROM sqlite_master
		WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type, name
	`).map(([type, name, table, sql]) => ({
		type: String(type), name: String(name), table: String(table), sql: String(sql ?? ''),
	}));
}

function readDocumentCandidate(
	adapter: SqliteAdapter,
	useAutosave: boolean,
): { source: 'autosave' | 'project'; dictionary: Uint8Array; document: Uint8Array } | null {
	for (const source of useAutosave ? ['autosave', 'project'] as const : ['project'] as const) {
		const row = adapter.rows(`SELECT dict, doc FROM ${source} WHERE id = 1 LIMIT 1`)[0];
		if (hasBytes(row?.[0]) && hasBytes(row?.[1])) return {
			source,
			dictionary: toBytes(row[0]).slice(),
			document: toBytes(row[1]).slice(),
		};
	}
	return null;
}

function pruneOrphanSampleBlocks(adapter: SqliteAdapter): Readonly<{
	deleted: number;
	referenced: number;
}> {
	const referenced = new Set<number>();
	try {
		for (const table of ['project', 'autosave']) {
			for (const [dictionary, document] of adapter.rows(`
				SELECT dict, doc FROM ${table} WHERE length(dict) > 0 AND length(doc) > 0
			`)) {
				const decoded = decodeAudacityBinaryXml(toBytes(dictionary), toBytes(document));
				for (const waveBlock of descendantNodes(decoded.root, 'waveblock')) {
					const blockId = Number(audacityXmlAttribute(waveBlock, 'blockid') ?? 0);
					if (Number.isSafeInteger(blockId) && blockId > 0) referenced.add(blockId);
				}
			}
		}
	} catch (error: unknown) {
		throw asAup3Error(error);
	}
	const orphanIds = adapter.rows('SELECT blockid FROM sampleblocks ORDER BY blockid')
		.map(([blockId]) => Number(blockId))
		.filter((blockId) => !referenced.has(blockId));
	for (const blockId of orphanIds) adapter.exec('DELETE FROM sampleblocks WHERE blockid = ?', [blockId]);
	return { deleted: orphanIds.length, referenced: referenced.size };
}

function databaseAdapter(database: unknown): SqliteAdapter {
	return createAup4DatabaseAdapter(database) as SqliteAdapter;
}

function hasBytes(value: unknown): value is ArrayBuffer | ArrayBufferView {
	return (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) && value.byteLength > 0;
}

function asAup3Error(error: unknown): Aup3Error {
	if (error instanceof Aup3Error) return error;
	if (error instanceof Error) {
		const code = 'code' in error && typeof error.code === 'string' ? error.code : 'INVALID_PROJECT_XML';
		return new Aup3Error(error.message, code, { cause: error });
	}
	return new Aup3Error('The Audacity project document is invalid.', 'INVALID_PROJECT_XML');
}
