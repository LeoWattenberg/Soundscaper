/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	collectClientErrors,
} from './audio-editor-test-helpers.js';

const WORKFLOW = { timeout: 120_000 };

test('renders an imported native image sequence through the pathless desktop decode bridge', async ({ page }) => {
	test.setTimeout(180_000);
	const clientErrors = collectClientErrors(page);
	await installNativeImageSequenceFixture(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await expect.poll(() => page.evaluate(() => globalThis.__nativeSequenceJourney.snapshots), {
		timeout: 20_000,
	}).toBeGreaterThan(0);

	await chooseCommandAction(page, editor, 'File', 'Image sequence', WORKFLOW);
	let dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await expect(dialog).toBeVisible(WORKFLOW);
	let action = dialog.locator('[data-framescaper-native-project-action="image-sequence-import"]');
	await action.click();
	await expect(action.locator('xpath=ancestor::section[1]').getByRole('status'))
		.toContainText(/complete/iu, WORKFLOW);
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();

	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible(WORKFLOW);
	await expect(card.locator('[data-project-bin-name]')).toHaveValue('Image-Sequence', WORKFLOW);
	await card.getByRole('button', { name: /Add to timeline:/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1', WORKFLOW);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', WORKFLOW);

	await chooseNestedCommandAction(
		page, editor, 'File', ['Export other', 'Add to render queue'], WORKFLOW,
	);
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await expect(dialog).toBeVisible(WORKFLOW);
	action = dialog.locator('[data-framescaper-native-project-action="render-queue-enqueue"]');
	await action.click();
	const queueStatus = action.locator('xpath=ancestor::section[1]').getByRole('status');
	await expect(queueStatus).not.toHaveText('Working', WORKFLOW);
	expect(await queueStatus.textContent()).toMatch(/complete/iu);

	const journey = await page.evaluate(() => structuredClone(globalThis.__nativeSequenceJourney));
	expect(journey.importOperations).toEqual(['begin', 'commit:pack', 'commit:inventory', 'admit', 'complete']);
	expect(journey.selectionReleases).toBe(1);
	expect(journey.decodes).toHaveLength(1);
	expect(journey.decodes[0]).toMatchObject({
		projectId: await editor.getAttribute('data-project-id'),
		sourceId: journey.sourceId,
	});
	expect(journey.decodes[0].projectRevision).toBeGreaterThan(0);
	expect(journey.decodeReads).toEqual(expect.arrayContaining([
		expect.objectContaining({ offset: 59, length: 32 }),
		expect.objectContaining({ offset: 91, length: 16 }),
	]));
	expect(journey.decodeReleases).toEqual(['d'.repeat(40)]);
	expect(journey.stages).toHaveLength(1);
	expect(journey.stages[0]).toMatchObject({
		liveRenderVersion: 1,
		planVersion: 14,
		projectId: await editor.getAttribute('data-project-id'),
	});
	expect(journey.enqueues).toHaveLength(1);
	expect(journey.enqueues[0]).toMatchObject({
		planVersion: 14,
		derivedInputStageId: 'b'.repeat(40),
		taskKind: 'encoded-export',
	});
	expect(journey.liveBytes).toBeGreaterThan(0);
	expect(journey.liveCompletions).toHaveLength(1);
	expect(journey.cancellations).toEqual([]);
	expect(clientErrors).toEqual([]);
});

async function installNativeImageSequenceFixture(page) {
	await page.addInitScript(() => {
		const FRAME_COUNT = 2;
		const WIDTH = 2;
		const HEIGHT = 2;
		const FRAME_BYTES = WIDTH * HEIGHT * 4;
		const DECODE_BYTES = 59 + FRAME_COUNT * (32 + FRAME_BYTES);
		const TRANSACTION_ID = 'f'.repeat(40);
		const CLAIM_ID = 'd'.repeat(40);
		const STAGE_ID = 'b'.repeat(40);
		const journey = {
			snapshots: 0,
			importOperations: [],
			selectionReleases: 0,
			sourceId: null,
			decodes: [],
			decodeReads: [],
			decodeReleases: [],
			cancellations: [],
			stages: [],
			enqueues: [],
			liveBytes: 0,
			liveCompletions: [],
		};
		const sourceFrames = [
			{ fileId: '1'.repeat(40), name: 'shot.0001.png', bytes: Uint8Array.of(1, 2, 3) },
			{ fileId: '2'.repeat(40), name: 'shot.0002.png', bytes: Uint8Array.of(4, 5, 6, 7) },
		];
		const transactionBodies = { pack: [], inventory: [] };
		const decoded = new Uint8Array(DECODE_BYTES);
		const decodedView = new DataView(decoded.buffer);
		for (let ordinal = 0; ordinal < FRAME_COUNT; ordinal += 1) {
			const offset = 59 + ordinal * (32 + FRAME_BYTES);
			decodedView.setBigUint64(offset, BigInt(ordinal), true);
			decodedView.setBigInt64(offset + 8, BigInt(ordinal), true);
			decodedView.setBigInt64(offset + 16, 1n, true);
			decodedView.setBigUint64(offset + 24, BigInt(FRAME_BYTES), true);
			for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
				decoded.set([ordinal ? 0x33 : 0xcc, pixel * 16, 0x66, 0xff], offset + 32 + pixel * 4);
			}
		}
		const capability = (domain, id) => ({
			domain,
			id,
			state: 'available',
			reason: 'ready',
			userEnabled: true,
			buildFingerprint: null,
			detail: null,
		});
		const servicesSnapshot = () => ({
			snapshotVersion: 1,
			runtimeAvailable: true,
			nativeMediaEnabled: true,
			queue: [],
			roots: [{ grantId: 'a'.repeat(16), displayName: 'Exports', revoked: false }],
			watchRules: [],
		});
		const nativeServices = {
			snapshot: async () => {
				journey.snapshots += 1;
				return servicesSnapshot();
			},
			control: async () => ({}),
			reorder: async () => [],
			remove: async () => true,
			capabilities: async () => ({
				snapshotVersion: 1,
				masterEnabled: true,
				buildFingerprint: null,
				entries: [
					capability('queue', 'persistent-render-queue'),
					capability('operation', 'image-sequence-import'),
				],
			}),
			preferences: async () => ({
				nativeMediaEnabled: true,
				hardwareDecodeEnabled: false,
				hardwareEncodeEnabled: false,
				ofxConsentEnabled: false,
			}),
			selectImageSequence: async () => ({
				selectionId: 'c'.repeat(40),
				files: sourceFrames.map(({ fileId, name, bytes }) => ({
					fileId, name, byteLength: bytes.byteLength,
				})),
			}),
			readImageSequenceFile: async ({ fileId, offset, length }) => {
				const file = sourceFrames.find((candidate) => candidate.fileId === fileId);
				if (!file) throw new Error('Unknown image-sequence fixture file.');
				return file.bytes.slice(offset, offset + length);
			},
			releaseImageSequence: async () => {
				journey.selectionReleases += 1;
				return true;
			},
			imageSequenceImport: async (request) => {
				journey.importOperations.push(request.asset
					? `${request.operation}:${request.asset}` : request.operation);
				if (request.operation === 'begin') {
					return { operation: 'begun', transactionId: TRANSACTION_ID };
				}
				if (request.operation === 'commit') {
					return { operation: 'committed', transactionId: TRANSACTION_ID };
				}
				if (request.operation === 'discard') {
					return { operation: 'discarded', transactionId: TRANSACTION_ID };
				}
				if (request.operation === 'complete') {
					return { operation: 'completed', transactionId: TRANSACTION_ID };
				}
				if (request.operation !== 'admit') throw new Error('Unexpected import operation.');
				const admission = request.admission;
				journey.sourceId = admission.sourceId;
				return {
					operation: 'admitted',
					transactionId: TRANSACTION_ID,
					result: {
						kind: admission.kind,
						admitted: true,
						schemaFamily: admission.schemaFamily,
						schemaVersion: admission.schemaVersion,
						projectId: admission.projectId,
						projectRevision: admission.projectRevision,
						sourceId: admission.sourceId,
						inventorySha256: admission.inventory.sha256,
						sourcePackSha256: admission.sourcePack.sha256,
						characteristics: {
							backend: 'framescaper-media-host',
							codedWidth: WIDTH,
							codedHeight: HEIGHT,
							hasAlpha: false,
							videoCodec: 'png',
							bitDepth: 8,
							pixelFormat: 'rgb24',
							chromaFormat: '4:4:4',
							alphaMode: null,
							alphaInterpretation: null,
							colour: {
								primaries: 'srgb',
								transfer: 'iec61966-2-1',
								matrix: 'rgb',
								range: 'full',
							},
						},
					},
				};
			},
			writeImageSequenceImportChunk: async ({ asset, offset, bytes }) => {
				const body = transactionBodies[asset];
				for (let index = 0; index < bytes.byteLength; index += 1) body[offset + index] = bytes[index];
				return { operation: 'written' };
			},
			readImageSequenceImportBody: async ({ asset, offset, length }) => (
				Uint8Array.from(transactionBodies[asset]).slice(offset, offset + length)
			),
			decodeImageSequenceSource: async (request) => {
				journey.decodes.push(structuredClone(request));
				return {
					claimId: CLAIM_ID,
					sourceId: request.sourceId,
					byteLength: DECODE_BYTES,
					sha256: 'e'.repeat(64),
					frameCount: FRAME_COUNT,
					width: WIDTH,
					height: HEIGHT,
					frameRate: { num: 24, den: 1 },
				};
			},
			cancelImageSequenceDecode: async ({ requestId }) => {
				journey.cancellations.push(requestId);
				return true;
			},
			readImageSequenceDecode: async (request) => {
				journey.decodeReads.push(structuredClone(request));
				return decoded.slice(request.offset, request.offset + request.length);
			},
			releaseImageSequenceDecode: async ({ claimId }) => {
				journey.decodeReleases.push(claimId);
				return true;
			},
			selectRoot: async () => ({
				grantId: 'a'.repeat(16), displayName: 'Exports', revoked: false,
			}),
			revalidateRoot: async () => true,
			stageLiveRenderInputs: async (request) => {
				journey.stages.push(structuredClone(request));
				return {
					stageId: STAGE_ID,
					carrierByteLength: request.carrierByteLength,
					scratchByteLength: Math.max(1, request.carrierByteLength),
				};
			},
			enqueue: async (request) => {
				journey.enqueues.push(structuredClone(request));
				return {};
			},
			writeLiveRenderInput: async (request) => {
				journey.liveBytes += request.bytes.byteLength;
				return {
					sequence: request.sequence,
					receivedBytes: request.offset + request.bytes.byteLength,
				};
			},
			completeLiveRenderInput: async (request) => {
				journey.liveCompletions.push(structuredClone(request));
				return { byteLength: request.byteLength, sha256: request.sha256 };
			},
			abandonRenderInputs: async () => true,
		};
		Object.defineProperty(globalThis, '__nativeSequenceJourney', {
			configurable: true,
			value: journey,
		});
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true,
			enumerable: true,
			value: Object.freeze({
				v1: Object.freeze({
					getExternalFfmpegStatus: async () => ({
						state: 'unconfigured',
						location: null,
						version: null,
						detail: '',
						canInstall: false,
						canBrowse: false,
						canClear: false,
					}),
					nativeServices: Object.freeze(nativeServices),
					readNativeTierControls: async () => ({
						probeHelperEnabled: false,
						probeHelperQuarantined: false,
						audioHelperEnabled: false,
						audioHelperQuarantined: false,
						nativeEffectDiscoveryEnabled: false,
					}),
					applyNativeTierControl: async () => ({
						probeHelperEnabled: false,
						probeHelperQuarantined: false,
						audioHelperEnabled: false,
						audioHelperQuarantined: false,
						nativeEffectDiscoveryEnabled: false,
					}),
				}),
			}),
		});
	});
}
