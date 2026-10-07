/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { exportProjectEdl, exportProjectFcpxml, exportProjectOtio } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';

for (const [profile, action] of [['fcpxml', exportProjectFcpxml], ['otio', exportProjectOtio], ['edl', exportProjectEdl]] as const) {
	test(`${profile} delivers supported video and reports the canonical image it cannot represent`, async () => {
		const { project, clip } = createFramescaperBaselineImageFixture();
		const original = structuredClone(project);
		const saved: Readonly<Record<string, unknown>>[] = [];
		const state: { deliveryReport?: unknown } = {};
		const result = await action({
			getProject: () => project, state,
			fileService: { saveFile: request => { saved.push(request); } },
		});
		assert.ok(result);
		assert.equal(saved.length, 1);
		const warning = result.report.items.find(item => item.code === `${profile}.unsupported-visual-clip-omitted`);
		assert.ok(warning);
		assert.deepEqual(warning.scope, { kind: 'clip', id: clip.id });
		assert.deepEqual(warning.data, { kind: 'image', title: 'Animated image' });
		assert.equal(warning.disposition, 'omitted');
		assert.equal(warning.severity, 'warning');
		assert.equal(state.deliveryReport, result.report);
		assert.deepEqual(project, original, 'the export does not remove or alter the authored image');
		assert.match(result.text, /(?:asset-clip|Clip\.1|001\s)/u, 'the camera edit still reaches the delivered file');
	});
}
