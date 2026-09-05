/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AssistanceProposalStaleError,
} from '../src/common/editor/assistance/proposal-session.ts';
import type {
	AssistanceWorkflowFenceV1,
	AssistanceWorkflowSourceRangeV1,
} from '../src/common/editor/assistance/workflow.ts';
import {
	resolveLocalAssistanceSelectedVideoAuthority,
} from '../src/common/editor/controller/local-assistance-selected-video.ts';
import {
	createLabel,
	createLabelTrack,
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';
import {
	createFramescaperAssistanceHighlightPublication,
	type FramescaperAssistanceHighlightPublicationDependencies,
} from '../src/framescaper/editor-local-assistance-highlight-publication.ts';
import {
	createFramescaperProjectAssistance,
	type FramescaperProjectAssistance,
} from '../src/framescaper/editor-project-assistance.ts';
import { FRAMESCAPER_ASSISTANCE_PROJECT_RUNTIME_PROFILE as PROFILE } from
	'../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type DataRecord = Record<string, unknown>;

/** The exact selection-fence fields the aggregate workflow fence has to agree with. */
interface SelectionFenceView {
	readonly occurrenceIds: readonly string[];
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly linkMembershipSha256: string;
	readonly timingAuthoritySha256: string;
}

const NOW = '2026-09-05T10:00:00.000Z';
const VIDEO_SHA256 = '12'.repeat(32);
const AUDIO_SHA256 = '34'.repeat(32);

test('creating the publication requires every named transaction dependency', () => {
	const complete = {
		currentAuthority: () => ({}), captureProject: () => null,
		assertProject: () => undefined, createId: (prefix: string) => prefix,
		commit: () => undefined,
	};
	for (const key of Object.keys(complete)) {
		assert.throws(() => createFramescaperAssistanceHighlightPublication(
			{ ...complete, [key]: 'not-callable' } as never,
		), { name: 'TypeError', message: /all transaction dependencies/u },
		`a ${key} that is not callable must be refused`);
	}
	assert.throws(() => createFramescaperAssistanceHighlightPublication(null as never),
		{ name: 'TypeError', message: /all transaction dependencies/u });
	const publication = createFramescaperAssistanceHighlightPublication(complete as never);
	assert.equal(Object.isFrozen(publication), true);
	assert.deepEqual(Object.keys(publication), ['acceptReviewed']);
});

test('the selected highlight identity set must be a bounded array of unique valid identities',
	async () => {
		const held = session();
		const fence = workflowFence(held.project);
		const one = review(fence);
		const two = review(fence, [proposal(), proposal({ id: 'highlight-b',
			startFrame: 28_800, endFrame: 48_000, sourceStartFrame: 6, sourceEndFrame: 10,
			cropKeyframes: [cropKeyframe(6), cropKeyframe(9)] })]);
		await assert.rejects(held.publication.acceptReviewed(one, 'highlight-a' as never),
			{ name: 'RangeError', message: /out of range/u });
		await assert.rejects(held.publication.acceptReviewed(one, ['highlight-a', 'highlight-b']),
			{ name: 'RangeError', message: /out of range/u });
		await assert.rejects(held.publication.acceptReviewed(two, ['highlight-a', 'highlight-a']),
			{ name: 'TypeError', message: /unique/u });
		await assert.rejects(held.publication.acceptReviewed(two, [7 as never]),
			{ name: 'TypeError', message: /selected highlight ID is invalid/u });
		assert.deepEqual(held.log, [],
			'a refused selection never reaches live project authority');
	});

test('publication refuses an authority that carries no selected-video custody', async () => {
	const project = highlightProject();
	const fence = workflowFence(project);
	for (const authority of [() => ({ fence }), () => null, () => 'authority']) {
		const held = session({ project, authority });
		await assert.rejects(held.publication.acceptReviewed(review(fence), ['highlight-a']),
			{ name: 'TypeError', message: /selected-video authority/u });
		assert.deepEqual(held.log, ['authority']);
	}
});

test('publication refuses a fence whose project identity has drifted from the live project',
	async () => {
		const project = highlightProject();
		for (const drift of [{ revision: Number(project.revision) + 1 },
			{ projectId: 'other-project' }]) {
			const fence = workflowFence(project, drift);
			const held = session({ project, authority: () => ({
				selection: authorityOf(project), fence }) });
			await assert.rejects(held.publication.acceptReviewed(review(fence), ['highlight-a']),
				AssistanceProposalStaleError);
			assert.deepEqual(held.commands, []);
		}
	});

test('publication refuses a fence naming a sequence the project no longer carries', async () => {
	const project = highlightProject();
	const fence = workflowFence(project, { sequenceId: 'ghost-sequence' });
	const held = session({ project, authority: () => ({
		selection: selectionFenceOverride(project, { sequenceId: 'ghost-sequence' }), fence }) });
	await assert.rejects(held.publication.acceptReviewed(review(fence), ['highlight-a']),
		AssistanceProposalStaleError);
});

test('publication requires exactly one video source range in the aggregate fence', async () => {
	const project = highlightProject();
	const selected = authorityOf(project).fence;
	const sets = [
		[audioRange(selected)],
		[audioRange(selected), videoRange(selected,
			{ slotId: 'video-alt', occurrenceIds: ['bin-video'] }), videoRange(selected)],
	];
	for (const sourceRanges of sets) {
		const fence = workflowFence(project, { sourceRanges });
		const held = session({ project, authority: () => ({
			selection: authorityOf(project), fence }) });
		await assert.rejects(held.publication.acceptReviewed(review(fence), ['highlight-a']),
			{ name: 'TypeError', message: /one video authority/u });
	}
});

test('publication refuses aggregate ranges that disagree with the selection authority', async () => {
	const project = highlightProject();
	const selected = authorityOf(project).fence;
	const sets = [
		[audioRange(selected), videoRange(selected, { sourceStartFrame: 1 })],
		[audioRange(selected, { linkMembershipSha256: 'ab'.repeat(32) }), videoRange(selected)],
		[audioRange(selected), audioRange(selected,
			{ slotId: 'audio-spare', occurrenceIds: ['bin-video'] }), videoRange(selected)],
	];
	for (const sourceRanges of sets) {
		const fence = workflowFence(project, { sourceRanges });
		const held = session({ project, authority: () => ({
			selection: authorityOf(project), fence }) });
		await assert.rejects(held.publication.acceptReviewed(review(fence), ['highlight-a']),
			AssistanceProposalStaleError);
	}
});

test('publication refuses a proposal occurrence the aggregate fence never authorised', async () => {
	const held = session();
	const fence = workflowFence(held.project);
	await assert.rejects(held.publication.acceptReviewed(
		review(fence, [proposal({ videoOccurrenceId: 'ghost-video' })]), ['highlight-a']),
	{ name: 'RangeError', message: /video occurrence authority must be unique/u });
	await assert.rejects(held.publication.acceptReviewed(
		review(fence, [proposal({ audioOccurrenceId: 'ghost-audio' })]), ['highlight-a']),
	{ name: 'RangeError', message: /audio occurrence authority must be unique/u });
	assert.deepEqual(held.commands, []);
});

test('publication refuses an authorised occurrence the live project no longer resolves', async () => {
	const project = highlightProject();
	const selected = authorityOf(project).fence;
	const fence = workflowFence(project, { sourceRanges: [
		audioRange(selected, { occurrenceIds: ['bin-video'] }), videoRange(selected)] });
	const held = session({ project, authority: () => ({
		selection: selectionFenceOverride(project,
			{ occurrenceIds: ['bin-video', 'video-clip'] }), fence }) });
	await assert.rejects(held.publication.acceptReviewed(
		review(fence, [proposal({ audioOccurrenceId: 'bin-video' })]), ['highlight-a']),
	AssistanceProposalStaleError);
});

test('publication refuses a forward-retimed range for an identity-retimed audio occurrence',
	async () => {
		const project = highlightProject();
		const selected = authorityOf(project).fence;
		const fence = workflowFence(project, { sourceRanges: [
			audioRange(selected, { retimeKind: 'monotonic-forward' }), videoRange(selected)] });
		const held = session({ project, authority: () => ({
			selection: authorityOf(project), fence }) });
		await assert.rejects(held.publication.acceptReviewed(review(fence), ['highlight-a']),
			AssistanceProposalStaleError);
	});

test('publication refuses highlight timing that leaves its selected video occurrence', async () => {
	const held = session();
	const fence = workflowFence(held.project);
	await assert.rejects(held.publication.acceptReviewed(review(fence, [proposal({
		endFrame: 52_800, sourceEndFrame: 10, cropKeyframes: [cropKeyframe(0), cropKeyframe(9)],
	})]), ['highlight-a']),
	{ name: 'RangeError', message: /inside one selected video occurrence/u });
	await assert.rejects(held.publication.acceptReviewed(
		review(fence, [proposal({ startFrame: 1 })]), ['highlight-a']),
	{ name: 'RangeError', message: /highlight start must lie on an exact sequence-frame boundary/u });
});

test('publication refuses audio timing that escapes its aggregate audio fence', async () => {
	const project = highlightProject();
	const selected = authorityOf(project).fence;
	const fence = workflowFence(project, { sourceRanges: [
		audioRange(selected, { sourceEndFrame: 19_200 }), videoRange(selected)] });
	const held = session({ project, authority: () => ({
		selection: authorityOf(project), fence }) });
	await assert.rejects(held.publication.acceptReviewed(review(fence, [proposal({
		endFrame: 48_000, sourceEndFrame: 10, cropKeyframes: [cropKeyframe(0), cropKeyframe(9)],
	})]), ['highlight-a']),
	{ name: 'RangeError', message: /audio timing escapes its aggregate fence/u });
});

test('publication refuses crop keyframes that do not bind the whole selected source range',
	async () => {
		const held = session();
		const fence = workflowFence(held.project);
		const sets = [[cropKeyframe(1), cropKeyframe(3)], [cropKeyframe(0), cropKeyframe(2)]];
		for (const cropKeyframes of sets) {
			await assert.rejects(held.publication.acceptReviewed(
				review(fence, [proposal({ cropKeyframes })]), ['highlight-a']),
			{ name: 'RangeError', message: /crop keyframes must bind the complete/u });
		}
		assert.deepEqual(held.commands, []);
	});

test('publication refuses a linked video occurrence proposed without its audio occurrence',
	async () => {
		const held = session();
		await assert.rejects(held.publication.acceptReviewed(
			review(workflowFence(held.project), [proposal({ audioOccurrenceId: null })]),
			['highlight-a']),
		{ name: 'RangeError', message: /one exact linked A\/V occurrence pair/u });
	});

test('publication refuses multicamera authority over the fenced sequence', async () => {
	const planned = highlightProject();
	const multicamera = highlightProject({ multicamera: true });
	const fence = workflowFence(planned);
	const held = session({ project: planned, authority: () => ({
		selection: { ...authorityOf(planned), project: multicamera }, fence }) });
	await assert.rejects(held.publication.acceptReviewed(review(fence), ['highlight-a']),
		{ name: 'RangeError', message: /multicamera source authority/u });
});

test('publication refuses a project that changed between planning and the commit gate', async () => {
	const planned = highlightProject();
	const renamed = highlightProject({ title: 'Renamed while publishing' });
	const fence = workflowFence(planned);
	const held = session({ project: planned, authority: (call) => ({
		selection: authorityOf(call === 1 ? planned : renamed), fence }) });
	await assert.rejects(held.publication.acceptReviewed(review(fence), ['highlight-a']),
		AssistanceProposalStaleError);
	assert.deepEqual(held.log, ['authority', 'capture', 'authority']);
});

test('publication revalidates authority on both sides of the project token before one commit',
	async () => {
		const held = session();
		await held.publication.acceptReviewed(review(workflowFence(held.project)), ['highlight-a']);
		assert.deepEqual(held.log,
			['authority', 'capture', 'authority', 'assert', 'authority', 'commit']);
		assert.equal(held.commands.length, 1);
		const batch = held.commands[0]!;
		assert.equal(batch.type, 'batch');
		assert.equal(Object.isFrozen(batch), true);
		assert.deepEqual((batch.commands as DataRecord[]).map(({ type }) => type), [
			'sequence/create', 'track/add', 'track/add', 'clip/add', 'clip/add',
			'video-keyframes/set', 'track/add',
		]);
	});

test('two selected highlights publish as one batch of independent secondary sequences',
	async () => {
		const held = session();
		const fence = workflowFence(held.project);
		await held.publication.acceptReviewed(review(fence, [proposal(), proposal({
			id: 'highlight-b', title: 'Second highlight', startFrame: 28_800, endFrame: 48_000,
			sourceStartFrame: 6, sourceEndFrame: 10,
			cropKeyframes: [cropKeyframe(6), cropKeyframe(9)],
		})]), ['highlight-b', 'highlight-a']);
		assert.equal(held.commands.length, 1);
		const commands = held.commands[0]!.commands as DataRecord[];
		assert.equal(commands.length, 14);
		const sequences = commands.filter(({ type }) => type === 'sequence/create')
			.map((command) => command.sequence as DataRecord);
		assert.deepEqual(sequences.map(({ name }) => name),
			['First highlight', 'Second highlight']);
		assert.equal(new Set(sequences.map(({ id }) => String(id))).size, 2);
	});

test('publication does not commit when the captured project token is no longer current', async () => {
	const held = session({ assertProject: () => {
		throw new Error('The project changed under the publication.');
	} });
	await assert.rejects(
		held.publication.acceptReviewed(review(workflowFence(held.project)), ['highlight-a']),
		{ message: 'The project changed under the publication.' });
	assert.deepEqual(held.log, ['authority', 'capture', 'authority', 'assert']);
	assert.deepEqual(held.commands, []);
});

test('publication awaits an asynchronous commit and surfaces its failure', async () => {
	let settled = false;
	const held = session({ commit: async () => {
		await Promise.resolve();
		settled = true;
	} });
	await held.publication.acceptReviewed(review(workflowFence(held.project)), ['highlight-a']);
	assert.equal(settled, true, 'acceptance must not resolve before its commit settles');
	const failing = session({ commit: () => Promise.reject(new Error('The commit was refused.')) });
	await assert.rejects(
		failing.publication.acceptReviewed(review(workflowFence(failing.project)), ['highlight-a']),
		{ message: 'The commit was refused.' });
});

test('existing project label identities are reserved against created highlight identities',
	async () => {
		const project = highlightProject({ labels: true });
		const colliding = session({ project, createId: (prefix) => (
			prefix === 'assistance-highlight-label' ? 'existing-label' : `${prefix}-1`) });
		await assert.rejects(
			colliding.publication.acceptReviewed(review(workflowFence(project)), ['highlight-a']),
			{ name: 'RangeError', message: /Duplicate highlight identity existing-label/u });
		assert.deepEqual(colliding.commands, []);
		const held = session({ project });
		await held.publication.acceptReviewed(review(workflowFence(project)), ['highlight-a']);
		assert.equal(held.commands.length, 1);
	});

interface SessionOptions {
	readonly project?: FramescaperProjectAssistance;
	readonly authority?: (call: number) => unknown;
	readonly createId?: (prefix: string) => string;
	readonly assertProject?: (token: unknown) => void;
	readonly commit?: (command: unknown) => void | PromiseLike<void>;
}

function session(options: SessionOptions = {}) {
	const project = options.project ?? highlightProject();
	const log: string[] = [];
	const commands: DataRecord[] = [];
	let calls = 0;
	const dependencies: FramescaperAssistanceHighlightPublicationDependencies = {
		currentAuthority: () => {
			log.push('authority');
			calls += 1;
			return (options.authority
				? options.authority(calls)
				: { selection: authorityOf(project), fence: workflowFence(project) }) as never;
		},
		captureProject: () => {
			log.push('capture');
			return project;
		},
		assertProject: (token) => {
			log.push('assert');
			if (options.assertProject) options.assertProject(token);
			else assert.strictEqual(token, project);
		},
		createId: options.createId ?? incrementalIds(),
		commit: (command) => {
			log.push('commit');
			commands.push(command as unknown as DataRecord);
			return options.commit?.(command);
		},
	};
	return {
		publication: createFramescaperAssistanceHighlightPublication(dependencies),
		project, log, commands,
	};
}

function highlightProject(options: Readonly<{
	title?: string;
	labels?: boolean;
	multicamera?: boolean;
}> = {}): FramescaperProjectAssistance {
	const value = structuredClone(framescaperV20Options());
	value.id = 'highlight-publication-project';
	value.title = options.title ?? 'Highlight publication project';
	value.now = NOW;
	value.selection = { startFrame: 0, endFrame: 48_000, trackIds: ['video-track'],
		clipIds: ['video-clip'], frequencyRange: null, annotationIds: [] };
	value.sources = records(value.sources).map((source) => ({ ...source,
		contentSha256: source.id === 'video-source' ? VIDEO_SHA256 : AUDIO_SHA256 }));
	value.clips = records(value.clips).map((clip) => ({ ...clip, avLinkId: 'original-av-link' }));
	value.tracks = records(value.tracks).map((track) => ({ ...track,
		laneGroupId: 'original-lane-group' }));
	if (options.labels === true) {
		value.tracks = [...records(value.tracks), createLabelTrack({ id: 'label-track',
			name: 'Chapters', clipIds: [], labels: [createLabel({ id: 'existing-label',
				title: 'Existing', startFrame: 0, endFrame: 4_800 })] })];
		value.sequences = records(value.sequences).map((sequence) => ({ ...sequence,
			trackIds: [...strings(sequence.trackIds), 'label-track'] }));
	}
	if (options.multicamera === true) {
		value.sources = [...records(value.sources), createVideoSource({ id: 'video-source-b',
			name: 'Second camera', storageKey: 'video-source-b', mimeType: 'video/mp4',
			contentSha256: 'ab'.repeat(32), frameCount: 48_000, sampleFrameCount: 48_000,
			sourceFrameCount: 10, frameRate: { num: 10, den: 1 }, width: 1_920, height: 1_080 })];
		value.multicameraGroups = [{ id: 'camera-group', projectId: value.id,
			sequenceId: 'main-sequence', outputClipId: 'video-clip', activeMemberId: 'camera-a',
			members: [
				{ id: 'camera-a', groupId: 'camera-group', sourceId: 'video-source',
					syncOffsetSamples: 0 },
				{ id: 'camera-b', groupId: 'camera-group', sourceId: 'video-source-b',
					syncOffsetSamples: 0 },
			] }];
	}
	return createFramescaperProjectAssistance(PROFILE, value as never);
}

function authorityOf(value: FramescaperProjectAssistance) {
	return resolveLocalAssistanceSelectedVideoAuthority({
		getProject: () => value, getSelectedClipId: () => 'video-clip',
	});
}

/** A structural copy of the live authority; boundary mapping refuses it, earlier gates do not. */
function selectionFenceOverride(
	value: FramescaperProjectAssistance,
	overrides: DataRecord,
): unknown {
	const authority = authorityOf(value);
	return { ...authority, fence: { ...authority.fence, ...overrides } };
}

function workflowFence(
	value: FramescaperProjectAssistance,
	overrides: Partial<AssistanceWorkflowFenceV1> = {},
): AssistanceWorkflowFenceV1 {
	const selected = authorityOf(value).fence;
	return {
		fenceVersion: 1, schemaFamily: 'framescaper', schemaVersion: 1,
		projectId: String(value.id), revision: Number(value.revision),
		sequenceId: 'main-sequence',
		sourceRanges: [audioRange(selected), videoRange(selected)],
		transcriptBodySha256: null, recipeSha256: 'bc'.repeat(32),
		settingsSha256: 'de'.repeat(32), modelBindingsSha256: 'f0'.repeat(32),
		...overrides,
	} as AssistanceWorkflowFenceV1;
}

function audioRange(
	selected: SelectionFenceView,
	overrides: Partial<AssistanceWorkflowSourceRangeV1> = {},
): AssistanceWorkflowSourceRangeV1 {
	return {
		slotId: 'audio-main', mediaKind: 'audio', sourceId: 'audio-source',
		sourceSha256: AUDIO_SHA256, sourceSampleRate: 48_000, occurrenceIds: ['audio-clip'],
		sourceStartFrame: 0, sourceEndFrame: 48_000,
		linkMembershipSha256: selected.linkMembershipSha256,
		timingAuthoritySha256: '78'.repeat(32), retimeKind: 'identity',
		...overrides,
	} as AssistanceWorkflowSourceRangeV1;
}

function videoRange(
	selected: SelectionFenceView,
	overrides: Partial<AssistanceWorkflowSourceRangeV1> = {},
): AssistanceWorkflowSourceRangeV1 {
	return {
		slotId: 'video-main', mediaKind: 'video', sourceId: 'video-source',
		sourceSha256: VIDEO_SHA256, sourceSampleRate: null, occurrenceIds: ['video-clip'],
		sourceStartFrame: selected.sourceStartFrame, sourceEndFrame: selected.sourceEndFrame,
		linkMembershipSha256: selected.linkMembershipSha256,
		timingAuthoritySha256: selected.timingAuthoritySha256, retimeKind: 'identity',
		...overrides,
	} as AssistanceWorkflowSourceRangeV1;
}

function review(
	fence: AssistanceWorkflowFenceV1,
	proposals: readonly DataRecord[] = [proposal()],
): DataRecord {
	return { kind: 'highlight-proposals', schemaVersion: 1, workflowId: 'make-highlights',
		fence, proposals };
}

function proposal(overrides: DataRecord = {}): DataRecord {
	return {
		id: 'highlight-a', startFrame: 0, endFrame: 19_200,
		sourceStartFrame: 0, sourceEndFrame: 4, score: 0.5,
		evidenceMode: 'speechless', transcriptExcerpt: null,
		visualSummary: 'Reviewed visual evidence.', selected: false,
		videoOccurrenceId: 'video-clip', audioOccurrenceId: 'audio-clip',
		title: 'First highlight', hook: null, chapters: [], explanation: null,
		cropKeyframes: [cropKeyframe(0), cropKeyframe(3)],
		...overrides,
	};
}

function cropKeyframe(sourceFrame: number): DataRecord {
	return { sourceFrame, authority: 'center', trackIds: [],
		crop: { left: 0.25, top: 0, right: 0.25, bottom: 0 } };
}

function incrementalIds(): (prefix: string) => string {
	let next = 0;
	return (prefix) => `${prefix}-${String(next += 1)}`;
}

function records(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value.map((entry) => entry as DataRecord) : [];
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String) : [];
}
