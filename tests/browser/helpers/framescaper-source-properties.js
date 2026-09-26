import { expect } from '@playwright/test';

/** Open source facts from the imported video's Project Bin action menu. */
export async function openFramescaperSourcePropertiesFromBin(page, editor, name) {
	await editor.getByRole('button', { name: `More file actions: ${name}`, exact: true }).click();
	await page.locator('.kw-audio-editor__project-bin-menu')
		.getByRole('menuitem', { name: 'Source properties', exact: true }).click();
	const properties = page.getByRole('dialog', { name: 'Source properties', exact: true });
	await expect(properties).toBeVisible();
	await expect(properties.locator('[data-source-properties]'))
		.not.toHaveAttribute('data-source-properties', 'empty');
	return properties;
}
