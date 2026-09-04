/* SPDX-License-Identifier: AGPL-3.0-only */

// The pure values the AUP4 worker computes and reports: project identifiers and
// paths, the save limit this browser admits, the estimated size of a planned
// snapshot, and the validation and compatibility reports an open or save is
// answered with. None of these touch the worker's open databases, which is what
// makes them readable and testable apart from it. Split out of aup4-worker.js;
// no behaviour changes here.

import {
	createAup4CompatibilityReport,
	effectiveAup4SaveLimit,
} from './aup4-profile.js';

// The worker never recovers a project from history and never opens one whose
// sample blocks are incomplete; both are surfaced to the renderer instead.
export const WORKER_VALIDATION_OPTIONS = Object.freeze({
	allowHistoryRecovery: false,
	references: Object.freeze({ allowMissingSampleBlocks: false }),
});

export function projectPath(projectId) { return `/project-${normalizeProjectId(projectId)}.aup4`; }

export function normalizeProjectId(value) {
	const id = String(value || '').trim();
	if (!id || id.length > 160 || !/^[a-z0-9_-]+$/i.test(id)) throw operationError('A stable alphanumeric project id is required.', 'INVALID_PROJECT_ID');
	return id;
}

export function normalizeLimit(value, fallback) {
	const limit = Number(value);
	return Number.isSafeInteger(limit) && limit >= 0 ? Math.min(limit, fallback) : fallback;
}

export function portableLimit(args, opfs) {
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

export function storageAvailable(args) {
	if (args.quota == null || args.usage == null) return null;
	const quota = Number(args.quota);
	const usage = Number(args.usage);
	if (!Number.isFinite(quota) || !Number.isFinite(usage)) return null;
	return Math.max(0, quota - usage);
}

export function estimatePlannedSnapshotBytes(variants) {
	let pcmBytes = 0;
	for (const variant of variants || []) {
		pcmBytes += Number(variant?.source?.frameCount || 0)
			* Number(variant?.source?.channelCount || 0)
			* Float32Array.BYTES_PER_ELEMENT;
	}
	// Float32 blocks plus exact summaries, SQLite pages, and project/history XML.
	return Math.ceil(pcmBytes * 1.02) + 2 * 1024 * 1024;
}

export function mergeValidationOptions(options) {
	return {
		...(options || {}),
		references: {
			...WORKER_VALIDATION_OPTIONS.references,
			...(options?.references || {}),
		},
	};
}

export function mergeSanitizationReport(...reports) {
	const values = reports.filter(Boolean);
	return {
		discardedEntries: values.reduce((sum, report) => sum + Number(report.discardedEntries || 0), 0),
		nodeNames: [...new Set(values.flatMap((report) => report.nodeNames || []))].sort(),
		attributeNames: [...new Set(values.flatMap((report) => report.attributeNames || []))].sort(),
		tagNames: [...new Set(values.flatMap((report) => report.tagNames || []))].sort(),
	};
}

export function mergeCompatibilityReports(left, right) {
	const items = [...(left?.items || []), ...(right?.items || [])]
		.filter((entry, index, all) => {
			const key = JSON.stringify([
				entry?.code,
				entry?.severity,
				entry?.disposition,
				entry?.scope,
				entry?.data,
			]);
			return all.findIndex((candidate) => JSON.stringify([
				candidate?.code,
				candidate?.severity,
				candidate?.disposition,
				candidate?.scope,
				candidate?.data,
			]) === key) === index;
		});
	return createAup4CompatibilityReport(right?.direction || left?.direction || 'open', {
		discardedCloudMetadata: mergeSanitizationReport(left?.discardedCloudMetadata, right?.discardedCloudMetadata),
		missingAudio: [...(left?.missingAudio || []), ...(right?.missingAudio || [])]
			.filter((entry, index, all) => all.findIndex((candidate) => candidate.blockId === entry.blockId && candidate.reason === entry.reason) === index),
		networkAccessAttempted: false,
		persistence: left?.persistence || right?.persistence || null,
		limits: left?.limits || right?.limits || null,
		items,
	});
}

export function normalizeFloat32(value) {
	if (value instanceof Float32Array) return value;
	if (ArrayBuffer.isView(value) || Array.isArray(value)) return Float32Array.from(value);
	throw operationError('AUP4 source channels must contain Float32 samples.', 'INVALID_SOURCE_AUDIO');
}

export function operationError(message, code, details) {
	const error = new Error(message);
	error.name = 'Aup4WorkerError';
	error.code = code;
	if (details) error.details = details;
	return error;
}

export function serializeError(error) {
	const quotaFailure = error?.name === 'QuotaExceededError' || error?.code === 22;
	return {
		name: String(error?.name || 'Error'),
		message: String(error?.message || error || 'Unknown AUP4 worker error'),
		code: String(quotaFailure ? 'QUOTA_EXCEEDED' : error?.code || 'AUP4_WORKER_ERROR'),
		details: error?.details || (quotaFailure ? { atomicPublication: false } : null),
	};
}

export function portableValidation(validation, entry = null) {
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
		compatibilityReport: createAup4CompatibilityReport(
			validation.compatibilityReport?.direction || 'open',
			{
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
				items: validation.compatibilityReport?.items || [],
			},
		),
	};
}

export function projectDescriptor(entry) {
	return {
		projectId: entry.projectId,
		sourceGeneration: entry.sourceGeneration || null,
		backend: entry.backend,
		readOnly: Boolean(entry.readOnly),
		...(Number.isFinite(entry.portableLimit) ? { portableLimit: entry.portableLimit } : {}),
	};
}

