/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test, { type TestContext } from 'node:test';

import { createClipboardDescriptor } from '../src/common/editor/commands/clipboard-runtime.js';
import { resolveControllerProjectRuntime } from '../src/common/editor/controller/project-runtime.ts';
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return { url: 'data:text/javascript,export default "mock-ffmpeg-asset"', shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`;
register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const {
	createFramescaperAudioEditorControllerV18,
} = await import('../src/framescaper/editor-controller-v18.ts');
const {
	createFramescaperEditorProjectEnvironmentV18,
} = await import('../src/framescaper/editor-project-environment-v18.ts');
const { createInstrumentedIndexedDB } = await import('./helpers/instrumented-indexeddb.js');

type ControllerV18 = ReturnType<typeof createFramescaperAudioEditorControllerV18>;
type EnvironmentV18 = Awaited<ReturnType<typeof createFramescaperEditorProjectEnvironmentV18>>;
type GraphKind = 'multicamera' | 'nested';
type EditAction = 'copy' | 'cutLeaveGap' | 'duplicate';

test('V18 Edit menu action ports reject graph-lossy copy, cut, and duplicate before mutation', async (context) => {
	const { controller, environment } = await setup(context);
	for (const graph of ['nested', 'multicamera'] as const) {
		for (const action of ['copy', 'cutLeaveGap', 'duplicate'] as const) {
			await context.test(`${graph} ${action}`, async () => {
				const project = graphProject(environment, graph, `${graph}-${action}`);
				await stageVideoSources(environment, project);
				await environment.createProjectIfAbsent(project);
				await controller.actions.project.open(project);
				controller.actions.timeline.setSelection(0, 48_000, {
					trackIds: [`${project.id}-track`],
				});
				const before = structuredClone(controller.project);

				invokeEdit(controller, action);

				assert.deepEqual(controller.project, before);
				const snapshot = controller.getSnapshot();
				assert.equal(snapshot.history?.hasClipboard, false);
				assert.equal(snapshot.status.state, 'error');
				assert.match(snapshot.status.message, new RegExp(
					`Framescaper V18 session clipboard cannot preserve a ${graph === 'nested' ? 'nested-sequence' : 'multicamera'} graph`,
					'iu',
				));
			});
		}
	}
});

test('flat V18 and default V17 runtimes preserve the maintained generic descriptor', async (context) => {
	const { environment } = await setup(context);
	const project = flatProject(environment, 'flat');
	const projected = environment.runtime.projectForCommandConsumers(project);
	const descriptor = createClipboardDescriptor(projected, {
		startFrame: 0, endFrame: 48_000, trackIds: [`${project.id}-track`],
	});
	assert.equal(descriptor.tracks[0]?.clips.length, 1);
	assert.deepEqual(
		environment.runtime.prepareEditClipboardDescriptor(project, descriptor),
		descriptor,
	);
	assert.equal(
		resolveControllerProjectRuntime().prepareEditClipboardDescriptor(projected, descriptor),
		descriptor,
	);
});

async function setup(context: TestContext): Promise<Readonly<{
	controller: ControllerV18;
	environment: EnvironmentV18;
}>> {
	const environment = await createFramescaperEditorProjectEnvironmentV18({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	});
	const controller = createFramescaperAudioEditorControllerV18(environment, { locale: 'en' });
	context.after(async () => {
		await controller.dispose();
		await environment.close();
	});
	await controller.ready;
	return { controller, environment };
}

function graphProject(
	environment: EnvironmentV18,
	graph: GraphKind | null,
	suffix: string,
): ReturnType<EnvironmentV18['runtime']['createProject']> {
	const id = `edit-clipboard-${suffix}`;
	const rate = { num: 10, den: 1 };
	const source = (sourceSuffix: string, digest: string) => createVideoSourceV10({
		id: `${id}-source-${sourceSuffix}`,
		name: `Camera ${sourceSuffix.toUpperCase()}`,
		storageKey: `${id}-source-${sourceSuffix}`,
		mimeType: 'video/mp4',
		contentSha256: digest.repeat(32),
		frameCount: 48_000,
		sampleFrameCount: 48_000,
		sourceFrameCount: 10,
		frameRate: rate,
		width: 1920,
		height: 1080,
	});
	const mainSequenceId = `${id}-main`;
	const nestedSequenceId = `${id}-nested-source`;
	const outputClipId = `${id}-clip`;
	const groupId = `${id}-group`;
	return environment.runtime.createProject({
		id,
		title: `Edit clipboard ${suffix}`,
		now: '2026-08-13T12:00:00.000Z',
		sampleRate: 48_000,
		sources: [source('a', '12'), ...(graph === 'multicamera' ? [source('b', '34')] : [])],
		clips: [{
			kind: 'video', id: outputClipId, sourceId: `${id}-source-a`, title: 'Output',
			sequenceId: mainSequenceId, sequenceStartFrame: 0, sequenceFrameCount: 10,
			sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({
			id: `${id}-track`, name: 'Video', clipIds: [outputClipId], locked: false,
		})],
		sequences: [{ id: mainSequenceId, rate, trackIds: [`${id}-track`] }, ...(graph === 'nested'
			? [{ id: nestedSequenceId, rate, trackIds: [] }]
			: [])],
		primarySequenceId: mainSequenceId,
		...(graph === 'nested' ? { subsequences: [{
			id: `${id}-placement`, sequenceId: mainSequenceId, sourceSequenceId: nestedSequenceId,
			sequenceStartFrame: 10, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
		}] } : {}),
		...(graph === 'multicamera' ? { multicameraGroups: [{
			id: groupId, projectId: id, sequenceId: mainSequenceId, outputClipId,
			activeMemberId: `${id}-member-a`, members: [{
				id: `${id}-member-a`, groupId, sourceId: `${id}-source-a`, syncOffsetSamples: 0,
			}, {
				id: `${id}-member-b`, groupId, sourceId: `${id}-source-b`, syncOffsetSamples: 0,
			}],
		}] } : {}),
	});
}

async function stageVideoSources(
	environment: EnvironmentV18,
	project: ReturnType<EnvironmentV18['runtime']['createProject']>,
): Promise<void> {
	for (const source of project.sources) {
		if (source.kind !== 'video') continue;
		const mimeType = String(source.mimeType);
		await environment.store.writeMediaAsset(
			source.storageKey,
			new Blob([String(source.id)], { type: mimeType }),
			{ mimeType },
		);
	}
}

function flatProject(
	environment: EnvironmentV18,
	suffix: string,
): ReturnType<EnvironmentV18['runtime']['createProject']> {
	const id = `edit-clipboard-${suffix}`;
	const sourceId = `${id}-source`;
	const trackId = `${id}-track`;
	return environment.runtime.createProject({
		id,
		title: `Edit clipboard ${suffix}`,
		now: '2026-08-13T12:00:00.000Z',
		sources: [createAudioSourceV10({
			id: sourceId, name: 'Audio', storageKey: sourceId,
			frameCount: 48_000, channelCount: 1, sampleRate: 48_000,
		})],
		clips: [createAudioClipV10({
			id: `${id}-clip`, sourceId, title: 'Audio',
			timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000,
		})],
		tracks: [createAudioTrackV10({
			id: trackId, name: 'Audio', clipIds: [`${id}-clip`], locked: false,
		})],
	});
}

function invokeEdit(controller: ControllerV18, action: EditAction): void {
	controller.actions.edit[action]();
}
