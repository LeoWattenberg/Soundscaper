/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync, statSync } from 'node:fs';

import {
	admitVampAnalyzerLibraryObservation,
	vampAnalyzerIdFor,
	vampAnalyzerInstallationIdFor,
} from './project-library-runtime/desktop/vamp-analyzer-registry.js';
import {
	applyRegistryAllowanceRecords,
	captureRegistryAllowanceDecisions,
	rebindRegistryAllowanceRecord,
	retainedAllowanceDecisions,
} from './registry-allowance-decision-store.mjs';

const VERSION = 1;
const ANALYZER_ID = /^va[a-f\d]{30}$/u;
const INSTALLATION_ID = /^vi[a-f\d]{30}$/u;
const DIGEST = /^[a-f\d]{64}$/u;
const MAXIMUM_FILE_BYTES = 32 * 1024 * 1024;
const MAXIMUM_RECORDS = 65_536;

/** Persist only explicit analyzer allowance/selection decisions and their exact observation. */
export function createVampAnalyzerAllowanceStore({
	filePath, fileSystem = {}, authenticateLibrary, logError = console.error,
}) {
	if (typeof filePath !== 'string' || typeof fileSystem.writeFile !== 'function'
		|| typeof authenticateLibrary !== 'function') {
		throw new TypeError('A Vamp analyzer allowance store requires a path, writer, and authenticator.');
	}
	let records = readState(filePath, fileSystem, logError);
	return Object.freeze({
		observe(observation, admission) {
			if (admission?.status !== 'recorded') return;
			const admitted = admitVampAnalyzerLibraryObservation(observation);
			for (const analyzer of admission.analyzers) {
				const descriptor = admitted.descriptors.find((candidate) =>
					vampAnalyzerInstallationIdFor(admitted.librarySha256, candidate.identifier)
					=== analyzer.installationId);
				if (!descriptor || vampAnalyzerIdFor(descriptor.identifier) !== analyzer.analyzerId) continue;
				const previous = records.get(analyzer.installationId);
				records.set(analyzer.installationId, Object.freeze({
					digest: admitted.librarySha256, analyzerId: analyzer.analyzerId,
					installationId: analyzer.installationId,
					...retainedAllowanceDecisions(previous),
					observation: admitted,
				}));
			}
		},
		apply(registry) {
			return applyRegistryAllowanceRecords(records, registry,
				(record, entry) => record.analyzerId === entry.analyzerId);
		},
		async rebind(registry, installationId) {
			const record = records.get(installationId);
			return rebindRegistryAllowanceRecord({
				record, registry,
				authenticate: (value) => authenticateLibrary(value.observation.libraryPath, {
					byteLength: value.observation.libraryBytes, sha256: value.digest,
				}),
				admit: (target, value, identity) => target.recordLibrary({ ...value.observation, identity }),
				matchesAdmission: (admission, value) => admission.status === 'recorded'
					&& admission.analyzers.some((analyzer) => analyzer.analyzerId === value.analyzerId
						&& analyzer.installationId === value.installationId),
			});
		},
		async capture(registry) {
			records = captureRegistryAllowanceDecisions(records, registry);
			await fileSystem.writeFile(filePath, JSON.stringify({
				schemaVersion: VERSION, records: [...records.values()],
			}));
		},
	});
}

function readState(filePath, fileSystem, logError) {
	try {
		const inspect = fileSystem.statSync ?? statSync;
		const read = fileSystem.readFileSync ?? readFileSync;
		if (inspect(filePath).size > MAXIMUM_FILE_BYTES) throw new RangeError('Vamp allowance state is too large.');
		return validateState(JSON.parse(read(filePath, 'utf8')));
	} catch (error) {
		if (error?.code !== 'ENOENT') logError('The Vamp analyzer allowance store was refused:', error);
		return new Map();
	}
}

function validateState(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).sort().join(',') !== 'records,schemaVersion'
		|| value.schemaVersion !== VERSION || !Array.isArray(value.records)
		|| value.records.length > MAXIMUM_RECORDS) {
		throw new TypeError('Unsupported Vamp analyzer allowance state.');
	}
	const records = new Map();
	for (const valueRecord of value.records) {
		if (!valueRecord || typeof valueRecord !== 'object' || Array.isArray(valueRecord)
			|| Object.keys(valueRecord).sort().join(',')
			!== 'allowed,analyzerId,digest,installationId,observation,selected'
			|| !DIGEST.test(valueRecord.digest) || !ANALYZER_ID.test(valueRecord.analyzerId)
			|| !INSTALLATION_ID.test(valueRecord.installationId)
			|| typeof valueRecord.allowed !== 'boolean' || typeof valueRecord.selected !== 'boolean'
			|| records.has(valueRecord.installationId)) {
			throw new TypeError('Malformed Vamp analyzer allowance record.');
		}
		const observation = admitVampAnalyzerLibraryObservation(valueRecord.observation);
		if (observation.librarySha256 !== valueRecord.digest) {
			throw new TypeError('Vamp analyzer allowance digest mismatch.');
		}
		const descriptor = observation.descriptors.find((candidate) =>
			vampAnalyzerInstallationIdFor(observation.librarySha256, candidate.identifier)
			=== valueRecord.installationId);
		if (!descriptor || vampAnalyzerIdFor(descriptor.identifier) !== valueRecord.analyzerId) {
			throw new TypeError('Vamp analyzer allowance identity mismatch.');
		}
		records.set(valueRecord.installationId, Object.freeze({
			digest: valueRecord.digest, analyzerId: valueRecord.analyzerId,
			installationId: valueRecord.installationId, allowed: valueRecord.allowed,
			selected: valueRecord.selected, observation,
		}));
	}
	return records;
}
