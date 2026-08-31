/* SPDX-License-Identifier: AGPL-3.0-only */

/** One target's authenticated build, install, self-test, and build-result pipeline. */

import { spawnSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

import {
	createSoundscaperProfessionalNativeBuildResult,
} from './soundscaper-professional-native-build-result.mjs';
import {
	executeSoundscaperProfessionalNativeBuild,
} from './soundscaper-professional-native-build.mjs';
import {
	executeOsAudioCodecHostBuild,
} from './os-audio-codec-host-build.mjs';
import {
	MAXIMUM_SELF_TEST_OUTPUT_BYTES,
	canonicalJson,
	sha256,
	targetId,
} from './soundscaper-professional-native-build-result-contract.mjs';
import {
	assertAuthenticatedSoundscaperProfessionalNativeSelfTestPlan,
	requiredPipelineSoundscaperProfessionalNativeSelfTestIds,
	verifyAuthenticatedSoundscaperProfessionalNativeSelfTestPlan,
} from './soundscaper-professional-native-self-test-plan.mjs';
import {
	createSoundscaperProfessionalNativeMacCodeSealPlan,
	executeSoundscaperProfessionalNativeMacCodeSealPlan,
} from './soundscaper-professional-native-macos-code-seal.mjs';
import {
	soundscaperProfessionalNativeIsolationConfigureArguments,
} from './soundscaper-professional-native-target-build.mjs';
import {
	readSoundscaperProfessionalNativeToolchainReceipt,
	soundscaperProfessionalNativeToolchainIdentity,
} from './soundscaper-professional-native-toolchain.mjs';
import {
	soundscaperProfessionalNativeProcessFailureMessage as soundscaperProfessionalNativePipelineFailureMessage,
} from './soundscaper-professional-native-process-diagnostics.mjs';

export { soundscaperProfessionalNativePipelineFailureMessage };

const AUTHENTICATED_PIPELINE_PLANS = new WeakSet();

export function requiredExternalSoundscaperProfessionalNativeSelfTestIds(targetValue) {
	return requiredPipelineSoundscaperProfessionalNativeSelfTestIds(targetValue);
}

export function createSoundscaperProfessionalNativeBuildResultPipelinePlan(options) {
	const target = targetId(options?.target);
	if (options?.professionalBuildPlan?.target !== target) {
		throw new TypeError('The professional build plan target is misbound.');
	}
	if (target.startsWith('linux-') ? options.osAudioCodecBuildPlan !== null
		: options?.osAudioCodecBuildPlan?.target !== target) {
		throw new TypeError('The OS audio codec build-plan target is misbound.');
	}
	if (target === 'mac-arm64'
		&& JSON.stringify(options.osAudioCodecBuildPlan.codeSeal) !== JSON.stringify({ mode: 'ad-hoc' })) {
		throw new TypeError('The professional and OS codec execution seals are misbound.');
	}
	const selfTestPlan = assertAuthenticatedSoundscaperProfessionalNativeSelfTestPlan(
		options?.selfTestPlan,
	);
	const isolationBuildRoot = absolutePath(options?.isolationBuildRoot, 'isolation build root');
	const isolationInstallRoot = absolutePath(options?.isolationInstallRoot, 'isolation install root');
	const repositoryRoot = absolutePath(options?.repositoryRoot, 'repository root');
	const buildResultRoot = absolutePath(options?.buildResultRoot, 'build-result root');
	const runtimeRoot = options?.runtimeRoot === null ? null
		: absolutePath(options?.runtimeRoot, 'runtime root');
	if (target === 'mac-arm64' && runtimeRoot === null) {
		throw new TypeError('The mac professional build result requires a runtime closure root.');
	}
	const sourceRevision = revisionValue(options?.sourceRevision);
	if (selfTestPlan.target !== target || selfTestPlan.sourceRevision !== sourceRevision) {
		throw new TypeError('The professional self-test authority is target or revision misbound.');
	}
	const selfTestCommands = selfTestPlan.commands;
	const isolationSourceRoot = resolve(repositoryRoot, 'native/milestone-5-native-isolation-launcher');
	const isolationSteps = Object.freeze([
		command('cmake', soundscaperProfessionalNativeIsolationConfigureArguments({
			target, sourceRoot: isolationSourceRoot, buildRoot: isolationBuildRoot,
		})),
		command('cmake', ['--build', isolationBuildRoot, '--config', 'Release', '--parallel']),
		command('cmake', ['--install', isolationBuildRoot, '--config', 'Release',
			'--prefix', isolationInstallRoot]),
	]);
	const identity = {
		schemaVersion: 1, target, sourceRevision,
		professional: commandIdentity(options.professionalBuildPlan),
		osAudioCodec: options.osAudioCodecBuildPlan === null
			? null : commandIdentity(options.osAudioCodecBuildPlan),
		macCodeSeal: target === 'mac-arm64' ? { method: 'codesign-ad-hoc' } : null,
		isolationSteps,
		selfTestAuthority: selfTestPlan.authority,
		selfTestCommands,
	};
	const plan = deepFreeze({
		...identity,
		repositoryRoot, buildResultRoot, runtimeRoot, isolationBuildRoot, isolationInstallRoot,
		professionalBuildPlan: options.professionalBuildPlan,
		osAudioCodecBuildPlan: options.osAudioCodecBuildPlan,
		selfTestPlan,
		buildPlanSha256: sha256(canonicalJson(identity)),
	});
	AUTHENTICATED_PIPELINE_PLANS.add(plan);
	return plan;
}

export async function executeSoundscaperProfessionalNativeBuildResultPipeline(plan, options = {}) {
	if (!AUTHENTICATED_PIPELINE_PLANS.has(plan)) {
		throw new TypeError('Build-result execution requires an authenticated pipeline plan.');
	}
	const run = options.run ?? spawnSync;
	const executeProfessional = options.executeProfessional
		?? executeSoundscaperProfessionalNativeBuild;
	const executeOsCodec = options.executeOsCodec ?? executeOsAudioCodecHostBuild;
	const createBuildResult = options.createBuildResult ?? createSoundscaperProfessionalNativeBuildResult;
	const createMacCodeSealPlan = options.createMacCodeSealPlan
		?? createSoundscaperProfessionalNativeMacCodeSealPlan;
	const executeMacCodeSeal = options.executeMacCodeSeal
		?? executeSoundscaperProfessionalNativeMacCodeSealPlan;
	const professional = executeProfessional(plan.professionalBuildPlan, { run });
	const osOutput = [];
	const osAudioCodec = plan.osAudioCodecBuildPlan === null ? null
		: executeOsCodec(plan.osAudioCodecBuildPlan, {
			run,
			onStepOutput(step, stdout, stderr) {
				osOutput.push(`${step.command}\0${step.argv.join('\0')}\0${stdout}\0${stderr}`);
			},
	});
	for (const step of plan.isolationSteps) runStep(run, step, 'isolation build');
	const macCodeSealResult = plan.target === 'mac-arm64'
		? await executeMacCodeSeal(createMacCodeSealPlan({
			target: plan.target,
			professionalInstallRoot: professional.installRoot,
			isolationInstallRoot: plan.isolationInstallRoot,
			osAudioCodecInstallRoot: plan.osAudioCodecBuildPlan.installRoot,
			runtimeRoot: plan.runtimeRoot,
		}), { run })
		: null;
	const buildSelfTests = [];
	for (const request of plan.selfTestCommands) {
		verifyAuthenticatedSoundscaperProfessionalNativeSelfTestPlan(plan.selfTestPlan, {
			verifyPackagedApp: request.id === 'packaged-electron-utility-process-smoke',
		});
		const result = runStep(run, request, `self-test ${request.id}`);
		buildSelfTests.push(...soundscaperProfessionalNativePipelineSelfTestReceipts(
			request, result,
		));
	}
	if (osAudioCodec !== null) {
		const request = {
			id: 'os-audio-codec-ctest', command: 'ctest',
			args: plan.osAudioCodecBuildPlan.nativeCanary.argv,
			expectedStatus: 0,
		};
		buildSelfTests.push({
			id: request.id, status: 'passed',
			commandSha256: sha256(canonicalJson(request)),
			outputSha256: sha256(osOutput.join('\n')),
		});
	}
	const toolchainReceipt = await readSoundscaperProfessionalNativeToolchainReceipt({
		target: plan.target,
		professionalBuildRoot: plan.professionalBuildPlan.buildRoot,
		isolationBuildRoot: plan.isolationBuildRoot,
		osAudioCodec: osAudioCodec?.toolchainIdentity ?? null,
	});
	const toolchainIdentity = soundscaperProfessionalNativeToolchainIdentity(toolchainReceipt);
	return createBuildResult({
		target: plan.target,
		buildResultRoot: plan.buildResultRoot,
		professionalInstallRoot: professional.installRoot,
		isolationInstallRoot: plan.isolationInstallRoot,
		runtimeRoot: plan.runtimeRoot,
		...(osAudioCodec === null ? {} : {
			osAudioCodecInstallRoot: plan.osAudioCodecBuildPlan.installRoot,
		}),
		sourceRevision: plan.sourceRevision,
		packagedAppAuthority: plan.selfTestPlan.authority.packagedApp,
		buildPlanSha256: plan.buildPlanSha256,
		toolchainIdentity,
		toolchainReceipt,
		sourceAuthentication: professional.sourceAuthentication,
		buildSelfTests,
		macCodeSealResult,
		...(options.inspectDependencies ? { inspectDependencies: options.inspectDependencies } : {}),
		...(options.runInstalledSelfTest ? { runSelfTest: options.runInstalledSelfTest } : {}),
	});
}

function runStep(run, step, label) {
	const args = step.argv ?? step.args;
	const result = run(step.command, args, {
		encoding: 'utf8', shell: false, maxBuffer: MAXIMUM_SELF_TEST_OUTPUT_BYTES,
		env: { ...process.env, SOURCE_DATE_EPOCH: '0', TZ: 'UTC', LC_ALL: 'C' },
	});
	if (!result || result.error !== undefined || result.signal !== null
		|| result.status !== (step.expectedStatus ?? 0)
		|| typeof (result.stdout ?? '') !== 'string' || typeof (result.stderr ?? '') !== 'string') {
		throw new Error(soundscaperProfessionalNativePipelineFailureMessage(label, result));
	}
	const output = Buffer.from(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
	if (output.byteLength > MAXIMUM_SELF_TEST_OUTPUT_BYTES) {
		throw new RangeError(`Professional native ${label} exceeded its output bound.`);
	}
	return { ...result, output };
}

export function soundscaperProfessionalNativePipelineSelfTestReceipts(request, result) {
	const receipts = [testReceipt(request, result)];
	if (request.id === 'packaged-electron-utility-process-smoke') {
		receipts.push(testReceipt(request, result, 'addon-exact-backend-format-inventory'));
	}
	return Object.freeze(receipts);
}

function testReceipt(request, result, receiptId = request.id) {
	const command = {
		id: receiptId, command: request.command, args: request.args,
		expectedStatus: request.expectedStatus,
		...(receiptId === request.id ? {} : { evidenceSourceId: request.id }),
	};
	return Object.freeze({
		id: receiptId, status: 'passed',
		commandSha256: sha256(canonicalJson(command)),
		outputSha256: sha256(result.output),
	});
}

function command(command_, args, id = undefined, expectedStatus = undefined) {
	return Object.freeze({
		...(id === undefined ? {} : { id }), command: command_,
		...(id === undefined ? { argv: Object.freeze([...args]) }
			: { args: Object.freeze([...args]), expectedStatus }),
	});
}

function commandIdentity(plan) {
	const fields = ['configure', 'build', 'test', 'install', 'nativeCanary', 'sign',
		'signatureVerification'];
	return Object.freeze(Object.fromEntries(fields
		.filter((field) => plan?.[field] !== undefined)
		.map((field) => [field, plan[field]])));
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0')) throw new TypeError(`The ${label} must be an absolute normalized path.`);
	return value;
}

function revisionValue(value) {
	if (typeof value !== 'string' || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(value)) {
		throw new TypeError('The build-result source revision is invalid.');
	}
	return value;
}

function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}
