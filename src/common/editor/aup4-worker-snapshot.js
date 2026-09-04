/* SPDX-License-Identifier: AGPL-3.0-only */

// A staged AUP4 save. The renderer hands the worker one project source at a
// time so a large save never holds the whole project's PCM at once, which means
// the sample blocks written so far, the sources still owed, and the project they
// belong to have to be tracked across several worker messages — and rolled back
// in full if any of them fails. This module owns that state; the worker passes
// in how to resolve a writable project. Split out of aup4-worker.js; no
// behaviour changes here.

import { encodeAudacityBinaryXml } from './audacity-binary-xml.js';
import { deleteAup4SampleBlocks, insertAup4SampleBlock, writeAup4Document } from './aup4-database.js';
import {
	createAup4ExportPlan,
	normalizeAup4ExportSource,
	requiredAup4SourceIds,
} from './aup4-export.js';
import {
	AUP4_MAX_BLOCK_SAMPLES,
	createAup4ProjectDocument,
	createAup4SampleBlock,
} from './aup4-profile.js';
import {
	estimatePlannedSnapshotBytes,
	normalizeFloat32,
	normalizeProjectId,
	operationError,
	portableLimit,
} from './aup4-worker-values.js';

/**
 * Track the snapshot writes in flight for one worker. `requireWritableProject`
 * resolves a project id to its open, writable entry or throws.
 */
export function createAup4SnapshotWrites({ requireWritableProject }) {
	const snapshotWrites = new Map();
	const activeSnapshotByProject = new Map();

	function writeSnapshot(args, context) {
		if (!args.project || !Array.isArray(args.sources)) throw operationError('A project and its source channels are required.', 'INVALID_SNAPSHOT');
		const started = beginSnapshot(args, context);
		try {
			for (const source of args.sources) appendSnapshotSource({
				projectId: args.projectId,
				snapshotId: started.snapshotId,
				source,
			}, context);
			return finalizeSnapshot({ projectId: args.projectId, snapshotId: started.snapshotId }, context);
		} catch (error) {
			abortSnapshot({ projectId: args.projectId, snapshotId: started.snapshotId });
			throw error;
		}
	}

	function beginSnapshot(args, context) {
		const entry = requireWritableProject(args.projectId);
		if (!args.project) throw operationError('An audio editor project is required.', 'INVALID_SNAPSHOT');
		if (activeSnapshotByProject.has(entry.projectId)) {
			throw operationError(`An AUP4 snapshot is already being written for ${entry.projectId}.`, 'SNAPSHOT_IN_PROGRESS');
		}
		context.checkCancelled();
		const plan = createAup4ExportPlan(args.project);
		const estimatedBytes = estimatePlannedSnapshotBytes(plan.sources);
		const limit = portableLimit(args, Boolean(entry.pool));
		entry.portableLimit = limit;
		if (estimatedBytes > limit) throw operationError(
			`The estimated AUP4 snapshot exceeds this browser's ${Math.round(limit / 1024 / 1024)} MiB save limit.`,
			'PROJECT_TOO_LARGE',
			{ limit, size: estimatedBytes, phase: 'preflight' },
		);
		const snapshotId = `${entry.projectId}:${context.id}`;
		const session = {
			snapshotId,
			projectId: entry.projectId,
			entry,
			plan,
			autosave: args.autosave !== false,
			expectedSourceIds: new Set(requiredAup4SourceIds(plan).map(String)),
			receivedSourceIds: new Set(),
			channelBlocks: new Map(),
			insertedBlockIds: [],
			totalSamples: plan.sources.reduce((total, variant) => (
				total + variant.source.frameCount * variant.source.channelCount
			), 0),
			completedSamples: 0,
		};
		snapshotWrites.set(snapshotId, session);
		activeSnapshotByProject.set(entry.projectId, snapshotId);
		return {
			snapshotId,
			sourceCount: session.expectedSourceIds.size,
			normalizedSourceCount: plan.sources.length,
			estimatedBytes,
		};
	}

	function appendSnapshotSource(args, context) {
		const session = requireSnapshotWrite(args);
		context.checkCancelled();
		const sourceId = String(args.source?.sourceId || '');
		if (!session.expectedSourceIds.has(sourceId)) return { sourceId, ignored: true };
		if (session.receivedSourceIds.has(sourceId)) {
			throw operationError(`PCM for project source ${sourceId} was supplied more than once.`, 'DUPLICATE_SOURCE');
		}
		const normalizedSources = normalizeAup4ExportSource(session.plan, args.source);
		const localBlocks = new Map();
		const localBlockIds = [];
		let completedSamples = 0;
		session.entry.database.exec('BEGIN IMMEDIATE');
		try {
			for (const source of normalizedSources) {
				for (let channelIndex = 0; channelIndex < source.channels.length; channelIndex += 1) {
					const samples = normalizeFloat32(source.channels[channelIndex]);
					const blocks = [];
					for (let offset = 0; offset < samples.length; offset += AUP4_MAX_BLOCK_SAMPLES) {
						context.checkCancelled();
						const chunk = samples.subarray(offset, Math.min(samples.length, offset + AUP4_MAX_BLOCK_SAMPLES));
						const blockId = insertAup4SampleBlock(session.entry.database, createAup4SampleBlock(chunk));
						localBlockIds.push(blockId);
						blocks.push({ blockId, start: offset, sampleCount: chunk.length });
						completedSamples += chunk.length;
						context.progress(
							session.totalSamples ? (session.completedSamples + completedSamples) / session.totalSamples : 1,
							'encoding-audio',
							{ sourceId: source.sourceId, inputSourceId: sourceId, channel: channelIndex },
						);
					}
					localBlocks.set(`${source.sourceId}:${channelIndex}`, blocks);
				}
			}
			session.entry.database.exec('COMMIT');
		} catch (error) {
			try { session.entry.database.exec('ROLLBACK'); } catch { /* Preserve original error. */ }
			throw error;
		}
		for (const [key, blocks] of localBlocks) session.channelBlocks.set(key, blocks);
		session.insertedBlockIds.push(...localBlockIds);
		session.receivedSourceIds.add(sourceId);
		session.completedSamples += completedSamples;
		return {
			sourceId,
			normalizedSourceCount: normalizedSources.length,
			sampleCount: completedSamples,
		};
	}

	function finalizeSnapshot(args, context) {
		const session = requireSnapshotWrite(args);
		const missing = [...session.expectedSourceIds].filter((sourceId) => !session.receivedSourceIds.has(sourceId));
		if (missing.length) {
			throw operationError(`PCM for project source ${missing[0]} is missing.`, 'MISSING_SOURCE', { sourceIds: missing });
		}
		context.checkCancelled();
		session.entry.database.exec('BEGIN IMMEDIATE');
		try {
			const document = createAup4ProjectDocument(session.plan.project, session.channelBlocks);
			const encoded = encodeAudacityBinaryXml(document);
			const result = writeAup4Document(session.entry.database, encoded, { autosave: session.autosave });
			session.entry.database.exec('COMMIT');
			session.entry.lastExportCompatibilityReport = session.plan.compatibilityReport || null;
			completeSnapshotWrite(session);
			context.progress(1, 'complete');
			return {
				...result,
				sourceCount: session.plan.sources.length,
				sampleCount: session.totalSamples,
				compatibilityReport: session.entry.lastExportCompatibilityReport,
			};
		} catch (error) {
			try { session.entry.database.exec('ROLLBACK'); } catch { /* Preserve original error. */ }
			discardSnapshotWrite(session);
			throw error;
		}
	}

	function abortSnapshot(args) {
		const session = snapshotWrites.get(String(args.snapshotId || ''));
		if (!session || session.projectId !== normalizeProjectId(args.projectId)) return false;
		discardSnapshotWrite(session);
		return true;
	}

	function requireSnapshotWrite(args) {
		const snapshotId = String(args.snapshotId || '');
		const session = snapshotWrites.get(snapshotId);
		const projectId = normalizeProjectId(args.projectId);
		if (!session || session.projectId !== projectId) {
			throw operationError('The AUP4 snapshot write is no longer active.', 'SNAPSHOT_NOT_OPEN');
		}
		if (session.entry !== requireWritableProject(projectId)) {
			throw operationError('The AUP4 snapshot database changed while it was being written.', 'SNAPSHOT_NOT_OPEN');
		}
		return session;
	}

	function completeSnapshotWrite(session) {
		snapshotWrites.delete(session.snapshotId);
		if (activeSnapshotByProject.get(session.projectId) === session.snapshotId) activeSnapshotByProject.delete(session.projectId);
	}

	function discardSnapshotWrite(session) {
		completeSnapshotWrite(session);
		if (session.entry.database && session.insertedBlockIds.length) {
			deleteAup4SampleBlocks(session.entry.database, session.insertedBlockIds);
		}
	}


	function assertNoActiveSnapshot(projectId) {
		if (activeSnapshotByProject.has(normalizeProjectId(projectId))) {
			throw operationError('The AUP4 project has an unfinished snapshot write.', 'SNAPSHOT_IN_PROGRESS');
		}
	}

		function discardProjectSnapshots(projectId) {
		for (const session of [...snapshotWrites.values()]) {
			if (session.projectId === projectId) discardSnapshotWrite(session);
		}
	}

	return {
		write: writeSnapshot,
		begin: beginSnapshot,
		appendSource: appendSnapshotSource,
		finalize: finalizeSnapshot,
		abort: abortSnapshot,
		assertNone: assertNoActiveSnapshot,
		discardForProject: discardProjectSnapshots,
	};
}
