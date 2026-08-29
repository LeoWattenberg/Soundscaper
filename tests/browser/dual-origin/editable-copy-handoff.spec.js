/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	expect,
	longTone,
	test,
	toneA,
	toneB,
	TRANSLATIONS_ROOT,
} from '../audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	clipByName,
	importFiles,
} from '../audio-editor-test-helpers.js';
import {
	FRAMESCAPER_DATABASE_NAME,
	SOUNDSCAPER_DATABASE_NAME,
} from '../helpers/editor-databases.js';

const SOUNDSCAPER_ORIGIN = 'http://127.0.0.1:4332';
const FRAMESCAPER_ORIGIN = 'http://127.0.0.1:4333';

test('the built product origins exchange independent editable copies in both directions', async ({ context }) => {
	await context.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		headers: { 'Access-Control-Allow-Origin': '*' },
		body: JSON.stringify({ schemaVersion: 1, locales: {} }),
	}));

	await assertTransferResponsePolicies(context.request);
	await exerciseEditableCopy(context, {
		sourceOrigin: SOUNDSCAPER_ORIGIN,
		destinationOrigin: FRAMESCAPER_ORIGIN,
		sourceProduct: 'soundscaper',
		destinationProduct: 'framescaper',
		sourceDatabase: SOUNDSCAPER_DATABASE_NAME,
		destinationDatabase: FRAMESCAPER_DATABASE_NAME,
		media: longTone,
		destinationMedia: toneB,
		renamedClip: 'Framescaper editable copy',
	});
	await exerciseEditableCopy(context, {
		sourceOrigin: FRAMESCAPER_ORIGIN,
		destinationOrigin: SOUNDSCAPER_ORIGIN,
		sourceProduct: 'framescaper',
		destinationProduct: 'soundscaper',
		sourceDatabase: FRAMESCAPER_DATABASE_NAME,
		destinationDatabase: SOUNDSCAPER_DATABASE_NAME,
		media: longTone,
		destinationMedia: toneA,
		renamedClip: 'Soundscaper editable copy',
	});
});

async function exerciseEditableCopy(context, options) {
	const source = await context.newPage();
	let receiver = null;
	let sourceVerifier = null;
	try {
		const editor = await bootEditor(source, `${options.sourceOrigin}/embed/en/`);
		await expect(editor).toHaveAttribute('data-product', options.sourceProduct);
		await importFiles(editor, [options.media]);
		await expect(clipByName(editor, options.media.name)).toBeVisible();
		const sourceProjectId = await editor.getAttribute('data-project-id');
		expect(sourceProjectId).toBeTruthy();
		await saveProject(source, editor);
		const sourceBefore = await persistedProject(source, options.sourceDatabase, sourceProjectId);
		expect(sourceBefore).not.toBeNull();
		const sourceBytesBefore = JSON.stringify(sourceBefore);

		await editor.getByRole('menuitem', { name: 'File', exact: true }).click();
		const action = source.getByRole('menu', { name: 'File', exact: true })
			.getByRole('menuitem', { name: new RegExp(`^Edit in ${productName(options.destinationProduct)}`) });
		await expect(action).toBeEnabled();
		await action.click();
		await expect(source).toHaveURL((url) => (
			url.origin === options.sourceOrigin
			&& url.pathname === '/transfer/send/'
			&& url.searchParams.has('handoff')
		));
		const intent = launchIntent(source.url());
		expect(intent).toMatchObject({
			kind: 'cross-product-editable-copy',
			version: 1,
			source: {
				projectId: sourceProjectId,
				schemaFamily: options.sourceProduct,
				schemaVersion: 1,
			},
			destination: {
				schemaFamily: options.destinationProduct,
				schemaVersion: 1,
			},
		});
		expect(intent.destination.projectId).not.toBe(sourceProjectId);

		const chosen = source.locator('input[data-transfer-choice]:checked');
		await expect(chosen).toHaveCount(1);
		await source.getByRole('button', {
			name: `Send the ticked projects to ${options.destinationOrigin}`,
			exact: true,
		}).click();
		await expect(source.getByText(
			`Send 1 project to ${options.destinationOrigin}? Nothing is removed from this origin.`,
			{ exact: true },
		)).toBeVisible();
		const receiverOpened = source.waitForEvent('popup');
		await source.getByRole('button', { name: 'Yes, send it', exact: true }).click();
		receiver = await receiverOpened;
		await expect(receiver).toHaveURL(`${options.destinationOrigin}/transfer/receive/`);
		expect(await receiver.evaluate(() => globalThis.opener !== null)).toBe(true);
		await expect(receiver.getByRole('heading', {
			name: 'Receive projects from the other product', exact: true,
		})).toBeVisible();

		await expect(source.getByText('Sent 1 of 1 projects.', { exact: false })).toBeVisible();
		await expect(receiver.getByText(/Imported 1 of 1 archives?\./u)).toBeVisible();
		await expect(receiver.getByText(/Conversion ledger: 1 invocation, \d+ classified roots\./u))
			.toBeVisible();
		const conversionRows = receiver.getByRole('listitem')
			.filter({ hasText: `${sourceProjectId} /` });
		await expect(conversionRows.filter({ hasText: /^.+ — copy:/u }).first()).toBeVisible();
		await expect(conversionRows.filter({ hasText: /^.+ — omit-with-report:/u }).first()).toBeVisible();

		await expect.poll(
			() => persistedProject(receiver, options.destinationDatabase, intent.destination.projectId),
			{ timeout: 30_000 },
		).not.toBeNull();
		expect(await persistedProject(source, options.sourceDatabase, intent.destination.projectId)).toBeNull();
		expect(await persistedProject(receiver, options.destinationDatabase, sourceProjectId)).toBeNull();
		expect(JSON.stringify(await persistedProject(source, options.sourceDatabase, sourceProjectId)))
			.toBe(sourceBytesBefore);

		const destinationEditor = await bootEditor(
			receiver,
			`${options.destinationOrigin}/embed/en/?project=${encodeURIComponent(intent.destination.projectId)}`,
		);
		await expect(destinationEditor).toHaveAttribute('data-product', options.destinationProduct);
		await expect(destinationEditor).toHaveAttribute('data-project-id', intent.destination.projectId);
		await expect(destinationEditor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
		const copiedClip = clipByName(destinationEditor, options.media.name);
		await expect(copiedClip).toBeVisible();
		await destinationEditor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(destinationEditor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await destinationEditor.getByRole('button', { name: 'Stop', exact: true }).click();
		await copiedClip.locator('.clip-header__name').dblclick();
		const nameInput = copiedClip.getByRole('textbox', { name: 'Clip name', exact: true });
		await expect(nameInput).toBeFocused();
		await nameInput.fill(options.renamedClip);
		await nameInput.press('Enter');
		await expect(clipByName(destinationEditor, options.renamedClip)).toBeVisible();
		await importFiles(destinationEditor, [options.destinationMedia]);
		await expect(clipByName(destinationEditor, options.destinationMedia.name)).toBeVisible();
		await saveProject(receiver, destinationEditor);
		const destinationMediaTitle = options.destinationMedia.name.replace(/\.[^.]+$/u, '');
		await expect.poll(async () => {
			const destination = await persistedProject(
				receiver, options.destinationDatabase, intent.destination.projectId,
			);
			return destination?.clips?.map(({ title }) => title) ?? [];
		}).toEqual(expect.arrayContaining([options.renamedClip, destinationMediaTitle]));

		sourceVerifier = await context.newPage();
		const reopenedSource = await bootEditor(
			sourceVerifier,
			`${options.sourceOrigin}/embed/en/?project=${encodeURIComponent(sourceProjectId)}`,
		);
		await expect(clipByName(reopenedSource, options.media.name)).toBeVisible();
		await expect(clipByName(reopenedSource, options.renamedClip)).toHaveCount(0);
		await expect(clipByName(reopenedSource, options.destinationMedia.name)).toHaveCount(0);
		await reopenedSource.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(reopenedSource.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await reopenedSource.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(JSON.stringify(await persistedProject(sourceVerifier, options.sourceDatabase, sourceProjectId)))
			.toBe(sourceBytesBefore);
	} finally {
		for (const page of [sourceVerifier, receiver, source]) {
			if (page && !page.isClosed()) await page.close({ runBeforeUnload: false });
		}
	}
}

async function assertTransferResponsePolicies(request) {
	for (const origin of [SOUNDSCAPER_ORIGIN, FRAMESCAPER_ORIGIN]) {
		const sender = await request.get(`${origin}/transfer/send/`);
		expect(sender.status()).toBe(200);
		expect(sender.headers()['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
		expect(sender.headers()['cross-origin-embedder-policy']).toBe('credentialless');
		const receiver = await request.get(`${origin}/transfer/receive/`);
		expect(receiver.status()).toBe(200);
		expect(receiver.headers()['cross-origin-opener-policy']).toBe('unsafe-none');
		expect(receiver.headers()['cross-origin-embedder-policy']).toBe('credentialless');
	}
	const retired = await request.get(`${SOUNDSCAPER_ORIGIN}/framescaper/en/`, { maxRedirects: 0 });
	expect(retired.status()).toBe(301);
	expect(retired.headers().location).toBe('https://framescaper.org/en/');
}

function productName(productId) {
	return productId === 'framescaper' ? 'Framescaper' : 'Soundscaper';
}

function launchIntent(url) {
	const encoded = new URL(url).searchParams.get('handoff');
	expect(encoded).toBeTruthy();
	return JSON.parse(encoded);
}

async function saveProject(page, editor) {
	await chooseFileAction(page, editor, 'Save project');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
}

async function persistedProject(page, databaseName, projectId) {
	return page.evaluate(({ name, id }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(name);
		open.onerror = () => reject(open.error || new Error(`Could not open ${name}.`));
		open.onsuccess = () => {
			const database = open.result;
			if (!database.objectStoreNames.contains('projects')) {
				database.close();
				resolve(null);
				return;
			}
			const read = database.transaction('projects').objectStore('projects').get(id);
			read.onerror = () => {
				database.close();
				reject(read.error || new Error(`Could not read ${id}.`));
			};
			read.onsuccess = () => {
				const project = read.result;
				database.close();
				resolve(project ? JSON.parse(JSON.stringify(project)) : null);
			};
		};
	}), { name: databaseName, id: projectId });
}
