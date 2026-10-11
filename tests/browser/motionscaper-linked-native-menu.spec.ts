/* SPDX-License-Identifier: AGPL-3.0-only */
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { createMotionscaperProject } from '../../src/motionscaper/editor-project.ts';
import { exportMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
async function menu(page: Page, top: string, item: string | RegExp): Promise<void> { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: typeof item === 'string' }).click(); }
async function close(page: Page): Promise<void> { await page.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.getByRole('dialog')).toHaveCount(0); }
test('native selected-file controls keep the controller connection after dialog close and disconnect explicitly', async ({ page }) => {
	const project = createMotionscaperProject({ id: 'native-selected', title: 'Native first', compositionId: 'main', width: 2, height: 2, durationFrames: 2 });
	const versions = await Promise.all([project, { ...project, revision: 1, title: 'Native saved update' }, { ...project, id: 'other-document', revision: 2, title: 'Different document' }].map(async value => {
		const blob = await exportMotionscaperArchive(value, () => null); if (!blob) throw new Error('Native fixture archive is absent.'); return [...new Uint8Array(await blob.arrayBuffer())];
	}));
	await page.addInitScript(({ versions }) => {
		let generation = 1, cancelled = 0; const tokens = new Map<string, Uint8Array>();
		const files = {
			select: async () => ({ watchId: 'selected-watch', name: 'Chosen.mscape' }),
			poll: async ({ afterGeneration }: { afterGeneration: number }) => { if (afterGeneration === generation) return { state: 'unchanged', generation }; const token = `pinned-${generation}`, bytes = new Uint8Array(versions[generation - 1]!); tokens.set(token, bytes); return { state: 'snapshot', snapshot: { token, name: 'Chosen.mscape', generation, byteLength: bytes.length } }; },
			read: async ({ token, offset, length }: { token: string; offset: number; length: number }) => tokens.get(token)!.slice(offset, offset + length),
			release: async ({ token }: { token: string }) => { tokens.delete(token); }, cancel: async () => { cancelled++; },
		};
		Object.defineProperty(globalThis, 'framescaperSuccessorDesktop', { value: { v1: { motionSavedFiles: files } } });
		Object.defineProperty(globalThis, 'nativeMotionFixture', { value: { update: () => { generation++; }, cancelled: () => cancelled } });
	}, { versions });
	await page.goto('/embed/en/'); await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible(); await menu(page, 'File', 'Linked compositions…');
	const dialog = page.getByRole('dialog', { name: 'Linked Motionscaper compositions' });
	await expect(dialog.getByRole('button', { name: 'Create pairing URL', exact: true })).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Choose saved .mscape file', exact: true }).click(); await expect(dialog.getByText('Native first', { exact: true })).toBeVisible();
	await close(page); await page.evaluate(() => (globalThis as unknown as { nativeMotionFixture: { update(): void } }).nativeMotionFixture.update());
	await menu(page, 'File', 'Linked compositions…'); await expect(dialog.getByText('Native saved update', { exact: true })).toBeVisible();
	await page.evaluate(() => (globalThis as unknown as { nativeMotionFixture: { update(): void } }).nativeMotionFixture.update());
	await dialog.getByRole('button', { name: 'Refresh saved revision', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('different project or composition');
	await expect(dialog.locator('code')).toHaveCount(1); await expect(dialog.getByText('Native saved update', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click(); await expect(dialog.getByRole('status')).toHaveText('Disconnected');
	expect(await page.evaluate(() => (globalThis as unknown as { nativeMotionFixture: { cancelled(): number } }).nativeMotionFixture.cancelled())).toBe(1);
});

for (const unavailablePreview of [false, true]) test(`native successor File export streams real retained partial-alpha picture and mixed PCM without encoded proxy assets (preview unavailable=${String(unavailablePreview)})`, async ({ page }) => {
	const { motionscaperSuccessorNativeFixture, motionscaperSuccessorNativeExpectedSample } = await import('../helpers/motionscaper-successor-native-fixture.ts');
	const { createBlobScapeArchiveByteSource } = await import('../../src/common/editor/scape-archive-byte-source.ts');
	const { openMotionNativeFrameReader } = await import('../../src/common/editor/motion-native-frame-carrier-v1.ts');
	const { openMotionNativePcmReader, motionNativePcmPlan } = await import('../../src/common/editor/motion-native-pcm-carrier-v1.ts');
	const { FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE } = await import('../../src/framescaper/editor-successor-native-delivery-contract.ts');
	if (unavailablePreview) await page.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) { return args[0] === 'webgl2' && this.hasAttribute('data-video-preview-canvas') ? null : Reflect.apply(original, this, args); } as typeof original; });
	const fixture = motionscaperSuccessorNativeFixture(); const archive = await exportMotionscaperArchive(fixture.revision.project, () => new Blob([fixture.bytes])); if (!archive) throw new Error('Missing native test archive');
	await page.addInitScript(({ archive, profile }) => {
		const bytes = new Uint8Array(archive), picture: number[] = [], audio: number[] = [];
		let plan: { identity: { projectId: string; revisionDigest: string; sequenceId: string }; width: number; height: number; frameRate: { num: number; den: number }; firstFrame: number; frameCount: number } | null = null;
		const files = { select: async () => ({ watchId: 'watch', name: 'Native.mscape' }), poll: async ({ afterGeneration }: { afterGeneration: number }) => afterGeneration === 1 ? { state: 'unchanged', generation: 1 } : { state: 'snapshot', snapshot: { token: 'snapshot', name: 'Native.mscape', generation: 1, byteLength: bytes.length } },
			read: async ({ offset, length }: { offset: number; length: number }) => bytes.slice(offset, offset + length), release: async () => {}, cancel: async () => {} };
		const delivery = { getProfile: async () => profile, begin: async (request: { plan: NonNullable<typeof plan> }) => { plan = request.plan; return { token: 'delivery' }; },
			write: async ({ bytes, offset, stream }: { bytes: Uint8Array; offset: number; stream?: string }) => { const output = stream === 'audio' ? audio : picture; if (offset !== output.length || output.length + bytes.length > 1024 * 1024) throw new Error('Invalid test carrier bound'); output.push(...bytes); },
			commit: async () => { if (!plan) throw new Error('No captured Frame sequence'); return { identity: plan.identity, name: 'Native.mov', byteLength: 10, sha256: 'a'.repeat(64), frameCount: plan.frameCount, profile, audio: { sampleRate: 48000, channels: 2, sampleCount: 4800 } }; }, cancel: async () => {} };
		Object.defineProperty(globalThis, 'framescaperSuccessorDesktop', { value: { v1: { motionSavedFiles: files, delivery } } });
		Object.defineProperty(globalThis, 'frameNativeCapture', { value: () => ({ plan, picture, audio }) });
	}, { archive: [...new Uint8Array(await archive.arrayBuffer())], profile: FRAMESCAPER_SUCCESSOR_DELIVERY_PROFILE });
	await page.goto('/embed/en/'); await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible();
	await expect(page.locator('[data-frame-native-delivery]')).toHaveCount(0); await menu(page, 'File', 'Linked compositions…');
	await page.getByRole('button', { name: 'Choose saved .mscape file', exact: true }).click(); await expect(page.getByText('Native revision 0', { exact: true }).first()).toBeVisible();
	await page.getByRole('button', { name: 'Disconnect', exact: true }).click(); await close(page);
	if (unavailablePreview) {
		await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-renderer', 'cpu');
		await expect(page.locator('[data-video-preview-renderer-warning]')).toHaveCount(0);
		await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-omitted-composition-clip-ids', '');
		const color = await page.locator('[data-video-preview-cpu-canvas]').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(16, 16, 1, 1).data]);
		expect(color).toEqual([89, 45, 149, 255]);
	} else {
		await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-renderer', 'ready');
		await page.locator('[data-video-preview-gpu-canvas]').evaluate((canvas: HTMLCanvasElement) => {
			const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context'); if (!extension) throw new Error('The actual context-loss capability is unavailable'); Object.defineProperty(globalThis, 'motionPreviewContextLossFixture', { value: extension }); extension.loseContext();
		});
		await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-renderer', 'cpu');
		await expect(page.locator('[data-video-preview-renderer-warning]')).toHaveCount(0);
		const color = await page.locator('[data-video-preview-cpu-canvas]').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(16, 16, 1, 1).data]); expect(color).toEqual([89, 45, 149, 255]);
		await page.evaluate(() => (globalThis as unknown as { motionPreviewContextLossFixture: WEBGL_lose_context }).motionPreviewContextLossFixture.restoreContext());
		await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-renderer', 'ready');
	}
	await menu(page, 'File', 'Export sequence as ProRes 4444…'); const dialog = page.locator('[data-frame-native-delivery]');
	await dialog.getByRole('button', { name: 'Choose destination and export', exact: true }).click();
	await expect(dialog.getByRole('status')).toContainText('Saved Native.mov', { timeout: 30000 }); await expect(dialog.getByRole('alert')).toHaveCount(0);
	const captured = await page.evaluate(() => (globalThis as unknown as { frameNativeCapture(): { plan: import('../../src/framescaper/editor-successor-native-delivery-contract.ts').FramescaperSuccessorNativePlan; picture: number[]; audio: number[] } }).frameNativeCapture());
	const identity = { projectId: captured.plan.identity.projectId, revisionDigest: captured.plan.identity.revisionDigest, compositionId: captured.plan.identity.sequenceId };
	expect(identity.projectId).not.toBe(fixture.revision.project.id); expect(captured.plan.frameCount).toBe(3); expect(captured.plan.width).toBe(64);
	const frames = await openMotionNativeFrameReader(createBlobScapeArchiveByteSource(new Blob([new Uint8Array(captured.picture)])), identity);
	for (let index = 0; index < 3; index++) { const surface = await frames.read(index), pixel = (16 * 64 + 16) * 4; expect(surface.pixels[pixel + 3]).toBeCloseTo(128 / 255, 6); expect(surface.pixels[pixel]).toBeGreaterThan(0.09); expect(surface.pixels[3]).toBe(0); }
	const audio = await openMotionNativePcmReader(createBlobScapeArchiveByteSource(new Blob([new Uint8Array(captured.audio)])), motionNativePcmPlan({ ...captured.plan, identity }, { sampleRate: 48000, channels: 2 }));
	for (const offset of [0, 4096]) { const block = await audio.read(offset); for (let index = 0; index < block.length / 2; index++) for (let channel = 0; channel < 2; channel++) expect(block[index * 2 + channel]).toBeCloseTo(motionscaperSuccessorNativeExpectedSample(offset + index, channel), 6); }
	if (unavailablePreview) {
		await close(page); await page.reload(); await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible();
		await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-renderer', 'cpu');
		const color = await page.locator('[data-video-preview-cpu-canvas]').evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(16, 16, 1, 1).data]); expect(color).toEqual([89, 45, 149, 255]);
		await menu(page, 'File', /^New\s+Ctrl\+N$/u); await expect(page.locator('[data-video-preview]')).toHaveAttribute('data-video-preview-renderer', 'fallback');
		await expect(page.locator('[data-video-preview-cpu-canvas]')).toHaveJSProperty('width', 0);
	}
});
