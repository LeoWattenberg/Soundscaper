/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { TimelineAnnotationLayer } from '../src/common/editor/ui/timeline/TimelineAnnotationLayer.jsx';
import {
	primarySequenceSelectionIds,
	TimelineAnnotationLaneActions,
} from '../src/common/editor/ui/timeline/TimelineAnnotationLaneActions.jsx';
import { completeTimelineAnnotationCreation } from '../src/common/editor/ui/timeline/useTimelineAnnotationCreateFeedback.js';
import {
	completeTimelineAnnotationNavigation,
	TimelineAnnotationPanel,
} from '../src/common/editor/ui/timeline/TimelineAnnotationPanel.jsx';
import {
	timelineAnnotationCreateKind,
	timelineAnnotationsAvailable,
} from '../src/common/editor/ui/timeline/timeline-annotation-ui-model.ts';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import {
	WORKSPACE_PANEL_IDS,
	workspacePanelLabel,
} from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { DEFAULT_PANELS } from '../src/common/editor/workspace-layout-defaults.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
} from '../src/common/editor/project-schema-version.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import type { RuntimeTimelineAnnotationProjection } from '../src/common/editor/runtime-timeline-annotation-projection.ts';

const REGION: RuntimeTimelineAnnotationProjection = Object.freeze({
	id: 'verse', sequenceId: 'main', name: 'Verse', color: 'blue', batchId: null,
	opaqueExtensions: {}, kind: 'region', anchor: 'sample', startFrame: 24_000, endFrame: 48_000,
	timelineStartFrame: 24_000, timelineEndFrame: 48_000, durationFrames: 24_000,
	coordinateDomain: 'resolved-samples',
});

test('timeline annotation layer renders roving multi-selection semantics and resize handles', () => {
	const markup = render(<TimelineAnnotationLayer
		controller={controllerFixture()}
		project={projectFixture()}
		annotations={[REGION]}
		selectedAnnotationId="verse"
		copy={ENGLISH_COPY}
		locale="en"
		pixelsPerSecond={120}
		sampleRate={48_000}
		scrollX={0}
		viewportWidth={1_000}
		blocked={false}
		run={(action: () => unknown) => action()}
		createAnnotation={createAnnotationFixture}
	/>);

	assert.match(markup, /data-timeline-annotation-layer="true"/u);
	assert.match(markup, /role="listbox"/u);
	assert.match(markup, /aria-multiselectable="true"/u);
	assert.match(markup, /role="option"/u);
	assert.match(markup, /aria-selected="true"/u);
	assert.match(markup, /data-annotation-edge="start"/u);
	assert.match(markup, /data-annotation-edge="end"/u);
	assert.match(markup, /Verse, Region, 0\.500–1\.000 s/u);
	assert.doesNotMatch(markup, /data-timeline-annotation-create-actions/u);
	assert.doesNotMatch(markup, /<button/u);
	assert.match(markup, /<\/div><span id="[^"]+" class="kw-audio-editor-sr-only" role="status"/u);
});

test('ruler-corner lane actions expose pointer create and batch parity outside annotation content', () => {
	const markup = render(<TimelineAnnotationLaneActions
		controller={controllerFixture()}
		project={projectFixture()}
		annotations={[REGION]}
		copy={ENGLISH_COPY}
		blocked={false}
		run={(action: () => unknown) => action()}
		createAnnotation={createAnnotationFixture}
		focusCreated={() => undefined}
	/>);
	const blockedMarkup = render(<TimelineAnnotationLaneActions
		controller={controllerFixture()}
		project={projectFixture()}
		annotations={[REGION]}
		copy={ENGLISH_COPY}
		blocked
		run={(action: () => unknown) => action()}
		createAnnotation={createAnnotationFixture}
		focusCreated={() => undefined}
	/>);

	assert.match(markup, /data-timeline-annotation-create-actions="true"/u);
	for (const name of [
		'Add marker at playhead', 'Add region from selection',
		'Batch selected annotations', 'Remove selected annotations from batch',
	]) assert.match(markup, new RegExp(`aria-label="${name}"`, 'u'));
	assert.equal(blockedMarkup.match(/disabled=""/gu)?.length, 4);
	assert.match(markup, /<\/div><span id="[^"]+" class="kw-audio-editor-sr-only" role="status"/u);
});

test('ruler-corner batch actions ignore selected annotations outside the primary sequence', () => {
	const foreign = Object.freeze({ ...REGION, id: 'foreign', sequenceId: 'secondary' });
	const project = {
		...projectFixture(),
		selection: { ...projectFixture().selection, annotationIds: ['verse', 'foreign'] },
	};
	const markup = render(<TimelineAnnotationLaneActions
		controller={controllerFixture()}
		project={project}
		annotations={[REGION, foreign]}
		copy={ENGLISH_COPY}
		blocked={false}
		run={(action: () => unknown) => action()}
		createAnnotation={createAnnotationFixture}
		focusCreated={() => undefined}
	/>);

	assert.deepEqual(
		primarySequenceSelectionIds([REGION, foreign], 'main', ['verse', 'foreign']),
		['verse'],
	);
	assert.match(markup, /aria-label="Batch selected annotations"[^>]*disabled=""/u);
	assert.doesNotMatch(markup, /aria-label="Remove selected annotations from batch"[^>]*disabled=""/u);
});

test('annotation creation feedback is success-only, announces the created row, then focuses it', () => {
	const statuses: string[] = [];
	const focused: string[] = [];
	const scheduled: Array<() => void> = [];
	const input = {
		snapshot: { timelineAnnotations: [REGION] },
		copy: ENGLISH_COPY,
		locale: 'en',
		sampleRate: 48_000,
		setStatus: (status: string) => statuses.push(status),
		focusCreated: (id: string) => focused.push(id),
		schedule: (callback: () => void) => {
			scheduled.push(callback);
			return 0;
		},
	};

	assert.equal(completeTimelineAnnotationCreation(null, input), null);
	assert.equal(completeTimelineAnnotationCreation('missing', input), 'missing');
	assert.deepEqual(statuses, []);
	assert.deepEqual(focused, []);
	assert.equal(completeTimelineAnnotationCreation('verse', input), 'verse');
	assert.deepEqual(statuses, ['Created Region: Verse, 0.500–1.000 s']);
	assert.deepEqual(focused, []);
	scheduled[0]?.();
	assert.deepEqual(focused, ['verse']);
});

test('corner, panel, layer, and ruler creation entries share the accessible completion path', () => {
	const directory = new URL('../src/common/editor/ui/timeline/', import.meta.url);
	const entries = [
		['TimelineAnnotationLaneActions.jsx', 2],
		['TimelineAnnotationPanel.jsx', 3],
		['TimelineAnnotationLayer.jsx', 1],
		['TimelineWorkspaceView.jsx', 1],
	] as const;
	for (const [file, expected] of entries) {
		const source = readFileSync(new URL(file, directory), 'utf8');
		assert.equal(source.match(/createAnnotation\(/gu)?.length, expected, file);
	}
});

test('short annotation regions retain two non-overlapping edge hit targets', () => {
	const shortRegion = Object.freeze({
		...REGION,
		id: 'short',
		startFrame: 24_000,
		endFrame: 24_001,
		timelineStartFrame: 24_000,
		timelineEndFrame: 24_001,
		durationFrames: 1,
	});
	const markup = render(<TimelineAnnotationLayer
		controller={controllerFixture()}
		project={{ ...projectFixture(), selection: { ...projectFixture().selection, annotationIds: ['short'] } }}
		annotations={[shortRegion]}
		selectedAnnotationId="short"
		copy={ENGLISH_COPY}
		locale="en"
		pixelsPerSecond={1}
		sampleRate={48_000}
		scrollX={0}
		viewportWidth={1_000}
		blocked={false}
		run={(action: () => unknown) => action()}
		createAnnotation={createAnnotationFixture}
	/>);

	// 12.5px is the ruler's 12px content inset plus the half pixel the region
	// starts at, so the handles sit under the ticks the region names.
	assert.match(markup, /style="left:12\.5px;width:16px"/u);
	assert.equal(markup.match(/data-annotation-edge="(?:start|end)"/gu)?.length, 2);
});

test('shown annotation visuals occupy a dedicated lane below the unblocked ruler surface', () => {
	const css = readFileSync(new URL(
		'../src/common/editor/ui/audio-editor-design-system/19-timeline-annotations.css', import.meta.url,
	), 'utf8');
	const workspace = readFileSync(new URL(
		'../src/common/editor/ui/timeline/TimelineWorkspaceView.jsx', import.meta.url,
	), 'utf8');
	const rulerCanvas = readFileSync(new URL(
		'../src/common/editor/ui/timeline/TimelineRulerCanvas.jsx', import.meta.url,
	), 'utf8');
	const cornerIndex = workspace.indexOf('className="audio-editor-ruler-corner"');
	const actionsIndex = workspace.indexOf('<TimelineAnnotationLaneActions', cornerIndex);
	const viewportIndex = workspace.indexOf('className="audio-editor-ruler-viewport"', actionsIndex);
	assert.match(css, /data-show-markers='true'[^}]*audio-editor-ruler-viewport[^}]*\{\s*height: 66px;/u);
	assert.match(css, /audio-editor-timeline-annotations\s*\{[^}]*top: 33px;/u);
	assert.match(css, /audio-editor-timeline-annotation\s*\{[^}]*min-width: 16px;/u);
	assert.ok(cornerIndex >= 0 && cornerIndex < actionsIndex && actionsIndex < viewportIndex);
	// The three ruler variants share one prop bag, so the lane is reserved once
	// and every variant spreads it.
	assert.match(rulerCanvas, /height: markerLaneVisible \? TIMELINE_RULER_HEIGHT_WITH_ANNOTATIONS : undefined,/u);
	assert.equal(rulerCanvas.match(/\{\.\.\.shared\}/gu)?.length, 3, 'every ruler variant reserves the annotation lane');
	assert.match(workspace, /<TimelineRulerCanvas/u);
	assert.match(workspace, /\{markerLaneVisible && <TimelineAnnotationLayer/u);
});

test('annotation list exposes equivalent named editing fields and native workflow actions', () => {
	const markup = render(<TimelineAnnotationPanel
		controller={controllerFixture()}
		project={projectFixture()}
		annotations={[REGION]}
		selectedAnnotationId="verse"
		copy={ENGLISH_COPY}
		locale="en"
		sampleRate={48_000}
		blocked={false}
		run={(action: () => unknown) => action()}
		createAnnotation={createAnnotationFixture}
	/>);

	assert.match(markup, /data-timeline-annotation-panel="true"/u);
	assert.match(markup, />Add marker at playhead</u);
	assert.match(markup, />Add region from selection</u);
	assert.match(markup, /aria-label="Marker and region list"/u);
	assert.match(markup, />Start sample<span class="audio-editor-timecode-input" data-timecode-input="samples"/u);
	assert.match(markup, /role="group" aria-label="Start sample"/u);
	assert.match(markup, />End sample<span class="audio-editor-timecode-input" data-timecode-input="samples"/u);
	assert.doesNotMatch(markup, /defaultValue/u);
	assert.match(markup, />Batch selected annotations</u);
	assert.match(markup, /role="status"/u);
});

test('blocked annotation surfaces retain roving focus while exposing disabled mutation state', () => {
	const layerMarkup = render(<TimelineAnnotationLayer
		controller={controllerFixture()}
		project={projectFixture()}
		annotations={[REGION]}
		selectedAnnotationId="verse"
		copy={ENGLISH_COPY}
		locale="en"
		pixelsPerSecond={120}
		sampleRate={48_000}
		scrollX={0}
		viewportWidth={1_000}
		blocked
		run={(action: () => unknown) => action()}
		createAnnotation={createAnnotationFixture}
	/>);
	const panelMarkup = render(<TimelineAnnotationPanel
		controller={controllerFixture()}
		project={projectFixture()}
		annotations={[REGION]}
		selectedAnnotationId="verse"
		copy={ENGLISH_COPY}
		locale="en"
		sampleRate={48_000}
		blocked
		run={(action: () => unknown) => action()}
		createAnnotation={createAnnotationFixture}
	/>);

	assert.match(layerMarkup, /role="option"[^>]*aria-disabled="true"[^>]*tabindex="0"/u);
	assert.match(panelMarkup, /class="audio-editor-timeline-annotation-list__item"[^>]*aria-disabled="true"[^>]*tabindex="0"/u);
	assert.doesNotMatch(panelMarkup, /audio-editor-timeline-annotation-list__item"[^>]*\sdisabled=/u);
	assert.match(panelMarkup, />Name<input disabled=""/u);
	assert.match(panelMarkup, />Previous annotation<\/button>/u);
});

test('navigation completion focuses, reveals, and announces targets for editable and read-only action results', () => {
	for (const mode of ['editable', 'read-only']) {
		const calls: string[] = [];
		const statuses: string[] = [];
		const item = {
			focus: () => calls.push(`${mode}:focus`),
			scrollIntoView: () => calls.push(`${mode}:scroll`),
		};
		const result = completeTimelineAnnotationNavigation(
			REGION,
			[{ id: 'verse', timingLabel: '0.500–1.000 s' }],
			ENGLISH_COPY,
			new Map([['verse', item]]),
			(status: string) => statuses.push(status),
			(callback: () => void) => {
				callback();
				return 0;
			},
		);
		assert.equal(result, 'verse');
		assert.deepEqual(calls, [`${mode}:focus`, `${mode}:scroll`]);
		assert.deepEqual(statuses, ['Verse, Region, 0.500–1.000 s']);
	}
});

test('cap-scale selection renders one editor and keeps visual-lane controls linear', () => {
	const annotations = Array.from({ length: 4_096 }, (_, index) => marker(`annotation-${index}`, index * 48_000));
	const annotationIds = annotations.map(({ id }) => id);
	const project = {
		...projectFixture(),
		selection: { ...projectFixture().selection, annotationIds },
	};
	const panelMarkup = render(<TimelineAnnotationPanel
		controller={controllerFixture()}
		project={project}
		annotations={annotations}
		selectedAnnotationId="annotation-2048"
		copy={ENGLISH_COPY}
		locale="en"
		sampleRate={48_000}
		blocked={false}
		run={(action: () => unknown) => action()}
		createAnnotation={createAnnotationFixture}
	/>);
	const layerMarkup = render(<TimelineAnnotationLayer
		controller={controllerFixture()}
		project={project}
		annotations={annotations}
		selectedAnnotationId="annotation-2048"
		copy={ENGLISH_COPY}
		locale="en"
		pixelsPerSecond={100}
		sampleRate={48_000}
		scrollX={0}
		viewportWidth={100}
		blocked={false}
		run={(action: () => unknown) => action()}
		createAnnotation={createAnnotationFixture}
	/>);

	assert.equal(panelMarkup.match(/audio-editor-timeline-annotation-list__editor"/gu)?.length, 1);
	assert.ok((panelMarkup.match(/<(?:button|input|select)\b/gu)?.length || 0) <= 4_110);
	assert.ok((layerMarkup.match(/role="option"/gu)?.length || 0) <= 3);
});

test('one creation shortcut picks its kind from the time selection and leaves M and R alone', () => {
	const empty = { startFrame: 24_000, endFrame: 24_000 };
	const spanning = { startFrame: 24_000, endFrame: 48_000 };
	const shiftM = { key: 'M', shiftKey: true };

	assert.equal(timelineAnnotationCreateKind(shiftM, empty), 'marker');
	assert.equal(timelineAnnotationCreateKind(shiftM, null), 'marker');
	assert.equal(timelineAnnotationCreateKind(shiftM, spanning), 'region');
	assert.equal(timelineAnnotationCreateKind({ key: 'm', shiftKey: true }, spanning), 'region');
	// Bare M stays available for track mute and R for recording, and modified
	// Shift+M chords belong to the host rather than to annotations.
	assert.equal(timelineAnnotationCreateKind({ key: 'm', shiftKey: false }, spanning), null);
	assert.equal(timelineAnnotationCreateKind({ key: 'r', shiftKey: false }, spanning), null);
	assert.equal(timelineAnnotationCreateKind({ key: 'r', shiftKey: true }, spanning), null);
	for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
		assert.equal(timelineAnnotationCreateKind({ ...shiftM, [modifier]: true }, spanning), null, modifier);
	}
	assert.equal(
		ENGLISH_COPY.timelineAnnotationKeyboardHelp.startsWith('Shift+M: marker, or region when time is selected'),
		true,
	);
});

test('the marker list is a dockable workspace panel that stays closed until it is opened', () => {
	assert.ok(WORKSPACE_PANEL_IDS.includes('markers'));
	assert.deepEqual(DEFAULT_PANELS.markers, { visible: false, dock: 'right', order: 5, size: 360 });
	assert.equal(workspacePanelLabel(ENGLISH_COPY, 'markers'), 'Markers');

	const markup = render(<WorkspacePanelContent
		{...{
			panelId: 'markers',
			controller: controllerFixture(),
			snapshot: annotationSnapshotFixture(),
			copy: ENGLISH_COPY,
			locale: 'en',
			run: (action: () => unknown) => action(),
			fileService: null,
			playbackMeterSettings: null,
			showArmControls: false,
			displayAudioSupported: false,
			onOpenEffects: () => undefined,
			effectsPanelTarget: null,
			onEffectWindowChange: () => undefined,
			blocked: false,
		}}
	/>);

	assert.match(markup, /class="kw-audio-editor__markers-panel"/u);
	assert.match(markup, /data-timeline-annotation-panel="true"/u);
	assert.match(markup, />Verse</u);
	assert.match(markup, /data-timeline-annotation-panel-create-status="true"/u);
});

test('the marker panel stays out of the dock until the project and product carry annotations', () => {
	const snapshot = annotationSnapshotFixture();
	assert.equal(timelineAnnotationsAvailable(snapshot), true);
	assert.equal(timelineAnnotationsAvailable({
		...snapshot,
		project: { ...snapshot.project, schemaFamily: 'soundscaper', schemaVersion: 1 },
	}), true);
	assert.equal(timelineAnnotationsAvailable(null), false);
	assert.equal(timelineAnnotationsAvailable({ ...snapshot, capabilities: { timelineAnnotations: false } }), false);
	assert.equal(timelineAnnotationsAvailable({
		...snapshot,
		project: { ...snapshot.project, schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION - 1 },
	}), false);
	assert.equal(timelineAnnotationsAvailable({
		...snapshot,
		project: { ...snapshot.project, timelineAnnotations: undefined },
	}), false);
	let annotationReads = 0;
	for (const identity of [
		{ schemaVersion: 19 },
		{ schemaFamily: 'soundscaper', schemaVersion: 2 },
	]) {
		assert.equal(timelineAnnotationsAvailable({
			...snapshot,
			project: {
				...identity,
				get timelineAnnotations(): never {
					annotationReads += 1;
					throw new Error('foreign timelineAnnotations was traversed');
				},
			},
		}), false);
	}
	assert.equal(annotationReads, 0);
});

test('the ruler-corner marker actions stay hidden until Show markers is enabled', () => {
	const workspace = readFileSync(new URL(
		'../src/common/editor/ui/timeline/TimelineWorkspaceView.jsx', import.meta.url,
	), 'utf8');

	assert.match(workspace, /\{markerLaneVisible && <TimelineAnnotationLaneActions/u);
	assert.equal(workspace.match(/<TimelineAnnotationLaneActions/gu)?.length, 1);
});

test('the Add Track flyout offers Show markers only where the project carries annotations', () => {
	const flyouts = readFileSync(new URL(
		'../src/common/editor/ui/timeline/TimelineFlyouts.jsx', import.meta.url,
	), 'utf8');
	const row = flyouts.match(/\{markersAvailable && <div className="add-track-flyout__row" role="none">[\S\s]*?<\/div>\}/u)?.[0];

	assert.ok(row, 'the marker toggle is gated on annotation availability');
	// The flyout body is a menu, so the toggle is a menuitemcheckbox that the
	// arrow-key rotation can reach; a bare input inside role="menu" was both
	// invalid and unreachable, since Tab closes the flyout.
	assert.match(row, /role="menuitemcheckbox"/u);
	assert.match(row, /aria-checked=\{showMarkers\}/u);
	assert.match(row, /onClick=\{onToggleMarkers\}/u);
	assert.match(row, /\{copy\.showMarkers\}/u);
	// The marker toggle is a view preference, not an edit, so it stays usable
	// while mutations are blocked — unlike the track-type options above it.
	assert.doesNotMatch(row, /disabled=/u);
	assert.equal(ENGLISH_COPY.showMarkers, 'Show markers');
});

function annotationSnapshotFixture() {
	return {
		capabilities: { timelineAnnotations: true },
		project: {
			...projectFixture(),
			sampleRate: 48_000,
			schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
			timelineAnnotations: [REGION],
		},
		timelineAnnotations: [REGION],
		selectedAnnotationId: 'verse',
	};
}

function render(node: ReactNode): string {
	return renderToStaticMarkup(React.createElement(React.Fragment, null, node));
}

function projectFixture() {
	return {
		primarySequenceId: 'main',
		selection: {
			startFrame: 24_000, endFrame: 48_000, trackIds: [], clipIds: [], annotationIds: ['verse'],
		},
	};
}

function controllerFixture() {
	const callable = () => undefined;
	return {
		actions: {
			timelineAnnotations: new Proxy<Record<string, () => undefined>>({}, { get: () => callable }),
		},
	};
}

function createAnnotationFixture(): null {
	return null;
}

function marker(id: string, positionFrame: number): RuntimeTimelineAnnotationProjection {
	return Object.freeze({
		id, sequenceId: 'main', name: id, color: 'auto', batchId: null, opaqueExtensions: {},
		kind: 'marker', anchor: 'sample', positionFrame,
		timelineStartFrame: positionFrame, timelineEndFrame: positionFrame,
		durationFrames: 0, coordinateDomain: 'resolved-samples',
	});
}
