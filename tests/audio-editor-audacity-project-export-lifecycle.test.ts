/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectDocument } from '../src/common/editor/controller/document/native-project-types.ts';
import { createFixture, project } from './helpers/native-project-service-fixture.ts';

test('Audacity project export keeps the authoritative project dirty and threads task cancellation', async () => {
	const signals: AbortSignal[] = [];
	const snapshot = projectWithAudio();
	const report = {
		schemaVersion: 1, format: 'audacity-project', targetGeneration: 'aup3', direction: 'save',
		items: [], counts: { preserved: 0, converted: 0, missing: 0, omitted: 0 },
	};
	const fixture = createFixture({
		getProject: () => snapshot,
		createAup4Client: () => ({
			initialize: async () => ({ opfs: false }),
			create: async (_projectId, options) => { signals.push(options?.signal as AbortSignal); },
			openFile: async () => ({ readOnly: false }),
			decode: async () => ({ project: snapshot, sources: [] }),
			writeSnapshot: async (_projectId, _project, _sources, options) => {
				signals.push(options.signal as AbortSignal);
				return { compatibilityReport: report };
			},
			commit: async (_projectId, options) => { signals.push(options?.signal as AbortSignal); },
			export: async (_projectId, options) => {
				signals.push(options.signal as AbortSignal);
				return { bytes: Uint8Array.of(1), validation: {}, compatibilityReport: report };
			},
			inspect: async () => ({}),
			delete: async () => undefined,
		}),
		saveAup3Result: async (_result, options) => {
			signals.push(options.signal as AbortSignal);
			return { fileName: 'project.aup3', size: 1 };
		},
	});
	fixture.state.saveState = 'dirty';
	const result = await createNativeProjectService(fixture.runtime).saveAup3({ useFileSystemAccess: false });

	assert.equal('cancelled' in result, false);
	assert.equal(fixture.state.saveState, 'dirty');
	assert.equal(signals.length, 5);
	assert.ok(signals[0] instanceof AbortSignal);
	assert.ok(signals.every((signal) => signal === signals[0]));
});

test('cancelled final AUP3 publication does not record a report or success', async () => {
	const snapshot = projectWithAudio();
	const report = {
		schemaVersion: 1, format: 'audacity-project', targetGeneration: 'aup3', direction: 'save',
		items: [], counts: { preserved: 0, converted: 0, missing: 0, omitted: 0 },
	};
	const fixture = createFixture({
		getProject: () => snapshot,
		createAup4Client: () => ({
			initialize: async () => ({ opfs: false }),
			create: async () => undefined,
			openFile: async () => ({ readOnly: false }),
			decode: async () => ({ project: snapshot, sources: [] }),
			writeSnapshot: async () => ({ compatibilityReport: report }),
			commit: async () => undefined,
			export: async () => ({ bytes: Uint8Array.of(1), validation: {}, compatibilityReport: report }),
			inspect: async () => ({}),
			delete: async () => undefined,
		}),
		saveAup3Result: async () => ({ cancelled: true }),
	});
	fixture.state.saveState = 'dirty';
	const result = await createNativeProjectService(fixture.runtime).saveAup3({ useFileSystemAccess: false });

	assert.deepEqual(result, { cancelled: true });
	assert.equal(fixture.state.saveState, 'dirty');
	assert.deepEqual(fixture.metadata.get(snapshot.id), {});
	assert.equal(fixture.statuses.some(({ message }) => message === 'AUP3 saved.'), false);
});

function projectWithAudio(): NativeProjectDocument {
	return {
		...project(),
		sources: [{
			kind: 'audio', id: 'source', storageKey: 'source', name: 'Audio', mimeType: 'audio/wav',
			frameCount: 1, channelCount: 1, sampleRate: 48_000,
		}],
		clips: [{ id: 'clip', kind: 'audio', sourceId: 'source' }],
	};
}
