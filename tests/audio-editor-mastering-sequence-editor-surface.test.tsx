/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	createSoundscaperProductionApplicationMenuItems,
	type SoundscaperProductionSurface,
} from '../src/common/editor/ui/soundscaper-production-application-menu.ts';
import {
	createSoundscaperProductionDialogModel,
} from '../src/common/editor/ui/soundscaper-production-dialog-model.ts';
import SoundscaperMasteringSequenceEditor, {
	masteringSequenceAddOperation,
} from '../src/common/editor/ui/dialogs/SoundscaperMasteringSequenceEditor.tsx';
import {
	createDocumentMasteringSequenceSnapshot,
} from '../src/common/editor/controller/document-mastering-sequence-snapshot.ts';
import {
	SOUNDSCAPER_PRODUCTION_COPY,
} from '../src/common/editor/ui/soundscaper-production-copy.ts';
import {
	executeSoundscaperProductionOperation,
	soundscaperProductionSurface,
} from '../src/common/editor/ui/workspace/useSoundscaperProductionWorkspace.ts';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

const NOW = '2026-08-18T00:00:00.000Z';
const CAPABILITIES = Object.freeze({
	audioAutomation: true, audioMixerGraph: true, audioEffects: true,
	audioAnalysis: true, masteringSequences: true,
});

function albumProject(entries: readonly unknown[] = [{ id: 'e1', annotationId: 'r-one' }]) {
	const base = createSoundscaperProject({
		id: 'album', title: 'Album', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
	} as never);
	const sequenceId = base.primarySequenceId;
	return createSoundscaperProject({
		id: 'album', title: 'Album', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
		primarySequenceId: sequenceId,
		sequences: base.sequences,
		timelineAnnotations: [{
			id: 'r-one', sequenceId, name: 'One', kind: 'region', anchor: 'sample',
			startFrame: 0, endFrame: 480_000, color: 'auto', batchId: null, opaqueExtensions: {},
		}],
		masteringSequences: [{ id: 'album-order', sequenceId, name: 'Album order', entries }],
	} as never);
}

test('the editing surface is reached from a menu and only where it can be used', () => {
	const calls: unknown[][] = [];
	const actions = {
		open: (surface: SoundscaperProductionSurface) => calls.push(['open', surface]),
		setAutomationMode: () => undefined,
		freeze: () => undefined,
	};
	const items = createSoundscaperProductionApplicationMenuItems({
		productId: 'soundscaper', capabilities: CAPABILITIES, project: albumProject(),
		selectedTrackId: 'a1', editingBlocked: false,
	}, actions);

	const entry = items.tools.find(({ id }) => id === 'soundscaper-mastering-sequences');
	assert.equal(entry?.label, 'Mastering sequences…');
	assert.equal(entry?.disabled, false);
	entry?.onClick?.();
	assert.deepEqual(calls, [['open', 'mastering-sequences']]);

	// The entry stays visible and disabled on a document that cannot hold one,
	// rather than vanishing and reading as a feature that does not exist. V21 is
	// the case that matters: it carries the production authority and still has
	// nowhere to put a sequence.
	for (const schemaVersion of [20, 21]) {
		const wrongSchema = createSoundscaperProductionApplicationMenuItems({
			productId: 'soundscaper', capabilities: CAPABILITIES,
			project: { ...albumProject(), schemaVersion }, editingBlocked: false,
		}, actions).tools.find(({ id }) => id === 'soundscaper-mastering-sequences');
		assert.equal(wrongSchema?.disabled, true, `schema ${schemaVersion}`);
	}

	assert.equal(
		createSoundscaperProductionApplicationMenuItems({
			productId: 'soundscaper', capabilities: {}, project: albumProject(), editingBlocked: false,
		}, actions).tools.some(({ id }) => id === 'soundscaper-mastering-sequences'),
		false,
		'a product without the capability offers no entry at all',
	);
	assert.equal(soundscaperProductionSurface('soundscaper-production:mastering-sequences'), 'mastering-sequences');
});

test('the dialog model carries the sequences and refuses a document that cannot hold them', () => {
	const model = createSoundscaperProductionDialogModel({
		productId: 'soundscaper', capabilities: CAPABILITIES, project: albumProject(),
		requestedSurface: 'mastering-sequences',
	});
	assert.equal(model.surface, 'mastering-sequences');
	assert.ok(model.surfaces.includes('mastering-sequences'));
	assert.deepEqual(model.masteringSequences.map(({ name }) => name), ['Album order']);
	assert.deepEqual(model.masteringRegions.map(({ id }) => id), ['r-one']);
	assert.equal(model.operationsBlocked, false);

	const wrongSchema = createSoundscaperProductionDialogModel({
		productId: 'soundscaper', capabilities: CAPABILITIES,
		project: { ...albumProject(), schemaVersion: 21 },
		requestedSurface: 'mastering-sequences',
	});
	assert.equal(wrongSchema.blockReason, 'wrong-schema');
});

test('the editor renders the sequence, its entries, and the regions it can add', () => {
	const snapshot = createDocumentMasteringSequenceSnapshot(albumProject());
	const markup = renderToStaticMarkup(<SoundscaperMasteringSequenceEditor
		copy={SOUNDSCAPER_PRODUCTION_COPY}
		disabled={false}
		sequences={snapshot.sequences}
		regions={snapshot.regions}
		primarySequenceId={snapshot.primarySequenceId}
		createId={() => 'generated'}
		onOperation={() => undefined}
	/>);

	assert.match(markup, /Album order/u);
	assert.match(markup, /Delivered length: 480000/u);
	assert.match(markup, /Gap before \(frames\)/u);
	assert.doesNotMatch(markup, /cannot be delivered/u);
});

test('the title field holds the override, not the region name it falls back to', () => {
	// The snapshot's title is the effective one, so filling the input with it and
	// submitting on every Apply pinned the region's current name as an override —
	// an entry whose gap the operator nudged silently stopped following its
	// region's name, and the delivery, its cues and its report kept delivering the
	// old one with no visible reason.
	const snapshot = createDocumentMasteringSequenceSnapshot(albumProject());
	const [entry] = snapshot.sequences[0].entries;
	assert.equal(entry.titleOverride, null, 'the fixture entry states no title of its own');
	assert.equal(entry.title, 'One', 'but its effective title is the region name');

	const markup = renderToStaticMarkup(<SoundscaperMasteringSequenceEditor
		copy={SOUNDSCAPER_PRODUCTION_COPY}
		disabled={false}
		sequences={snapshot.sequences}
		regions={snapshot.regions}
		primarySequenceId={snapshot.primarySequenceId}
		createId={() => 'generated'}
		onOperation={() => undefined}
	/>);

	const titleInput = markup.match(/<input[^>]*name="title"[^>]*>/u)?.[0] ?? '';
	assert.match(titleInput, /placeholder="One"/u, 'the region name is shown as the placeholder it is');
	assert.match(titleInput, /value=""/u,
		'and the field itself is empty, so Apply stores no override the operator never asked for');
});

test('an entry form refreshes when the document updates the same entry id', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const initial = createDocumentMasteringSequenceSnapshot(albumProject());
	const entry = initial.sequences[0]!.entries[0]!;
	const updated = Object.freeze({
		...initial,
		sequences: Object.freeze([Object.freeze({
			...initial.sequences[0]!,
			entries: Object.freeze([Object.freeze({
				...entry,
				title: 'Document title',
				titleOverride: 'Document title',
				gapBeforeFrames: 37,
			})]),
		})]),
	});
	const props = {
		copy: SOUNDSCAPER_PRODUCTION_COPY,
		disabled: false,
		regions: initial.regions,
		primarySequenceId: initial.primarySequenceId,
		createId: () => 'generated',
		onOperation: () => undefined,
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SoundscaperMasteringSequenceEditor
			{...props}
			sequences={initial.sequences}
		/>));
		const staleTitle = namedControl(dom.container, 'title');
		staleTitle.value = 'Unsubmitted local title';

		await act(async () => root.render(<SoundscaperMasteringSequenceEditor
			{...props}
			sequences={updated.sequences}
		/>));

		assert.equal(namedControl(dom.container, 'title').value, 'Document title',
			'a same-id document update must not leave an old uncontrolled value ready to overwrite it');
		assert.notEqual(namedControl(dom.container, 'title'), staleTitle,
			'the updated document owns a fresh form rather than the stale same-id form');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function namedControl(root: ReactTestElement, name: string): ReactTestElement {
	const pending = [...root.childNodes];
	while (pending.length > 0) {
		const node = pending.shift()!;
		if (node instanceof ReactTestElement && node.name === name) return node;
		pending.unshift(...node.childNodes);
	}
	throw new Error(`Missing mounted control ${name}`);
}

test('the New sequence button states the sequence the new one orders', () => {
	// A mastering sequence names the timeline sequence it orders, and the panel is
	// the only place that creates one. Emitting the add without it made the button
	// fail on every press: the command refused before the document was touched, so
	// no sequence could be created from the product at all.
	const project = albumProject();
	const snapshot = createDocumentMasteringSequenceSnapshot(project);
	assert.equal(snapshot.primarySequenceId, project.primarySequenceId);

	const operation = masteringSequenceAddOperation(
		snapshot.primarySequenceId, 'generated', SOUNDSCAPER_PRODUCTION_COPY.newMasteringSequence,
	);
	const created = applySoundscaperProjectCommand(project, operation as never, { now: NOW });
	assert.equal(created.masteringSequences.length, 2);
	assert.equal(
		created.masteringSequences.find(({ id }) => id === 'generated')?.sequenceId,
		project.primarySequenceId,
	);

	// A document with no sequence to order cannot create one, and the button says so.
	const markup = renderToStaticMarkup(<SoundscaperMasteringSequenceEditor
		copy={SOUNDSCAPER_PRODUCTION_COPY}
		disabled={false}
		sequences={snapshot.sequences}
		regions={snapshot.regions}
		primarySequenceId=""
		createId={() => 'generated'}
		onOperation={() => undefined}
	/>);
	assert.match(markup, /<button type="button" disabled=""[^>]*>New sequence<\/button>/u);
});

test('an undeliverable sequence shows its reason instead of hiding', () => {
	const snapshot = createDocumentMasteringSequenceSnapshot(
		albumProject([{ id: 'e1', annotationId: 'gone' }]),
	);
	const markup = renderToStaticMarkup(<SoundscaperMasteringSequenceEditor
		copy={SOUNDSCAPER_PRODUCTION_COPY}
		disabled={false}
		sequences={snapshot.sequences}
		regions={snapshot.regions}
		primarySequenceId={snapshot.primarySequenceId}
		createId={() => 'generated'}
		onOperation={() => undefined}
	/>);

	assert.match(markup, /cannot be delivered/u);
	assert.match(markup, /Delivered length: —/u);
	assert.match(markup, /Region unavailable/u, 'the entry is still listed, with its problem');
});

test('an empty project says what to do rather than showing an empty editor', () => {
	const markup = renderToStaticMarkup(<SoundscaperMasteringSequenceEditor
		copy={SOUNDSCAPER_PRODUCTION_COPY}
		disabled={false}
		sequences={[]}
		regions={[]}
		primarySequenceId="main-sequence"
		createId={() => 'generated'}
		onOperation={() => undefined}
	/>);
	assert.match(markup, /no mastering sequence yet/u);
});

test('editor operations are the ordinary commands, committed through the ordinary path', () => {
	// A sequence built here and one built by any other caller are the same
	// document, undo the same way, and are refused the same way.
	const committed: unknown[] = [];
	const controller = {
		actions: { edit: { commit: (operation: unknown) => { committed.push(operation); return operation; } } },
	};
	for (const operation of [
		{ type: 'mastering-sequence/add', sequence: { id: 's', name: 'S', entries: [] } },
		{ type: 'mastering-sequence/entry-reorder', sequenceId: 's', entryId: 'e1', toIndex: 0 },
		{ type: 'mastering-sequence/entry-timing', sequenceId: 's', entryId: 'e1', gapBeforeFrames: 4 },
	] as const) {
		executeSoundscaperProductionOperation(controller as never, operation as never, () => undefined);
	}
	assert.deepEqual(committed.map((operation) => (operation as { type: string }).type), [
		'mastering-sequence/add',
		'mastering-sequence/entry-reorder',
		'mastering-sequence/entry-timing',
	]);
});
