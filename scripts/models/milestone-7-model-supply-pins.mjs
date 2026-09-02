/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pinned upstream identities for Milestone 7 model supply; validators live in milestone-7-model-supply.mjs. */

export const MILESTONE_7_SUPPLY_CANDIDATES = Object.freeze({
	'tiger-dnr-neural-core': Object.freeze({
		framework: 'pytorch',
		codeUrl: 'https://github.com/JusperLee/TIGER',
		codeRevision: '9f18d4a10a7137e1ce8052cfb62215179f1287b6',
		recipeId: 'tiger-dnr-neural-core-onnx-v1',
		parityFixtureId: 'tiger-dnr-parity-v1',
		parityGeneratorId: 'tiger-dnr-audio-v1',
		frameworks: Object.freeze(['source-pytorch', 'onnxruntime-cpu']),
		artifacts: Object.freeze([Object.freeze({
			role: 'dnr-weights', required: true, fileName: 'model.safetensors',
			url: 'https://huggingface.co/JusperLee/TIGER-DnR/resolve/b7a59560bbca10febbcd46fb01600f868e587f57/model.safetensors',
			revision: 'b7a59560bbca10febbcd46fb01600f868e587f57', byteLength: 17_130_568,
			integrity: { algorithm: 'sha256', value: 'dd1c696e72f6adea0085ef1af640882a8260519ad666422835e387a5b4abdd2a' },
		})]),
	}),
	'panns-cnn10': Object.freeze({
		framework: 'pytorch',
		codeUrl: 'https://github.com/qiuqiangkong/audioset_tagging_cnn',
		codeRevision: 'd2f4b8c18eab44737fcc0de1248ae21eb43f6aa4',
		recipeId: 'panns-cnn10-onnx-v1',
		parityFixtureId: 'panns-cnn10-parity-v1',
		parityGeneratorId: 'panns-cnn10-audio-v1',
		frameworks: Object.freeze(['source-pytorch', 'onnxruntime-cpu']),
		artifacts: Object.freeze([
			Object.freeze({
				role: 'cnn10-checkpoint', required: true, fileName: 'Cnn10_mAP=0.380.pth',
				url: 'https://zenodo.org/api/records/3987831/files/Cnn10_mAP=0.380.pth/content',
				revision: '10.5281/zenodo.3987831', byteLength: 25_237_595,
				integrity: { algorithm: 'md5', value: 'bfb1f1f9968938fa8ef4012b8471f5f6' },
			}),
			Object.freeze({
				role: 'audioset-class-map', required: true, fileName: 'class_labels_indices.csv',
				url: 'https://raw.githubusercontent.com/qiuqiangkong/audioset_tagging_cnn/d2f4b8c18eab44737fcc0de1248ae21eb43f6aa4/metadata/class_labels_indices.csv',
				revision: 'd2f4b8c18eab44737fcc0de1248ae21eb43f6aa4', byteLength: 14_675,
				integrity: { algorithm: 'sha256', value: 'cdd1049833c4b86127c2773ac0d14a2754b6a6d0d1798002ed5c66e699708429' },
			}),
		]),
	}),
	'beat-this': Object.freeze({
		framework: 'pytorch',
		codeUrl: 'https://github.com/CPJKU/beat_this',
		codeRevision: 'ad7974846029835307ba19a3d5cefbf40b243041',
		recipeId: 'beat-this-onnx-v1',
		parityFixtureId: 'beat-this-parity-v1',
		parityGeneratorId: 'beat-this-audio-v1',
		frameworks: Object.freeze(['source-pytorch', 'onnxruntime-cpu']),
		artifacts: Object.freeze([
			Object.freeze({
				role: 'small0-checkpoint', required: true, fileName: 'small0.ckpt',
				url: 'https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/small0.ckpt',
				revision: 'v1.1.0', byteLength: 8_451_101,
				integrity: { algorithm: 'sha1', value: '77a7ef5c21f628578f2b259ac29d2d680412efcc' },
			}),
			Object.freeze({
				role: 'final0-checkpoint', required: false, fileName: 'final0.ckpt',
				url: 'https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/final0.ckpt',
				revision: 'v1.1.0', byteLength: 81_058_141,
				integrity: { algorithm: 'sha1', value: 'e1506282faf66ca10e8ab50ee26bd542b7b9ff0a' },
			}),
		]),
	}),
	transnetv2: Object.freeze({
		framework: 'tensorflow',
		codeUrl: 'https://github.com/soCzech/TransNetV2',
		codeRevision: '85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed',
		recipeId: 'transnetv2-onnx-v1',
		parityFixtureId: 'transnetv2-parity-v1',
		parityGeneratorId: 'transnetv2-rgb-v1',
		frameworks: Object.freeze(['source-tensorflow', 'source-pytorch', 'onnxruntime-cpu']),
		artifacts: Object.freeze([
			transNetArtifact('tensorflow-saved-model', 'saved_model.pb', 5_933_260,
				'8ac2a52c5719690d512805b6eaf5ce12097c1d8860b3d9de245dcbbc3100f554',
				'inference/transnetv2-weights/saved_model.pb'),
			transNetArtifact('tensorflow-variables-data', 'variables.data-00000-of-00001', 30_516_656,
				'b8c9dc3eb807583e6215cabee9ca61737b3eb1bceff68418b43bf71459669367',
				'inference/transnetv2-weights/variables/variables.data-00000-of-00001'),
			transNetArtifact('tensorflow-variables-index', 'variables.index', 5_526,
				'8b99e28b4ad11372d9a1ad9703298c2e370df14859da4245fdbe818e92dd403f',
				'inference/transnetv2-weights/variables/variables.index'),
		]),
	}),
	'dereverb-room': Object.freeze({
		framework: 'pytorch',
		codeUrl: 'https://github.com/ZFTurbo/MSS_ONNX_TensorRT',
		codeRevision: '43d939e7671d8ff6cf1922f98c2f2e4b56908e47',
		recipeId: 'dereverb-room-onnx-v1',
		parityFixtureId: 'dereverb-room-parity-v1',
		parityGeneratorId: 'dereverb-room-audio-v1',
		frameworks: Object.freeze(['source-pytorch', 'onnxruntime-cpu']),
		artifacts: Object.freeze([
			Object.freeze({
				role: 'bs-roformer-checkpoint', required: true,
				fileName: 'dereverb_room_anvuew_sdr_13.7432.ckpt',
				url: 'https://huggingface.co/anvuew/dereverb_room/resolve/0b85f5b80b7f779b2dfe80f33a1b35b38af9376d/dereverb_room_anvuew_sdr_13.7432.ckpt',
				revision: '0b85f5b80b7f779b2dfe80f33a1b35b38af9376d', byteLength: 118_128_452,
				integrity: { algorithm: 'sha256', value: '2edec521f09e26341c1923dc82c8c52dbc86478b42b9999f679535743c970cb3' },
			}),
			Object.freeze({
				role: 'bs-roformer-config', required: true,
				fileName: 'dereverb_room_anvuew.yaml',
				url: 'https://huggingface.co/anvuew/dereverb_room/resolve/0b85f5b80b7f779b2dfe80f33a1b35b38af9376d/dereverb_room_anvuew.yaml',
				revision: '0b85f5b80b7f779b2dfe80f33a1b35b38af9376d', byteLength: 1_991,
				integrity: { algorithm: 'sha256', value: 'c37e3039521d79cd1daff129857f69fa80c6a1f383a0fe8cda757f2dfc5032f8' },
			}),
		]),
	}),
});

function transNetArtifact(role, fileName, byteLength, sha256, path) {
	const revision = '85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed';
	return Object.freeze({
		role, required: true, fileName,
		url: `https://github.com/soCzech/TransNetV2/raw/${revision}/${path}`,
		revision, byteLength, integrity: { algorithm: 'sha256', value: sha256 },
	});
}

export const MILESTONE_7_DIRECT_PINS = Object.freeze({
	'wav2vec2-base-960h-english-alignment': Object.freeze({
		repository: 'https://huggingface.co/facebook/wav2vec2-base-960h',
		revision: '6d2b9ffaac8aabc45934584ee608c5fb5ee34a4e',
		runtimeFamily: 'onnxruntime-node', fileName: 'onnx/model.onnx',
		byteLength: 377_887_594,
		sha256: 'b73fe60ddcd3fd07f91d65d50b4f10ba99039104c4fb5db5bdafbb27610bb6eb',
		minimumSystemMemoryBytes: 0,
	}),
	'qwen3-4b-q4-k-m': Object.freeze({
		repository: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF',
		revision: 'bc640142c66e1fdd12af0bd68f40445458f3869b',
		runtimeFamily: 'llama-cpp', fileName: 'Qwen3-4B-Q4_K_M.gguf',
		byteLength: 2_497_280_256,
		sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
		minimumSystemMemoryBytes: 16 * 1024 ** 3,
	}),
});
