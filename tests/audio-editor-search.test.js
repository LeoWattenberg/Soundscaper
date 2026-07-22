import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AUDIO_EDITOR_SEARCH_RESULT_LIMIT,
	createAudioEditorMediaSearchEntries,
	createAudioEditorSearchEntries,
	flattenAudioEditorSearchMenus,
	normalizeAudioEditorSearchText,
	searchAudioEditorEntries,
} from '../src/common/editor/search.js';

test('search text normalization is deterministic across punctuation and diacritics', () => {
	assert.equal(
		normalizeAudioEditorSearchText('  Über—Café / Straße!  '),
		'uber cafe strasse',
	);
	assert.equal(normalizeAudioEditorSearchText('Tonhöhe_ÄNDERN'), 'tonhohe andern');
	assert.equal(normalizeAudioEditorSearchText(null), '');
});

test('menu flattening inherits disabled state and canonically deduplicates live commands', () => {
	const disabledHandler = () => 'disabled';
	const enabledHandler = () => 'enabled';
	const menus = [
		{
			id: 'edit',
			label: 'Bearbeiten',
			items: [
				{ divider: true },
				{
					id: 'special',
					label: 'Spezial',
					disabled: true,
					disabledReason: 'Select a clip first',
					items: [
						{
							id: 'undo',
							parityActionId: 'action://trackedit/undo',
							label: 'Rückgängig',
							shortcut: 'Ctrl+Z',
							onClick: disabledHandler,
						},
						{
							id: 'inherited-disabled',
							label: 'Inherited disabled',
							onClick: disabledHandler,
						},
					],
				},
			],
		},
		{
			id: 'extra',
			label: 'Extra',
			items: [
				{
					id: 'action://trackedit/undo',
					parityActionId: 'action://trackedit/undo',
					label: 'Undo',
					onClick: enabledHandler,
				},
				{
					id: 'pending-command',
					label: 'Pending command',
					disabled: true,
					disabledReason: 'Not implemented',
				},
				{ id: 'non-command', label: 'No handler' },
			],
		},
	];

	const entries = flattenAudioEditorSearchMenus(menus);
	assert.deepEqual(entries.map(({ commandId }) => commandId), [
		'action://trackedit/undo',
		'inherited-disabled',
		'pending-command',
	]);

	const undo = entries[0];
	assert.equal(undo.disabled, false);
	assert.equal(undo.state, 'enabled');
	assert.equal(undo.handler, enabledHandler);
	assert.equal(undo.sourceOrder, 0);
	assert.deepEqual(undo.breadcrumbs, ['Extra']);
	assert.deepEqual(undo.paths, [
		['Bearbeiten', 'Spezial', 'Rückgängig'],
		['Extra', 'Undo'],
	]);
	assert.ok(undo.terms.includes('Rückgängig'));
	assert.ok(undo.terms.includes('Bearbeiten'));

	const inherited = entries[1];
	assert.equal(inherited.disabled, true);
	assert.equal(inherited.disabledReason, 'Select a clip first');
	assert.equal(inherited.reason, 'Select a clip first');
	assert.equal(inherited.handler, disabledHandler);

	const pending = entries[2];
	assert.equal(pending.disabled, true);
	assert.equal(pending.handler, null);
	assert.deepEqual(searchAudioEditorEntries(entries, 'pending'), [pending]);
});

test('media entries preserve timeline clips and group paired Project Bin records', () => {
	const project = {
		sources: [
			{ id: 'source-ambience', kind: 'audio', name: 'Café ambience.wav' },
			{ id: 'source-camera', kind: 'video', name: 'Interview.mov' },
			{ id: 'source-camera-audio', kind: 'audio', name: 'Interview audio.wav' },
		],
		clips: [
			{ id: 'shared-clip', sourceId: 'source-ambience', kind: 'audio', title: 'Blue ambience' },
			{ id: 'camera-clip', sourceId: 'source-camera', kind: 'video', title: 'Camera angle' },
		],
		tracks: [
			{ id: 'track-atmosphere', type: 'audio', name: 'Atmosphère', clipIds: ['shared-clip'] },
			{ id: 'track-picture', type: 'video', name: 'Picture', clipIds: ['camera-clip'] },
		],
		projectBin: {
			clips: [
				{
					id: 'bin-camera-video', binItemId: 'bin-camera', sourceId: 'source-camera',
					kind: 'video', title: 'Interview take',
				},
				{
					id: 'bin-camera-audio', binItemId: 'bin-camera', sourceId: 'source-camera-audio',
					kind: 'audio', title: 'Interview audio',
				},
				{
					id: 'shared-clip', binItemId: null, sourceId: 'source-ambience',
					kind: 'audio', title: 'Blue ambience bin copy',
				},
			],
		},
	};

	const entries = createAudioEditorMediaSearchEntries(project, { startOrder: 10 });
	assert.deepEqual(entries.map(({ kind, key }) => [kind, key]), [
		['timeline', 'timeline:shared-clip'],
		['timeline', 'timeline:camera-clip'],
		['project-bin', 'project-bin:bin-camera'],
		['project-bin', 'project-bin:shared-clip'],
	]);
	assert.deepEqual(entries.map(({ sourceOrder }) => sourceOrder), [10, 11, 12, 13]);

	const timeline = entries[0];
	assert.ok(timeline.terms.includes('Café ambience.wav'));
	assert.ok(timeline.terms.includes('Atmosphère'));
	assert.ok(timeline.terms.includes('audio'));
	assert.deepEqual(timeline.target, {
		clipId: 'shared-clip',
		trackId: 'track-atmosphere',
		trackIds: ['track-atmosphere'],
	});

	const pairedBin = entries[2];
	assert.equal(pairedBin.label, 'Interview take');
	assert.ok(pairedBin.terms.includes('Interview audio'));
	assert.ok(pairedBin.terms.includes('Interview.mov'));
	assert.ok(pairedBin.terms.includes('Interview audio.wav'));
	assert.ok(pairedBin.terms.includes('audio'));
	assert.ok(pairedBin.terms.includes('video'));
	assert.deepEqual(pairedBin.target, {
		binItemId: 'bin-camera',
		clipId: 'bin-camera-video',
		clipIds: ['bin-camera-video', 'bin-camera-audio'],
	});
	assert.notEqual(entries[0].key, entries[3].key);

	assert.deepEqual(
		searchAudioEditorEntries(entries, 'atmosphere').map(({ key }) => key),
		['timeline:shared-clip'],
	);
	assert.deepEqual(
		searchAudioEditorEntries(entries, 'interview audio').map(({ key }) => key),
		['project-bin:bin-camera'],
	);
});

test('weighted ranking handles natural-language aliases, localized labels, and fuzzy matches', () => {
	const menus = [{
		id: 'effect',
		label: 'Effekt',
		items: [
			{
				id: 'audacity-amplify',
				label: 'Verstärken',
				disabled: true,
				disabledReason: 'Select an audio track',
			},
			{ id: 'louder-notes', label: 'Louder notes', onClick: () => {} },
			{ id: 'audacity-normalize', label: 'Normalisieren', onClick: () => {} },
		],
	}];
	const entries = flattenAudioEditorSearchMenus(menus);

	const naturalLanguage = searchAudioEditorEntries(entries, 'I want to make this louder');
	assert.equal(naturalLanguage[0].commandId, 'audacity-amplify');
	assert.equal(naturalLanguage[0].disabled, true);
	assert.equal(searchAudioEditorEntries(entries, 'lautstarke erhohen')[0].commandId, 'audacity-amplify');
	assert.equal(searchAudioEditorEntries(entries, 'verstarken')[0].commandId, 'audacity-amplify');
	assert.equal(searchAudioEditorEntries(entries, 'amplfy')[0].commandId, 'audacity-amplify');
});

test('search ranking is stable, token aware, and hard-limited to fifty results', () => {
	const entries = [
		entry('exact', 'Blue ambience', 4, ['Blue ambience']),
		entry('prefix', 'Blue ambience extended', 1, ['Blue ambience extended']),
		entry('token', 'Blue Café Ambience', 2, ['Blue Café Ambience']),
		entry('substring', 'Deepblue ambience', 0, ['Deepblue ambience']),
		entry('late', 'Match later', 9, ['match']),
		entry('early', 'Match early', 5, ['match']),
	];
	assert.deepEqual(
		searchAudioEditorEntries(entries, 'blue ambience').map(({ key }) => key),
		['exact', 'prefix', 'token', 'substring'],
	);
	assert.deepEqual(
		searchAudioEditorEntries(entries, 'match').map(({ key }) => key),
		['early', 'late'],
	);

	const many = Array.from({ length: 60 }, (_, index) => entry(
		`command-${index}`,
		`Match command ${index}`,
		index,
	));
	const results = searchAudioEditorEntries(many, 'match', { limit: 100 });
	assert.equal(results.length, AUDIO_EDITOR_SEARCH_RESULT_LIMIT);
	assert.equal(results[0].key, 'command-0');
	assert.equal(results.at(-1).key, 'command-49');
	assert.deepEqual(searchAudioEditorEntries(many, '', { limit: 3 }).map(({ key }) => key), [
		'command-0', 'command-1', 'command-2',
	]);
});

test('the combined model keeps commands, timeline clips, and Project Bin items distinct', () => {
	const entries = createAudioEditorSearchEntries({
		menus: [{ id: 'file', label: 'File', items: [{ id: 'open', label: 'Open', onClick: () => {} }] }],
		project: {
			sources: [{ id: 'source', name: 'take.wav' }],
			clips: [{ id: 'clip', sourceId: 'source', title: 'Take' }],
			tracks: [{ id: 'track', type: 'audio', name: 'Track', clipIds: ['clip'] }],
			projectBin: { clips: [{ id: 'bin', sourceId: 'source', title: 'Take' }] },
		},
	});
	assert.deepEqual(entries.map(({ kind }) => kind), ['command', 'timeline', 'project-bin']);
	assert.deepEqual(entries.map(({ sourceOrder }) => sourceOrder), [0, 1, 2]);
	assert.deepEqual(searchAudioEditorEntries(entries, 'Take').map(({ kind }) => kind), [
		'timeline', 'project-bin',
	]);
});

test('search model creation is safe without an active or complete project', () => {
	assert.deepEqual(createAudioEditorSearchEntries(), []);
	assert.deepEqual(createAudioEditorMediaSearchEntries(null), []);
	assert.deepEqual(createAudioEditorMediaSearchEntries({
		sources: null,
		clips: null,
		tracks: null,
		projectBin: null,
	}), []);
});

function entry(key, label, sourceOrder, terms = [label]) {
	return {
		kind: 'command',
		key,
		label,
		terms,
		aliases: [],
		disabled: false,
		sourceOrder,
	};
}
