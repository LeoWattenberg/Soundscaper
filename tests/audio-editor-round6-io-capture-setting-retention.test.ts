/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCaptureSourceSettings } from '../src/common/editor/controller/capture/internal/framescaper-capture-preview-resources.ts';

test('editing a capture source format preserves its previously authored native constraints', async () => {
	let constraints: Readonly<Record<string, unknown>> = {
		deviceId: { exact: 'camera-a' }, frameRate: { exact: 24 },
	};
	const track = {
		getConstraints: () => ({ ...constraints }),
		applyConstraints: async (value: Readonly<Record<string, unknown>>) => { constraints = value; },
	};
	await applyCaptureSourceSettings(track, { width: 1280, height: 720 });
	assert.deepEqual(constraints, {
		deviceId: { exact: 'camera-a' }, frameRate: { exact: 24 },
		width: { exact: 1280 }, height: { exact: 720 },
	});
	await applyCaptureSourceSettings(track, { frameRate: 25 });
	assert.deepEqual(constraints, {
		deviceId: { exact: 'camera-a' }, frameRate: { exact: 25 },
		width: { exact: 1280 }, height: { exact: 720 },
	});
});

test('tracks without native constraints retain the existing requested-format adapter', async () => {
	const applied: unknown[] = [];
	await applyCaptureSourceSettings({ applyConstraints: async (value: unknown) => { applied.push(value); } }, { sampleRate: 48_000 });
	assert.deepEqual(applied, [{ sampleRate: { exact: 48_000 } }]);
});

test('quick source format choices merge after the preceding native constraints settle', async () => {
	let releaseFirst!: () => void;
	const firstReady = new Promise<void>(resolve => { releaseFirst = resolve; });
	let startFirst!: () => void;
	const firstStarted = new Promise<void>(resolve => { startFirst = resolve; });
	let nativeTail = Promise.resolve();
	let calls = 0;
	let constraints: Readonly<Record<string, unknown>> = { frameRate: { exact: 60 } };
	const track = {
		getConstraints: () => ({ ...constraints }),
		applyConstraints: (value: Readonly<Record<string, unknown>>) => {
			const index = calls++;
			const write = nativeTail.then(async () => {
				if (index === 0) { startFirst(); await firstReady; }
				constraints = value;
			});
			nativeTail = write;
			return write;
		},
	};
	const frameRate = applyCaptureSourceSettings(track, { frameRate: 24 });
	await firstStarted;
	const resolution = applyCaptureSourceSettings(track, { width: 1280, height: 720 });
	releaseFirst();
	await Promise.all([frameRate, resolution]);
	assert.deepEqual(constraints, { frameRate: { exact: 24 }, width: { exact: 1280 }, height: { exact: 720 } });
});

test('a rejected native setting does not block the next ordinary format choice', async () => {
	let constraints: Readonly<Record<string, unknown>> = { frameRate: { exact: 60 } };
	let calls = 0;
	const track = {
		getConstraints: () => ({ ...constraints }),
		applyConstraints: async (value: Readonly<Record<string, unknown>>) => {
			if (calls++ === 0) throw new DOMException('Unsupported camera combination', 'OverconstrainedError');
			constraints = value;
		},
	};
	const frameRate = applyCaptureSourceSettings(track, { frameRate: 24 });
	const rejected = assert.rejects(frameRate, /Unsupported camera combination/u);
	const resolution = applyCaptureSourceSettings(track, { width: 1280, height: 720 });
	await Promise.all([rejected, resolution]);
	assert.deepEqual(constraints, { frameRate: { exact: 60 }, width: { exact: 1280 }, height: { exact: 720 } });
});
