import { auditHandbookContent } from './lib/handbook-content-check.mjs';

const report = await auditHandbookContent('handbook/src/content/docs');
if (report.errors.length) {
	for (const error of report.errors) console.error(error);
	process.exitCode = 1;
} else {
	console.log(`Checked ${report.pages} handbook pages.`);
}
