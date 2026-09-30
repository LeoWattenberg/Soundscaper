/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffect } from '../src/common/editor/effects.js';
import { createAudioTrack, createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, type SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	createSoundscaperTrackDuplicateClipboardV8,
	normalizeSoundscaperTrackDuplicateClipboardV8,
	prepareCurrentSoundscaperTrackDuplicateCarrierV8,
	prepareSoundscaperTrackDuplicateCarrierV8,
} from '../src/soundscaper/editor-session-clipboard.ts';

for (const extraTrack of [
	createLabelTrack({ id: 'labels', name: 'Labels' }),
	{ id: 'video', name: 'Video', type: 'video', clipIds: [], locked: false },
]) {
	test(`track duplication ignores a ${extraTrack.type} track without an effect rack`, () => {
		const voice = createAudioTrack({
			id: 'voice', name: 'Voice', clipIds: [],
			effects: [createEffect('highpass', { id: 'voice-gain' })],
		});
		const project = createSoundscaperProject({
			tracks: [voice, extraTrack],
			sequences: [{
				id: 'main-sequence', rate: { num: 30, den: 1 },
				trackIds: ['voice', String(extraTrack.id)],
			}],
			primarySequenceId: 'main-sequence',
		} as never);

		const carrier = prepareCurrentSoundscaperTrackDuplicateCarrierV8(project, {
			sourceTrackId: 'voice', targetTrackId: 'voice-copy',
			effectIds: [{ sourceId: 'voice-gain', targetId: 'voice-copy-gain' }],
		});
		assert.deepEqual(carrier.effectIds, [
			{ sourceId: 'voice-gain', targetId: 'voice-copy-gain' },
		]);
		assert.equal(Object.isFrozen(carrier), true);
	});
}

test('track duplicate clipboard captures and normalizes detached immutable authority', () => {
	const project = clipboardProject();
	const captured = createSoundscaperTrackDuplicateClipboardV8(project, 'voice');
	const normalized = normalizeSoundscaperTrackDuplicateClipboardV8(structuredClone(captured));

	assert.deepEqual(normalized, captured);
	assert.notStrictEqual(normalized, captured);
	assert.equal(Object.isFrozen(captured), true);
	assert.equal(Object.isFrozen(captured.effectIds), true);
	assert.equal(Object.isFrozen(normalized), true);
	assert.equal(Object.isFrozen(normalized.effectIds), true);
});

test('track duplicate clipboard refuses an unknown source track', () => {
	assert.throws(
		() => createSoundscaperTrackDuplicateClipboardV8(clipboardProject(), 'missing'),
		/unknown clipboard source track/iu,
	);
});

test('track duplicate clipboard requires its exact schema version and carrier kind', () => {
	const captured = createSoundscaperTrackDuplicateClipboardV8(clipboardProject(), 'voice');
	assert.throws(
		() => normalizeSoundscaperTrackDuplicateClipboardV8({ ...captured, schemaVersion: 7 }),
		/requires clipboard V8/iu,
	);
	assert.throws(
		() => normalizeSoundscaperTrackDuplicateClipboardV8({ ...captured, kind: 'clips' }),
		/unsupported carrier kind/iu,
	);
});

test('track duplicate clipboard refuses duplicate effect identities', () => {
	const captured = createSoundscaperTrackDuplicateClipboardV8(clipboardProject(), 'voice');
	assert.throws(
		() => normalizeSoundscaperTrackDuplicateClipboardV8({
			...captured,
			effectIds: ['voice-highpass', 'voice-highpass'],
		}),
		/effect IDs must be unique/iu,
	);
});

test('track duplicate clipboard rejects accessors without evaluating them', () => {
	const captured = structuredClone(
		createSoundscaperTrackDuplicateClipboardV8(clipboardProject(), 'voice'),
	) as Record<string, unknown>;
	let reads = 0;
	Object.defineProperty(captured, 'kind', {
		enumerable: true,
		get() { reads += 1; return 'track-duplicate'; },
	});

	assert.throws(() => normalizeSoundscaperTrackDuplicateClipboardV8(captured), /own enumerable data/iu);
	assert.equal(reads, 0);
});

test('track duplicate clipboard refuses sparse effect arrays', () => {
	const captured = createSoundscaperTrackDuplicateClipboardV8(clipboardProject(), 'voice');
	assert.throws(
		() => normalizeSoundscaperTrackDuplicateClipboardV8({
			...captured, effectIds: new Array<string>(captured.effectIds.length),
		}),
		/must be dense/iu,
	);
});

test('track duplicate clipboard refuses accessor array entries without evaluating them', () => {
	const captured = createSoundscaperTrackDuplicateClipboardV8(clipboardProject(), 'voice');
	const effectIds = [...captured.effectIds];
	let reads = 0;
	Object.defineProperty(effectIds, '0', {
		enumerable: true,
		configurable: true,
		get() { reads += 1; return captured.effectIds[0]; },
	});

	assert.throws(
		() => normalizeSoundscaperTrackDuplicateClipboardV8({ ...captured, effectIds }),
		/own enumerable data/iu,
	);
	assert.equal(reads, 0);
});

test('track duplicate clipboard refuses numeric-looking properties outside its array length', () => {
	const captured = createSoundscaperTrackDuplicateClipboardV8(clipboardProject(), 'voice');
	const effectIds = [...captured.effectIds];
	Object.defineProperty(effectIds, '4294967295', {
		enumerable: true, configurable: true, value: 'smuggled-effect',
	});

	assert.throws(
		() => normalizeSoundscaperTrackDuplicateClipboardV8({ ...captured, effectIds }),
		/unsupported property/iu,
	);
});

test('track duplicate clipboard refuses stale project revision authority', () => {
	const project = clipboardProject();
	const captured = createSoundscaperTrackDuplicateClipboardV8(project, 'voice');
	assert.throws(
		() => prepareSoundscaperTrackDuplicateCarrierV8(project, {
			...captured, originRevision: captured.originRevision + 1,
		}, duplicateRequest()),
		/stale/iu,
	);
});

test('track duplicate clipboard refuses a substituted source track identity', () => {
	const project = clipboardProject();
	const captured = createSoundscaperTrackDuplicateClipboardV8(project, 'voice');
	assert.throws(
		() => prepareSoundscaperTrackDuplicateCarrierV8(project, captured, {
			...duplicateRequest(), sourceTrackId: 'music',
		}),
		/changed its source track identity/iu,
	);
});

test('track duplicate clipboard requires a fresh target track identity', () => {
	const project = clipboardProject();
	const captured = createSoundscaperTrackDuplicateClipboardV8(project, 'voice');
	for (const targetTrackId of ['voice', 'music']) {
		assert.throws(
			() => prepareSoundscaperTrackDuplicateCarrierV8(project, captured, {
				...duplicateRequest(), targetTrackId,
			}),
			/fresh target track identity/iu,
		);
	}
});

test('track duplicate clipboard requires one-to-one effect remapping', () => {
	const project = clipboardProject();
	for (const effectIds of [
		[
			{ sourceId: 'voice-highpass', targetId: 'copy-highpass' },
			{ sourceId: 'voice-highpass', targetId: 'copy-limiter' },
		],
		[
			{ sourceId: 'voice-highpass', targetId: 'copy-effect' },
			{ sourceId: 'voice-limiter', targetId: 'copy-effect' },
		],
	]) {
		assert.throws(
			() => prepareCurrentSoundscaperTrackDuplicateCarrierV8(project, {
				...duplicateRequest(), effectIds,
			}),
			/must be one-to-one/iu,
		);
	}
});

test('track duplicate clipboard refuses target effect identities already in the project', () => {
	const project = clipboardProject();
	const captured = createSoundscaperTrackDuplicateClipboardV8(project, 'voice');
	assert.throws(
		() => prepareSoundscaperTrackDuplicateCarrierV8(project, captured, {
			...duplicateRequest(),
			effectIds: [
				{ sourceId: 'voice-highpass', targetId: 'music-highpass' },
				{ sourceId: 'voice-limiter', targetId: 'copy-limiter' },
			],
		}),
		/already in use/iu,
	);
});

test('track duplicate clipboard detects a source rack changed after capture', () => {
	const project = clipboardProject();
	const captured = createSoundscaperTrackDuplicateClipboardV8(project, 'voice');
	const changed = structuredClone(project) as SoundscaperProject;
	const voice = changed.tracks.find(({ id }) => id === 'voice')!;
	const effects = (voice as unknown as { effects: { id: string }[] }).effects;
	effects[0]!.id = 'changed-highpass';

	assert.throws(
		() => prepareSoundscaperTrackDuplicateCarrierV8(changed, captured, duplicateRequest()),
		/source effects changed/iu,
	);
});

function clipboardProject(): SoundscaperProject {
	return createSoundscaperProject({
		id: 'clipboard-project', title: 'Clipboard project', revision: 3,
		now: '2026-09-30T12:00:00.000Z',
		tracks: [
			createAudioTrack({
				id: 'voice', name: 'Voice', clipIds: [],
				effects: [
					createEffect('highpass', { id: 'voice-highpass' }),
					createEffect('limiter', { id: 'voice-limiter' }),
				],
			}),
			createAudioTrack({
				id: 'music', name: 'Music', clipIds: [],
				effects: [createEffect('highpass', { id: 'music-highpass' })],
			}),
		],
		sequences: [{
			id: 'main-sequence', rate: { num: 30, den: 1 }, trackIds: ['voice', 'music'],
		}],
		primarySequenceId: 'main-sequence',
	} as never);
}

function duplicateRequest() {
	return {
		sourceTrackId: 'voice', targetTrackId: 'voice-copy',
		effectIds: [
			{ sourceId: 'voice-highpass', targetId: 'copy-highpass' },
			{ sourceId: 'voice-limiter', targetId: 'copy-limiter' },
		],
	};
}
