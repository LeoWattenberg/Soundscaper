/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LOCAL_DIAGNOSTICS_ERROR_LIMIT,
	createLocalDiagnosticsErrorJournal,
} from '../src/common/editor/local-diagnostics-error-journal.ts';
import {
	LOCAL_DIAGNOSTICS_MAX_BYTES,
	buildLocalDiagnosticsReport,
	createLocalDiagnosticsRuntimeIdentity,
	saveLocalDiagnosticsReport,
	serializeLocalDiagnosticsReport,
} from '../src/common/editor/local-diagnostics-report.ts';

const GENERATED_AT = '2026-08-29T10:11:12.000Z';

test('the local diagnostics error journal is bounded and never retains error prose', () => {
	let sequence = 0;
	const journal = createLocalDiagnosticsErrorJournal({
		now: () => new Date(Date.UTC(2026, 7, 29, 10, 0, sequence++)),
	});
	for (let index = 0; index < LOCAL_DIAGNOSTICS_ERROR_LIMIT + 3; index += 1) {
		const error = new TypeError(`private message /home/operator/session-${String(index)}.wav`);
		Object.defineProperty(error, 'code', {
			value: index === 0 ? '../../private' : `E_${String(index)}`,
			enumerable: true,
		});
		journal.record(error, index % 2 ? 'workspace' : 'controller');
	}

	const snapshot = journal.snapshot();
	assert.equal(snapshot.recentErrors.length, LOCAL_DIAGNOSTICS_ERROR_LIMIT);
	assert.deepEqual(snapshot.recentErrors[0], {
		occurredAt: '2026-08-29T10:00:03.000Z',
		source: 'workspace',
		name: 'TypeError',
		code: 'E_3',
	});
	assert.ok(Object.isFrozen(snapshot));
	assert.ok(Object.isFrozen(snapshot.recentErrors));
	assert.ok(Object.isFrozen(snapshot.recentErrors[0]));
	assert.doesNotMatch(JSON.stringify(snapshot), /private message|operator|\.wav/u);

	journal.clear();
	assert.deepEqual(journal.snapshot().recentErrors, []);
});

test('runtime identity admits only normalized browser or desktop facts', () => {
	assert.deepEqual(createLocalDiagnosticsRuntimeIdentity({
		isDesktop: false,
		locale: 'en-US',
		navigator: {
			platform: 'Linux x86_64',
			userAgent: 'Mozilla/5.0 Chrome/126.0.6478.2 Safari/537.36 private-sentinel',
		},
	}), {
		kind: 'browser',
		platform: 'linux',
		architecture: 'x64',
		locale: 'en-us',
		browser: { name: 'chromium', version: '126.0.6478.2' },
		desktop: null,
	});
	assert.deepEqual(createLocalDiagnosticsRuntimeIdentity({
		isDesktop: true,
		locale: 'ignored-private-locale',
		desktopEnvironment: {
			platform: 'darwin', arch: 'arm64', locale: 'de-DE',
			runtimeVersions: { electron: '43.1.1', chromium: '142.0.7444.0', node: '26.5.0' },
			privatePath: '/Users/operator/Library/Application Support',
		},
	}), {
		kind: 'desktop',
		platform: 'darwin',
		architecture: 'arm64',
		locale: 'de-de',
		browser: null,
		desktop: { electron: '43.1.1', chromium: '142.0.7444.0', node: '26.5.0' },
	});
});

test('the diagnostic report is an exact read-only allowlist without project or error content', async () => {
	const snapshot = {
		project: {
			id: 'private-project-id', title: 'Secret interview', path: '/home/operator/private.scape',
			schemaFamily: 'soundscaper', schemaVersion: 1, revision: 17,
			sources: [{ name: 'confidential.wav', transcript: 'never serialize this' }],
		},
		projects: [{ id: 'private-project-id', title: 'Secret interview' }],
		projectTabs: [{ id: 'private-project-id', title: 'Secret interview', dirty: true }],
		readOnly: false,
		storage: {
			state: 'indexeddb', backend: 'indexeddb', persistent: true, ephemeral: false,
			degradedReason: '/home/operator/private.scape', usage: 1234, quota: 9999, free: 8765,
			pressure: 'normal', evictionProtection: 'granted',
			lastPreflight: { operation: 'project', requiredBytes: 1, requiredFreeBytes: 2, status: 'ready' },
		},
		takeCycleRecovery: { projectId: 'private-project-id' },
		capture: null,
		webVcr: null,
	};
	const before = structuredClone(snapshot);
	const report = buildLocalDiagnosticsReport({
		generatedAt: GENERATED_AT,
		applicationVersion: '1.0.0-rc.1',
		productId: 'soundscaper',
		runtime: createLocalDiagnosticsRuntimeIdentity({
			isDesktop: false,
			locale: 'en',
			navigator: { platform: 'Linux x86_64', userAgent: 'Firefox/128.0 private-sentinel' },
		}),
		capabilities: { project: true, audioRecording: true, privateCapability: true },
		snapshot,
		diagnostics: {
			recentErrors: [{
				occurredAt: GENERATED_AT,
				source: 'controller',
				name: 'TypeError',
				code: 'INVALID_STATE',
				message: '/home/operator/private.scape',
				stack: 'Secret interview',
			}],
		},
	});

	assert.deepEqual(snapshot, before, 'building a report must not mutate editor state');
	assert.deepEqual(Object.keys(report), [
		'kind', 'schemaVersion', 'generatedAt', 'product', 'versions', 'environment',
		'capabilities', 'errors', 'storage', 'library', 'recovery',
	]);
	assert.deepEqual(report.product, { id: 'soundscaper' });
	assert.deepEqual(report.versions.project, { family: 'soundscaper', version: 1 });
	assert.equal(report.library.projectCount, 1);
	assert.equal(report.library.openProjectCount, 1);
	assert.deepEqual(report.library.current, {
		family: 'soundscaper', version: 1, revision: 17, readOnly: false,
	});
	assert.equal(report.recovery.takeCycle, 'pending');
	assert.equal(report.recovery.capture, 'not-applicable');
	assert.equal(report.recovery.webVcr, 'not-applicable');
	assert.equal(report.recovery.renderQueue, 'not-observed');
	assert.deepEqual(report.errors.recent, [{
		occurredAt: GENERATED_AT,
		source: 'controller',
		name: 'TypeError',
		code: 'INVALID_STATE',
	}]);
	assert.equal(report.capabilities.find(({ id }) => id === 'project')?.available, true);
	assert.equal(report.capabilities.find(({ id }) => id === 'audioRecording')?.available, true);
	assert.equal(report.capabilities.some(({ id }) => id === 'privateCapability'), false);

	const serialized = serializeLocalDiagnosticsReport(report);
	assert.equal(serialized.fileName, 'soundscaper-diagnostics-2026-08-29.json');
	assert.equal(serialized.mimeType, 'application/json');
	assert.ok(new TextEncoder().encode(serialized.text).byteLength <= LOCAL_DIAGNOSTICS_MAX_BYTES);
	assert.doesNotMatch(serialized.text, /private|Secret interview|project-id|operator|\.wav|transcript|message|stack/u);

	const requests: Array<Record<string, unknown>> = [];
	const saved = await saveLocalDiagnosticsReport(report, {
		async saveFile(request) { requests.push(request); return { method: 'download' }; },
	});
	assert.equal(saved.text, serialized.text);
	assert.equal(requests.length, 1);
	assert.equal(requests[0]?.purpose, 'report');
	assert.equal(requests[0]?.suggestedName, serialized.fileName);
	assert.equal(requests[0]?.mimeType, 'application/json');
	assert.equal(await (requests[0]?.blob as Blob).text(), serialized.text);
});

test('serialization rejects unknown fields and over-retained error journals', () => {
	const report = buildLocalDiagnosticsReport({
		generatedAt: GENERATED_AT,
		applicationVersion: '1.0.0-rc.1',
		productId: 'framescaper',
		runtime: createLocalDiagnosticsRuntimeIdentity({
			isDesktop: false, locale: 'en', navigator: {},
		}),
		capabilities: {},
		snapshot: { project: null, projects: [], projectTabs: [], storage: {} },
		diagnostics: { recentErrors: [] },
	});
	assert.throws(
		() => serializeLocalDiagnosticsReport({ ...report, title: 'private' }),
		/keys/u,
	);
	assert.throws(() => serializeLocalDiagnosticsReport({
		...report,
		errors: {
			...report.errors,
			recent: Array.from({ length: LOCAL_DIAGNOSTICS_ERROR_LIMIT + 1 }, () => ({
				occurredAt: GENERATED_AT, source: 'controller', name: 'Error', code: 'UNKNOWN',
			})),
		},
	}), /32/u);
	const capabilities = [...report.capabilities];
	Object.defineProperty(capabilities, '0', {
		enumerable: true,
		get() { throw new Error('private accessor content'); },
	});
	assert.throws(() => serializeLocalDiagnosticsReport({
		...report, capabilities,
	}), /accessors/u);
});
