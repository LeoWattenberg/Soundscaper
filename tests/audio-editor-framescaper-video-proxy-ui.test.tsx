/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import FramescaperVideoProxyDialog from '../src/common/editor/ui/dialogs/FramescaperVideoProxyDialog.tsx';
import {
	createFramescaperVideoProxyApplicationMenuItems,
} from '../src/common/editor/ui/framescaper-video-proxy-application-menu.ts';
import {
	createFramescaperVideoProxyDialogModel,
} from '../src/common/editor/ui/framescaper-video-proxy-dialog-model.ts';
import {
	bindFramescaperVideoProxyActionRuntime,
	registerFramescaperVideoProxyActionRuntime,
} from '../src/framescaper/editor-video-proxy-action-runtime.ts';

test('the baseline retains proxy projects in one existing menu with product isolation', () => {
	let opens = 0;
	const items = createFramescaperVideoProxyApplicationMenuItems({
		productId: 'framescaper', project: project(),
		copy: {}, open: () => { opens += 1; },
	});
	assert.equal(items.length, 1);
	assert.equal(items[0]?.id, 'video-proxy-manager');
	assert.equal(items[0]?.disabled, false);
	items[0]?.onClick();
	assert.equal(opens, 1);
	assert.deepEqual(createFramescaperVideoProxyApplicationMenuItems({
		productId: 'soundscaper', project: project(), copy: {}, open: () => undefined,
	}), []);
});

test('proxy dialog model targets the selected source and reports offline attached state', () => {
	const value = project();
	(value.sources[0] as Record<string, unknown>).proxyAttachment = { originalAuthorityKind: 'linked' };
	const model = createFramescaperVideoProxyDialogModel({
		project: value, selectedClipId: 'video-clip', missingSourceIds: ['video-source'],
		editingBlocked: false, readOnly: false,
	});
	assert.equal(model.supported, true);
	assert.equal(model.selectedSourceId, 'video-source');
	assert.deepEqual(model.sources, [{
		id: 'video-source', name: 'Camera', attachmentPresent: true,
		originalAuthorityKind: 'linked', originalAvailable: false,
		projectBinClipId: 'bin-video',
	}]);
	assert.equal(model.mutationsDisabled, false);
});

test('the proxy workflow is lazy, menu-only, and does not activate native M5 proxy surfaces', () => {
	const overlays = readFileSync('src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', 'utf8');
	const workspaceRuntime = readFileSync('src/common/editor/ui/workspace/workspace-application-menu-runtime.js', 'utf8');
	const finishingMenu = readFileSync('src/common/editor/ui/framescaper-video-finishing-menu.ts', 'utf8');
	const projectBin = readFileSync('src/common/editor/ui/workspace/ProjectBinPanel.jsx', 'utf8');
	const nativeMenu = readFileSync('src/common/editor/ui/framescaper-native-services-menu.ts', 'utf8');
	assert.match(overlays, /React\.lazy\(\(\) => import\('\.\.\/dialogs\/FramescaperVideoProxyDialog\.tsx'\)\)/u);
	assert.match(workspaceRuntime, /openVideoProxy:\s*\(\) => openSurface\('video-proxy'\)/u);
	assert.match(finishingMenu, /createFramescaperVideoProxyApplicationMenuItems/u);
	assert.match(projectBin,
		/React\.lazy\(\(\) => import\('\.\.\/dialogs\/FramescaperVideoProxyDialog\.tsx'\)\)/u);
	assert.match(projectBin, /createFramescaperVideoProxyApplicationMenuItems\(\{[\s\S]*productId: snapshot\.productId,[\s\S]*setProxyClipId\(menuVideoClip\.id\)/u);
	assert.match(projectBin, /label=\{proxyMenuItem\.label\}[\s\S]*onClick=\{proxyMenuItem\.onClick\}/u);
	assert.match(projectBin, /selectedClipId: proxyClipId/u,
		'the clicked Project Bin occurrence, rather than timeline selection, seeds the proxy dialog');
	assert.doesNotMatch(overlays, /import FramescaperVideoProxyDialog from/u);
	assert.doesNotMatch(projectBin, /import FramescaperVideoProxyDialog from/u);
	assert.match(nativeMenu, /professionalMediaProject\s*=\s*hasProject/u);
});

test('the selected proxy dialog exposes pathless attach-existing from its lazy menu surface', () => {
	const controller = {};
	bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'auto',
		previewTrust: () => 'unverified',
		setMode: async () => undefined,
		pressure: () => null,
		reportPreviewPressure: async () => undefined,
		generate: async () => undefined,
		attachExisting: async () => undefined,
		detach: async () => undefined,
		regenerate: async () => undefined,
		relinkOriginal: async () => 'relinked',
	}));
	const markup = renderToStaticMarkup(<FramescaperVideoProxyDialog
		controller={controller}
		snapshot={{ project: project(), selectedClipId: 'video-clip', missingSourceIds: [] }}
		editingBlocked={false}
		copy={{}}
		fileService={{}}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
	assert.match(markup, /data-video-proxy-attach-existing="true"/u);
	assert.match(markup, /data-video-proxy-existing-file="true"/u);
	assert.match(markup, /type="file"/u);
	assert.match(markup, /accept="video\/\*"/u);
	assert.match(markup, /data-video-proxy-selection-policy="strict"/u);
	assert.match(markup, /Proxy.*refuses.*Auto.*fall back/iu);
	assert.doesNotMatch(markup, /path=/iu);
});

test('proxy status never promotes an attachment pointer to verified trust', () => {
	const controller = {};
	bindFramescaperVideoProxyActionRuntime(controller, registerFramescaperVideoProxyActionRuntime({
		mode: () => 'proxy', previewTrust: () => 'unavailable',
		setMode: async () => undefined, pressure: () => null,
		reportPreviewPressure: async () => undefined, generate: async () => undefined,
		attachExisting: async () => undefined, detach: async () => undefined,
		regenerate: async () => undefined, relinkOriginal: async () => 'relinked',
	}));
	const value = project();
	(value.sources[0] as Record<string, unknown>).proxyAttachment = { originalAuthorityKind: 'owned' };
	const markup = renderToStaticMarkup(<FramescaperVideoProxyDialog
		controller={controller}
		snapshot={{ project: value, selectedClipId: 'video-clip', missingSourceIds: [] }}
		editingBlocked={false} copy={{}} fileService={{}}
		run={(operation) => operation()} onClose={() => undefined}
	/>);
	assert.match(markup, /failed verification|missing/iu);
	assert.match(markup, /Proxy mode refuses/iu);
	assert.doesNotMatch(markup, /verified proxy is attached/iu);
});

function project() {
	return {
		schemaFamily: 'framescaper', schemaVersion: 1,
		sources: [{
			kind: 'video', id: 'video-source', name: 'Camera', proxyAttachment: null,
		}],
		clips: [{ kind: 'video', id: 'video-clip', sourceId: 'video-source' }],
		projectBin: { clips: [{ kind: 'video', id: 'bin-video', sourceId: 'video-source' }] },
	};
}
