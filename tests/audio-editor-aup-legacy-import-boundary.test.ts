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

test('late legacy block-size refusal precedes conversion, persistence, and imported-project publication', async () => {
	const allowedCalls: string[] = [];
	const forbiddenCalls: string[] = [];
	let blockReads = 0;
	const forbidden = (name: string) => (..._args: unknown[]) => {
		forbiddenCalls.push(name);
		throw new Error(`Unexpected ${name}`);
	};
	const bytes = floatAuBlock();
	const blockFile = {
		name: 'e0000.au',
		size: bytes.byteLength,
		async arrayBuffer() {
			blockReads += 1;
			const mismatched = new Uint8Array(bytes.byteLength + 1);
			mismatched.set(bytes);
			return mismatched.buffer;
		},
	};
	const runtime = {
		copy: {
			aupImporting: 'Importing AUP',
			timelineFramesFinite: 'Frames must be finite.',
		},
		convertLegacyAupToProjectV2: forbidden('convert'),
		createStableId: forbidden('create-id'),
		decodeLegacyAupProject: (
			file: unknown,
			_dataFiles: unknown,
			options: Parameters<typeof decodeLegacyAupProject>[2],
		) => (
			decodeLegacyAupProject(file, [blockFile], options)
		),
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
	const xml = '<project rate="44100"><wavetrack><waveclip><sequence><waveblock><simpleblockfile filename="e0000.au" len="1"/></waveblock></sequence></waveclip></wavetrack></project>';
	const projectFile = {
		name: 'mismatch.aup',
		size: new TextEncoder().encode(xml).byteLength,
		async text() { return xml; },
	};

	await assert.rejects(
		service.importFile(projectFile),
		(error: unknown) => (error as { code?: string })?.code === 'PROJECT_BLOCK_SIZE_MISMATCH',
	);
	assert.equal(blockReads, 1);
	assert.deepEqual(forbiddenCalls, []);
	assert.deepEqual(allowedCalls, ['preflight', 'status']);
});

function floatAuBlock(): Uint8Array {
	const bytes = new Uint8Array(28);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x2e736e64, false);
	view.setUint32(4, 24, false);
	view.setUint32(8, 4, false);
	view.setUint32(12, 6, false);
	view.setUint32(16, 44_100, false);
	view.setUint32(20, 1, false);
	view.setFloat32(24, 0.25, false);
	return bytes;
}
