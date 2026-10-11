/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const modulePath = fileURLToPath(new URL('../scripts/lib/motionscaper_native_chooser_paths.py', import.meta.url));
const inspect = async (cases: readonly (readonly string[])[]) => {
	const program = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('motion_paths',sys.argv[1])
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
results=[]
for args in json.loads(sys.argv[2]):
 try: results.append({'accepted':True,'result':module.validate_arguments(args)})
 except ValueError: results.append({'accepted':False})
print(json.dumps(results))`;
	const result = await promisify(execFile)('python3', ['-B', '-E', '-s', '-c', program, modulePath, JSON.stringify(cases)],
		{ env: { ...process.env, DISPLAY: '' }, maxBuffer: 65536, timeout: 5000 });
	return JSON.parse(result.stdout) as unknown;
};
test('Motionscaper sustained chooser admits exact own duration outputs without changing default scene routing', async () => {
	const scene = '/tmp/motionscaper-native-scene-owned_1', owned = '/tmp/motionscaper-sustained-owned_1';
	const cases = [[`${scene}/saved.mscape`], [`${scene}/output.mov`], ['--sustained', `${owned}/input.mscape`]];
	const expected: unknown[] = [{ accepted: true, result: [`${scene}/saved.mscape`, false] }, { accepted: true, result: [`${scene}/output.mov`, true] },
		{ accepted: true, result: [`${owned}/input.mscape`, false] }];
	for (const frames of [300, 1200]) for (const name of ['output.mov', 'native-upload-cancel.mov', 'native-upload-retry.mov', 'native-encode-cancel.mov', 'native-encode-retry.mov']) {
		const path = `${owned}/${frames}/${name}`; cases.push(['--sustained', path]); expected.push({ accepted: true, result: [path, true] });
	}
	assert.deepEqual(await inspect(cases), expected);
});
test('Motionscaper sustained chooser refuses foreign paths, extra arguments, wrong modes and unowned output names', async () => {
	const owned = '/tmp/motionscaper-sustained-owned';
	const paths = [
		`${owned}/output.mov`, `${owned}/300/input.mscape`, `${owned}/301/output.mov`, `${owned}/300/other.mov`, `${owned}/300/native-upload.mov`,
		`${owned}/300/output.MOV`, `${owned}/300/output.mov/extra`, `${owned}/300/../output.mov`, `${owned}/300/output.mov\n`,
		'/tmp/motionscaper-sustained-/input.mscape', '/tmp/foreign/input.mscape', '/tmp/motionscaper-native-scene-owned/saved.mscape',
	];
	const cases = paths.map(path => ['--sustained', path]);
	cases.push([`${owned}/input.mscape`], ['--sustained'], ['--sustained', `${owned}/input.mscape`, 'extra'], ['--other', `${owned}/input.mscape`], []);
	assert.deepEqual(await inspect(cases), cases.map(() => ({ accepted: false })));
});
