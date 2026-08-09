/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	TRACK_FOLDER_V12_DEFAULTS,
	TRACK_FOLDER_V12_LIMITS,
	createTrackFolderV12,
	createTrackFoldersV12,
	validateTrackFolderV12,
	validateTrackFoldersV12,
} from '../src/common/editor/track-folder-v12.ts';

const COMPLETE_FOLDER = Object.freeze({
	id: 'dialogue',
	name: 'Dialogue',
	collapsed: false,
	height: 40,
	hidden: false,
	mute: false,
	solo: false,
});

test('V12 folder factories apply explicit bounded defaults and freeze canonical data', () => {
	assert.deepEqual(TRACK_FOLDER_V12_DEFAULTS, {
		collapsed: false,
		height: 40,
		hidden: false,
		mute: false,
		solo: false,
	});
	assert.deepEqual(TRACK_FOLDER_V12_LIMITS, {
		maximumFolders: 4_096,
		maximumIdCodeUnits: 256,
		maximumNameCodeUnits: 4_096,
		minimumHeight: 40,
		maximumHeight: 4_096,
	});
	assert.equal(Object.isFrozen(TRACK_FOLDER_V12_DEFAULTS), true);

	const folder = createTrackFolderV12({ id: 'dialogue', name: 'Dialogue' });
	assert.deepEqual(folder, COMPLETE_FOLDER);
	assert.equal(Object.isFrozen(folder), true);
	assert.equal(validateTrackFolderV12(folder), true);
	assert.throws(() => {
		(folder as unknown as { height: number }).height = 96;
	}, TypeError);

	const custom = createTrackFolderV12({
		id: 'music',
		name: 'Music',
		collapsed: true,
		height: 4_096,
		hidden: true,
		mute: true,
		solo: true,
	});
	assert.deepEqual(custom, {
		id: 'music',
		name: 'Music',
		collapsed: true,
		height: 4_096,
		hidden: true,
		mute: true,
		solo: true,
	});
});

test('V12 folder validation accepts only a closed plain-data wire record', () => {
	const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, COMPLETE_FOLDER);
	assert.equal(validateTrackFolderV12(nullPrototype), true);

	for (const value of [
		null,
		[],
		new Date(),
		Object.assign(Object.create({ inherited: true }) as Record<string, unknown>, COMPLETE_FOLDER),
		{ ...COMPLETE_FOLDER, extension: true },
		{ ...COMPLETE_FOLDER, [Symbol('extension')]: true },
		{ id: 'dialogue', name: 'Dialogue' },
	]) {
		assert.throws(() => validateTrackFolderV12(value), /folder|plain|unsupported|missing/iu);
	}

	let getterCalls = 0;
	const accessor = { ...COMPLETE_FOLDER } as Record<string, unknown>;
	Object.defineProperty(accessor, 'name', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return 'Dialogue';
		},
	});
	assert.throws(() => validateTrackFolderV12(accessor), /name.*data|enumerable data/iu);
	assert.equal(getterCalls, 0);

	const hidden = { ...COMPLETE_FOLDER };
	Object.defineProperty(hidden, 'solo', { enumerable: false, value: false });
	assert.throws(() => validateTrackFolderV12(hidden), /solo.*enumerable/iu);
	assert.throws(
		() => createTrackFolderV12({ id: 'folder', name: 'Folder', future: true }),
		/unsupported|unknown/iu,
	);
	for (const value of [
		{ id: 'folder', name: 'Folder', collapsed: null },
		{ id: 'folder', name: 'Folder', height: undefined },
		{ id: 'folder', name: 'Folder', hidden: null },
		{ id: 'folder', name: 'Folder', mute: undefined },
		{ id: 'folder', name: 'Folder', solo: null },
	]) {
		assert.throws(() => createTrackFolderV12(value), /boolean|height|safe integer/iu);
	}
});

test('V12 folder identifiers and names are non-empty bounded canonical single-line text', () => {
	assert.equal(validateTrackFolderV12({
		...COMPLETE_FOLDER,
		id: '🎵'.repeat(128),
		name: '音'.repeat(4_096),
	}), true, 'limits count UTF-16 code units');

	for (const [field, value] of [
		['id', ''],
		['id', ' folder '],
		['id', 'x'.repeat(257)],
		['id', 'line\nbreak'],
		['id', 'format\u200bcharacter'],
		['name', ''],
		['name', ' Folder '],
		['name', 'x'.repeat(4_097)],
		['name', 'line\rbreak'],
		['name', `control${String.fromCodePoint(7)}`],
	] as const) {
		assert.throws(
			() => validateTrackFolderV12({ ...COMPLETE_FOLDER, [field]: value }),
			/non-empty|canonical|length|maximum|single-line|control|format/iu,
		);
	}
});

test('V12 folder state is strictly typed and height is a canonical bounded safe integer', () => {
	for (const [field, value] of [
		['collapsed', 0],
		['hidden', null],
		['mute', 'false'],
		['solo', undefined],
		['height', 39],
		['height', 4_097],
		['height', 40.5],
		['height', -0],
		['height', Number.NaN],
		['height', Number.POSITIVE_INFINITY],
	] as const) {
		assert.throws(
			() => validateTrackFolderV12({ ...COMPLETE_FOLDER, [field]: value }),
			/boolean|height|safe integer|between/iu,
		);
	}
});

test('V12 folder collections are dense canonical arrays with unique bounded IDs', () => {
	const folders = createTrackFoldersV12([
		{ id: 'dialogue', name: 'Dialogue' },
		{ id: 'music', name: 'Music', collapsed: true },
	]);
	assert.deepEqual(folders, [
		COMPLETE_FOLDER,
		{ ...COMPLETE_FOLDER, id: 'music', name: 'Music', collapsed: true },
	]);
	assert.equal(Object.isFrozen(folders), true);
	assert.equal(Object.isFrozen(folders[0]), true);
	assert.equal(validateTrackFoldersV12(folders), true);

	assert.throws(
		() => validateTrackFoldersV12([COMPLETE_FOLDER, { ...COMPLETE_FOLDER }]),
		/duplicate.*dialogue/iu,
	);
	const maximumInput = Array.from(
		{ length: TRACK_FOLDER_V12_LIMITS.maximumFolders },
		(_, index) => ({ id: `folder-${String(index)}`, name: 'Folder' }),
	);
	const maximum = createTrackFoldersV12(maximumInput);
	assert.equal(maximum.length, TRACK_FOLDER_V12_LIMITS.maximumFolders);
	assert.equal(validateTrackFoldersV12(maximum), true);
	assert.throws(
		() => createTrackFoldersV12([...maximumInput, { id: 'overflow', name: 'Folder' }]),
		/4,096|4096|maximum/iu,
	);

	const sparse = new Array<unknown>(1);
	const expanded = [COMPLETE_FOLDER] as unknown[] & Record<string, unknown>;
	expanded.extra = true;
	const symbolic = [COMPLETE_FOLDER] as unknown[] & Record<PropertyKey, unknown>;
	symbolic[Symbol('extra')] = true;
	class FolderArray extends Array<unknown> {}
	for (const value of [sparse, expanded, symbolic, new FolderArray(COMPLETE_FOLDER)]) {
		assert.throws(() => validateTrackFoldersV12(value), /canonical array|dense|unsupported|array/iu);
	}

	let getterCalls = 0;
	const accessor: unknown[] = [COMPLETE_FOLDER];
	Object.defineProperty(accessor, '0', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return COMPLETE_FOLDER;
		},
	});
	assert.throws(() => validateTrackFoldersV12(accessor), /enumerable data|canonical array/iu);
	assert.equal(getterCalls, 0);
});
