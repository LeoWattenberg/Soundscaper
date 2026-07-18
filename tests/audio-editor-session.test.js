import test from 'node:test';
import assert from 'node:assert/strict';

import { applyEditorCommand } from '../src/lib/tools/audio-editor/commands.js';
import { createAudioEditorProjectV2 } from '../src/lib/tools/audio-editor/project-v2.js';
import {
	AUDIO_EDITOR_SESSION_SCHEMA_VERSION,
	createAudioEditorSessionClipboard,
	createAudioEditorSessionController,
} from '../src/lib/tools/audio-editor/session.js';

const NOW = '2026-07-13T10:00:00.000Z';
const LATER = '2026-07-13T11:00:00.000Z';

function audioProject(id, sourceId, options = {}) {
	let project = createAudioEditorProjectV2({ id, title: options.title || id, now: NOW });
	project = applyEditorCommand(project, {
		type: 'source/add',
		source: {
			schemaVersion: 2,
			id: sourceId,
			name: `${sourceId}.wav`,
			storageKey: `pcm/${sourceId}`,
			mimeType: 'audio/wav',
			frameCount: options.frameCount || 2_000,
			channelCount: options.channelCount || 1,
			sampleRate: project.sampleRate,
			sampleFormat: 'float32',
		},
	}, { now: NOW });
	project = applyEditorCommand(project, {
		type: 'track/add',
		track: { schemaVersion: 2, type: 'audio', id: `${id}-track`, name: `${id} track` },
	}, { now: NOW });
	project = applyEditorCommand(project, {
		type: 'clip/add',
		trackId: `${id}-track`,
		clip: {
			schemaVersion: 2,
			id: `${id}-clip`,
			sourceId,
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			durationFrames: options.durationFrames || 1_000,
			sourceDurationFrames: options.durationFrames || 1_000,
		},
	}, { now: NOW });
	return project;
}

function emptyProjectLike(project) {
	return createAudioEditorProjectV2({ id: project.id, title: project.title, now: project.createdAt });
}

test('session tabs open once, preserve order, switch explicitly, and choose a deterministic close fallback', () => {
	const first = audioProject('project-a', 'source-a');
	const second = audioProject('project-b', 'source-b');
	const controller = createAudioEditorSessionController();
	let notifications = 0;
	controller.subscribe(() => { notifications += 1; });

	assert.deepEqual(controller.openProject(first), {
		projectId: first.id, opened: true, activated: true, releasedSourceIds: [],
	});
	assert.deepEqual(controller.openProject(second, { activate: false }), {
		projectId: second.id, opened: true, activated: false, releasedSourceIds: [],
	});
	assert.equal(controller.getSnapshot().activeProjectId, first.id);
	assert.deepEqual(controller.getSnapshot().tabs.map((tab) => tab.projectId), [first.id, second.id]);
	assert.equal(controller.switchProject(second.id), true);
	assert.equal(controller.switchProject(second.id), false);
	assert.deepEqual(controller.openProject(second), {
		projectId: second.id, opened: false, activated: false, releasedSourceIds: [],
	});
	assert.equal(controller.getSnapshot().tabs.length, 2);

	const closed = controller.closeProject(second.id, { force: true });
	assert.equal(closed.closed, true);
	assert.equal(closed.activeProjectId, first.id);
	assert.deepEqual(closed.releasedSourceIds, ['source-b']);
	assert.equal(controller.getSnapshot().activeProjectId, first.id);
	assert.equal(notifications, 4);
});

test('each tab owns independent history, dirty state, rename state, and read-only metadata', () => {
	const first = audioProject('project-a', 'source-a');
	const second = audioProject('project-b', 'source-b');
	const controller = createAudioEditorSessionController({ projects: [first, second] });

	const update = controller.updateProject(first.id, (project) => ({ ...project, title: 'Edited A' }), {
		command: { type: 'test/edit-title' },
	});
	assert.equal(update.project.title, 'Edited A');
	assert.equal(controller.getProjectHistory(first.id).undoStack.length, 1);
	assert.equal(controller.getProjectHistory(second.id).undoStack.length, 0);
	assert.equal(controller.getSnapshot().tabs.find((tab) => tab.projectId === first.id).dirty, true);

	const renamed = controller.renameProject(first.id, 'Renamed A', { now: LATER });
	assert.equal(renamed.project.title, 'Renamed A');
	assert.equal(renamed.project.updatedAt, LATER);
	assert.equal(renamed.project.revision, first.revision + 1);
	assert.equal(controller.getProjectHistory(first.id).undoStack.length, 2);
	assert.equal(controller.markProjectSaved(first.id), true);
	assert.equal(controller.markProjectSaved(first.id), false);
	assert.deepEqual(controller.updateProjectMetadata(first.id, { saveState: 'saved' }), { saveState: 'saved' });
	assert.deepEqual(controller.updateProjectMetadata(first.id, () => ({ compatibilityReport: ['ok'] }), { replace: true }), {
		compatibilityReport: ['ok'],
	});
	assert.throws(() => controller.renameProject(first.id, 'Bad timestamp', { now: 'not-a-date' }), /valid rename timestamp/);

	controller.setProjectReadOnly(second.id, { readOnly: true, reason: 'project-lock', lockMethod: 'navigator-locks' });
	const readOnlyTab = controller.getSnapshot().tabs.find((tab) => tab.projectId === second.id);
	assert.equal(readOnlyTab.readOnly, true);
	assert.equal(readOnlyTab.readOnlyReason, 'project-lock');
	assert.equal(readOnlyTab.lockMethod, 'navigator-locks');
	assert.throws(() => controller.updateProject(second.id, (project) => project), /read-only: project-lock/);
	assert.throws(() => controller.renameProject(second.id, 'No'), /read-only/);

	const future = { ...createAudioEditorProjectV2({ id: 'future', now: NOW }), schemaVersion: 99 };
	controller.openProject(future, { metadata: { compatibilityReport: ['newer writer'] } });
	const futureTab = controller.getSnapshot().tabs.find((tab) => tab.projectId === future.id);
	assert.equal(futureTab.readOnly, true);
	assert.equal(futureTab.readOnlyReason, 'newer-schema');
	assert.deepEqual(futureTab.metadata, { compatibilityReport: ['newer writer'] });
});

test('cross-project clipboard retains source metadata and owns source roots after its origin closes', () => {
	const released = [];
	const first = audioProject('project-z', 'source-z');
	const second = audioProject('project-a', 'source-a');
	const differentRate = createAudioEditorProjectV2({ id: 'project-hires', title: 'Hi-res', sampleRate: 96_000, now: NOW });
	const controller = createAudioEditorSessionController({
		projects: [first, second, differentRate],
		onSourcesReleased: (sourceIds, context) => released.push({ sourceIds, reason: context.reason }),
	});

	assert.deepEqual(controller.getSourceReferenceCounts(), { 'source-a': 1, 'source-z': 1 });
	const copied = controller.copySelection(first.id, {
		startFrame: 100,
		endFrame: 500,
		trackIds: [`${first.id}-track`],
	});
	assert.equal(copied.clipboard.originProjectId, first.id);
	assert.deepEqual(copied.clipboard.sources.map((source) => source.id), ['source-z']);
	assert.equal(copied.clipboard.descriptor.tracks[0].clips[0].sourceStartFrame, 100);
	assert.deepEqual(controller.getSourceReferenceCounts(), { 'source-a': 1, 'source-z': 2 });
	assert.equal(controller.clipboardForProject(second.id).compatibleSampleRate, true);
	assert.equal(controller.clipboardForProject(differentRate.id).requiresSampleRateConversion, true);

	const closeOrigin = controller.closeProject(first.id, { force: true });
	assert.deepEqual(closeOrigin.releasedSourceIds, []);
	assert.deepEqual(controller.clipboardForProject(second.id).sources.map((source) => source.storageKey), ['pcm/source-z']);
	assert.deepEqual(controller.getSourceReferenceCounts(), { 'source-a': 1, 'source-z': 1 });

	controller.copySelection(second.id, {
		startFrame: 0,
		endFrame: 250,
		trackIds: [`${second.id}-track`],
	});
	assert.deepEqual(released, [{ sourceIds: ['source-z'], reason: 'clipboard-set' }]);
	assert.deepEqual(controller.getSourceReferenceCounts(), { 'source-a': 2 });
	assert.deepEqual(controller.clearClipboard(), { cleared: true, releasedSourceIds: [] });
	assert.deepEqual(controller.getSourceReferenceCounts(), { 'source-a': 1 });
	const closeSecond = controller.closeProject(second.id, { force: true });
	assert.deepEqual(closeSecond.releasedSourceIds, ['source-a']);
	assert.deepEqual(released.at(-1), { sourceIds: ['source-a'], reason: 'project-close' });
});

test('session clipboard accepts legacy V1 audio descriptors', () => {
	const project = audioProject('legacy-clipboard-project', 'legacy-source');
	const controller = createAudioEditorSessionController({ projects: [project] });
	const result = controller.setClipboard({
		schemaVersion: 1,
		sampleRate: project.sampleRate,
		durationFrames: 100,
		tracks: [{
			sourceTrackId: `${project.id}-track`,
			sourceTrackName: 'Legacy track',
			clips: [{
				key: 'legacy-key',
				sourceId: 'legacy-source',
				offsetFrame: 0,
				sourceStartFrame: 0,
				durationFrames: 100,
			}],
		}],
	});

	assert.equal(result.clipboard.descriptor.schemaVersion, 1);
	assert.deepEqual(result.clipboard.sources.map((source) => source.id), ['legacy-source']);
	assert.equal(controller.clipboardForProject(project.id).descriptor.tracks[0].clips[0].key, 'legacy-key');
});

test('history and clipboard reference counts release sources only after their final root disappears', () => {
	const project = audioProject('project-history', 'source-history');
	const empty = emptyProjectLike(project);
	const releaseEvents = [];
	const controller = createAudioEditorSessionController({
		projects: [project],
		onSourcesReleased: (ids) => releaseEvents.push(ids),
	});

	controller.updateProject(project.id, empty);
	assert.deepEqual(controller.getSourceReferenceCounts(), { 'source-history': 1 });
	assert.equal(controller.getProjectHistory(project.id).undoStack.length, 1);
	assert.deepEqual(releaseEvents, []);

	const compacted = {
		limit: 200,
		present: empty,
		undoStack: [],
		redoStack: [],
	};
	const result = controller.updateProjectHistory(project.id, compacted);
	assert.deepEqual(result.releasedSourceIds, ['source-history']);
	assert.deepEqual(releaseEvents, [['source-history']]);
	assert.deepEqual(controller.getSourceReferenceCounts(), {});
});

test('dirty closes are blocked, snapshots round-trip, and disposal cleanup is sorted and idempotent', () => {
	const first = audioProject('project-z', 'source-z');
	const second = audioProject('project-a', 'source-a');
	const original = createAudioEditorSessionController({ projects: [first, second] });
	original.updateProject(first.id, (project) => ({ ...project, title: 'Dirty' }));
	assert.deepEqual(original.closeProject(first.id), { closed: false, reason: 'dirty', releasedSourceIds: [] });
	assert.deepEqual(original.getSnapshot().tabs.map((tab) => tab.projectId), [first.id, second.id]);
	original.copySelection(first.id, { startFrame: 0, endFrame: 100, trackIds: [`${first.id}-track`] });
	original.switchProject(second.id);

	const serialized = original.serialize();
	assert.equal(serialized.schemaVersion, AUDIO_EDITOR_SESSION_SCHEMA_VERSION);
	const jsonRoundTrip = JSON.parse(JSON.stringify(serialized));
	const releaseEvents = [];
	const restored = createAudioEditorSessionController({
		snapshot: jsonRoundTrip,
		onSourcesReleased: (ids, context) => releaseEvents.push({ ids, reason: context.reason }),
	});
	assert.deepEqual(restored.serialize(), jsonRoundTrip);
	assert.equal(restored.getSnapshot().activeProjectId, second.id);
	assert.deepEqual(restored.getSourceReferenceCounts(), { 'source-a': 1, 'source-z': 2 });

	let notifications = 0;
	restored.subscribe(() => { notifications += 1; });
	const disposed = restored.dispose();
	assert.deepEqual(disposed.releasedSourceIds, ['source-a', 'source-z']);
	assert.deepEqual(releaseEvents, [{ ids: ['source-a', 'source-z'], reason: 'session-dispose' }]);
	assert.equal(notifications, 1);
	assert.equal(restored.getSnapshot().disposed, true);
	assert.deepEqual(restored.dispose(), { disposed: true, releasedSourceIds: [] });
	assert.throws(() => restored.getProject(second.id), /disposed/);
});

test('invalid clipboard replacement is atomic and cannot lose an existing clipboard root', () => {
	const project = audioProject('project-a', 'source-a');
	const controller = createAudioEditorSessionController({ projects: [project] });
	const valid = createAudioEditorSessionClipboard(project, {
		startFrame: 0,
		endFrame: 100,
		trackIds: [`${project.id}-track`],
	});
	controller.setClipboard(valid);
	const before = controller.serialize();
	assert.throws(() => controller.setClipboard({ ...valid, sources: [] }), /metadata is missing/);
	assert.deepEqual(controller.serialize(), before);
	assert.deepEqual(controller.getSourceReferenceCounts(), { 'source-a': 2 });
});

test('history ingestion clones the aggregate once regardless of stack depth and keeps caller data isolated', () => {
	const initial = audioProject('project-history-clone', 'source-history-clone');
	const initialTitle = initial.title;
	let present = initial;
	const undoStack = [];
	for (let index = 0; index < 40; index += 1) {
		const command = { type: 'project/rename', title: `Revision ${index}` };
		undoStack.push({ project: present, command });
		present = applyEditorCommand(present, command, { now: LATER });
	}
	const history = {
		limit: 200,
		present,
		undoStack,
		redoStack: [],
	};
	const controller = createAudioEditorSessionController({ projects: [initial] });
	const nativeStructuredClone = globalThis.structuredClone;
	let aggregateCloneCalls = 0;
	globalThis.structuredClone = (value, options) => {
		aggregateCloneCalls += 1;
		return nativeStructuredClone(value, options);
	};
	let result;
	try {
		result = controller.updateProjectHistory(initial.id, history);
	} finally {
		globalThis.structuredClone = nativeStructuredClone;
	}

	assert.equal(aggregateCloneCalls, 4);
	history.present.title = 'Mutated caller history';
	history.undoStack[0].project.title = 'Mutated caller snapshot';
	result.history.present.title = 'Mutated result';
	result.history.undoStack[0].project.title = 'Mutated result snapshot';
	const retained = controller.getProjectHistory(initial.id);
	assert.equal(retained.present.title, 'Revision 39');
	assert.equal(retained.undoStack[0].project.title, initialTitle);
	assert.deepEqual(controller.getSourceReferenceCounts(), { 'source-history-clone': 1 });
});
