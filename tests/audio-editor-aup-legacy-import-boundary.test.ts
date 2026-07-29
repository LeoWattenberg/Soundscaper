/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeLegacyAupProject } from '../src/common/editor/aup-legacy.js';
import {
	createProjectImportService,
	type ProjectImportRuntime,
} from '../src/common/editor/controller/project-import-service.ts';

const LEGACY_AUP_MAXIMUM_XML_BYTES = 16 * 1024 * 1024;

test('oversized legacy AUP rejection precedes conversion, persistence, and imported-project publication', async () => {
	const allowedCalls: string[] = [];
	const forbiddenCalls: string[] = [];
	let textCalls = 0;
	const forbidden = (name: string) => (..._args: unknown[]) => {
		forbiddenCalls.push(name);
		throw new Error(`Unexpected ${name}`);
	};
	const runtime = {
		copy: {
			aupImporting: 'Importing AUP',
			timelineFramesFinite: 'Frames must be finite.',
		},
		convertLegacyAupToProjectV2: forbidden('convert'),
		createStableId: forbidden('create-id'),
		decodeLegacyAupProject,
		isLegacyAupFile: (file: { name?: string }) => /\.aup$/iu.test(file.name || ''),
		preflightStorage: async () => { allowedCalls.push('preflight'); },
		publishDocumentSnapshot: forbidden('publish'),
		setStatus: () => { allowedCalls.push('status'); },
		store: {
			beginSourceWrite: forbidden('begin-source-write'),
			deleteSource: forbidden('delete-source'),
			saveAnalysis: forbidden('save-analysis'),
			saveProject: forbidden('save-project'),
		},
		stripExtension: forbidden('strip-extension'),
		switchProject: forbidden('switch-project'),
	} as ProjectImportRuntime;
	const service = createProjectImportService(runtime);
	const projectFile = {
		name: 'oversized.aup',
		size: LEGACY_AUP_MAXIMUM_XML_BYTES + 1,
		async text() {
			textCalls += 1;
			return '<project rate="44100"/>';
		},
	};

	await assert.rejects(
		service.importFile(projectFile),
		(error: unknown) => (error as { code?: string })?.code === 'PROJECT_XML_TOO_LARGE',
	);
	assert.equal(textCalls, 0);
	assert.deepEqual(forbiddenCalls, []);
	assert.deepEqual(allowedCalls, ['preflight', 'status']);
});
