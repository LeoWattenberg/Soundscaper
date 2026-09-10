/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperCaptureDocumentPorts, createFramescaperCaptureProxyDocumentInstaller } from '../src/common/editor/controller/capture/framescaper-capture-document-ports.ts';
import { createFramescaperCaptureProxyActiveProjectSynchronizer } from '../src/common/editor/controller/capture/framescaper-capture-proxy-quiescence.ts';
import { admitFramescaperCaptureProject } from '../src/common/editor/controller/capture/internal/framescaper-capture-project-admission.ts';
import { createFramescaperCaptureAdminInterlock } from '../src/common/editor/controller/capture/framescaper-capture-admin-interlock.ts';
import { resolveControllerProjectRuntime } from '../src/common/editor/controller/document/project-runtime.ts';
import type { DocumentHistory, DocumentProject } from '../src/common/editor/controller/document/document-composition-types.ts';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';
import { createOpaqueProjectConsumer } from '../src/common/editor/project-opaque-consumer.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

const runtime = resolveControllerProjectRuntime(createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE));
function fixture() {
	const initial = runtime.createHistory(runtime.createProject({ id: 'capture-document' }));
	let history: DocumentHistory = initial;
	let project: DocumentProject = initial.present;
	const played: DocumentProject[] = [];
	const session = createAudioEditorSessionController();
	session.openProject(initial.present, { history: initial });
	const ports = createFramescaperCaptureDocumentPorts({
		adminInterlock: createFramescaperCaptureAdminInterlock(), session, runtime,
		getProject: () => project, getHistory: () => history,
		setProject: value => { project = value; }, setHistory: value => { history = value; },
		synchronizeProject: value => { played.push(value); },
	});
	return { initial, ports, session, played, getProject: () => project, getHistory: () => history,
		setProject(value: DocumentProject) { project = value; },
	};
}

void test('capture publication preserves the installed document identity through playback', async () => {
	const f = fixture();
	const next = runtime.executeCommand(f.initial, { type: 'project/rename', title: 'Captured' });
	f.ports.setActiveHistory(next);
	f.ports.setActiveProject(next.present);
	await f.ports.synchronizeProject(next.present);
	assert.equal(f.getHistory().present, next.present);
	assert.equal(f.getProject(), next.present);
	assert.equal(f.played[0], next.present);
	assert.equal(f.ports.getActiveHistory()?.present, next.present);
	const captured = f.ports.sessionController.captureProjectHistory(f.initial.present.id);
	assert.equal(captured.token, f.session.captureProjectHistory(f.initial.present.id).token);
	assert.deepEqual(captured.history, f.initial);
});

void test('capture rejects malformed documents and history before changing active state', () => {
	const f = fixture();
	const present = admitFramescaperCaptureProject(f.initial.present);
	const invalid = { ...present, sources: [{ id: 'broken' }] };
	assert.throws(() => f.ports.setActiveProject(invalid));
	assert.throws(() => f.ports.setActiveHistory({ present }));
	assert.equal(f.getProject(), f.initial.present);
	assert.equal(f.getHistory(), f.initial);
	assert.deepEqual(f.played, []);
});

void test('capture reads an inactive future document without traversing its body', () => {
	const f = fixture();
	const future = createOpaqueProjectConsumer({ id: 'future' }, { schemaFamily: 'framescaper', schemaVersion: 999 });
	f.setProject(future);
	assert.equal(f.ports.getActiveProject(), null);
});

void test('proxy synchronization admits every history entry before replacing editor state', async () => {
	const f = fixture();
	const installed: DocumentHistory[] = [];
	let published = 0;
	const synchronize = createFramescaperCaptureProxyActiveProjectSynchronizer({
		getActiveProject: f.getProject,
		installActiveProject: createFramescaperCaptureProxyDocumentInstaller({
			runtime, setHistory: value => { installed.push(value); },
			synchronizeProject: value => { f.played.push(value); },
		}),
		publishProjectState: () => { published += 1; },
	});
	const project = f.initial.present;
	await assert.rejects(synchronize({ projectId: project.id, project,
		history: { ...f.initial, undoStack: [{ project: { ...project, id: 'another-project' } }] },
	}));
	assert.equal(installed.length, 0);
	assert.deepEqual(f.played, []);
	assert.equal(published, 0);
	assert.equal(await synchronize({ projectId: 'inactive', project, history: f.initial }), false);
	assert.equal(await synchronize({ projectId: project.id, project, history: f.initial }), true);
	assert.equal(installed[0]?.present, project);
	assert.equal(f.played[0], project);
	assert.equal(published, 1);
});
