/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return {
				url: 'data:text/javascript,export default "mock-ffmpeg-asset"',
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/common/editor/app.js');

test('AUP3 export creates a fresh legacy-target database and publishes an .aup3 file', async () => {
	const calls: Array<readonly unknown[]> = [];
	const savedFiles: Array<Readonly<{ suggestedName: string; blob: Blob }>> = [];
	const aup4Client = {
		async initialize() { return { opfs: false }; },
		async create(projectId: string, options: Readonly<Record<string, unknown>>) {
			calls.push(['create', projectId, options]);
		},
		async writeSnapshot(projectId: string) {
			calls.push(['writeSnapshot', projectId]);
			return {
				compatibilityReport: {
					schemaVersion: 1,
					format: 'audacity-project',
					targetGeneration: 'aup3',
					direction: 'save',
					items: [],
					counts: { preserved: 0, converted: 0, missing: 0, omitted: 0 },
				},
			};
		},
		async commit(projectId: string) { calls.push(['commit', projectId]); },
		async export(projectId: string) {
			calls.push(['export', projectId]);
			return {
				bytes: Uint8Array.of(0x41, 0x55, 0x50, 0x33),
				mimeType: 'application/x-audacity-project',
				validation: { generation: 'aup3' },
			};
		},
		async delete(projectId: string) { calls.push(['delete', projectId]); },
		dispose() {},
	};
	const controller = createAudioEditorController(null, {
		headless: true,
		locale: 'en',
		engine: createTestEngine(),
		ffmpeg: { dispose() {} },
		aup4Client,
		fileService: {
			isDesktop: false,
			async saveFile(request: Readonly<{ suggestedName: string; blob: Blob }>) {
				savedFiles.push(request);
				return { method: 'test-file', fileName: request.suggestedName, size: request.blob.size };
			},
		},
	} as never);

	try {
		await controller.ready;
		const result = await controller.actions.project.saveAup3({
			fileName: 'legacy-copy.aup4',
			useFileSystemAccess: false,
		});

		assert.equal('cancelled' in result, false);
		if ('cancelled' in result) assert.fail('The AUP3 save was unexpectedly cancelled.');
		assert.equal(savedFiles.length, 1);
		assert.equal(savedFiles[0]?.suggestedName, 'legacy-copy.aup3');
		assert.deepEqual(new Uint8Array(await savedFiles[0]!.blob.arrayBuffer()), Uint8Array.of(0x41, 0x55, 0x50, 0x33));
		assert.equal(result.validation.generation, 'aup3');
		assert.equal(result.compatibilityReport.targetGeneration, 'aup3');
		const createCall = calls.find(([name]) => name === 'create');
		assert.ok(createCall);
		assert.equal((createCall[2] as { targetGeneration?: string }).targetGeneration, 'aup3');
		assert.ok((createCall[2] as { signal?: unknown }).signal instanceof AbortSignal);
		assert.match(String(createCall[1]), /^aup3-export-/);
		assert.deepEqual(calls.map(([name]) => name), ['create', 'writeSnapshot', 'commit', 'export', 'delete']);
	} finally {
		await controller.dispose();
	}
});

function createTestEngine() {
	return {
		setSourceResolver() { return this; },
		loadProject() {},
		async applyProject() {},
		getState() { return { state: 'stopped', loop: { enabled: false } }; },
		getPositionFrames() { return 0; },
		stop() {},
		async dispose() {},
	};
}
