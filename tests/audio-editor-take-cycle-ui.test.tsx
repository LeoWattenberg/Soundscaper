/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TakeCycleRecoveryDialog from '../src/common/editor/ui/dialogs/TakeCycleRecoveryDialog.tsx';
import {
	createTakeCycleRecordingMenuItems,
	selectTakeCycleStartAdmission,
} from '../src/common/editor/ui/take-cycle-recording-menu.ts';
import { CANONICAL_EXTRA_COPY_BY_LOCALE } from '../src/common/i18n/canonical-extras.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

const PENDING = Object.freeze({
	kind: 'take-cycle-pending-open-recovery' as const,
	projectId: 'project',
	publicationGeneration: 7,
	recoveryToken: `take-cycle-open-recovery-v1:${'a'.repeat(64)}`,
	draftCount: 2,
	requiresDecision: true as const,
});

test('record menu admits only an exact Soundscaper routed loop capture', () => {
	const snapshot = editableSnapshot();
	assert.deepEqual(selectTakeCycleStartAdmission(snapshot), { allowed: true, reason: null });
	const calls: string[] = [];
	const items = createTakeCycleRecordingMenuItems({
		snapshot,
		copy: ENGLISH_COPY,
		start: () => { calls.push('start'); },
		openRecovery: () => { calls.push('recover'); },
	});
	assert.deepEqual(items.map(({ id, label, disabled }) => ({ id, label, disabled })), [{
		id: 'record-loop-into-takes', label: 'Record loop into takes', disabled: false,
	}]);
	items[0]?.onClick();
	assert.deepEqual(calls, ['start']);

	for (const [label, update, reason] of [
		['Framescaper', { productId: 'framescaper' }, 'product'],
		['pending recovery', { takeCycleRecovery: PENDING }, 'recovery'],
		['read only', { readOnly: true }, 'read-only'],
		['busy', { recordingStarting: true }, 'busy'],
		['disabled loop', { project: project({ loop: { enabled: false, startFrame: 0, endFrame: 48_000 } }) }, 'loop'],
		['sound activation', { recordingInputs: inputs({ soundActivationEnabled: true }) }, 'sound-activation'],
		['locked target', { project: project({ locked: true }) }, 'tracks'],
		['missing route', { recordingInputs: inputs({ routed: false }) }, 'routing'],
	] as const) {
		assert.equal(selectTakeCycleStartAdmission({ ...snapshot, ...update }).reason, reason, label);
	}
	assert.deepEqual(createTakeCycleRecordingMenuItems({
		snapshot: { ...snapshot, productId: 'framescaper' }, copy: ENGLISH_COPY,
		start: () => undefined, openRecovery: () => undefined,
	}), []);
});

test('pending recovery stays menu-reachable and is never an implicit decision', () => {
	const calls: string[] = [];
	const items = createTakeCycleRecordingMenuItems({
		snapshot: { ...editableSnapshot(), takeCycleRecovery: PENDING },
		copy: ENGLISH_COPY,
		start: () => { calls.push('start'); },
		openRecovery: () => { calls.push('open'); },
	});
	assert.equal(items[0]?.disabled, true);
	assert.deepEqual(items.map(({ label }) => label), [
		'Record loop into takes', 'Resolve interrupted take recording',
	]);
	items[1]?.onClick();
	assert.deepEqual(calls, ['open']);
});

test('recovery dialog exposes an exact explicit accessible recover/discard choice', () => {
	const markup = renderToStaticMarkup(<TakeCycleRecoveryDialog
		productId="soundscaper"
		pending={PENDING}
		controller={{ actions: { recording: { cycle: {
			recover: () => undefined,
			discard: () => undefined,
		} } } }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(markup, /role="dialog"[^>]*aria-label="Interrupted take recording"/u);
	assert.match(markup, /data-take-cycle-recovery-dialog="true"/u);
	assert.match(markup, /Generation 7 contains 2 unsettled recording lanes/u);
	assert.match(markup, /Closing this dialog makes no decision/u);
	assert.match(markup, /data-take-cycle-recover="true"/u);
	assert.match(markup, />Recover takes</u);
	assert.match(markup, />Discard takes</u);
	assert.match(markup, /role="status" aria-live="polite" aria-atomic="true"/u);
	assert.equal(renderToStaticMarkup(<TakeCycleRecoveryDialog
		productId="framescaper"
		pending={PENDING}
		controller={{ actions: { recording: { cycle: { recover() {}, discard() {} } } } }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>), '');
});

test('workspace auto-offers each authority once and keeps recovery menu-only', async () => {
	const [workspace, toolbar, transport, overlays, hook, css] = await Promise.all([
		readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspace.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/toolbar/EditorToolToolbar.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/use-take-cycle-recovery-surface.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/audio-editor-design-system/28-take-cycle-recovery.css', import.meta.url), 'utf8'),
	]);
	assert.match(workspace, /useTakeCycleRecoverySurface\(productId, snapshot\.takeCycleRecovery\)/u);
	assert.match(workspace, /onOpenTakeCycleRecovery=\{\(\) => openSurface\('take-cycle-recovery'\)\}/u);
	assert.match(toolbar, /onOpenTakeCycleRecovery=\{onOpenTakeCycleRecovery\}/u);
	assert.match(transport, /createTakeCycleRecordingMenuItems/u);
	assert.match(overlays, /activeSurface === 'take-cycle-recovery' && snapshot\.takeCycleRecovery/u);
	assert.match(hook, /offeredToken\.current === pending\.recoveryToken/u);
	assert.match(hook, /setActiveSurface\('take-cycle-recovery'\)/u);
	assert.doesNotMatch(workspace, /takeCycleRecovery[^\n]*recover\(/u);
	assert.match(css, /@media \(forced-colors: active\)/u);
	assert.match(css, /forced-color-adjust: none/u);
});

test('pending recovery visibly blocks ordinary recording mutations and cycle pause', async () => {
	const [transport, toolbar] = await Promise.all([
		readFile(new URL('../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/ui/toolbar/EditorToolToolbar.jsx', import.meta.url), 'utf8'),
	]);
	assert.match(transport, /const recoveryBlocked = Boolean\(snapshot\.takeCycleRecovery\)/u);
	assert.match(transport, /const ordinaryRecording = snapshot\.recordingKind !== 'take-cycle'/u);
	assert.match(transport, /disabled: !snapshot\.recording \|\| !ordinaryRecording/u);
	assert.match(transport, /const recordingInputBlocked = recoveryBlocked \|\| snapshot\.recording/u);
	assert.match(transport, /label: copy\.monitor,[\s\S]{0,100}disabled: recoveryBlocked/u);
	assert.match(transport, /label: copy\.recordingOffset, disabled: recoveryBlocked/u);
	assert.match(transport, /label: copy\.timedRecording,[\s\S]{0,100}disabled: recoveryBlocked/u);
	assert.match(transport, /label: copy\.soundActivatedRecording,[\s\S]{0,120}disabled: recoveryBlocked/u);
	assert.match(transport, /label: copy\.soundActivationLevel,[\s\S]{0,100}disabled: recoveryBlocked/u);
	assert.match(toolbar, /disabled=\{Boolean\(snapshot\.takeCycleRecovery\) \|\| snapshot\.readOnly/u);
});

test('cycle recording and recovery copy is complete in English and German', () => {
	const keys = [
		'takeCycleRecordMenu', 'takeCycleRecoveryMenu', 'takeCycleRecoveryTitle',
		'takeCycleRecoveryDescription', 'takeCycleRecoverySummary', 'takeCycleRecoveryCloseHint',
		'takeCycleRecover', 'takeCycleDiscard', 'takeCycleRecovering', 'takeCycleDiscarding',
		'takeCycleRecoveryWorking',
	];
	for (const key of keys) {
		assert.equal(typeof CANONICAL_EXTRA_COPY_BY_LOCALE.en[key], 'string', `English ${key}`);
		assert.equal(typeof CANONICAL_EXTRA_COPY_BY_LOCALE.de[key], 'string', `German ${key}`);
		assert.notEqual(CANONICAL_EXTRA_COPY_BY_LOCALE.en[key], key);
		assert.notEqual(CANONICAL_EXTRA_COPY_BY_LOCALE.de[key], key);
	}
});

function editableSnapshot() {
	return {
		productId: 'soundscaper', capabilities: { takeComp: true }, project: project(),
		takeCycleRecovery: null, readOnly: false, importing: false, exporting: false,
		recording: false, recordingStarting: false, recordingScheduling: false,
		scheduledRecording: null, transportState: 'stopped', recordingInputs: inputs(),
	};
}

function project({
	loop = { enabled: true, startFrame: 0, endFrame: 48_000 },
	locked = false,
}: Readonly<{ loop?: unknown; locked?: boolean }> = {}) {
	return {
		schemaVersion: 17,
		loop,
		tracks: [{ id: 'track', type: 'audio', armed: true, locked }],
		sequences: [{ id: 'sequence', trackIds: ['track'] }],
	};
}

function inputs({
	routed = true,
	soundActivationEnabled = false,
}: Readonly<{ routed?: boolean; soundActivationEnabled?: boolean }> = {}) {
	return {
		routes: routed ? { track: { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1 } } : {},
		soundActivation: { preferences: { enabled: soundActivationEnabled } },
	};
}
