/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import { preProcessFile } from 'typescript';

import {
	createAudioClipV9,
	createAudioEditorProjectV9,
	createAudioSourceV9,
	createAudioTrackV9,
	type AudioEditorProjectV9,
	validateAudioEditorProjectV9,
} from '../src/common/editor/project-v9.ts';
import {
	AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS,
	resolveAudioEditorProjectV9ValidationLimits,
	validateAudioEditorProjectV9 as validateAudioEditorProjectV9Direct,
} from '../src/common/editor/project-v9-validation.ts';

const NOW = '2026-07-30T12:00:00.000Z';
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const VALIDATOR_ENTRY = resolve(REPOSITORY_ROOT, 'src/common/editor/project-v9-validation.ts');

type MutableProject = Record<string, unknown>;
type ProjectMutation = (project: MutableProject) => void;

function populatedProject(): AudioEditorProjectV9 {
	const source = createAudioSourceV9({
		id: 'source-1',
		name: 'Source 1',
		storageKey: 'source-1',
		frameCount: 96_000,
		channelCount: 2,
	});
	const clip = createAudioClipV9({
		id: 'clip-1',
		sourceId: source.id,
		title: 'Clip 1',
		durationFrames: 48_000,
		sourceDurationFrames: 48_000,
	});
	const track = createAudioTrackV9({
		id: 'track-1',
		name: 'Track 1',
		clipIds: [clip.id],
		effects: [{
			id: 'effect-1',
			type: 'limiter',
			enabled: true,
			params: { threshold: -1 },
		}],
	});
	return createAudioEditorProjectV9({
		id: 'project-1',
		title: 'Validator fixture',
		now: NOW,
		sources: [source],
		clips: [clip],
		tracks: [track],
	});
}

function mutableClone(project: AudioEditorProjectV9): MutableProject {
	return structuredClone(project) as MutableProject;
}

function record(value: unknown, name: string): MutableProject {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${name} fixture must be an object`);
	return value as MutableProject;
}

function array(value: unknown, name: string): unknown[] {
	assert.ok(Array.isArray(value), `${name} fixture must be an array`);
	return value;
}

function firstRecord(value: unknown, name: string): MutableProject {
	const first = array(value, name)[0];
	assert.notEqual(first, undefined, `${name} fixture must not be empty`);
	return record(first, `${name}[0]`);
}

const invalidMutations: readonly Readonly<{
	name: string;
	mutate: ProjectMutation;
}>[] = [
	{
		name: 'created timestamp',
		mutate: (project) => { project.createdAt = 'tomorrow'; },
	},
	{
		name: 'updated timestamp',
		mutate: (project) => { project.updatedAt = '2026-07-30 12:00:00'; },
	},
	{
		name: 'source',
		mutate: (project) => { firstRecord(project.sources, 'sources').sampleFormat = 'uint8'; },
	},
	{
		name: 'clip',
		mutate: (project) => { firstRecord(project.clips, 'clips').sourceId = 'missing-source'; },
	},
	{
		name: 'track',
		mutate: (project) => { firstRecord(project.tracks, 'tracks').height = 39; },
	},
	{
		name: 'effects',
		mutate: (project) => {
			const track = firstRecord(project.tracks, 'tracks');
			firstRecord(track.effects, 'track.effects').enabled = 'true';
		},
	},
	{
		name: 'tempo',
		mutate: (project) => {
			record(record(project.tempo, 'tempo').timeSignature, 'tempo.timeSignature').denominator = 3;
		},
	},
	{
		name: 'selection',
		mutate: (project) => { record(project.selection, 'selection').trackIds = ['missing-track']; },
	},
	{
		name: 'loop',
		mutate: (project) => {
			const loop = record(project.loop, 'loop');
			loop.enabled = true;
			loop.startFrame = 100;
			loop.endFrame = 100;
		},
	},
	{
		name: 'view',
		mutate: (project) => { record(project.view, 'view').pixelsPerSecond = 0; },
	},
	{
		name: 'master',
		mutate: (project) => { record(project.master, 'master').gain = 5; },
	},
	{
		name: 'mixer',
		mutate: (project) => {
			record(project.mixer, 'mixer').routes = {
				'missing-track': { groupId: null, sends: {} },
			};
		},
	},
];

test('strict current-schema validation accepts generated V9 persistence documents', () => {
	assert.strictEqual(validateAudioEditorProjectV9, validateAudioEditorProjectV9Direct);
	const fixtures = [
		createAudioEditorProjectV9({ id: 'empty-project', now: NOW }),
		populatedProject(),
	];

	for (const project of fixtures) {
		const original = structuredClone(project);
		assert.equal(validateAudioEditorProjectV9(project), true);
		assert.deepEqual(project, original, 'strict validation must not mutate its input');

		const jsonRoundTrip = JSON.parse(JSON.stringify(project)) as unknown;
		const roundTripOriginal = structuredClone(jsonRoundTrip);
		assert.equal(validateAudioEditorProjectV9(jsonRoundTrip), true);
		assert.deepEqual(jsonRoundTrip, roundTripOriginal, 'strict validation must not mutate JSON input');
	}
});

test('strict current-schema validation rejects deterministic deep domain mutations', () => {
	const valid = populatedProject();

	for (const { name, mutate } of invalidMutations) {
		const invalid = mutableClone(valid);
		mutate(invalid);
		assert.throws(
			() => validateAudioEditorProjectV9(invalid),
			`${name} mutation must fail strict validation`,
		);
	}
});

test('strict current-schema validation exposes lower-only structural work limits', () => {
	assert.deepEqual(AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS, {
		maximumTraversalNodes: 100_000,
		maximumTraversalDepth: 128,
	});
	assert.equal(Object.isFrozen(AUDIO_EDITOR_PROJECT_V9_VALIDATION_HARD_LIMITS), true);
	const lowered = resolveAudioEditorProjectV9ValidationLimits({
		maximumTraversalNodes: 80,
		maximumTraversalDepth: 4,
	});
	assert.deepEqual(lowered, {
		maximumTraversalNodes: 80,
		maximumTraversalDepth: 4,
	});
	assert.equal(Object.isFrozen(lowered), true);
	for (const limits of [
		null,
		[],
		'maximumTraversalNodes',
		{ maximumTraversalNodes: 0 },
		{ maximumTraversalDepth: 1.5 },
		{ maximumTraversalNodes: 100_001 },
		{ maximumTraversalDepth: 129 },
		{ unsupportedLimit: 1 },
	]) {
		assert.throws(
			() => resolveAudioEditorProjectV9ValidationLimits(limits),
			(error: unknown) => error instanceof TypeError || error instanceof RangeError,
		);
	}
});

test('strict current-schema validation admits project shape before semantic traversal', () => {
	const wide = mutableClone(createAudioEditorProjectV9({ id: 'wide-project', now: NOW }));
	record(record(wide.view, 'view').panelState, 'view.panelState').items = Array.from(
		{ length: 16 },
		(_, index) => index,
	);
	record(wide.tempo, 'tempo').bpm = 0;
	assert.throws(
		() => validateAudioEditorProjectV9(wide, {
			limits: { maximumTraversalNodes: 80 },
		}),
		/validation.*structural.*node limit/iu,
	);

	const deep = mutableClone(createAudioEditorProjectV9({ id: 'deep-project', now: NOW }));
	let nested: MutableProject = {};
	for (let depth = 0; depth < 6; depth += 1) nested = { nested };
	record(deep.view, 'view').panelState = nested;
	assert.throws(
		() => validateAudioEditorProjectV9(deep, {
			limits: { maximumTraversalDepth: 4 },
		}),
		/validation.*structural.*depth limit/iu,
	);

	const cyclic = mutableClone(createAudioEditorProjectV9({ id: 'cyclic-project', now: NOW }));
	const panelState = record(record(cyclic.view, 'view').panelState, 'view.panelState');
	panelState.self = panelState;
	assert.throws(() => validateAudioEditorProjectV9(cyclic), /cyclic.*project/iu);

	const hidden = mutableClone(createAudioEditorProjectV9({ id: 'hidden-project', now: NOW }));
	Object.defineProperty(record(hidden.metadata, 'metadata'), 'tags', {
		configurable: true,
		enumerable: false,
		value: Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`tag-${String(index)}`, 'value'])),
	});
	assert.throws(
		() => validateAudioEditorProjectV9(hidden),
		/enumerable.*data propert/iu,
	);

	const accessor = mutableClone(createAudioEditorProjectV9({ id: 'accessor-project', now: NOW }));
	let activations = 0;
	Object.defineProperty(accessor, 'title', {
		configurable: true,
		get() {
			activations += 1;
			return 'Accessor project';
		},
	});
	assert.throws(() => validateAudioEditorProjectV9(accessor), /enumerable.*data propert/iu);
	assert.equal(activations, 0, 'structural admission must not invoke project accessors');

	const arrayShadow = mutableClone(createAudioEditorProjectV9({ id: 'array-shadow-project', now: NOW }));
	let arrayActivations = 0;
	const selectedTrackIds = array(record(arrayShadow.selection, 'selection').trackIds, 'selection.trackIds');
	selectedTrackIds.map = () => {
		arrayActivations += 1;
		return [];
	};
	assert.throws(() => validateAudioEditorProjectV9(arrayShadow), /arrays cannot carry named/iu);
	assert.equal(arrayActivations, 0, 'structural admission must not invoke shadowed array methods');

	const executable = mutableClone(createAudioEditorProjectV9({ id: 'executable-project', now: NOW }));
	record(record(executable.view, 'view').panelState, 'view.panelState').callback = () => undefined;
	assert.throws(() => validateAudioEditorProjectV9(executable), /JSON-serializable scalar/iu);
});

test('the production V9 validator closure excludes legacy, executable, and worker runtimes', () => {
	const closure = validatorImportClosure(VALIDATOR_ENTRY);
	const relativeClosure = [...closure].map((path) => (
		path.startsWith('package:') ? path : relative(REPOSITORY_ROOT, path).split(sep).join('/')
	)).sort();

	assert.ok(relativeClosure.includes('src/common/editor/project-v9-validation.ts'));
	assert.ok(relativeClosure.includes('src/common/editor/project-v9-document-validation.ts'));
	assert.ok(relativeClosure.includes('src/common/editor/persisted-audio-effect-validation.ts'));

	const forbidden = [
		{ name: 'generic project validator', pattern: /^src\/common\/editor\/project\.js$/u },
		{ name: 'legacy project schema module', pattern: /^src\/common\/editor\/project-v[2-8]\.(?:js|ts)$/u },
		{ name: 'executable audio-effect registry', pattern: /^src\/common\/editor\/effects\.js$/u },
		{ name: 'Audacity effect runtime', pattern: /(?:^|\/)audacity-effects(?:\/|$)/u },
		{ name: 'PFFFT runtime', pattern: /pffft/iu },
		{ name: 'WebAssembly runtime', pattern: /wasm/iu },
		{ name: 'migration module', pattern: /migration/iu },
		{ name: 'worker module', pattern: /worker/iu },
	] as const;

	for (const dependency of relativeClosure) {
		for (const denied of forbidden) {
			assert.doesNotMatch(dependency, denied.pattern, `${denied.name} reached from ${dependency}`);
		}
	}
});

function validatorImportClosure(entry: string): ReadonlySet<string> {
	const visited = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop();
		assert.ok(file);
		if (visited.has(file)) continue;
		visited.add(file);
		const imports = preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles;
		for (const imported of imports) {
			if (!imported.fileName.startsWith('.')) {
				visited.add(`package:${imported.fileName}`);
				continue;
			}
			const dependency = resolve(dirname(file), imported.fileName);
			assert.equal(existsSync(dependency), true, `Unresolved validator import: ${imported.fileName}`);
			queue.push(dependency);
		}
	}
	return visited;
}
