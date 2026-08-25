/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return { url: 'data:text/javascript,export default "mock-ffmpeg-asset"', shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/common/editor/app.js');
const { createProjectStore } = await import('../src/common/editor/storage.js');

const COPY = Object.freeze({
	ready: 'Ready', untitledProject: 'Untitled', track: 'Track',
	projectSaving: 'Saving', projectSaved: 'Saved', storage: 'Storage',
	genericError: 'Error: {message}', unknownError: 'Unknown error',
});

test('real controller export actions retain the configured file service', async () => {
	const saves: Array<Readonly<Record<string, unknown>>> = [];
	const controller = createController(saves);
	try {
		await controller.ready;
		const preset = await controller.actions.export.presets.save({
			label: 'Web master', kind: 'audio', format: 'wav',
		});
		await controller.actions.export.presets.saveToFile(preset.id);

		assert.equal(saves.length, 1);
		assert.equal(saves[0]?.purpose, 'preset');
		assert.equal(saves[0]?.suggestedName, 'Web-master.json');
	} finally {
		await controller.dispose();
	}
});

test('real controller exposes linked-audio relink classification to the Project Bin UI', async () => {
	const controller = createController([]);
	try {
		await controller.ready;
		assert.equal(
			typeof controller.actions.projectBin.classifyLinkedAudioRelink,
			'function',
		);
	} finally {
		await controller.dispose();
	}
});

test('real controller owns reviewed local-assistance result acceptance', async () => {
	const controller = createController([]);
	try {
		await controller.ready;
		assert.equal(
			typeof controller.selectedMediaPreparation.acceptValidatedResult,
			'function',
		);
	} finally {
		await controller.dispose();
	}
});

test('real Framescaper capture open action reveals Recording Setup without opening media', async () => {
	const controller = createAudioEditorController(null, {
		headless: true,
		productId: 'framescaper',
		framescaperCaptureRouteSchemaVersion: 19,
		copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createMemoryTimePitchCache(),
		fileService: { isDesktop: false },
	});
	try {
		await controller.ready;
		assert.equal(recordingSetupVisible(controller.getSnapshot()), false);
		const openSetup = controller.actions.capture.openSetup;
		if (typeof openSetup !== 'function') throw new TypeError('Capture openSetup action is unavailable.');
		await openSetup();
		assert.equal(recordingSetupVisible(controller.getSnapshot()), true);
	} finally {
		await controller.dispose();
	}
});

function createController(saves: Array<Readonly<Record<string, unknown>>>) {
	return createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createMemoryTimePitchCache(),
		fileService: {
			isDesktop: false,
			saveFile(request: Readonly<Record<string, unknown>>) {
				saves.push(request);
				return { cancelled: false };
			},
		},
	});
}

function createMemoryEngine() {
	return {
		loadProject() {},
		async applyProject() {},
		setSourceResolver() {},
		getPositionFrames() { return 0; },
		getState() { return { state: 'stopped', loop: { enabled: false } }; },
		stop() {},
		seek(frame: number) { return frame; },
		async getAudioContext() { return null; },
		async dispose() {},
	};
}

function createMemoryTimePitchCache() {
	return {
		createEngineSourceResolver() { return null; },
		retainClipIds() {},
		getProtectedSourceIds() { return new Set<string>(); },
		dispose() {},
	};
}

function recordingSetupVisible(snapshot: unknown): boolean {
	if (!snapshot || typeof snapshot !== 'object') return false;
	const preferences = (snapshot as Readonly<{ preferences?: unknown }>).preferences;
	if (!preferences || typeof preferences !== 'object') return false;
	const workspace = (preferences as Readonly<{ workspace?: unknown }>).workspace;
	if (!workspace || typeof workspace !== 'object') return false;
	const panels = (workspace as Readonly<{ panels?: unknown }>).panels;
	if (!panels || typeof panels !== 'object') return false;
	const setup = (panels as Readonly<Record<string, unknown>>)['recording-setup'];
	return Boolean(setup && typeof setup === 'object'
		&& (setup as Readonly<{ visible?: unknown }>).visible === true);
}
