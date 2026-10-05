/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorExportService } from '../src/common/editor/controller/export/internal/export-service.ts';
import { createFixture } from './helpers/export-service-fixture.ts';

for (const format of ['wav', 'mp4']) {
	test(`${format} blob export publishes to the supplied original-file destination`, async () => {
		const fixture = createFixture();
		const destination = { id: 'original-save-target', name: `original.${format}` };
		let publishedTarget: unknown;
		const runtime = {
			...fixture.runtime,
			fileService: {
				...fixture.runtime.fileService,
				isDesktop: true,
				getDesktopVideoExportCapabilities: async () => ({ schemaVersion: 1, formats: {
					mp4: { available: true, provider: 'external-ffmpeg', reason: null },
				} }),
				createDownload: async (request: Record<string, unknown>) => {
					publishedTarget = request.target;
					return { method: 'desktop', fileName: destination.name, size: 128, url: null };
				},
			},
		};
		await createEditorExportService(runtime).handleExportAction('start', {
			format: format === 'mp4' ? 'video-mp4' : format, saveTarget: destination,
		});
		assert.deepEqual(fixture.errors, []);
		assert.equal(publishedTarget, destination);
	});
}
