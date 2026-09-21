/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { cloneFrozenVideoExportProject } from '../src/common/editor/video-export-project-snapshot.ts';

test('both video export callers own independent immutable snapshots through the shared policy', () => {
	const project = { sampleRate: 48_000, rows: [{ name: 'first' }] };
	for (const role of ['keyframe', 'offline'] as const) {
		const snapshot = cloneFrozenVideoExportProject(project, role);
		assert.notEqual(snapshot, project);
		assert.notEqual(snapshot.rows, project.rows);
		assert.equal(Object.isFrozen(snapshot), true);
		assert.equal(Object.isFrozen(snapshot.rows), true);
		assert.equal(Object.isFrozen(snapshot.rows[0]), true);
		project.rows[0]!.name = 'changed';
		assert.equal(snapshot.rows[0]?.name, 'first');
		project.rows[0]!.name = 'first';
	}
});

test('both video export snapshot roles retain their own binary, clone, and cloned-record errors', () => {
	for (const [role, label] of [
		['keyframe', 'Video keyframe export'],
		['offline', 'Offline video export'],
	] as const) {
		assert.throws(
			() => cloneFrozenVideoExportProject({ binary: new Uint8Array(1) }, role),
			{ name: 'TypeError', message: `${label} projects cannot embed binary data.` },
		);
		const failure = new Error('no structured clone');
		const clone = globalThis.structuredClone;
		try {
			globalThis.structuredClone = () => { throw failure; };
			assert.throws(
				() => cloneFrozenVideoExportProject({ sampleRate: 48_000 }, role),
				(error: unknown) => error instanceof TypeError
					&& error.message === `${label} project must be structured-clone data.`
					&& error.cause === failure,
			);
		} finally {
			globalThis.structuredClone = clone;
		}
	}
	const clone = globalThis.structuredClone;
	try {
		globalThis.structuredClone = () => [];
		assert.throws(
			() => cloneFrozenVideoExportProject({ sampleRate: 48_000 }, 'offline', (value) => {
				if (Array.isArray(value)) throw new TypeError('offline video export project snapshot must be a plain record.');
			}),
			{ message: 'offline video export project snapshot must be a plain record.' },
		);
	} finally {
		globalThis.structuredClone = clone;
	}
});

test('video frame-source and offline exporter use one bounded clone/freeze authority', () => {
	const source = readFileSync(new URL('../src/common/editor/video-keyframe-export-frame-source.ts', import.meta.url), 'utf8');
	const offline = readFileSync(new URL('../src/common/editor/ui/video-keyframe-offline-video-export.ts', import.meta.url), 'utf8');
	const runtimeInventory = readFileSync(new URL('../scripts/lib/desktop-project-runtime-files.mjs', import.meta.url), 'utf8');
	for (const caller of [source, offline]) {
		assert.match(caller, /cloneFrozenVideoExportProject\(/u);
		assert.doesNotMatch(caller, /function (?:assertSnapshotPayloadBound|deepFreeze|freezeProjectSnapshot)\(/u);
	}
	assert.match(runtimeInventory, /src\/common\/editor\/video-export-project-snapshot\.js/u);
});
