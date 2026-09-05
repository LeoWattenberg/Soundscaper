/* SPDX-License-Identifier: AGPL-3.0-only */

// The composition root must build only the audio subsystems the product profile
// says the product has. These tests watch the seven gated factories through a
// module resolve hook that redirects app.js's own imports to counting shims, so
// "not composed" is measured at the factory rather than inferred from a refusal.

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

/** app.js specifier → the factory export the composition root calls from it. */
const GATED_FACTORIES = Object.freeze({
	'./controller/deferred-analysis-service.ts': 'createDeferredAudioAnalysisService',
	'./controller/selection-effect-worker-service.ts': 'createSelectionEffectWorkerService',
	'./controller/nyquist-host-service.ts': 'createNyquistHostService',
	'./controller/nyquist-generated-audio-service.ts': 'createNyquistGeneratedAudioService',
	'./controller/effect-macro-service.ts': 'createEffectMacroService',
	'./controller/effect-execution-service.ts': 'createSelectionEffectExecutionService',
	'./controller/generator-service.ts': 'createAudioGeneratorService',
});

const RECORDER = '__soundscaperComposedFactories';

const shims = Object.fromEntries(Object.entries(GATED_FACTORIES).map(([specifier, factory]) => {
	const real = new URL(`../src/common/editor/${specifier.slice(2)}`, import.meta.url).href;
	const source = `
		import { ${factory} as real } from ${JSON.stringify(real)};
		export function ${factory}(...args) {
			(globalThis[${JSON.stringify(RECORDER)}] ??= []).push(${JSON.stringify(factory)});
			return real(...args);
		}
	`;
	return [specifier, `data:text/javascript,${encodeURIComponent(source)}`];
}));

const hook = `
	const shims = ${JSON.stringify(shims)};
	export async function resolve(specifier, context, nextResolve) {
		const parent = String(context.parentURL ?? '');
		if (parent.endsWith('/src/common/editor/app.js') && Object.hasOwn(shims, specifier)) {
			return { url: shims[specifier], shortCircuit: true, format: 'module' };
		}
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return { url: 'data:text/javascript,export default "mock-ffmpeg-asset"', shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/common/editor/app.js');
const { createProjectStore } = await import('../src/common/editor/storage.js');

const COPY = Object.freeze({
	ready: 'Ready', untitledProject: 'Untitled', track: 'Track',
	projectSaving: 'Saving', projectSaved: 'Saved', storage: 'Storage',
	genericError: 'Error: {message}', unknownError: 'Unknown error',
});

test('Framescaper composes none of the audio subsystems its profile omits', async () => {
	const controller = createController('framescaper');
	try {
		await controller.ready;
		assert.deepEqual(composedFactories(), []);
	} finally {
		await controller.dispose();
	}
});

test('Soundscaper composes every audio subsystem its profile declares', async () => {
	const controller = createController('soundscaper');
	try {
		await controller.ready;
		assert.deepEqual(composedFactories(), [...Object.values(GATED_FACTORIES)].sort());
	} finally {
		await controller.dispose();
	}
});

test('Framescaper actions for an absent domain stay callable and refuse', async () => {
	const controller = createController('framescaper');
	try {
		await controller.ready;
		const refusals: Array<() => unknown> = [
			() => controller.actions.analysis.run(),
			() => controller.actions.analysis.plotSpectrum(),
			() => controller.actions.analysis.measureLoudness(),
			() => controller.actions.generators.generate('tone', {}),
			() => controller.actions.generators.repeatLast(),
			() => controller.actions.nyquist.evaluate({}),
			() => controller.actions.macros.run('macro'),
			() => controller.actions.macros.cancel(),
		];
		for (const call of refusals) {
			assert.equal(typeof call, 'function');
			await assert.rejects(async () => call(), /Framescaper does not support/u);
		}
	} finally {
		await controller.dispose();
	}
});

test('a Framescaper controller with absent subsystems disposes cleanly', async () => {
	const controller = createController('framescaper');
	await controller.ready;
	await controller.dispose();
	await controller.dispose();
});

function composedFactories(): readonly string[] {
	const recorder = globalThis as unknown as Record<string, string[] | undefined>;
	const recorded = [...(recorder[RECORDER] ?? [])].sort();
	recorder[RECORDER] = [];
	return recorded;
}

function createController(productId: string) {
	composedFactories();
	return createAudioEditorController(null, {
		headless: true,
		productId,
		copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createMemoryEngine(),
		engineFactory: createMemoryRenderEngine,
		ffmpeg: { dispose() {} },
		clipTimePitchCache: createMemoryTimePitchCache(),
		fileService: { isDesktop: false, saveFile() { return { cancelled: false }; } },
	});
}

function createMemoryRenderEngine() {
	const render = (options: Readonly<Record<string, unknown>>) => {
		const startFrame = Number(options.startFrame);
		const endFrame = Number(options.endFrame);
		const channel = new Float32Array(endFrame - startFrame);
		return {
			numberOfChannels: 1,
			length: channel.length,
			sampleRate: 48_000,
			duration: channel.length / 48_000,
			getChannelData: () => channel,
		};
	};
	return {
		loadProject() {},
		setSourceResolver() {},
		async renderTrack(_trackId: string, options: Readonly<Record<string, unknown>>) { return render(options); },
		async renderMix(options: Readonly<Record<string, unknown>>) { return render(options); },
		async dispose() {},
	};
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
