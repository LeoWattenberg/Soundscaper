import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorDocumentSnapshot,
	publishProjectView,
	type EditorDocumentSnapshotState,
	type SnapshotProject,
} from '../src/common/editor/controller/document/document-snapshot.ts';
import { stateFixture } from './helpers/audio-editor-snapshot-state.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createEditorHistory } from '../src/common/editor/history.js';
import { DEFAULT_SOUND_ACTIVATION_PREFERENCES } from '../src/common/editor/sound-activation-preferences.ts';
import { exposeOwnedFields } from '../src/common/editor/controller/shared/owned-state.ts';

const SOUND_ACTIVATION_SNAPSHOT = Object.freeze({
	preferences: DEFAULT_SOUND_ACTIVATION_PREFERENCES,
	preferenceMutationBlocked: false,
	preferenceMutationBlockReason: null,
	sources: Object.freeze([]),
});
const CAPTURE_SNAPSHOT = Object.freeze({
	phase: 'recording' as const,
	availability: Object.freeze({ status: 'available' as const, sourceRoles: Object.freeze(['microphone'] as const) }),
	requestedRoles: Object.freeze(['microphone'] as const), sources: Object.freeze([]), sourcesFrozen: true,
	destination: 'both' as const, countdownMs: 0, permissionRequestGeneration: 1, failure: null,
	devices: Object.freeze([]), selectedDeviceIds: Object.freeze({}), displaySelectionMode: null,
	displaySources: Object.freeze([]), selectedDisplaySourceToken: null,
	monitoring: false, inputGain: 1, elapsedTimeMs: 1_250, metrics: Object.freeze([]),
});

test('document snapshots expose durability, scheduling, history, and compatibility semantically', () => {
	const project: SnapshotProject = {
		id: 'project',
		selection: { startFrame: 10, endFrame: 20 },
		tracks: [{ id: 'track' }, { id: 'second-track' }],
	};
	const videoPreviewProject = Object.freeze({ ...project, transientVideoFallback: true });
	const state = stateFixture({
		projects: [{ id: 'older' }, { id: 'project' }],
		recentProjectIds: ['project', 'missing'],
		selectedAnnotationId: 'annotation',
		timedRecording: {
			startTimeMs: 1_700_000_000_000,
			options: { trackId: 'track', endTimeMs: 1_700_000_060_000 },
		},
		recordingPreviews: [null, { frames: 4 }],
		history: { undoStack: ['old', 'new'], redoStack: ['redo'] },
		clipboard: { sourceIds: [] },
		lastAudacityEffect: { type: 'audacity-noise-reduction', params: {}, controlTrackId: null },
		recordingKind: 'take-cycle',
		archiveManifest: { manifest: { members: [{ id: 'project.json' }] }, unavailable: null },
		takeCycleRecovery: Object.freeze({
			kind: 'take-cycle-pending-open-recovery', projectId: 'project',
			publicationGeneration: 4, recoveryToken: 'recover-4', draftCount: 2,
			requiresDecision: true,
		}),
	});
	const snapshot = createEditorDocumentSnapshot({
		state,
		product: { id: 'soundscaper' },
		productId: 'soundscaper',
		capabilities: { recording: true },
		locale: 'en',
		getCurrentProject: () => project,
		projectForPlayback: () => videoPreviewProject,
		getProjectTabs: () => [{
			projectId: 'project', title: 'Project', dirty: true, readOnly: false,
		}],
		getCurrentTabMetadata: () => ({
			trackChannelHeightRatios: {
				track: 0.7,
				'second-track': Number.NaN,
				missing: 0.25,
			},
			aup4CompatibilityReport: { direction: 'import' },
			aup4CompatibilityReportDismissed: true,
			featureRequirementsReport: { compatible: false, items: [{ featureId: 'unknown' }] },
			featureRequirementsAudioEffectPlaybackBypass: {
				schemaVersion: 1,
				placeholders: [{ scope: 'track', ownerId: 'track', effectId: 'effect', effectType: 'compressor' }],
			},
			featureRequirementsAudioRenderedFallback: {
				schemaVersion: 1,
				featureId: 'org.soundscaper.capability.audio-effects',
				requirementId: 'audio-effects',
				sourceId: 'rendered-source',
				trackId: 'soundscaper:rendered-audio-fallback:track',
				clipId: 'soundscaper:rendered-audio-fallback:clip',
			},
			featureRequirementsVideoEffectPlaybackBypass: {
				schemaVersion: 1,
				placeholders: [{
					location: 'timeline', clipId: 'clip', effectId: 'video-effect', effectType: 'pixelate',
				}],
			},
			featureRequirementsVideoRenderedFallback: {
				schemaVersion: 1,
				featureId: 'org.soundscaper.capability.video-effects',
				requirementId: 'video-effects',
				sourceId: 'rendered-video',
				trackId: 'framescaper:rendered-video-fallback:track',
				clipId: 'framescaper:rendered-video-fallback:clip',
			},
		}),
		recordingPreviewSnapshot: (preview) => preview,
		getAudioDevicesSnapshot: () => ({ inputSupported: true }),
		getSoundActivationSnapshot: () => SOUND_ACTIVATION_SNAPSHOT,
		sampleEditingAvailable: () => true,
		canUndo: () => true,
		canRedo: () => true,
		historyEntrySummary: (entry) => `summary:${String(entry)}`,
		getStorageStatus: () => ({
			state: 'memory-ephemeral', backend: 'memory', persistent: false,
			ephemeral: true, degradedReason: 'indexeddb-unavailable',
		}),
		getRackEffectTypes: () => [{ type: 'gain' }],
		getVideoEffectTypes: () => [{ type: 'fade' }],
		getVideoNavigationSnapshot: () => Object.freeze({ rate: 2, positionFrame: 960 }),
		getFramescaperCaptureSnapshot: () => CAPTURE_SNAPSHOT,
		getSelectionEffectTypes: () => [{ type: 'normalize' }],
		getSelectionEffectParams: () => ({ amount: 1 }),
		getSelectionEffectDefinition: () => ({ type: 'normalize' }),
		getEffectPresets: () => [{ id: 'preset' }],
	});

	assert.deepEqual(snapshot.selection, project.selection);
	assert.strictEqual(snapshot.selection, snapshot.project?.selection);
	assert.equal(snapshot.selectedAnnotationId, 'annotation');
	assert.deepEqual(snapshot.recentProjects, [{ id: 'project' }]);
	assert.deepEqual(snapshot.projectTabs, [{
		id: 'project', title: 'Project', dirty: true, readOnly: false,
	}]);
	assert.deepEqual(snapshot.scheduledRecording, {
		startTimeMs: 1_700_000_000_000,
		startTime: '2023-11-14T22:13:20.000Z',
		endTimeMs: 1_700_000_060_000,
		endTime: '2023-11-14T22:14:20.000Z',
		trackId: 'track',
	});
	assert.equal(snapshot.recording, false);
	assert.equal(snapshot.recordingKind, 'take-cycle');
	assert.strictEqual(snapshot.takeCycleRecovery, state.takeCycleRecovery);
	assert.equal(Object.isFrozen(snapshot.takeCycleRecovery), true);
	assert.strictEqual(snapshot.recordingInputs.soundActivation, SOUND_ACTIVATION_SNAPSHOT);
	assert.deepEqual(snapshot.recordingPreviews, [{ frames: 4 }]);
	assert.deepEqual(snapshot.history.undoEntries, ['summary:new', 'summary:old']);
	assert.deepEqual(snapshot.timeline.trackChannelHeightRatios, { track: 0.7 });
	assert.equal(Object.isFrozen(snapshot.timeline.trackChannelHeightRatios), true);
	assert.equal(snapshot.storage.ephemeral, true);
	// The File entry that saves the archive's checksums is enabled from this, so a
	// manifest that never reached the snapshot left that entry disabled for the
	// whole session with no reason shown.
	assert.deepEqual(snapshot.archiveManifest, {
		manifest: { members: [{ id: 'project.json' }] }, unavailable: null,
	});
	assert.deepEqual(snapshot.aup4Compatibility, {
		report: { direction: 'import' }, dismissed: true,
	});
	assert.deepEqual(snapshot.featureRequirementsCompatibility, {
		compatible: false, items: [{ featureId: 'unknown' }],
	});
	assert.deepEqual(snapshot.audioEffectPlaybackBypass, {
		schemaVersion: 1,
		placeholders: [{ scope: 'track', ownerId: 'track', effectId: 'effect', effectType: 'compressor' }],
	});
	assert.deepEqual(snapshot.audioRenderedFallback, {
		schemaVersion: 1,
		featureId: 'org.soundscaper.capability.audio-effects',
		requirementId: 'audio-effects',
		sourceId: 'rendered-source',
		trackId: 'soundscaper:rendered-audio-fallback:track',
		clipId: 'soundscaper:rendered-audio-fallback:clip',
	});
	assert.deepEqual(snapshot.videoEffectPlaybackBypass, {
		schemaVersion: 1,
		placeholders: [{
			location: 'timeline', clipId: 'clip', effectId: 'video-effect', effectType: 'pixelate',
		}],
	});
	assert.deepEqual(snapshot.videoRenderedFallback, {
		schemaVersion: 1,
		featureId: 'org.soundscaper.capability.video-effects',
		requirementId: 'video-effects',
		sourceId: 'rendered-video',
		trackId: 'framescaper:rendered-video-fallback:track',
		clipId: 'framescaper:rendered-video-fallback:clip',
	});
	assert.deepEqual(snapshot.videoPreviewProject, videoPreviewProject);
	assert.notStrictEqual(snapshot.videoPreviewProject, videoPreviewProject);
	assert.throws(() => {
		(snapshot.videoPreviewProject?.selection as { startFrame: number }).startFrame = 0;
	}, TypeError);
	assert.equal(project.selection?.startFrame, 10);
	assert.deepEqual(snapshot.videoNavigation, { rate: 2, positionFrame: 960 });
	assert.strictEqual(snapshot.capture, CAPTURE_SNAPSHOT);
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot.effects), true);
	assert.equal(snapshot.effects.lastSelectionType, 'audacity-noise-reduction');
});

test('published documents and preferences cannot mutate history or controller state', () => {
	const history = createEditorHistory(createCurrentAudioEditorProject({ now: 1_700_000_000_000 }));
	const state = stateFixture({
		history,
		projects: [{ id: history.present.id, title: history.present.title }],
		recentProjectIds: [history.present.id],
	});
	const runtime = {
		...documentRuntimeFixture(history.present as unknown as SnapshotProject),
		state,
	};
	const first = createEditorDocumentSnapshot(runtime);
	const second = createEditorDocumentSnapshot(runtime);
	const originalRevision = history.present.revision;
	const originalTitle = history.present.title;

	assert.notStrictEqual(first.project, history.present);
	assert.strictEqual(first.project, second.project);
	assert.strictEqual(first.videoPreviewProject, first.project);
	assert.notStrictEqual(first.preferences, state.preferences);
	assert.strictEqual(first.preferences, second.preferences);
	assert.notStrictEqual(first.projects, state.projects);
	assert.strictEqual(first.projects, second.projects);
	assert.strictEqual(first.recentProjects[0], first.projects[0]);
	assert.throws(() => { (first.project as unknown as { title: string }).title = 'Bypassed history'; }, TypeError);
	assert.throws(() => { (first.project?.selection?.trackIds as string[]).push('new-track'); }, TypeError);
	assert.throws(() => { (first.preferences.playback as { playAtSpeedMode: string }).playAtSpeedMode = 'resample'; }, TypeError);
	assert.throws(() => { (first.projects[0] as unknown as { title: string }).title = 'Changed'; }, TypeError);
	assert.equal(history.present.title, originalTitle);
	assert.equal(history.present.revision, originalRevision);
	assert.deepEqual(history.present.selection.trackIds, []);
	assert.equal(state.preferences.playback?.playAtSpeedMode, 'naive');
	assert.equal(state.projects[0]?.title, originalTitle);
});

test('published collections detach from state, reject writes, and remain cloneable', () => {
	const lookup = new Map([['item', { value: 1 }]]);
	const tags = new Set(['saved']);
	const project: SnapshotProject = { id: 'project-with-collections', lookup };
	const state = stateFixture({
		preferences: { ...stateFixture().preferences, tags },
	});
	const snapshot = createEditorDocumentSnapshot({ ...documentRuntimeFixture(project), state });
	const publishedLookup = snapshot.project?.lookup as Map<string, { value: number }>;
	const publishedTags = snapshot.preferences.tags as Set<string>;

	assert.notStrictEqual(publishedLookup, lookup);
	assert.notStrictEqual(publishedTags, tags);
	assert.throws(() => publishedLookup.set('other', { value: 2 }), TypeError);
	assert.throws(() => publishedLookup.delete('item'), TypeError);
	assert.throws(() => { publishedLookup.get('item')!.value = 2; }, TypeError);
	assert.throws(() => publishedTags.add('changed'), TypeError);
	assert.throws(() => publishedTags.clear(), TypeError);
	assert.deepEqual([...lookup], [['item', { value: 1 }]]);
	assert.deepEqual([...tags], ['saved']);
	assert.deepEqual([...structuredClone(publishedLookup)], [['item', { value: 1 }]]);
});

test('project publication refuses opaque mutable objects instead of exposing them live', () => {
	assert.throws(() => publishProjectView({ id: 'project', timestamp: new Date() }), /mutable non-plain/u);
});

test('document snapshots hide collapsed selections and prepared recorders', () => {
	const state = stateFixture({
		recorder: { state: 'ready' },
		timedRecording: null,
		timedRecordingCancelling: true,
	});
	const snapshot = createEditorDocumentSnapshot({
		state,
		product: null,
		productId: 'soundscaper',
		capabilities: null,
		locale: 'de',
		getCurrentProject: () => ({
			id: 'project', selection: { startFrame: 12, endFrame: 12 },
		}),
		projectForPlayback: (candidate) => candidate,
		getProjectTabs: () => [],
		getCurrentTabMetadata: () => ({}),
		recordingPreviewSnapshot: () => null,
		getAudioDevicesSnapshot: () => ({}),
		getSoundActivationSnapshot: () => SOUND_ACTIVATION_SNAPSHOT,
		sampleEditingAvailable: () => false,
		canUndo: () => false,
		canRedo: () => false,
		historyEntrySummary: (entry) => entry,
		getStorageStatus: () => ({
			state: 'indexeddb', backend: 'indexeddb', persistent: true,
			ephemeral: false, degradedReason: null,
		}),
		getRackEffectTypes: () => [],
		getVideoEffectTypes: () => [],
		getSelectionEffectTypes: () => [],
		getSelectionEffectParams: () => ({}),
		getSelectionEffectDefinition: () => null,
		getEffectPresets: () => [],
	});

	assert.equal(snapshot.selection, null);
	assert.equal(snapshot.audioRenderedFallback, null);
	assert.equal(snapshot.videoRenderedFallback, null);
	assert.equal(snapshot.videoNavigation, null);
	assert.equal(snapshot.capture, null);
	assert.strictEqual(snapshot.videoPreviewProject, snapshot.project);
	assert.equal(snapshot.recording, false);
	assert.equal(snapshot.locale, 'de');
});

test('document snapshots expose one sorted immutable runtime annotation view', () => {
	const project = createCurrentAudioEditorProject({
		id: 'annotation-project',
		now: 1_700_000_000_000,
		timelineAnnotations: [
			{
				id: 'later', sequenceId: 'main-sequence', name: 'Later', color: 'blue', batchId: null,
				opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 48_000,
			},
			{
				id: 'first', sequenceId: 'main-sequence', name: 'First', color: 'red', batchId: null,
				opaqueExtensions: {}, kind: 'region', anchor: 'musical',
				startBeat: { num: 1, den: 1 }, endBeat: { num: 2, den: 1 },
			},
		],
	});
	const snapshot = createEditorDocumentSnapshot(documentRuntimeFixture(project as unknown as SnapshotProject));

	assert.deepEqual(snapshot.timelineAnnotations.map(({ id }) => id), ['first', 'later']);
	assert.equal(snapshot.timelineAnnotations[0]?.coordinateDomain, 'resolved-samples');
	assert.equal(Object.isFrozen(snapshot.timelineAnnotations), true);
	assert.equal(Object.isFrozen(snapshot.timelineAnnotations[0]), true);
	assert.notStrictEqual(snapshot.timelineAnnotations, project.timelineAnnotations);
});

test('document snapshots materialize cloneable effects-owned results', () => {
	const state = exposeOwnedFields(stateFixture(), {
		effectMacros: Object.freeze({
			schemaVersion: 1 as const,
			macros: Object.freeze([Object.freeze({
				id: 'macro', name: 'Cleanup',
				effects: Object.freeze([Object.freeze({
					id: 'effect', type: 'gain', params: Object.freeze({ gainDb: 3 }),
				})]),
			})]),
		}),
		macroScripts: Object.freeze({
			schemaVersion: 1 as const,
			scripts: Object.freeze([Object.freeze({
				id: 'script', name: 'Select all', source: 'await sound.select.all();',
				trust: 'authored' as const, trustedSource: null, origin: null,
			})]),
		}),
		nyquistResult: Object.freeze({
			type: 'labels',
			labels: Object.freeze([Object.freeze({ startTime: 0, endTime: 1, text: 'Verse' })]),
			output: '',
		}),
	});
	const snapshot = createEditorDocumentSnapshot({
		...documentRuntimeFixture({ id: 'project' }),
		state,
	});

	const clone = structuredClone({ macros: snapshot.macros, nyquist: snapshot.nyquist });
	assert.deepEqual(clone, {
		macros: {
			library: [{
				id: 'macro', name: 'Cleanup',
				effects: [{ id: 'effect', type: 'gain', params: { gainDb: 3 } }],
			}],
			scripts: [{
				id: 'script', name: 'Select all', source: 'await sound.select.all();',
				trust: 'authored', trustedSource: null, origin: null,
			}],
		},
		nyquist: {
			processing: false,
			result: { type: 'labels', labels: [{ startTime: 0, endTime: 1, text: 'Verse' }], output: '' },
		},
	});
});

function documentRuntimeFixture(project: SnapshotProject) {
	return {
		state: stateFixture(), product: null, productId: 'soundscaper', capabilities: {}, locale: 'en',
		getCurrentProject: () => project, projectForPlayback: () => project,
		getProjectTabs: () => [], getCurrentTabMetadata: () => ({}),
		recordingPreviewSnapshot: () => null, getAudioDevicesSnapshot: () => ({}),
		getSoundActivationSnapshot: () => SOUND_ACTIVATION_SNAPSHOT,
		sampleEditingAvailable: () => false, canUndo: () => false, canRedo: () => false,
		historyEntrySummary: (entry: unknown) => entry,
		getStorageStatus: () => ({
			state: 'indexeddb' as const, backend: 'indexeddb' as const, persistent: true,
			ephemeral: false, degradedReason: null,
		}),
		getRackEffectTypes: () => [], getVideoEffectTypes: () => [],
		getSelectionEffectTypes: () => [], getSelectionEffectParams: () => ({}),
		getSelectionEffectDefinition: () => null, getEffectPresets: () => [],
	};
}


test('the delivery canvas an open export dialog states rides the snapshot to the preview', () => {
	const project: SnapshotProject = { id: 'project', selection: { startFrame: 0, endFrame: 0 } };
	const canvas = { size: { width: 1_080, height: 1_920 }, fit: 'cover' };

	// A delivery that reframes to 9:16 was never previewed at 9:16, because the
	// panel resolves the project's derived canvas and nothing told it otherwise.
	const snapshot = (state: EditorDocumentSnapshotState) => createEditorDocumentSnapshot({
		state,
		product: null,
		productId: 'soundscaper',
		capabilities: null,
		locale: 'en',
		getCurrentProject: () => project,
		projectForPlayback: (candidate) => candidate,
		getProjectTabs: () => [],
		getCurrentTabMetadata: () => ({}),
		recordingPreviewSnapshot: () => null,
		getAudioDevicesSnapshot: () => ({}),
		getSoundActivationSnapshot: () => SOUND_ACTIVATION_SNAPSHOT,
		sampleEditingAvailable: () => false,
		canUndo: () => false,
		canRedo: () => false,
		historyEntrySummary: (entry) => entry,
		getStorageStatus: () => ({
			state: 'indexeddb', backend: 'indexeddb', persistent: true,
			ephemeral: false, degradedReason: null,
		}),
		getRackEffectTypes: () => [],
		getVideoEffectTypes: () => [],
		getSelectionEffectTypes: () => [],
		getSelectionEffectParams: () => ({}),
		getSelectionEffectDefinition: () => null,
		getEffectPresets: () => [],
	});

	assert.equal(snapshot(stateFixture()).videoDeliveryPreviewCanvas, null);
	assert.deepEqual(
		snapshot(stateFixture({ videoDeliveryPreviewCanvas: canvas } as Partial<EditorDocumentSnapshotState>))
			.videoDeliveryPreviewCanvas,
		canvas,
	);
});
