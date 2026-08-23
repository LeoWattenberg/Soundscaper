/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	createFramescaperVideoProxyApplicationMenuItems,
} from '../src/common/editor/ui/framescaper-video-proxy-application-menu.ts';
import {
	createFramescaperVideoProxyDialogModel,
} from '../src/common/editor/ui/framescaper-video-proxy-dialog-model.ts';

test('selected V20 and V27 expose one existing-menu proxy manager with product isolation', () => {
	let opens = 0;
	for (const schemaVersion of [20, 27]) {
		const items = createFramescaperVideoProxyApplicationMenuItems({
			productId: 'framescaper', project: project(schemaVersion),
			copy: {}, open: () => { opens += 1; },
		});
		assert.equal(items.length, 1);
		assert.equal(items[0]?.id, 'video-proxy-manager');
		assert.equal(items[0]?.disabled, false);
		items[0]?.onClick();
	}
	assert.equal(opens, 2);
	assert.deepEqual(createFramescaperVideoProxyApplicationMenuItems({
		productId: 'soundscaper', project: project(20), copy: {}, open: () => undefined,
	}), []);
});

test('proxy dialog model targets the selected source and reports offline attached state', () => {
	const value = project(27);
	(value.sources[0] as Record<string, unknown>).proxyAttachment = { originalAuthorityKind: 'linked' };
	const model = createFramescaperVideoProxyDialogModel({
		project: value, selectedClipId: 'video-clip', missingSourceIds: ['video-source'],
		editingBlocked: false, readOnly: false,
	});
	assert.equal(model.supported, true);
	assert.equal(model.selectedSourceId, 'video-source');
	assert.deepEqual(model.sources, [{
		id: 'video-source', name: 'Camera', attached: true,
		originalAuthorityKind: 'linked', originalAvailable: false,
		projectBinClipId: 'bin-video',
	}]);
	assert.equal(model.mutationsDisabled, false);
});

test('the proxy workflow is lazy, menu-only, and does not activate native M5 proxy surfaces', () => {
	const overlays = readFileSync('src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx', 'utf8');
	const workspaceRuntime = readFileSync('src/common/editor/ui/workspace/workspace-application-menu-runtime.js', 'utf8');
	const finishingMenu = readFileSync('src/common/editor/ui/framescaper-video-finishing-menu.ts', 'utf8');
	const nativeMenu = readFileSync('src/common/editor/ui/framescaper-native-services-menu.ts', 'utf8');
	assert.match(overlays, /React\.lazy\(\(\) => import\('\.\.\/dialogs\/FramescaperVideoProxyDialog\.tsx'\)\)/u);
	assert.match(workspaceRuntime, /openVideoProxy:\s*\(\) => openSurface\('video-proxy'\)/u);
	assert.match(finishingMenu, /createFramescaperVideoProxyApplicationMenuItems/u);
	assert.doesNotMatch(overlays, /import FramescaperVideoProxyDialog from/u);
	assert.match(nativeMenu, /professionalMediaProject[\s\S]*schemaVersion === 25 \|\| schemaVersion === 26/u);
});

function project(schemaVersion: number) {
	return {
		schemaVersion,
		sources: [{
			kind: 'video', id: 'video-source', name: 'Camera', proxyAttachment: null,
		}],
		clips: [{ kind: 'video', id: 'video-clip', sourceId: 'video-source' }],
		projectBin: { clips: [{ kind: 'video', id: 'bin-video', sourceId: 'video-source' }] },
	};
}
