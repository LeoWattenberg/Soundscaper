import { expect } from '../audio-editor-test-fixtures.js';
import {
	assertAccessibleBasics,
	assertNoSeriousAxeViolations,
	openNestedCommandMenu,
} from '../audio-editor-test-helpers.js';

/** Verify the opt-in report while keeping the editor workspace geometry stable. */
export async function inspectProjectCompatibilityReport(page, editor) {
	const summary = editor.locator('[data-project-feature-compatibility-summary]');
	await expect(summary).toBeVisible();
	await expect(summary.locator('[data-editor-toast]')).toHaveAccessibleName('Project features unavailable');
	await expect(summary).toContainText('This project is read-only');
	await expect(editor.locator('[data-project-feature-compatibility]')).toHaveCount(0);
	const workspace = editor.locator('.kw-audio-editor__workspace');
	const workspaceBefore = await workspace.boundingBox();
	const editorBounds = await editor.boundingBox();
	const summaryBounds = await summary.boundingBox();
	expect(summaryBounds.width).toBeLessThan(editorBounds.width * 0.75);

	const viewReport = summary.getByRole('button', { name: 'View report', exact: true });
	await viewReport.click();
	const reportDialog = page.getByRole('dialog', { name: 'Project compatibility report', exact: true });
	await expect(reportDialog).toBeVisible();
	await expect(reportDialog).toBeFocused();
	const notice = reportDialog.locator('[data-project-feature-compatibility]');
	await expect(notice).toHaveAccessibleName('Project features unavailable');
	await expect(notice.locator('[data-project-feature-unavailable-count]')).toHaveText('1');
	await expect(notice.locator('[data-project-feature-unknown-count]')).toHaveText('1');
	const bypassed = notice.locator('[data-project-feature-requirement="org.soundscaper.capability.video-effects"]');
	await expect(bypassed).toBeVisible();
	await expect(bypassed).toContainText('Video effects');
	await expect(bypassed).toContainText('Unavailable · Bypass declared');
	await expect(bypassed).toHaveAttribute('data-declared-disposition', 'bypass');
	await expect(bypassed).toHaveAttribute('data-effective-disposition', 'bypassed');
	const rendered = notice.locator('[data-project-feature-requirement="org.example.future-mixer"]');
	await expect(rendered).toBeVisible();
	await expect(rendered).toContainText('Future mixer');
	await expect(rendered).toContainText('Unknown · Rendered fallback declared');
	await expect(rendered).toHaveAttribute('data-declared-disposition', 'rendered-fallback');
	await expect(rendered).toHaveAttribute('data-effective-disposition', 'rendered-fallback');
	await expect(rendered.locator('[data-project-feature-audio-rendered-fallback]')).toHaveCount(0);
	await expect(notice.getByRole('button')).toHaveCount(0);
	await expect(notice).not.toContainText(/plug-?in|third-party|feature code/iu);
	await notice.focus();
	await expect(notice).toBeFocused();
	await assertAccessibleBasics(notice);
	await assertNoSeriousAxeViolations(page, '[data-project-compatibility-report-dialog]');
	await page.keyboard.press('Escape');
	await expect(reportDialog).toBeHidden();
	await expect(viewReport).toBeFocused();
	await viewReport.click();
	await expect(reportDialog).toBeVisible();
	await expect(rendered).toContainText('Future mixer');
	await page.keyboard.press('Escape');
	await expect(reportDialog).toBeHidden();

	await summary.getByRole('button', { name: 'Dismiss compatibility summary', exact: true }).click();
	await expect(summary).toHaveCount(0);
	expect(await workspace.boundingBox()).toEqual(workspaceBefore);
	const fileMenu = await openNestedCommandMenu(page, editor, 'File', []);
	await expect(fileMenu.getByRole('menuitem', { name: 'Project compatibility report', exact: true })).toHaveCount(0);
	await expect(fileMenu.getByRole('menuitem', { name: 'AUP4 Compatibility Report', exact: true })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(reportDialog).toBeHidden();
	await expect(editor.getByRole('menuitem', { name: 'File', exact: true })).toBeFocused();
	return { notice, rendered };
}


export async function openProjectCompatibilityReport(page, editor) {
	await editor.locator('[data-project-feature-compatibility-summary]')
		.getByRole('button', { name: 'View report', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Project compatibility report', exact: true })).toBeVisible();
}
