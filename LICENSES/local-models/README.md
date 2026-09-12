# Local model license texts

These files retain the complete upstream license texts without edits. The five
conversion-code licenses were read from the exact authenticated source archives
in the conversion execution register. Qwen's license was read at its pinned model
revision. Apache-2.0.txt is the standard license text for the Apache-2.0 model
declarations; it is not a claim that a weight repository contains that file.
GPL-3.0.txt is the complete standard GNU license text for anvuew's `gpl-3.0`
declaration. The unmodified pinned dereverb model card retains that declaration;
the converter's MIT notice is retained separately. Hugging Face documents
[model-card metadata as its supported license declaration](https://huggingface.co/docs/hub/repositories-licenses).

Desktop packaging copies this directory into its offline licenses inventory.
Model-specific attribution, weight/code distinctions, artifact modifications,
and distribution limitations are in
[THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md#mirrored-assistance-models).
The catalog signature remains required for model installation. The dereverb source
directions identify the original checkpoint, configuration, and exact converter;
the dry training corpus and base-checkpoint lineage remain unknown.

| File | Upstream source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| [tiger-dnr-neural-core-LICENSE.txt](tiger-dnr-neural-core-LICENSE.txt) | [Source](https://github.com/JusperLee/TIGER/blob/9f18d4a10a7137e1ce8052cfb62215179f1287b6/LICENSE) | 1072 | `edc64d62aa021be7612337d2ced140375f52e4fd064b2f9cf6e656913d01bfa6` |
| [panns-cnn10-LICENSE.txt](panns-cnn10-LICENSE.txt) | [Source](https://github.com/qiuqiangkong/audioset_tagging_cnn/blob/d2f4b8c18eab44737fcc0de1248ae21eb43f6aa4/LICENSE.MIT) | 1081 | `7e540655d851d9737fafaa9f0cbd064c3a29bdfe5e937ee07a09360f85161975` |
| [beat-this-LICENSE.txt](beat-this-LICENSE.txt) | [Source](https://github.com/CPJKU/beat_this/blob/ad7974846029835307ba19a3d5cefbf40b243041/LICENSE) | 1113 | `909ab6549794a18e9bb243aacfadda4a5f308436fc2846f350755c53c4f06ae1` |
| [transnetv2-LICENSE.txt](transnetv2-LICENSE.txt) | [Source](https://github.com/soCzech/TransNetV2/blob/85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed/LICENSE) | 1072 | `a8d7a056688ccedebe89f18fd60f1a47128df94cb82669cd02459934919cbb6f` |
| [Qwen3-4B-LICENSE.txt](Qwen3-4B-LICENSE.txt) | [Source](https://huggingface.co/Qwen/Qwen3-4B-GGUF/blob/bc640142c66e1fdd12af0bd68f40445458f3869b/LICENSE) | 11544 | `5de36594c10839788a8c589443a8ef9d8b8d17c65a1b5807206ae037fc36c6bd` |
| [Apache-2.0.txt](Apache-2.0.txt) | [Source](https://www.apache.org/licenses/LICENSE-2.0.txt) | 11358 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| [dereverb-room-MODEL-CARD.md](dereverb-room-MODEL-CARD.md) | [Source](https://huggingface.co/anvuew/dereverb_room/raw/0b85f5b80b7f779b2dfe80f33a1b35b38af9376d/README.md) | 949 | `7c12fe33b3e22930edf1765940c16a919ee182b4d633c4106ba5dd298974a66a` |
| [dereverb-room-converter-LICENSE.txt](dereverb-room-converter-LICENSE.txt) | [Source](https://raw.githubusercontent.com/ZFTurbo/MSS_ONNX_TensorRT/43d939e7671d8ff6cf1922f98c2f2e4b56908e47/LICENSE) | 1081 | `3282dc057695ef5b9a64909a7092ca40b2c292c232580fc6ace6e5d665cc0207` |
| [GPL-3.0.txt](GPL-3.0.txt) | [Source](https://www.gnu.org/licenses/gpl-3.0.txt) | 35149 | `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986` |

Dereverb's [complete corresponding-source archive](https://assets.soundscaper.org/models/dereverb-room/1.0.0/corresponding-source.tar.gz)
contains the preferred checkpoint/configuration, both converters, frozen
dependencies, fixtures, and licenses. It is 135,886,483 bytes, SHA-256
`ca86ebde5d248f92a7c9ae1ce599586f592e930ebdeb4fdf876ff3f7d1c47c73`.
The archived instructions reproduced the exact distributed ONNX graph and
passed parity from a clean extraction.
