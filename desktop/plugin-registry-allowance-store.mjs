/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const VERSION = 4;
const ID = /^[a-z][a-f\d]{15}$/u;
const DIGEST = /^[a-f\d]{64}$/u;
const MAXIMUM_FILE_BYTES = 32 * 1_024 * 1_024;

/** Durable observations are rehashed and restatted before registry admission. */
export function createPluginRegistryAllowanceStore({
	filePath, legacyFilePath = /** @type {string | null} */ (null), fileSystem, authenticateBinary,
}) {
	let records = readState(filePath, legacyFilePath);
	const applyRecord = (registry, record) => {
		try {
			if (record.allowed) registry.allow(record.installationId);
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
				allowed: previous?.allowed === true,
				selected: previous?.selected === true,
				observation: Object.freeze(withoutLegacySignature(observation)),
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
					allowed: decision?.allowed ?? record.allowed,
					selected: decision?.selected ?? record.selected,
				})];
			}));
			await fileSystem.writeFile(filePath, JSON.stringify({
				schemaVersion: VERSION, records: [...records.values()],
			}));
		},
	});
}

function readState(filePath, legacyFilePath) {
	const primary = readFile(filePath, 'allowance');
	if (primary.status === 'loaded') return validateState(primary.parsed);
	if (primary.status === 'refused' || legacyFilePath === null) return new Map();
	const legacy = readFile(legacyFilePath, 'legacy allowance');
	return legacy.status === 'loaded' ? validateState(legacy.parsed) : new Map();
}

function readFile(filePath, label) {
	try {
		if (statSync(filePath).size > MAXIMUM_FILE_BYTES) throw new RangeError(`Plug-in ${label} state is too large.`);
		return { status: 'loaded', parsed: JSON.parse(readFileSync(filePath, 'utf8')) };
	} catch (error) {
		if (error?.code === 'ENOENT') return { status: 'missing' };
		console.error(`The plug-in ${label} store was refused:`, error);
		return { status: 'refused' };
	}
}

function validateState(parsed) {
	try {
		if (![2, 3, VERSION].includes(parsed?.schemaVersion) || !Array.isArray(parsed.records)
			|| parsed.records.length > 65_536) throw new TypeError('Unsupported plug-in allowance state.');
		const legacy = parsed.schemaVersion < VERSION;
		const records = new Map();
		const storedIds = new Set();
		for (const value of parsed.records) {
			const expectedKeys = legacy
				? 'digest,entryId,installationId,observation,reviewed,selected'
				: 'allowed,digest,entryId,installationId,observation,selected';
			const allowed = legacy ? value?.reviewed : value?.allowed;
			if (!value || typeof value !== 'object' || Array.isArray(value)
				|| Object.keys(value).sort().join(',') !== expectedKeys
				|| !DIGEST.test(value.digest) || !ID.test(value.entryId) || !ID.test(value.installationId)
				|| typeof allowed !== 'boolean' || typeof value.selected !== 'boolean'
				|| !value.observation || typeof value.observation !== 'object' || Array.isArray(value.observation)
				|| value.observation.binarySha256 !== value.digest || storedIds.has(value.installationId)
				|| (!legacy && Object.hasOwn(value.observation, 'signature'))) {
				throw new TypeError('Malformed plug-in allowance state.');
			}
			storedIds.add(value.installationId);
			const withoutSignature = legacy ? withoutLegacySignature(value.observation) : { ...value.observation };
			const observation = withoutSignature.bundleStableIds === undefined
				? { ...withoutSignature, bundleStableIds: [withoutSignature.stableId] }
				: withoutSignature;
			const installationId = parsed.schemaVersion === 2
				? descriptorInstallationId(value.digest, observation.stableId)
				: value.installationId;
			if (!ID.test(installationId) || records.has(installationId)) {
				throw new TypeError('Ambiguous plug-in allowance state.');
			}
			records.set(installationId, Object.freeze({
				digest: value.digest,
				entryId: value.entryId,
				installationId,
				allowed,
				selected: value.selected,
				observation: Object.freeze(observation),
			}));
		}
		return records;
	} catch (error) {
		console.error('The plug-in allowance store was refused:', error);
		return new Map();
	}
}

function withoutLegacySignature(observation) {
	const result = { ...observation };
	delete result.signature;
	return result;
}

function descriptorInstallationId(digest, stableId) {
	if (typeof stableId !== 'string' || stableId.length < 1 || stableId.includes('\0')) return '';
	return `i${createHash('sha256').update(`${digest}\0${stableId}`).digest('hex').slice(0, 15)}`;
}
