import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import sqliteWasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';

import { decodeAudacityBinaryXml, encodeAudacityBinaryXml } from './audacity-binary-xml.js';
import {
	commitAup4Autosave,
	discardExcludedAup4Metadata,
	initializeAup4Database,
	insertAup4SampleBlock,
	listAup4History,
	prepareAup4SerializedDatabase,
	readAup4Document,
	readAup4SampleBlock,
	restoreAup4History,
	upgradeAup4Database,
	validateAup4Database,
	writeAup4Document,
} from './aup4-database.js';
import { decodeAup4ProjectTree } from './aup4-conversion.js';
import {
	AUP4_MAX_BLOCK_SAMPLES,
	createAup4ProjectDocument,
	createAup4SampleBlock,
	effectiveAup4SaveLimit,
} from './aup4-profile.js';
import { sanitizeAup4Document } from './aup4-sanitization.js';

const DATABASE_DIRECTORY = 'kw-media/audio-editor/aup4';
const VFS_NAME = 'kw-media-aup4';
const INITIAL_POOL_CAPACITY = 12;
const IMPORT_CHUNK_BYTES = 1024 * 1024;
const WORKER_VALIDATION_OPTIONS = Object.freeze({
	references: Object.freeze({ allowMissingSampleBlocks: true }),
});
const projects = new Map();
const cancelled = new Set();
let sqlitePromise;
let poolPromise;

globalThis.addEventListener('message', (event) => {
	const message = event.data || {};
	if (message.type === 'cancel') {
		cancelled.add(message.id);
		return;
	}
	void dispatch(message).catch((error) => {
		postMessage({ id: message.id, error: serializeError(error) });
	});
});

async function dispatch(message) {
	if (!message.id || typeof message.type !== 'string') return;
	const context = {
		id: message.id,
		progress(value, phase, detail = null) { postMessage({ id: message.id, progress: { value, phase, detail } }); },
		checkCancelled() {
			if (cancelled.has(message.id)) throw operationError('The AUP4 operation was cancelled.', 'ABORTED');
		},
	};
	try {
		const result = await handle(message.type, message.args || {}, context);
		const transfer = collectTransferables(result);
		postMessage({ id: message.id, result }, transfer);
	} finally {
		cancelled.delete(message.id);
	}
}

async function handle(type, args, context) {
	if (type === 'initialize') {
		const environment = await environmentInfo();
		return environment;
	}
	if (type === 'create') return createProject(args, context);
	if (type === 'open-file') return openFile(args, context);
	if (type === 'inspect') return inspectProject(args.projectId, args.options);
	if (type === 'decode') return decodeProject(args, context);
	if (type === 'write-document') return updateDocument(args, context);
	if (type === 'write-snapshot') return writeSnapshot(args, context);
	if (type === 'commit') return commitProject(args.projectId, args.now);
	if (type === 'restore-history') return restoreHistory(args.projectId, args.generation);
	if (type === 'history') return listHistory(args.projectId);
	if (type === 'read-block') return readBlock(args.projectId, args.blockId);
	if (type === 'export') return exportProject(args, context);
	if (type === 'close') return closeProject(args.projectId);
	if (type === 'delete') return deleteProject(args.projectId);
	if (type === 'list-open') return [...projects.values()].map(projectDescriptor);
	throw operationError(`Unsupported AUP4 worker operation: ${type}.`, 'UNKNOWN_OPERATION');
}

async function initializeSqlite() {
	if (!sqlitePromise) sqlitePromise = sqlite3InitModule({
		locateFile(path) { return path.endsWith('.wasm') ? sqliteWasmUrl : path; },
		print: () => undefined,
		printErr: (...values) => console.warn('[AUP4 SQLite]', ...values),
	});
	return sqlitePromise;
}

async function initializePool() {
	if (poolPromise) return poolPromise;
	poolPromise = (async () => {
		const sqlite = await initializeSqlite();
		try {
			const pool = await sqlite.installOpfsSAHPoolVfs({
				name: VFS_NAME,
				directory: DATABASE_DIRECTORY,
				initialCapacity: INITIAL_POOL_CAPACITY,
			});
			await pool.reserveMinimumCapacity(INITIAL_POOL_CAPACITY);
			return pool;
		} catch (error) {
			console.warn('[AUP4 SQLite] OPFS SAH pool unavailable; using bounded memory storage.', error);
			return null;
		}
	})();
	return poolPromise;
}

async function environmentInfo() {
	const sqlite = await initializeSqlite();
	const pool = await initializePool();
	return {
		backend: pool ? 'opfs-sahpool' : 'memory',
		opfs: Boolean(pool),
		vfs: pool?.vfsName || null,
		poolCapacity: pool?.getCapacity() || 0,
		poolFiles: pool?.getFileCount() || 0,
		sqliteVersion: sqlite.version.libVersion,
	};
}

async function createProject(args, context) {
	const projectId = normalizeProjectId(args.projectId);
	if (projects.has(projectId)) return projectDescriptor(projects.get(projectId));
	const sqlite = await initializeSqlite();
	const pool = await initializePool();
	context.checkCancelled();
	const entry = openDatabase(sqlite, pool, projectId);
	try {
		initializeAup4Database(entry.database);
		projects.set(projectId, entry);
		return projectDescriptor(entry);
	} catch (error) {
		entry.database.close();
		throw error;
	}
}

async function openFile(args, context) {
	const projectId = normalizeProjectId(args.projectId);
	const file = args.file;
	if (!file || typeof file.size !== 'number' || typeof file.slice !== 'function') throw operationError('A File is required to open an AUP4 project.', 'INVALID_FILE');
	const sqlite = await initializeSqlite();
	const pool = await initializePool();
	const limit = portableLimit(args, Boolean(pool));
	const availableQuota = storageAvailable(args);
	if (availableQuota != null && file.size > availableQuota) throw operationError(
		'The AUP4 file is larger than the browser storage currently available.',
		'QUOTA_EXCEEDED',
		{ required: file.size, available: availableQuota, readOnlyAvailable: false },
	);
	const exceedsEditableLimit = file.size > limit;
	if (exceedsEditableLimit && !pool) {
		throw operationError(`The AUP4 file exceeds this browser's ${Math.round(limit / 1024 / 1024)} MiB in-memory project limit.`, 'PROJECT_TOO_LARGE', {
			readOnlyAvailable: false,
			limit,
			size: file.size,
		});
	}
	await closeProject(projectId);
	context.progress(0, 'importing');
	let entry;
	if (pool) {
		const path = projectPath(projectId);
		let offset = 0;
		try {
			try { pool.unlink(path); } catch { /* There may be no prior pool file. */ }
			await pool.importDb(path, async () => {
				context.checkCancelled();
				if (offset >= file.size) return undefined;
				const end = Math.min(file.size, offset + IMPORT_CHUNK_BYTES);
				const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
				context.checkCancelled();
				offset = end;
				context.progress(file.size ? offset / file.size : 1, 'importing');
				return chunk;
			});
			context.checkCancelled();
			entry = openDatabase(sqlite, pool, projectId);
		} catch (error) {
			try { pool.unlink(path); } catch { /* Preserve the import/cancellation error. */ }
			throw error;
		}
	} else {
		context.checkCancelled();
		const bytes = new Uint8Array(await file.arrayBuffer());
		context.checkCancelled();
		entry = { projectId, path: ':memory:', database: deserializeMemoryDatabase(sqlite, bytes), backend: 'memory', pool: null };
	}
	try {
		const migration = upgradeAup4Database(entry.database, WORKER_VALIDATION_OPTIONS);
		const discardedCloudMetadata = discardExcludedAup4Metadata(entry.database);
		entry.discardedCloudMetadata = discardedCloudMetadata;
		const validation = discardedCloudMetadata.discardedEntries
			? validateAup4Database(entry.database, WORKER_VALIDATION_OPTIONS)
			: migration.validation;
		entry.portableLimit = limit;
		entry.openedSize = file.size;
		entry.readOnly = Boolean(validation.readOnly || exceedsEditableLimit);
		projects.set(projectId, entry);
		context.progress(1, 'complete');
		const portable = portableValidation(validation, entry);
		if (migration.upgraded) portable.issues = [...portable.issues, {
			level: 'warning',
			code: 'SCHEMA_UPGRADED',
			message: `The AUP4 database schema was upgraded from 0x${migration.fromVersion.toString(16)} to the pinned browser profile.`,
		}];
		if (exceedsEditableLimit) portable.issues = [...portable.issues, {
			level: 'warning',
			code: 'EDITABLE_LIMIT_EXCEEDED',
			message: `This project exceeds the browser's ${Math.round(limit / 1024 / 1024)} MiB editable-project limit and was opened read-only for audio extraction.`,
		}];
		return { ...projectDescriptor(entry), validation: portable };
	} catch (error) {
		entry.database.close();
		if (pool) pool.unlink(entry.path);
		throw error;
	}
}

function openDatabase(sqlite, pool, projectId) {
	const path = projectPath(projectId);
	const database = pool ? new pool.OpfsSAHPoolDb(path, 'c') : new sqlite.oo1.DB(':memory:', 'c');
	configureDefensiveDatabase(sqlite, database);
	return { projectId, path: pool ? path : ':memory:', database, backend: pool ? 'opfs-sahpool' : 'memory', pool: pool || null, readOnly: false };
}

function deserializeMemoryDatabase(sqlite, bytes) {
	const serialized = prepareAup4SerializedDatabase(bytes);
	const database = new sqlite.oo1.DB(':memory:', 'c');
	const pointer = sqlite.wasm.allocFromTypedArray(serialized);
	const flags = (sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE || 1) | (sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE || 2);
	const result = sqlite.capi.sqlite3_deserialize(database.pointer, 'main', pointer, serialized.byteLength, serialized.byteLength, flags);
	if (result) {
		sqlite.wasm.dealloc(pointer);
		database.close();
		throw operationError(`SQLite could not deserialize the AUP4 file (${result}).`, 'INVALID_DATABASE');
	}
	configureDefensiveDatabase(sqlite, database);
	return database;
}

function configureDefensiveDatabase(sqlite, database) {
	const { capi } = sqlite;
	const pointer = database?.pointer;
	if (!pointer || typeof capi?.sqlite3_db_config !== 'function') {
		database?.close?.();
		throw operationError('SQLite defensive mode is unavailable in this browser.', 'SQLITE_SECURITY_UNAVAILABLE');
	}
	for (const [option, value] of [
		[capi.SQLITE_DBCONFIG_DEFENSIVE, 1],
		[capi.SQLITE_DBCONFIG_TRUSTED_SCHEMA, 0],
	]) {
		const result = capi.sqlite3_db_config(pointer, option, value, 0);
		if (result !== capi.SQLITE_OK) {
			database.close();
			throw operationError(`SQLite could not enable its defensive project-file mode (${result}).`, 'SQLITE_SECURITY_UNAVAILABLE');
		}
	}
	database.exec('PRAGMA trusted_schema = OFF');
}

function inspectProject(projectId, options) {
	const entry = requireProject(projectId);
	return portableValidation(validateAup4Database(entry.database, mergeValidationOptions(options)), entry);
}

async function decodeProject(args, context) {
	const entry = requireProject(args.projectId);
	const validation = validateAup4Database(entry.database, WORKER_VALIDATION_OPTIONS);
	const decoded = await decodeAup4ProjectTree(
		validation.document.root,
		async (blockId) => {
			context.checkCancelled();
			return readAup4SampleBlock(entry.database, blockId);
		},
		{
			projectId: entry.projectId,
			title: args.title,
			maxDecodedBytes: args.maxDecodedBytes,
			onProgress(progress) { context.progress(progress.value, progress.phase, { blockId: progress.blockId }); },
		},
	);
	const portable = portableValidation(validation, entry);
	return {
		...decoded,
		validation: portable,
		compatibilityReport: mergeCompatibilityReports(portable.compatibilityReport, decoded.compatibilityReport),
	};
}

function updateDocument(args, context) {
	const entry = requireWritableProject(args.projectId);
	context.checkCancelled();
	const blockIds = [];
	entry.database.exec('BEGIN IMMEDIATE');
	try {
		for (const block of args.sampleBlocks || []) {
			context.checkCancelled();
			blockIds.push(insertAup4SampleBlock(entry.database, block));
		}
		const decoded = decodeAudacityBinaryXml(args.encoded?.dictionary, args.encoded?.document);
		const sanitized = sanitizeAup4Document(decoded);
		const encoded = encodeAudacityBinaryXml(sanitized.document);
		const result = writeAup4Document(entry.database, encoded, { autosave: args.autosave !== false });
		entry.database.exec('COMMIT');
		entry.discardedCloudMetadata = mergeSanitizationReport(entry.discardedCloudMetadata, sanitized.report);
		return { ...result, blockIds };
	} catch (error) {
		try { entry.database.exec('ROLLBACK'); } catch { /* Preserve original error. */ }
		throw error;
	}
}

function writeSnapshot(args, context) {
	const entry = requireWritableProject(args.projectId);
	if (!args.project || !Array.isArray(args.sources)) throw operationError('A project and its source channels are required.', 'INVALID_SNAPSHOT');
	const estimatedBytes = estimateSnapshotBytes(args.sources);
	const limit = portableLimit(args, Boolean(entry.pool));
	entry.portableLimit = limit;
	if (estimatedBytes > limit) throw operationError(
		`The estimated AUP4 snapshot exceeds this browser's ${Math.round(limit / 1024 / 1024)} MiB save limit.`,
		'PROJECT_TOO_LARGE',
		{ limit, size: estimatedBytes, phase: 'preflight' },
	);
	const sourceById = new Map(args.sources.map((source) => [source.sourceId, source]));
	const expectedSources = new Set((args.project.sources || []).map((source) => source.id));
	for (const sourceId of expectedSources) {
		if (!sourceById.has(sourceId) && (args.project.clips || []).some((clip) => clip.sourceId === sourceId)) {
			throw operationError(`PCM for project source ${sourceId} is missing.`, 'MISSING_SOURCE');
		}
	}
	const totalSamples = args.sources.reduce((total, source) => total + (source.channels || []).reduce((sum, channel) => sum + Number(channel?.length || 0), 0), 0);
	let completedSamples = 0;
	const channelBlocks = new Map();
	entry.database.exec('BEGIN IMMEDIATE');
	try {
		for (const source of args.sources) {
			if (!expectedSources.has(source.sourceId)) continue;
			for (let channelIndex = 0; channelIndex < (source.channels || []).length; channelIndex += 1) {
				const samples = normalizeFloat32(source.channels[channelIndex]);
				const blocks = [];
				for (let offset = 0; offset < samples.length; offset += AUP4_MAX_BLOCK_SAMPLES) {
					context.checkCancelled();
					const chunk = samples.subarray(offset, Math.min(samples.length, offset + AUP4_MAX_BLOCK_SAMPLES));
					const blockId = insertAup4SampleBlock(entry.database, createAup4SampleBlock(chunk));
					blocks.push({ blockId, start: offset, sampleCount: chunk.length });
					completedSamples += chunk.length;
					context.progress(totalSamples ? completedSamples / totalSamples : 1, 'encoding-audio', { sourceId: source.sourceId, channel: channelIndex });
				}
				channelBlocks.set(`${source.sourceId}:${channelIndex}`, blocks);
			}
		}
		const document = createAup4ProjectDocument(args.project, channelBlocks);
		const encoded = encodeAudacityBinaryXml(document);
		const result = writeAup4Document(entry.database, encoded, { autosave: args.autosave !== false });
		entry.database.exec('COMMIT');
		context.progress(1, 'complete');
		return { ...result, sourceCount: sourceById.size, sampleCount: totalSamples };
	} catch (error) {
		try { entry.database.exec('ROLLBACK'); } catch { /* Preserve original error. */ }
		throw error;
	}
}

function commitProject(projectId, now) {
	const entry = requireWritableProject(projectId);
	return { committed: commitAup4Autosave(entry.database, { now }), history: listAup4History(entry.database) };
}

function restoreHistory(projectId, generation) {
	const entry = requireWritableProject(projectId);
	return {
		restored: restoreAup4History(entry.database, generation),
		validation: portableValidation(validateAup4Database(entry.database, WORKER_VALIDATION_OPTIONS), entry),
	};
}

function listHistory(projectId) { return listAup4History(requireProject(projectId).database); }

function readBlock(projectId, blockId) { return readAup4SampleBlock(requireProject(projectId).database, blockId); }

async function exportProject(args, context) {
	const projectId = normalizeProjectId(args.projectId);
	const entry = requireProject(projectId);
	if (!entry.readOnly && args.commit !== false) commitAup4Autosave(entry.database, { now: args.now });
	validateAup4Database(entry.database, WORKER_VALIDATION_OPTIONS);
	context.checkCancelled();
	let bytes;
	if (entry.pool) {
		entry.database.close();
		entry.database = null;
		try {
			bytes = entry.pool.exportFile(entry.path);
		} finally {
			const sqlite = await initializeSqlite();
			entry.database = openDatabase(sqlite, entry.pool, projectId).database;
		}
	} else {
		const sqlite = await initializeSqlite();
		bytes = sqlite.capi.sqlite3_js_db_export(entry.database.pointer);
	}
	context.checkCancelled();
	const limit = portableLimit(args, Boolean(entry.pool));
	if (bytes.byteLength > limit) throw operationError(`The AUP4 snapshot exceeds this browser's ${Math.round(limit / 1024 / 1024)} MiB save limit.`, 'PROJECT_TOO_LARGE', { limit, size: bytes.byteLength });
	context.progress(1, 'complete');
	return { bytes, size: bytes.byteLength, mimeType: 'application/x-audacity-project', extension: '.aup4' };
}

async function closeProject(projectId) {
	const id = normalizeProjectId(projectId);
	const entry = projects.get(id);
	if (!entry) return false;
	entry.database?.close();
	projects.delete(id);
	return true;
}

async function deleteProject(projectId) {
	const id = normalizeProjectId(projectId);
	const entry = projects.get(id);
	const pool = entry?.pool || await initializePool();
	const path = entry?.path || projectPath(id);
	await closeProject(id);
	return pool ? pool.unlink(path) : true;
}

function requireProject(projectId) {
	const entry = projects.get(normalizeProjectId(projectId));
	if (!entry?.database) throw operationError(`AUP4 project is not open: ${projectId}.`, 'PROJECT_NOT_OPEN');
	return entry;
}

function requireWritableProject(projectId) {
	const entry = requireProject(projectId);
	if (entry.readOnly) throw operationError('This newer AUP4 project is read-only.', 'READ_ONLY');
	return entry;
}

function projectDescriptor(entry) {
	return {
		projectId: entry.projectId,
		backend: entry.backend,
		readOnly: Boolean(entry.readOnly),
		...(Number.isFinite(entry.portableLimit) ? { portableLimit: entry.portableLimit } : {}),
	};
}


function portableValidation(validation, entry = null) {
	const discardedCloudMetadata = mergeSanitizationReport(
		validation.compatibilityReport?.discardedCloudMetadata,
		entry?.discardedCloudMetadata,
	);
	const issues = [...(validation.issues || [])];
	if (discardedCloudMetadata.discardedEntries && !issues.some((issue) => issue.code === 'EXCLUDED_CLOUD_METADATA')) issues.push({
		level: 'warning',
		code: 'EXCLUDED_CLOUD_METADATA',
		message: `${discardedCloudMetadata.discardedEntries} cloud/account metadata ${discardedCloudMetadata.discardedEntries === 1 ? 'entry was' : 'entries were'} discarded from the browser project.`,
	});
	if (entry && !entry.pool && !issues.some((issue) => issue.code === 'NO_CRASH_RECOVERY')) issues.push({
		level: 'warning',
		code: 'NO_CRASH_RECOVERY',
		message: 'OPFS persistence is unavailable; this in-memory AUP4 session has no browser-crash recovery.',
	});
	return {
		compatible: validation.compatible,
		readOnly: validation.readOnly || Boolean(entry?.readOnly),
		applicationId: validation.applicationId,
		userVersion: validation.userVersion,
		xmlVersion: validation.xmlVersion,
		source: validation.source,
		generation: validation.generation,
		summary: validation.summary,
		references: validation.references,
		recovery: validation.recovery,
		issues,
		compatibilityReport: {
			discardedCloudMetadata,
			missingAudio: (validation.compatibilityReport?.missingAudio || []).map((missing) => ({
				...missing,
				possiblyCloudBacked: Boolean(missing.possiblyCloudBacked || discardedCloudMetadata.discardedEntries),
			})),
			networkAccessAttempted: false,
			persistence: entry ? {
				backend: entry.backend,
				crashRecovery: Boolean(entry.pool),
			} : null,
			limits: entry ? {
				portableSaveBytes: entry.portableLimit ?? null,
				openedBytes: entry.openedSize ?? null,
			} : null,
		},
	};
}

function projectPath(projectId) { return `/project-${normalizeProjectId(projectId)}.aup4`; }

function normalizeProjectId(value) {
	const id = String(value || '').trim();
	if (!id || id.length > 160 || !/^[a-z0-9_-]+$/i.test(id)) throw operationError('A stable alphanumeric project id is required.', 'INVALID_PROJECT_ID');
	return id;
}

function normalizeLimit(value, fallback) {
	const limit = Number(value);
	return Number.isSafeInteger(limit) && limit >= 0 ? Math.min(limit, fallback) : fallback;
}

function portableLimit(args, opfs) {
	const fallback = effectiveAup4SaveLimit({
		opfs,
		mobile: args.mobile,
		deviceMemory: args.deviceMemory,
		...(args.quota == null ? {} : { quota: args.quota }),
		...(args.usage == null ? {} : { usage: args.usage }),
		workingBytes: args.workingBytes,
	});
	return normalizeLimit(args.maxBytes, fallback);
}

function storageAvailable(args) {
	if (args.quota == null || args.usage == null) return null;
	const quota = Number(args.quota);
	const usage = Number(args.usage);
	if (!Number.isFinite(quota) || !Number.isFinite(usage)) return null;
	return Math.max(0, quota - usage);
}

function estimateSnapshotBytes(sources) {
	let pcmBytes = 0;
	for (const source of sources || []) for (const channel of source.channels || []) {
		pcmBytes += Number(channel?.byteLength || Number(channel?.length || 0) * Float32Array.BYTES_PER_ELEMENT);
	}
	// Float32 blocks plus exact summaries, SQLite pages, and project/history XML.
	return Math.ceil(pcmBytes * 1.02) + 2 * 1024 * 1024;
}

function mergeValidationOptions(options) {
	return {
		...(options || {}),
		references: {
			...WORKER_VALIDATION_OPTIONS.references,
			...(options?.references || {}),
		},
	};
}

function mergeSanitizationReport(...reports) {
	const values = reports.filter(Boolean);
	return {
		discardedEntries: values.reduce((sum, report) => sum + Number(report.discardedEntries || 0), 0),
		nodeNames: [...new Set(values.flatMap((report) => report.nodeNames || []))].sort(),
		attributeNames: [...new Set(values.flatMap((report) => report.attributeNames || []))].sort(),
		tagNames: [...new Set(values.flatMap((report) => report.tagNames || []))].sort(),
	};
}

function mergeCompatibilityReports(left, right) {
	return {
		discardedCloudMetadata: mergeSanitizationReport(left?.discardedCloudMetadata, right?.discardedCloudMetadata),
		missingAudio: [...(left?.missingAudio || []), ...(right?.missingAudio || [])]
			.filter((entry, index, all) => all.findIndex((candidate) => candidate.blockId === entry.blockId && candidate.reason === entry.reason) === index),
		networkAccessAttempted: false,
		persistence: left?.persistence || right?.persistence || null,
		limits: left?.limits || right?.limits || null,
	};
}

function normalizeFloat32(value) {
	if (value instanceof Float32Array) return value;
	if (ArrayBuffer.isView(value) || Array.isArray(value)) return Float32Array.from(value);
	throw operationError('AUP4 source channels must contain Float32 samples.', 'INVALID_SOURCE_AUDIO');
}

function operationError(message, code, details) {
	const error = new Error(message);
	error.name = 'Aup4WorkerError';
	error.code = code;
	if (details) error.details = details;
	return error;
}

function serializeError(error) {
	const quotaFailure = error?.name === 'QuotaExceededError' || error?.code === 22;
	return {
		name: String(error?.name || 'Error'),
		message: String(error?.message || error || 'Unknown AUP4 worker error'),
		code: String(quotaFailure ? 'QUOTA_EXCEEDED' : error?.code || 'AUP4_WORKER_ERROR'),
		details: error?.details || (quotaFailure ? { atomicPublication: false } : null),
	};
}

function collectTransferables(value, output = []) {
	if (!value || typeof value !== 'object') return output;
	if (value instanceof ArrayBuffer) output.push(value);
	else if (ArrayBuffer.isView(value)) output.push(value.buffer);
	else for (const item of Object.values(value)) collectTransferables(item, output);
	return [...new Set(output)];
}
