/* SPDX-License-Identifier: AGPL-3.0-only */

// Which audio graph builder compiles a path used to be an emergent property of
// the project object: `buildProjectGraph` re-ran a shape predicate on every
// call, so a scheduler, a scrub and a render inside one session could disagree,
// and transient engine input — every audition preview, every effect-macro step
// and the take-comp flatten that commits audio — always fell to the legacy
// builder while playback of the same material ran the production one.
//
// The selection is now resolved once, when the engine loads a project, and
// carried by the runtime host through every build and latency query.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioPreviewProject } from '../src/common/editor/engine/audio-preview-project.ts';
import {
	buildProjectGraph,
	projectGraphLatencyFrames,
} from '../src/common/editor/engine/project-graph.ts';
import { resolveProjectGraphSelection } from '../src/common/editor/engine/project-graph-selection.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineSourceBufferInput } from '../src/common/editor/engine/public-api.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { MockGainRenderingOfflineAudioContext } from './helpers/audio-editor-runtime-harness.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

const SAMPLE_RATE = 48_000;
const FRAME_COUNT = 48;

/** A panned mono strip: the material the two builders were last found to disagree on. */
function pannedMonoPreviewProject(): EngineProject {
	return createAudioPreviewProject({
		title: 'Panned mono preview',
		sampleRate: SAMPLE_RATE,
		sources: [{
			id: 'source', name: 'Source', storageKey: 'source',
			frameCount: FRAME_COUNT, channelCount: 1, sampleRate: SAMPLE_RATE,
		}],
		clips: [{
			id: 'clip', sourceId: 'source', title: 'Clip', timelineStartFrame: 0,
			durationFrames: FRAME_COUNT, sourceStartFrame: 0, sourceDurationFrames: FRAME_COUNT,
		}],
		tracks: [{
			id: 'track', name: 'Track', clipIds: ['clip'],
			gain: 0.5, pan: -0.75, mute: false, solo: false, effects: [],
		}],
	});
}

interface RecordingContext {
	readonly nodeKinds: readonly string[];
	readonly destination: unknown;
}

function graphTopology(context: RecordingContext): string {
	return JSON.stringify(context.nodeKinds);
}

function buildInto(project: EngineProject, graph?: 'v21' | 'legacy'): RecordingContext {
	const context = new MockAudioContext({ sampleRate: SAMPLE_RATE });
	buildProjectGraph(
		context as unknown as BaseAudioContext,
		context.destination as unknown as AudioNode,
		project,
		{ metering: false, ...(graph === undefined ? {} : { graph }) },
	);
	return context as unknown as RecordingContext;
}

function sourceBuffers(): EngineSourceBufferInput {
	const buffer = new MockAudioBuffer(1, FRAME_COUNT, SAMPLE_RATE);
	buffer.getChannelData(0).fill(0.5);
	return new Map([['source', buffer as unknown as AudioBuffer]]);
}

interface RenderedBuffer {
	readonly numberOfChannels: number;
	getChannelData(index: number): Float32Array;
}

function renderEngine(contexts: RecordingContext[]): EngineRuntimeHost {
	return createAudioEditorEngine({
		audioContextFactory: (() => new MockAudioContext({ sampleRate: SAMPLE_RATE })) as never,
		offlineAudioContextFactory: ((options: {
			numberOfChannels: number; length: number; sampleRate: number;
		}) => {
			const context = new MockGainRenderingOfflineAudioContext(options);
			contexts.push(context as unknown as RecordingContext);
			return context;
		}) as never,
	}) as unknown as EngineRuntimeHost;
}

function renderedChannels(rendered: RenderedBuffer): readonly (readonly number[])[] {
	return Array.from(
		{ length: rendered.numberOfChannels },
		(_value, index) => [...rendered.getChannelData(index)],
	);
}

test('a preview project selects the production graph builder, exactly as playback does', () => {
	assert.equal(resolveProjectGraphSelection(pannedMonoPreviewProject()), 'v21');
});

test('a preview project compiles the production graph, not the legacy one', () => {
	const project = pannedMonoPreviewProject();
	assert.equal(
		graphTopology(buildInto(project)),
		graphTopology(buildInto(project, 'v21')),
	);
	assert.notEqual(
		graphTopology(buildInto(project, 'legacy')),
		graphTopology(buildInto(project, 'v21')),
	);
});

test('an explicit graph selection overrides the shape predicate in both directions', () => {
	const project = pannedMonoPreviewProject();
	const legacyOnly = { ...project, mixer: { groups: [], sends: [], routes: {} } } as EngineProject;
	assert.equal(resolveProjectGraphSelection(legacyOnly), 'legacy');
	assert.equal(
		graphTopology(buildInto(project, 'legacy')),
		graphTopology(buildInto(legacyOnly)),
	);
	assert.equal(
		projectGraphLatencyFrames(project, { graph: 'legacy' }),
		projectGraphLatencyFrames(legacyOnly, {}),
	);
});

test('a panned mono strip renders the same frames through either builder', async () => {
	const contexts: RecordingContext[] = [];
	const project = pannedMonoPreviewProject();
	const production = renderEngine(contexts);
	production.loadProject(project, sourceBuffers());
	const productionFrames = renderedChannels(await production.renderMix({
		startFrame: 0, endFrame: FRAME_COUNT,
	}) as unknown as RenderedBuffer);
	await production.dispose();

	const legacy = renderEngine(contexts);
	legacy.loadProject(project, sourceBuffers(), { graph: 'legacy' });
	const legacyFrames = renderedChannels(await legacy.renderMix({
		startFrame: 0, endFrame: FRAME_COUNT,
	}) as unknown as RenderedBuffer);
	await legacy.dispose();

	assert.deepEqual(productionFrames, legacyFrames);
});

test('the builder resolved at load survives the project object changing shape mid-session', async () => {
	const contexts: RecordingContext[] = [];
	const engine = renderEngine(contexts);
	const project = pannedMonoPreviewProject();
	engine.loadProject(project, sourceBuffers());
	assert.equal(engine.projectGraphSelection, 'v21');
	await engine.renderMix({ startFrame: 0, endFrame: FRAME_COUNT });
	assert.equal(contexts.length, 1);
	const first = graphTopology(contexts[0]!);

	// Nothing in the editor mutates a loaded project in place, but the point of
	// resolving once is that the answer no longer depends on the object holding
	// still: a second render in the same session must compile the same builder.
	Reflect.deleteProperty(engine.project as unknown as object, 'automationLanes');
	assert.equal(resolveProjectGraphSelection(engine.project), 'legacy');
	await engine.renderMix({ startFrame: 0, endFrame: FRAME_COUNT });
	await engine.dispose();
	assert.equal(contexts.length, 2);
	assert.equal(graphTopology(contexts[1]!), first);
});
