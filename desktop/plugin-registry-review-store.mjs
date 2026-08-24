/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const VERSION = 3;
const ID = /^[a-z][a-f\d]{15}$/u;
const DIGEST = /^[a-f\d]{64}$/u;
const MAXIMUM_FILE_BYTES = 32 * 1_024 * 1_024;

/** Durable observations are rehashed and restatted before registry admission. */
export function createPluginRegistryReviewStore({ filePath, fileSystem, authenticateBinary }) {
	let records = readState(filePath);
	const applyRecord = (registry, record) => {
		try {
			if (record.reviewed) registry.allow(record.installationId);
			if (record.selected) registry.select(record.installationId);
			return true;
		} catch { return false; }
	};
	return Object.freeze({
		observe(observation, admission) {
			if (admission?.status !== 'recorded') return;
			const previous = records.get(admission.installationId);
			records.set(admission.installationId, Object.freeze({
				digest: observation.binarySha256,
				entryId: admission.entryId,
				installationId: admission.installationId,
				reviewed: previous?.reviewed === true,
				selected: previous?.selected === true,
				observation: Object.freeze({ ...observation }),
			}));
		},
		apply(registry) {
			const projection = registry.describe();
			for (const entry of projection.entries) for (const installation of entry.installations) {
				const record = records.get(installation.installationId);
				if (record?.entryId === entry.entryId
					&& record.installationId === installation.installationId) applyRecord(registry, record);
			}
			return registry.describe();
		},
		async rebind(registry, installationId) {
			const record = [...records.values()].find((value) => value.installationId === installationId);
			if (!record) return false;
			const identity = await authenticateBinary(record.observation.binaryPath, {
				byteLength: record.observation.binaryBytes, sha256: record.digest,
			});
			if (!identity) return false;
			const admission = registry.record({ ...record.observation, identity });
			return admission.status === 'recorded'
				&& admission.entryId === record.entryId
				&& admission.installationId === record.installationId
				&& applyRecord(registry, record);
		},
		async capture(registry) {
			const decisions = new Map();
			for (const entry of registry.describe().entries) for (const installation of entry.installations) {
				decisions.set(installation.installationId, installation);
			}
			records = new Map([...records].map(([installationId, record]) => {
				const decision = decisions.get(record.installationId);
				return [installationId, Object.freeze({
					...record,
					reviewed: decision?.reviewed ?? record.reviewed,
					selected: decision?.selected ?? record.selected,
				})];
			}));
			await fileSystem.writeFile(filePath, JSON.stringify({
				schemaVersion: VERSION, records: [...records.values()],
			}));
		},
	});
}

function readState(filePath) {
	let parsed;
	try {
		if (statSync(filePath).size > MAXIMUM_FILE_BYTES) throw new RangeError('Plug-in review state is too large.');
		parsed = JSON.parse(readFileSync(filePath, 'utf8'));
	} catch (error) {
		if (error?.code !== 'ENOENT') console.error('The plug-in review store was refused:', error);
		return new Map();
	}
	try {
		if (![2, VERSION].includes(parsed?.schemaVersion) || !Array.isArray(parsed.records)
			|| parsed.records.length > 65_536) throw new TypeError('Unsupported plug-in review state.');
		const records = new Map();
		const storedIds = new Set();
		for (const value of parsed.records) {
			if (!value || typeof value !== 'object' || Array.isArray(value)
				|| Object.keys(value).sort().join(',') !== 'digest,entryId,installationId,observation,reviewed,selected'
				|| !DIGEST.test(value.digest) || !ID.test(value.entryId) || !ID.test(value.installationId)
				|| typeof value.reviewed !== 'boolean' || typeof value.selected !== 'boolean'
				|| !value.observation || typeof value.observation !== 'object' || Array.isArray(value.observation)
				|| value.observation.binarySha256 !== value.digest || storedIds.has(value.installationId)) {
				throw new TypeError('Malformed plug-in review state.');
			}
			storedIds.add(value.installationId);
			const observation = value.observation.bundleStableIds === undefined
				? { ...value.observation, bundleStableIds: [value.observation.stableId] }
				: { ...value.observation };
			const installationId = parsed.schemaVersion === 2
				? descriptorInstallationId(value.digest, observation.stableId)
				: value.installationId;
			if (!ID.test(installationId) || records.has(installationId)) throw new TypeError('Ambiguous plug-in review state.');
			records.set(installationId, Object.freeze({
				...value, installationId, observation: Object.freeze(observation),
			}));
		}
		return records;
	} catch (error) {
		console.error('The plug-in review store was refused:', error);
		return new Map();
	}
}

function descriptorInstallationId(digest, stableId) {
	if (typeof stableId !== 'string' || stableId.length < 1 || stableId.includes('\0')) return '';
	return `i${createHash('sha256').update(`${digest}\0${stableId}`).digest('hex').slice(0, 15)}`;
}
