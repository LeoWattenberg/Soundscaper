/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The contract every deferred facade owes the module it stands in for.
 *
 * `deferred-module-facade.ts` is checked against its service at compile time,
 * but the facades that reach a module through `import()` only find out whether
 * the member they name still exists when a user opens the menu entry behind it:
 * the chunk loads, the method is missing, and the failure surfaces in a browser
 * as a `TypeError` from a lazy module nothing typechecked against.
 *
 * This suite loads each implementation module the way the facade does and
 * asserts that every member the facade declares is there with the kind the
 * facade assumes, so an export renamed or dropped behind a lazy boundary fails
 * in seconds instead of at first use. The facades' own surfaces are read from
 * the facades themselves rather than restated here, so a facade that gains a
 * port carries it into the contract without an edit.
 *
 * Every module below loads under Node with the suite's asset loader; none of
 * them touch a browser global at module scope. The two implementations that do
 * need a browser to *construct* - the AUP4 worker client and the Nyquist
 * evaluation client, both of which want a module `Worker` - are checked against
 * their class prototypes, which is where their methods live either way.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Aup4WorkerClient } from '../src/common/editor/aup4-client.js';
import { createDeferredAudioAnalysisService } from '../src/common/editor/controller/deferred-analysis-service.ts';
import { createDeferredArchiveRuntime } from '../src/common/editor/controller/deferred-archive-runtime.ts';
import { createDeferredDawprojectService } from '../src/common/editor/controller/deferred-dawproject-service.ts';
import { createDeferredEditorExportService } from '../src/common/editor/controller/deferred-export-service.ts';
import { createDeferredEffectRuntime } from '../src/common/editor/controller/deferred-effect-runtime.ts';
import {
	createDeferredLocalAssistancePreparation,
	type DeferredLocalAssistanceRuntimeDependencies,
} from '../src/common/editor/controller/deferred-local-assistance-runtime.ts';
import {
	loadDeferredSpectralEditAdmission,
} from '../src/common/editor/controller/deferred-spectral-edit-admission.ts';
import { NyquistEvaluationClient } from '../src/common/editor/nyquist/client.js';

/**
 * A dependency bag no contract calls into: the facades compose their ports at
 * construction and reach the runtime only once a proxied method is invoked.
 */
function stub<Dependencies>(value: Readonly<Record<string, unknown>> = {}): Dependencies {
	return value as unknown as Dependencies;
}

const ASSISTANCE_PORTS: DeferredLocalAssistanceRuntimeDependencies = Object.freeze({
	createId: (prefix: string) => `${prefix}-contract`,
	preflightStorage: async () => Object.freeze({}),
	getProject: () => Object.freeze({}),
	getSelectedClipId: () => null,
	captureProject: () => Object.freeze({}),
	assertProject: () => undefined,
	renderDryTrackRange: async () => Object.freeze([]),
	commit: () => undefined,
});

/** The storage ports the acceptance half of the assistance runtime validates. */
const ASSISTANCE_STORE = Object.freeze({
	getMediaAssetMetadata: () => undefined,
	loadMediaAsset: () => undefined,
	beginMediaAssetWrite: () => undefined,
	beginSourceWrite: () => undefined,
	deleteSource: () => undefined,
});

const analysisFacade = createDeferredAudioAnalysisService(stub());
const dawprojectFacade = createDeferredDawprojectService(stub(), stub());
const exportFacade = createDeferredEditorExportService(stub());
const assistanceFacade = createDeferredLocalAssistancePreparation({
	...ASSISTANCE_PORTS, assistanceStore: ASSISTANCE_STORE,
});
const assistanceFacadeWithoutStore = createDeferredLocalAssistancePreparation(ASSISTANCE_PORTS);
const effectFacade = createDeferredEffectRuntime();
const archiveFacade = createDeferredArchiveRuntime();

type MemberKind = 'function' | 'number';

interface DeferredFacadeContract {
	/** What the controller composes, named as the reader would find it. */
	readonly facade: string;
	/** The module the facade loads on demand, or the class it constructs from it. */
	readonly implementation: string;
	/** The members the facade stands in for. */
	readonly members: readonly string[];
	/** The kind those members must have; a facade proxies methods unless stated. */
	readonly kind?: MemberKind;
	readonly resolve: () => Promise<object>;
}

const AUDACITY_PORTS = ['applyAudacityEffectAsync', 'captureAudacityNoiseProfile'] as const;
const SELECTION_PORTS = ['applyAudioSelectionEffectAsync'] as const;
const PFFFT_PORTS = ['initializePffft'] as const;
const PARAMETRIC_EQ_PORTS = ['loadParametricEqWasmModule'] as const;
const SPECTRAL_PORTS = ['applySpectralGain'] as const;
const AUP4_MODULE_PORTS = ['requestAup4FileHandle', 'saveAup4Result'] as const;
const LEGACY_DECODE_PORTS = ['decodeLegacyAupProject'] as const;
const LEGACY_CONVERT_PORTS = ['convertLegacyAupToProject'] as const;
const SCAPE_PORTS = ['inspectScapeProject', 'importScapeProject', 'exportScapeProject'] as const;
const SCAPE_COPY_PORTS = ['copyFutureScapeArchive'] as const;

const CONTRACTS: readonly DeferredFacadeContract[] = Object.freeze([
	{
		facade: 'deferred-analysis-service',
		implementation: 'controller/analysis-service.ts',
		members: Object.keys(analysisFacade),
		resolve: async () => (
			await import('../src/common/editor/controller/analysis-service.ts')
		).createAudioAnalysisService(stub()),
	},
	{
		facade: 'deferred-dawproject-service',
		implementation: 'controller/dawproject-service.ts',
		members: Object.keys(dawprojectFacade),
		resolve: async () => (
			await import('../src/common/editor/controller/dawproject-service.ts')
		).createDawprojectService(stub(), stub()),
	},
	{
		facade: 'deferred-export-service',
		implementation: 'controller/export-service.ts',
		members: Object.keys(exportFacade),
		resolve: async () => (
			await import('../src/common/editor/controller/export-service.ts')
		).createEditorExportService(stub()),
	},
	{
		facade: 'deferred-local-assistance-runtime',
		implementation: 'controller/local-assistance-runtime.ts',
		members: Object.keys(assistanceFacade),
		resolve: async () => (
			await import('../src/common/editor/controller/local-assistance-runtime.ts')
		).createLocalAssistancePreparationRuntime({
			...ASSISTANCE_PORTS, assistanceStore: ASSISTANCE_STORE,
		}),
	},
	{
		facade: 'deferred-effect-runtime (Audacity ports)',
		implementation: 'audacity-effects/index.js',
		members: AUDACITY_PORTS,
		resolve: () => import('../src/common/editor/audacity-effects/index.js'),
	},
	{
		facade: 'deferred-effect-runtime (selection port)',
		implementation: 'selection-effects-runtime.js',
		members: SELECTION_PORTS,
		resolve: () => import('../src/common/editor/selection-effects-runtime.js'),
	},
	{
		facade: 'deferred-effect-runtime (PFFFT port)',
		implementation: 'pffft.js',
		members: PFFFT_PORTS,
		resolve: () => import('../src/common/editor/pffft.js'),
	},
	{
		facade: 'deferred-effect-runtime (parametric EQ port)',
		implementation: 'parametric-eq/wasm-loader.js',
		members: PARAMETRIC_EQ_PORTS,
		resolve: () => import('../src/common/editor/parametric-eq/wasm-loader.js'),
	},
	{
		facade: 'deferred-effect-runtime (spectral port)',
		implementation: 'spectral-edit.js',
		members: SPECTRAL_PORTS,
		resolve: () => import('../src/common/editor/spectral-edit.js'),
	},
	{
		facade: 'deferred-effect-runtime (Nyquist client)',
		implementation: 'nyquist/client.js NyquistEvaluationClient.prototype',
		members: Object.keys(effectFacade.createNyquistClient()),
		resolve: async () => NyquistEvaluationClient.prototype as object,
	},
	{
		facade: 'deferred-archive-runtime (AUP4 module)',
		implementation: 'aup4-client.js',
		members: AUP4_MODULE_PORTS,
		resolve: () => import('../src/common/editor/aup4-client.js'),
	},
	{
		facade: 'deferred-archive-runtime (AUP4 client)',
		implementation: 'aup4-client.js Aup4WorkerClient.prototype',
		members: Object.keys(archiveFacade.createAup4Client()),
		resolve: async () => Aup4WorkerClient.prototype as object,
	},
	{
		facade: 'deferred-archive-runtime (legacy decoder)',
		implementation: 'aup-legacy.js',
		members: LEGACY_DECODE_PORTS,
		resolve: () => import('../src/common/editor/aup-legacy.js'),
	},
	{
		facade: 'deferred-archive-runtime (legacy conversion)',
		implementation: 'aup-legacy-conversion.js',
		members: LEGACY_CONVERT_PORTS,
		resolve: () => import('../src/common/editor/aup-legacy-conversion.js'),
	},
	{
		facade: 'deferred-archive-runtime (Scape project)',
		implementation: 'scape-project.js',
		members: SCAPE_PORTS,
		resolve: () => import('../src/common/editor/scape-project.js'),
	},
	{
		facade: 'deferred-archive-runtime (Scape archive copy)',
		implementation: 'scape-archive-copy.ts',
		members: SCAPE_COPY_PORTS,
		resolve: () => import('../src/common/editor/scape-archive-copy.ts'),
	},
	{
		facade: 'deferred-spectral-edit-admission (admission plans)',
		implementation: 'spectral-edit-admission.ts',
		members: [
			'inspectSpectralEditChannels',
			'planSpectralEditJobAdmission',
			'planSpectralEditWorkflowAdmission',
		],
		resolve: loadDeferredSpectralEditAdmission,
	},
	{
		facade: 'deferred-spectral-edit-admission (memory limit)',
		implementation: 'spectral-edit-admission.ts',
		members: ['MAXIMUM_SPECTRAL_EDIT_USEFUL_BINARY_BYTES'],
		kind: 'number',
		resolve: loadDeferredSpectralEditAdmission,
	},
]);

for (const contract of CONTRACTS) {
	test(`${contract.facade} reaches every member it declares on ${contract.implementation}`, async () => {
		const expected = contract.kind ?? 'function';
		assert.ok(contract.members.length > 0, 'a facade contract that names nothing proves nothing');
		const implementation = await contract.resolve();
		const wrong = contract.members
			.map((name) => [name, kindOf(implementation, name)] as const)
			.filter(([, kind]) => kind !== expected)
			.map(([name, kind]) => `${name} is ${kind}, expected ${expected}`);
		assert.deepEqual(wrong, [], `${contract.implementation} no longer satisfies ${contract.facade}`);
	});
}

test('the effect runtime facade declares exactly the ports its contracts cover', () => {
	assert.deepEqual(Object.keys(effectFacade).sort(), [
		...AUDACITY_PORTS, ...SELECTION_PORTS, ...PFFFT_PORTS,
		...PARAMETRIC_EQ_PORTS, ...SPECTRAL_PORTS, 'createNyquistClient',
	].sort());
});

test('the archive runtime facade declares exactly the ports its contracts cover', () => {
	assert.deepEqual(Object.keys(archiveFacade).sort(), [
		...AUP4_MODULE_PORTS, ...LEGACY_DECODE_PORTS, ...LEGACY_CONVERT_PORTS,
		...SCAPE_PORTS, ...SCAPE_COPY_PORTS, 'createAup4Client',
	].sort());
});

test('the assistance facade without a store declares a subset of the acceptance surface', async () => {
	const withoutStore = Object.keys(assistanceFacadeWithoutStore);
	const withStore = new Set(Object.keys(assistanceFacade));
	assert.ok(withoutStore.length > 0);
	assert.deepEqual(withoutStore.filter((name) => !withStore.has(name)), []);
	const preparation = (
		await import('../src/common/editor/controller/local-assistance-runtime.ts')
	).createLocalAssistancePreparationRuntime(ASSISTANCE_PORTS);
	assert.deepEqual(withoutStore.filter((name) => kindOf(preparation, name) !== 'function'), []);
});

test('every deferred facade proxies only members its implementation still has', () => {
	assert.ok(CONTRACTS.length >= 7, 'each deferred facade owes at least one contract');
	const facades = new Set(CONTRACTS.map(({ facade }) => facade.replace(/ \(.*\)$/u, '')));
	assert.deepEqual([...facades].sort(), [
		'deferred-analysis-service',
		'deferred-archive-runtime',
		'deferred-dawproject-service',
		'deferred-effect-runtime',
		'deferred-export-service',
		'deferred-local-assistance-runtime',
		'deferred-spectral-edit-admission',
	]);
});

function kindOf(implementation: object, name: string): string {
	const member: unknown = Reflect.get(implementation, name);
	return member === undefined && !Reflect.has(implementation, name) ? 'missing' : typeof member;
}
