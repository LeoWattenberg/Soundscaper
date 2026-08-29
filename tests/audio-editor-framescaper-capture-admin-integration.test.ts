/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureAdminInterlock } from '../src/common/editor/controller/framescaper-capture-admin-interlock.ts';
import {
	createProjectAdminService,
	type ProjectAdminServiceRuntime,
} from '../src/common/editor/controller/project-admin-service.ts';
import { createFixture, deferred } from './audio-editor-project-admin-service-fixture.ts';

test('deferred deletion owns admission before stop and blocks capture until deletion settles', async () => {
	const fixture = createFixture();
	const interlock = createFramescaperCaptureAdminInterlock();
	const stopped = deferred();
	const stopGate = deferred();
	const runtime = {
		...fixture.runtime,
		beginCaptureInterlockedAdminOperation: interlock.beginAdminOperation,
		async stopRecording() {
			fixture.calls.push('stop-recording:pending');
			stopped.resolve();
			await stopGate.promise;
		},
	} satisfies ProjectAdminServiceRuntime;
	const deleting = createProjectAdminService(runtime).deleteProject();
	await stopped.promise;
	assert.throws(() => interlock.beginCaptureAdmission('project-a'), /delete/iu);
	assert.equal(fixture.calls.includes('delete:project-a'), false);
	stopGate.resolve();
	await deleting;
	interlock.beginCaptureAdmission('project-a').release();
});

test('deferred handoff owns admission and capture-owned admission rejects handoff preflight', async () => {
	const fixture = createFixture();
	const interlock = createFramescaperCaptureAdminInterlock();
	const flushed = deferred();
	const flushGate = deferred();
	const runtime = {
		...fixture.runtime,
		beginCaptureInterlockedAdminOperation: interlock.beginAdminOperation,
		async flushProject() {
			fixture.calls.push('flush:pending');
			flushed.resolve();
			await flushGate.promise;
		},
	} satisfies ProjectAdminServiceRuntime;
	const service = createProjectAdminService(runtime);
	const handingOff = service.prepareProjectHandoff();
	await flushed.promise;
	assert.throws(() => interlock.beginCaptureAdmission('project-a'), /handoff/iu);
	assert.equal(fixture.calls.includes('release'), false);
	flushGate.resolve();
	await handingOff;

	const capture = interlock.beginCaptureAdmission('project-a');
	await assert.rejects(() => service.prepareProjectHandoff(), /capture/iu);
	assert.equal(fixture.calls.filter((call) => call === 'release').length, 1);
	capture.release();
});

test('deferred dirty close owns its exact project until the close lifecycle settles', async () => {
	const fixture = createFixture();
	const interlock = createFramescaperCaptureAdminInterlock();
	const saveStarted = deferred();
	const saveGate = deferred();
	const tab = fixture.tabs.get('project-a');
	assert.ok(tab);
	tab.dirty = true;
	const saveCurrent = async () => {
		fixture.calls.push('save:pending');
		saveStarted.resolve();
		await saveGate.promise;
	};
	const runtime = {
		...fixture.runtime,
		beginCaptureInterlockedAdminOperation: interlock.beginAdminOperation,
		saveNow: saveCurrent,
		async newProject(options: Readonly<{ skipFlush?: boolean }> = {}) {
			if (!options.skipFlush) await saveCurrent();
			return fixture.runtime.newProject({ skipFlush: true });
		},
	} satisfies ProjectAdminServiceRuntime;
	const closing = createProjectAdminService(runtime).closeProjectTab('project-a');
	await saveStarted.promise;
	assert.throws(() => interlock.beginCaptureAdmission('project-a'), /close/iu);
	assert.equal(fixture.calls.includes('close:project-a'), false);
	saveGate.resolve();
	await closing;
	interlock.beginCaptureAdmission('project-a').release();
});

test('deferred global clear blocks every capture origin and releases after reset', async () => {
	const fixture = createFixture();
	const interlock = createFramescaperCaptureAdminInterlock();
	const stopStarted = deferred();
	const stopGate = deferred();
	const runtime = {
		...fixture.runtime,
		beginCaptureInterlockedAdminOperation: interlock.beginAdminOperation,
		async stopRecording() {
			fixture.calls.push('clear-stop:pending');
			stopStarted.resolve();
			await stopGate.promise;
		},
	} satisfies ProjectAdminServiceRuntime;
	const clearing = createProjectAdminService(runtime).clearLocalData();
	await stopStarted.promise;
	assert.throws(() => interlock.beginCaptureAdmission('project-a'), /clear/iu);
	assert.throws(() => interlock.beginCaptureAdmission('project-b'), /clear/iu);
	assert.equal(fixture.calls.includes('clear-store'), false);
	stopGate.resolve();
	await clearing;
	interlock.beginCaptureAdmission('project-b').release();
});
