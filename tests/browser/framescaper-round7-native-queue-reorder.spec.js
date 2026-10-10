/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, getMenuItem, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { openNativePreferences } from './helpers/assistance-task-menu.js';

const IDS = ['1a', '2b', '3c'].map((suffix) => suffix.repeat(20));

test('Background jobs reorders pending work after cancelling an earlier job', async ({ page }) => {
	const clientErrors = [];
	page.on('pageerror', (error) => clientErrors.push(error.message));
	await installQueueFixture(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await openNativePreferences(page, editor, 'Media', 'Native media and scratch');
	let dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await dialog.locator('[data-native-service-preference="native-media"]').check();
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	const tools = await openNestedCommandMenu(page, editor, 'Tools', []);
	await getMenuItem(tools, 'Background jobs').click();
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	const row = (jobId) => dialog.locator(`[data-native-queue-job="${jobId}"]`);
	const order = () => dialog.locator('[data-native-queue-job]').evaluateAll(
		(rows) => rows.map((element) => element.getAttribute('data-native-queue-job')),
	);
	await row(IDS[1]).getByRole('button', { name: 'Move earlier', exact: true }).click();
	await expect.poll(order).toEqual([IDS[1], IDS[0], IDS[2]]);
	await row(IDS[1]).getByRole('button', { name: 'Move later', exact: true }).click();
	await expect.poll(order).toEqual(IDS);
	await row(IDS[0]).getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(row(IDS[0])).toContainText('cancelled');
	await row(IDS[2]).getByRole('button', { name: 'Move earlier', exact: true }).click();
	await expect.poll(order).toEqual([IDS[0], IDS[2], IDS[1]]);
	await expect(row(IDS[2]).getByRole('button', { name: 'Move earlier', exact: true })).toBeDisabled();
	await expect(row(IDS[1]).getByRole('button', { name: 'Move later', exact: true })).toBeDisabled();
	await row(IDS[2]).getByRole('button', { name: 'Move later', exact: true }).click();
	await expect.poll(order).toEqual(IDS);
	await expect(row(IDS[0]).getByRole('button', { name: 'Move earlier', exact: true })).toBeDisabled();
	await expect(row(IDS[0]).getByRole('button', { name: 'Move later', exact: true })).toBeDisabled();
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	expect(clientErrors).toEqual([]);
});

async function installQueueFixture(page) {
	await page.addInitScript((ids) => {
		const preferences = {
			nativeMediaEnabled: false, hardwareDecodeEnabled: false,
			hardwareEncodeEnabled: false, ofxConsentEnabled: false,
		};
		let queue = ids.map((jobId, position) => ({
			jobId, schemaFamily: 'framescaper', schemaVersion: 1, taskKind: 'encoded-export',
			projectId: 'project-1', relativeDestination: `exports/job-${String(position + 1)}.mp4`,
			state: 'queued', position, progress: null, attempt: 0, lastFailureCode: null,
		}));
		const isPending = ({ state }) => ['queued', 'paused', 'blocked', 'needs-authorization'].includes(state);
		const nativeServices = {
			snapshot: async () => ({
				snapshotVersion: 1, runtimeAvailable: true,
				nativeMediaEnabled: preferences.nativeMediaEnabled,
				queue: structuredClone(queue), roots: [], watchRules: [],
			}),
			control: async ({ jobId, action }) => {
				if (action !== 'cancel') throw new Error(`Unexpected queue action ${action}`);
				queue = queue.map((job) => job.jobId === jobId ? { ...job, state: 'cancelled' } : job);
				return structuredClone(queue.find((job) => job.jobId === jobId));
			},
			reorder: async ({ jobId, index }) => {
				// The real repository's index addresses pending jobs; terminal/running
				// positions remain fixed. The mounted fixture also uses that repository.
				const pending = queue.filter(isPending);
				const positions = pending.map(({ position }) => position);
				const from = pending.findIndex((job) => job.jobId === jobId);
				if (from < 0) throw new Error('The job is not reorderable.');
				const [job] = pending.splice(from, 1);
				pending.splice(Math.min(index, pending.length), 0, job);
				pending.forEach((entry, offset) => { entry.position = positions[offset]; });
				queue.sort((left, right) => left.position - right.position);
				return structuredClone(queue);
			},
			remove: async () => false,
			preferences: async () => ({ ...preferences }),
			setPreference: async ({ preference, enabled }) => {
				if (preference !== 'native-media') throw new Error(`Unexpected preference ${preference}`);
				preferences.nativeMediaEnabled = enabled;
				return enabled;
			},
			capabilities: async () => ({
				snapshotVersion: 1, masterEnabled: preferences.nativeMediaEnabled, buildFingerprint: null,
				entries: [{
					domain: 'queue', id: 'persistent-render-queue',
					state: preferences.nativeMediaEnabled ? 'available' : 'disabled',
					reason: preferences.nativeMediaEnabled ? 'ready' : 'master-switch-off',
					userEnabled: preferences.nativeMediaEnabled, buildFingerprint: null, detail: null,
				}],
			}),
		};
		const controls = {
			probeHelperEnabled: false, probeHelperQuarantined: false,
			audioHelperEnabled: false, audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: false,
		};
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true, enumerable: true, value: Object.freeze({ v1: Object.freeze({
				getExternalFfmpegStatus: async () => ({
					state: 'unconfigured', location: null, version: null, detail: '',
					canInstall: false, canBrowse: false, canClear: false,
				}),
				nativeServices: Object.freeze(nativeServices),
				readNativeTierControls: async () => ({ ...controls }),
				applyNativeTierControl: async () => ({ ...controls }),
			}) }),
		});
	}, IDS);
}
