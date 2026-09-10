/* SPDX-License-Identifier: AGPL-3.0-only */

// The composition root must build only the audio subsystems the product profile
// says the product has. These tests watch the seven gated factories through a
// module resolve hook that redirects the imports made by app.js and by its
// domain composition modules to counting shims, so "not composed" is measured
// at the factory rather than inferred from a refusal.

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

/** Module path under src/common/editor → the factory export the composition calls from it. */
const GATED_FACTORIES = Object.freeze({
	'controller/analysis/internal/deferred-analysis-service.ts': 'createDeferredAudioAnalysisService',
	'controller/effects/internal/selection-effect-worker-service.ts': 'createSelectionEffectWorkerService',
	'controller/effects/internal/nyquist/nyquist-host-service.ts': 'createNyquistHostService',
	'controller/effects/internal/nyquist/nyquist-generated-audio-service.ts': 'createNyquistGeneratedAudioService',
	'controller/effects/internal/macro/effect-macro-service.ts': 'createEffectMacroService',
	'controller/effects/internal/effect-execution-service.ts': 'createSelectionEffectExecutionService',
	'controller/edit/generator-service.ts': 'createAudioGeneratorService',
});

const RECORDER = '__soundscaperComposedFactories';

const shims = Object.fromEntries(Object.entries(GATED_FACTORIES).map(([path, factory]) => {
	const real = new URL(`../src/common/editor/${path}`, import.meta.url).href;
	const source = `
		import { ${factory} as real } from ${JSON.stringify(real)};
		export function ${factory}(...args) {
			(globalThis[${JSON.stringify(RECORDER)}] ??= []).push(${JSON.stringify(factory)});
			return real(...args);
		}
	`;
	return [path, `data:text/javascript,${encodeURIComponent(source)}`];
}));

const hook = `
	const shims = ${JSON.stringify(shims)};
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return { url: 'data:text/javascript,export default "mock-ffmpeg-asset"', shortCircuit: true };
		}
		const resolved = await nextResolve(specifier, context);
		const parent = String(context.parentURL ?? '');
		const composing = parent.endsWith('/src/common/editor/app.js')
			|| (parent.includes('/src/common/editor/controller/') && parent.endsWith('-composition.ts'));
		const gated = composing
			? Object.keys(shims).find((path) => String(resolved.url).endsWith('/src/common/editor/' + path))
			: undefined;
		if (gated) return { url: shims[gated], shortCircuit: true, format: 'module' };
		return resolved;
	}
`;

register(`data:text/javascript,${encodeURIComponent(hook)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/common/editor/app.js');
const { createProjectStore } = await import('../src/common/editor/storage.js');
const { createAudioEditorFileService } = await import('../src/common/editor/file-service.js');
const { createAudioEditorEngine } = await import('../src/common/editor/engine.js');

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
			() => controller.actions.macros.run({ name: 'macro' }),
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
		fileService: { ...createAudioEditorFileService(), async saveFile() { return { method: 'test', fileName: 'test-output', size: 0 }; } },
	});
}

function createMemoryRenderEngine() {
	return createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null,
		softwareRenderer: ({ startFrame, endFrame, sampleRate }) => ({
			channels: [new Float32Array(Number(endFrame) - Number(startFrame))], sampleRate,
		}),
	});
}

function createMemoryEngine() {
	return createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
}
