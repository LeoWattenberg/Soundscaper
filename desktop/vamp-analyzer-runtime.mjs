/* SPDX-License-Identifier: AGPL-3.0-only */

import { DesktopVampAnalyzerRegistry } from './project-library-runtime/desktop/vamp-analyzer-registry.js';
import { DesktopVampAnalyzerScanService } from './project-library-runtime/desktop/vamp-analyzer-scan-service.js';
import { DesktopVampAnalyzerSessions } from './project-library-runtime/desktop/vamp-analyzer-session.js';

/** Owns discovery decisions and finite analysis sessions without effect semantics. */
export function createDesktopVampAnalyzerRuntime(options) {
	if (!options || typeof options.allowances?.capture !== 'function'
		|| typeof options.backend?.open !== 'function') {
		throw new TypeError('The Vamp analyzer runtime requires allowance and backend ports.');
	}
	const registry = new DesktopVampAnalyzerRegistry({
		isQuarantined: (digest) => options.quarantine.isQuarantined(digest),
	});
	const scan = new DesktopVampAnalyzerScanService({
		supervisor: options.supervisor, consent: options.consent, quarantine: options.quarantine,
		roots: options.roots, isEnabled: options.isEnabled, describePayload: options.describePayload,
		registry,
		onRecorded: (observation, admission) => options.allowances.observe(observation, admission),
	});
	const sessions = new DesktopVampAnalyzerSessions({
		registry, backend: options.backend,
		...(options.mintSessionId ? { mintSessionId: options.mintSessionId } : {}),
	});
	return Object.freeze({
		async scanRoot(owner, value) {
			const request = exact(value, ['rootId', 'format'], 'Vamp scan request');
			const outcome = await scan.scanRoot({
				owner, rootId: request.rootId, format: request.format,
			});
			options.allowances.apply(registry);
			return outcome;
		},
		registryView: () => registry.describe(),
		catalog: () => catalog(registry.describe()),
		pluginRegistryEntries: () => pluginRegistryEntries(registry.describe()),
		async setInstallationAllowed(installationId, allowed) {
			if (typeof allowed !== 'boolean') throw new TypeError('Vamp analyzer allowance must be boolean.');
			if (allowed) registry.allow(installationId);
			else {
				registry.withdrawAllowance(installationId);
				await sessions.cancelInstallation(installationId, 'allowance-withdrawn');
			}
			await options.allowances.capture(registry);
			return registry.describe();
		},
		async selectInstallation(installationId) {
			registry.select(installationId);
			await options.allowances.capture(registry);
			return registry.describe();
		},
		async start(owner, value) {
			const request = exact(value,
				['analyzerId', 'stableId', 'binarySha256', 'sessionId'], 'Vamp analyzer start request');
			let installation = locate(registry.describe(), request.stableId);
			if (installation === null) {
				await options.allowances.rebind(registry, request.stableId);
				installation = locate(registry.describe(), request.stableId);
			}
			if (installation === null || installation.entry.analyzerId !== request.analyzerId
				|| installation.installation.librarySha256 !== request.binarySha256) {
				throw new Error('The Vamp analyzer identity no longer matches its installation.');
			}
			return sessions.start(owner, {
				installationId: request.stableId, sessionId: request.sessionId,
			});
		},
		configure: (owner, value) => sessions.configure(owner, value),
		pushPcm: (owner, value) => sessions.pushPcm(owner, value),
		finish: (owner, value) => sessions.finish(owner, value),
		cancel: (owner, value) => sessions.cancel(owner, value),
		revokeOwner(owner) {
			scan.revokeOwner(owner);
			return sessions.cancelOwner(owner, 'renderer-revoked');
		},
		async dispose() {
			scan.dispose();
			await sessions.dispose();
		},
	});
}

function catalog(view) {
	return Object.freeze(view.entries.flatMap((entry) => {
		if (!entry.eligible) return [];
		const installation = entry.installations.find((candidate) => candidate.selected)
			?? (entry.installations.length === 1 ? entry.installations[0] : null);
		if (!installation || !installation.allowed || installation.quarantined
			|| installation.compatibility !== 'compatible') return [];
		const descriptor = installation.descriptor;
		return [Object.freeze({
			analyzerId: entry.analyzerId, stableId: installation.installationId,
			binarySha256: installation.librarySha256, name: descriptor.name, maker: descriptor.maker,
			programs: descriptor.programs,
			parameters: Object.freeze(descriptor.parameters.map((parameter) => Object.freeze({
				id: parameter.identifier, name: parameter.name, description: parameter.description,
				unit: parameter.unit, minValue: parameter.minimumValue, maxValue: parameter.maximumValue,
				defaultValue: parameter.defaultValue, quantizeStep: parameter.quantizeStep,
			}))),
			outputs: Object.freeze(descriptor.outputs.map((output) => Object.freeze({
				id: output.identifier, name: output.name, description: output.description, unit: output.unit,
				sampleType: output.sampleType, sampleRate: output.sampleRate, hasDuration: output.hasDuration,
			}))),
			configuration: Object.freeze({
				minimumChannels: descriptor.minimumChannels, maximumChannels: descriptor.maximumChannels,
				preferredStepSize: descriptor.preferredStepSize,
				preferredBlockSize: descriptor.preferredBlockSize,
			}),
		})];
	}));
}

function pluginRegistryEntries(view) {
	return Object.freeze(view.entries.map((entry) => Object.freeze({
		entryId: entry.analyzerId, kind: 'analyzer', format: 'vamp', name: entry.name,
		vendor: entry.installations[0]?.descriptor.maker ?? '', eligible: entry.eligible,
		ineligibleReason: entry.ineligibleReason,
		installations: Object.freeze(entry.installations.map((installation) => Object.freeze({
			installationId: installation.installationId,
			version: String(installation.descriptor.pluginVersion), allowed: installation.allowed,
			selected: installation.selected, quarantined: installation.quarantined,
		}))),
	})));
}

function locate(view, installationId) {
	for (const entry of view.entries) {
		const installation = entry.installations.find((candidate) =>
			candidate.installationId === installationId);
		if (installation) return { entry, installation };
	}
	return null;
}

function exact(value, keys, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a record.`);
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new TypeError(`${label} has invalid keys.`);
	}
	return value;
}
