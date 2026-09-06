/* SPDX-License-Identifier: AGPL-3.0-only */

/*
 * The timeline-image project history is the last surviving copy of a design
 * that once had four: the composition, finishing and native-media histories
 * were removed as orphans. The cases still run against a table so that a
 * second family can be added back the way the first is covered.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectTimelineImage } from '../src/framescaper/editor-project-timeline-image.ts';
import {
	createFramescaperProjectHistoryTimelineImage,
	executeFramescaperProjectCommandTimelineImage,
	redoFramescaperProjectCommandTimelineImage,
	undoFramescaperProjectCommandTimelineImage,
	validateFramescaperProjectHistoryTimelineImage,
} from '../src/framescaper/editor-project-timeline-image-history.ts';

type Data = Record<string, unknown>;

interface HistoryFamily {
	readonly name: string;
	readonly profile: unknown;
	createProject(): Data;
	create(profile: unknown, project: unknown, options?: Readonly<{ limit?: number }>): Data;
	validate(profile: unknown, history: unknown): boolean;
	execute(profile: unknown, history: unknown, command: unknown, options?: unknown): Data;
	undo(profile: unknown, history: unknown, options?: unknown): Data;
	redo(profile: unknown, history: unknown, options?: unknown): Data;
}

const RENAME = Object.freeze({ type: 'project/rename', title: 'Renamed' });
const AT = (day: number) => Object.freeze({ now: new Date(`2026-01-0${String(day)}T00:00:00.000Z`) });

const FAMILIES: readonly HistoryFamily[] = Object.freeze([
	{
		name: 'timeline image',
		profile: FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE,
		createProject: () => createFramescaperProjectTimelineImage(
			FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE, {} as never,
		) as unknown as Data,
		create: createFramescaperProjectHistoryTimelineImage as unknown as HistoryFamily['create'],
		validate: validateFramescaperProjectHistoryTimelineImage as unknown as HistoryFamily['validate'],
		execute: executeFramescaperProjectCommandTimelineImage as unknown as HistoryFamily['execute'],
		undo: undoFramescaperProjectCommandTimelineImage as unknown as HistoryFamily['undo'],
		redo: redoFramescaperProjectCommandTimelineImage as unknown as HistoryFamily['redo'],
	},
]);

function fresh(family: HistoryFamily, limit?: number): Data {
	return limit === undefined
		? family.create(family.profile, family.createProject())
		: family.create(family.profile, family.createProject(), { limit });
}

function shape(history: Data): Readonly<{ undo: number; redo: number; title: unknown; revision: unknown }> {
	const present = history.present as Data;
	return {
		undo: (history.undoStack as readonly unknown[]).length,
		redo: (history.redoStack as readonly unknown[]).length,
		title: present.title,
		revision: present.revision,
	};
}

test('a fresh history holds a clone of the project with both stacks empty', () => {
	for (const family of FAMILIES) {
		const project = family.createProject();
		const history = family.create(family.profile, project);

		assert.deepEqual(Object.keys(history), ['limit', 'present', 'undoStack', 'redoStack'], family.name);
		assert.equal(history.limit, 200, family.name);
		assert.deepEqual(shape(history), { undo: 0, redo: 0, title: 'Untitled project', revision: 0 }, family.name);
		assert.notEqual(history.present, project, family.name);
	}
});

test('a history refuses a foreign profile, an invalid project and an impossible limit', () => {
	for (const family of FAMILIES) {
		assert.throws(() => family.create({}, family.createProject()), TypeError, family.name);
		assert.throws(() => family.create(family.profile, { id: 'not a project' }), family.name);
		assert.throws(() => fresh(family, 0), RangeError, family.name);
		assert.throws(() => fresh(family, 1.5), RangeError, family.name);
	}
});

test('validation accepts a real history and rejects every malformed shape', () => {
	for (const family of FAMILIES) {
		const history = fresh(family);

		assert.equal(family.validate(family.profile, history), true, family.name);
		assert.throws(() => family.validate({}, history), TypeError, family.name);
		assert.throws(() => family.validate(family.profile, null), family.name);
		assert.throws(() => family.validate(family.profile, []), family.name);
		assert.throws(() => family.validate(family.profile, { ...history, extra: true }), family.name);
		assert.throws(() => family.validate(family.profile, { ...history, limit: 0 }), family.name);
		assert.throws(() => family.validate(family.profile, { ...history, present: {} }), family.name);
		assert.throws(() => family.validate(family.profile, { ...history, undoStack: 'stack' }), family.name);
	}
});

test('validation rejects a stack longer than the limit it declares', () => {
	for (const family of FAMILIES) {
		const executed = family.execute(family.profile, fresh(family), RENAME, AT(1));
		const entry = (executed.undoStack as readonly Data[])[0];

		assert.throws(
			() => family.validate(family.profile, { ...executed, limit: 1, undoStack: [entry, entry] }),
			family.name,
		);
	}
});

test('validation rejects an entry that is malformed or belongs to another project', () => {
	for (const family of FAMILIES) {
		const executed = family.execute(family.profile, fresh(family), RENAME, AT(1));
		const entry = (executed.undoStack as readonly Data[])[0];
		const foreign = { ...entry, project: { ...(entry.project as Data), id: 'another-project' } };

		assert.throws(() => family.validate(family.profile, { ...executed, undoStack: [foreign] }), family.name);
		assert.throws(
			() => family.validate(family.profile, { ...executed, undoStack: [{ project: entry.project }] }),
			family.name,
		);
		assert.throws(
			() => family.validate(family.profile, { ...executed, redoStack: [{ ...entry, command: null }] }),
			family.name,
		);
	}
});

test('executing a command advances the present and records exactly one undo step', () => {
	for (const family of FAMILIES) {
		const executed = family.execute(family.profile, fresh(family), RENAME, AT(1));

		assert.deepEqual(shape(executed), { undo: 1, redo: 0, title: 'Renamed', revision: 1 }, family.name);
		assert.equal(
			((executed.undoStack as readonly Data[])[0].project as Data).title,
			'Untitled project',
			family.name,
		);
	}
});

test('a history never grows past its limit, discarding its oldest step instead', () => {
	for (const family of FAMILIES) {
		let history = fresh(family, 1);
		for (const title of ['First', 'Second', 'Third']) {
			history = family.execute(family.profile, history, { type: 'project/rename', title }, AT(1));
		}

		assert.equal((history.undoStack as readonly unknown[]).length, 1, family.name);
		assert.equal(
			((history.undoStack as readonly Data[])[0].project as Data).title,
			'Second',
			family.name,
		);
	}
});

test('undo restores the previous present and offers the command back for redo', () => {
	for (const family of FAMILIES) {
		const executed = family.execute(family.profile, fresh(family), RENAME, AT(1));

		const undone = family.undo(family.profile, executed, AT(2));

		assert.deepEqual(shape(undone), { undo: 0, redo: 1, title: 'Untitled project', revision: 2 }, family.name);
		assert.equal((undone.present as Data).updatedAt, '2026-01-02T00:00:00.000Z', family.name);
	}
});

test('redo replays the undone command and returns the step to the undo stack', () => {
	for (const family of FAMILIES) {
		const undone = family.undo(
			family.profile,
			family.execute(family.profile, fresh(family), RENAME, AT(1)),
			AT(2),
		);

		const redone = family.redo(family.profile, undone, AT(3));

		assert.deepEqual(shape(redone), { undo: 1, redo: 0, title: 'Renamed', revision: 3 }, family.name);
		assert.equal((redone.present as Data).updatedAt, '2026-01-03T00:00:00.000Z', family.name);
	}
});

test('executing after an undo abandons the redo stack', () => {
	for (const family of FAMILIES) {
		const undone = family.undo(
			family.profile,
			family.execute(family.profile, fresh(family), RENAME, AT(1)),
			AT(2),
		);

		const diverged = family.execute(family.profile, undone, { type: 'project/rename', title: 'Other' }, AT(3));

		assert.deepEqual(shape(diverged), { undo: 1, redo: 0, title: 'Other', revision: 3 }, family.name);
	}
});

test('undo and redo on an empty stack return the history untouched', () => {
	for (const family of FAMILIES) {
		const history = fresh(family);

		assert.equal(family.undo(family.profile, history, AT(2)), history, family.name);
		assert.equal(family.redo(family.profile, history, AT(2)), history, family.name);
	}
});

test('restoring a history refuses a timestamp that is not a date', () => {
	for (const family of FAMILIES) {
		const executed = family.execute(family.profile, fresh(family), RENAME, AT(1));

		assert.throws(() => family.undo(family.profile, executed, { now: 'not a date' }), family.name);
	}
});

test('a restored present is defaulted to the current clock when no timestamp is given', () => {
	for (const family of FAMILIES) {
		const before = new Date().toISOString();
		const undone = family.undo(
			family.profile,
			family.execute(family.profile, fresh(family), RENAME, AT(1)),
		);

		const updatedAt = String((undone.present as Data).updatedAt);
		assert.ok(updatedAt >= before, `${family.name}: ${updatedAt} is not after ${before}`);
	}
});
