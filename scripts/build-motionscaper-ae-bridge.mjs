/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse } from 'acorn';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'src/motionscaper/ae-bridge');
const modules = [
	{ name: 'motion-ae-host-json', global: 'MotionAeHostJson', exports: ['parseMotionAeHostJson', 'stringifyMotionAeHostJson'] },
	{ name: 'motion-ae-host-sampling', global: 'MotionAeHostSampling', exports: ['sampleMotionAeNumericProperty'] },
	{ name: 'motion-ae-host-property', global: 'MotionAeHostProperty', exports: ['readMotionAeHostProperty'] },
	{ name: 'motion-ae-host-render', global: 'MotionAeHostRender', exports: ['renderMotionAeHostComposition'] },
	{ name: 'motion-ae-installed-render', global: 'MotionAeInstalledRender', exports: ['readMotionAePngHeader', 'renderMotionAeInstalledComposition'] },
	{ name: 'motion-ae-host-export', global: 'MotionAeHostExport', exports: ['exportMotionAeHostProject'] },
	{ name: 'motion-ae-installed-export', global: 'MotionAeInstalledExport', exports: ['runMotionAeInstalledExport'] },
	{ name: 'motion-ae-host-sha256', global: 'MotionAeHostSha256', exports: ['createMotionAeHostSha256'] },
	{ name: 'motion-ae-host-import-plan', global: 'MotionAeHostImportPlan', exports: ['prepareMotionAeHostImport'] },
	{ name: 'motion-ae-host-import', global: 'MotionAeHostImport', exports: ['importMotionAeHostPlan'] },
	{ name: 'motion-ae-installed-import', global: 'MotionAeInstalledImport', exports: ['runMotionAeInstalledImport'] },
];
const check = process.argv.includes('--check');
let stale = false;
await mkdir(directory, { recursive: true });
for (const module of modules) {
	const source = await readFile(resolve(root, 'src/common/editor', `${module.name}.ts`), 'utf8');
	const tree = ts.createSourceFile(`${module.name}.ts`, source, ts.ScriptTarget.Latest, true);
	const replacements = [], bindings = [];
	for (const statement of tree.statements) {
		if (ts.isImportDeclaration(statement)) {
			replacements.push({ start: statement.getStart(tree), end: statement.end, text: '' });
			if (statement.importClause?.isTypeOnly) continue;
			const imported = modules.find((item) => `./${item.name}.ts` === statement.moduleSpecifier.text);
			const clause = statement.importClause?.namedBindings;
			if (clause && ts.isNamedImports(clause)) for (const item of clause.elements) {
				if (item.isTypeOnly) continue;
				if (!imported) throw new Error(`Unregistered bridge runtime import in ${module.name}.`);
				bindings.push(`var ${item.name.text} = ${imported.global}.${item.propertyName?.text ?? item.name.text};`);
			}
		} else if (statement.modifiers) for (const modifier of statement.modifiers) {
			if (modifier.kind === ts.SyntaxKind.ExportKeyword) replacements.push({ start: modifier.getStart(tree), end: modifier.end, text: '' });
		}
	}
	let stripped = source;
	for (const replacement of replacements.sort((a, b) => b.start - a.start)) stripped = stripped.slice(0, replacement.start) + replacement.text + stripped.slice(replacement.end);
	const compiled = ts.transpileModule(stripped, { compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None, removeComments: false, newLine: ts.NewLineKind.LineFeed },
		transformers: { before: [(context) => {
			const visit = (node) => {
				const next = ts.visitEachChild(node, visit, context);
				if (ts.isObjectLiteralExpression(next)) return ts.factory.updateObjectLiteralExpression(next, ts.factory.createNodeArray(next.properties, false));
				if (ts.isArrayLiteralExpression(next)) return ts.factory.updateArrayLiteralExpression(next, ts.factory.createNodeArray(next.elements, false));
				return next;
			};
			return (sourceFile) => ts.visitNode(sourceFile, visit);
		}] },
	}).outputText;
	const output = `/* SPDX-License-Identifier: AGPL-3.0-only */\n/* Generated from strict TypeScript by scripts/build-motionscaper-ae-bridge.mjs. */\nvar ${module.global} = (function () {\n${bindings.join('\n')}\n${compiled}\nreturn { ${module.exports.map((name) => `${name}: ${name}`).join(', ')} };\n}());\n`;
	try { parse(output, { ecmaVersion: 3 }); } catch (error) { throw new Error(`${module.name}: ${error.message}; ${output.split('\n')[error.loc.line - 1]}`, { cause: error }); }
	await publish(`${module.name}.jsxinc`, output);
}
await publish('Motionscaper-Export.jsx.txt', entry(modules.slice(0, 7), 'MotionAeInstalledExport.runMotionAeInstalledExport();'));
await publish('Motionscaper-Export-Sampled.jsx.txt', entry(modules.slice(0, 7), 'MotionAeInstalledExport.runMotionAeInstalledExport(true);'));
await publish('Motionscaper-Export-Rendered.jsx.txt', entry(modules.slice(0, 7), 'MotionAeInstalledExport.runMotionAeInstalledExport(false, true);'));
await publish('Motionscaper-Import.jsx.txt', entry([modules[0], ...modules.slice(7)], 'MotionAeInstalledImport.runMotionAeInstalledImport();'));
if (stale) process.exitCode = 1;

function entry(includes, call) {
	return `/* SPDX-License-Identifier: AGPL-3.0-only */\n/* Development bridge: installed-AE qualification is still required. */\n#target aftereffects\n${includes.map((module) => `#include "${module.name}.jsxinc"`).join('\n')}\n${call}\n`;
}

async function publish(name, output) {
	const path = resolve(directory, name);
	if (check) {
		let current = ''; try { current = await readFile(path, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
		if (current !== output) { process.stderr.write(`${name} differs from its strict TypeScript source.\n`); stale = true; }
	} else await writeFile(path, output);
}
