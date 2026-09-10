/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectSessionService } from '../src/common/editor/controller/document/internal/project/project-session-service.ts';
import type { ProjectBootstrapServiceRuntime } from '../src/common/editor/controller/document/internal/project/project-bootstrap-service.ts';

function fixture(productId: string, values: Readonly<Record<string, unknown>>) {
	const reads: string[] = [];
	const service = createProjectSessionService({
		productId, recentProjectsSettingKey: `${productId}:recent`, lastProjectSettingKey: `${productId}:last`,
		getRecentProjectIds: () => [], setRecentProjectIds() {}, getActiveProjectId: () => null,
		state: { selectedTrackId: null, selectedClipId: null, selectedAnnotationId: null },
		findTrack: () => null, findClip: () => null, getTabs: () => [], updateProjectMetadata() {},
		async loadSetting(key, fallback) { reads.push(key); return Object.hasOwn(values, key) ? values[key] : fallback; },
		async persistSetting() {}, publish() {},
	});
	return { service, reads };
}

for (const value of [17, true, [], { id: 'project' }, '']) {
	void test(`recent-project admission rejects ${JSON.stringify(value)} as a storage key`, async () => {
		const { service } = fixture('framescaper', { 'framescaper:last': value });
		assert.equal(await service.loadRecentProjectState(async value => value), null);
	});
}

void test('an invalid Soundscaper pointer falls back to an admitted legacy key', async () => {
	const { service } = fixture('soundscaper', { 'soundscaper:last': {}, 'last-project-id': 'legacy-project' });
	assert.equal(await service.loadRecentProjectState(async value => value), 'legacy-project');
});

void test('the bootstrap port retains the session guard and admitted key contracts', async () => {
	const { service, reads } = fixture('soundscaper', { 'soundscaper:last': 'current-project' });
	const load: ProjectBootstrapServiceRuntime<{ id: string; tracks: readonly never[] }, unknown, unknown>['loadRecentProjectState'] =
		service.loadRecentProjectState;
	assert.equal(await load(async value => value), 'current-project');
	assert.ok(!reads.includes('last-project-id'));
});
