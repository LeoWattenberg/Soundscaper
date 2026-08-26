# SPDX-License-Identifier: AGPL-3.0-only

"""Closed, revision-bound candidate inventory used by the conversion CLI."""

PROTOCOL = "soundscaper-model-conversion-v1"

CANDIDATES = {
    "tiger-dnr-neural-core": {
        "plan": "f8e22860e579bdf7ee23d9d72f41740e1e97d6d1a849c4cf4170ef508c631c13",
        "revision": "9f18d4a10a7137e1ce8052cfb62215179f1287b6",
        "archive": "tiger-9f18d4a10a7137e1ce8052cfb62215179f1287b6.tar.gz",
        "artifacts": [
            ("dnr-weights", True, "model.safetensors", 17_130_568, "sha256",
             "dd1c696e72f6adea0085ef1af640882a8260519ad666422835e387a5b4abdd2a"),
        ],
        "outputs": [("network", True, "tiger-dnr.onnx")],
        "fixture": ("tiger-dnr-parity-v1", 705_644,
                    "aa4a0d814269fb6024f7985c1466f204ec915242b5340a7c99fdca8b866c92ad"),
        "frameworks": ["source-pytorch", "onnxruntime-cpu"],
        "roles": ["dialogue-waveform", "effects-waveform", "music-waveform"],
        "counts": {"dialogue-waveform": 176_400, "effects-waveform": 176_400,
                   "music-waveform": 176_400},
        "comparisons": [
            ("source-pytorch", "onnxruntime-cpu", role, "maximum-absolute-error", 0.0001)
            for role in ("dialogue-waveform", "effects-waveform", "music-waveform")
        ],
    },
    "panns-cnn10": {
        "plan": "33da2c9f07f86a51b119466c38cca28368c7a58fe5e975cd5eda9c68dd99f2a2",
        "revision": "d2f4b8c18eab44737fcc0de1248ae21eb43f6aa4",
        "archive": "audioset-tagging-cnn-d2f4b8c18eab44737fcc0de1248ae21eb43f6aa4.tar.gz",
        "artifacts": [
            ("cnn10-checkpoint", True, "Cnn10_mAP=0.380.pth", 25_237_595, "md5",
             "bfb1f1f9968938fa8ef4012b8471f5f6"),
            ("audioset-class-map", True, "class_labels_indices.csv", 14_675, "sha256",
             "cdd1049833c4b86127c2773ac0d14a2754b6a6d0d1798002ed5c66e699708429"),
        ],
        "outputs": [("network", True, "panns-cnn10.onnx")],
        "fixture": ("panns-cnn10-parity-v1", 256_044,
                    "1cb40bf7dd77139b6d40733794f6005d0f3fcb6c69d1e0d8e257c0ba86440d48"),
        "frameworks": ["source-pytorch", "onnxruntime-cpu"],
        "roles": ["clipwise-probabilities", "embedding"],
        "counts": {"clipwise-probabilities": 527, "embedding": 512},
        "comparisons": [
            ("source-pytorch", "onnxruntime-cpu", "clipwise-probabilities",
             "maximum-absolute-error", 0.00001),
            ("source-pytorch", "onnxruntime-cpu", "embedding",
             "maximum-absolute-error", 0.0001),
        ],
    },
    "beat-this": {
        "plan": "bf5cd009d7c20d8cd384ee143eb9e0d3eb1970723748d9f09c86122f3a46eaf0",
        "revision": "ad7974846029835307ba19a3d5cefbf40b243041",
        "archive": "beat-this-ad7974846029835307ba19a3d5cefbf40b243041.tar.gz",
        "artifacts": [
            ("small0-checkpoint", True, "small0.ckpt", 8_451_101, "sha1",
             "77a7ef5c21f628578f2b259ac29d2d680412efcc"),
            ("final0-checkpoint", False, "final0.ckpt", 81_058_141, "sha1",
             "e1506282faf66ca10e8ab50ee26bd542b7b9ff0a"),
        ],
        "outputs": [
            ("small0-network", True, "beat-this-small0.onnx"),
            ("final0-network", False, "beat-this-final0.onnx"),
        ],
        "fixture": ("beat-this-parity-v1", 705_644,
                    "dac09d315142aab6d80d5ec653519a480414e06feff4412e6006252883dc567a"),
        "frameworks": ["source-pytorch", "onnxruntime-cpu"],
        "roles": ["beat-logits", "downbeat-logits", "beat-points", "downbeat-points"],
        "counts": {"beat-logits": 401, "downbeat-logits": 401},
        "comparisons": [
            ("source-pytorch", "onnxruntime-cpu", "beat-logits",
             "maximum-absolute-error", 0.0001),
            ("source-pytorch", "onnxruntime-cpu", "downbeat-logits",
             "maximum-absolute-error", 0.0001),
            ("source-pytorch", "onnxruntime-cpu", "beat-points",
             "symmetric-index-difference", 0),
            ("source-pytorch", "onnxruntime-cpu", "downbeat-points",
             "symmetric-index-difference", 0),
        ],
    },
    "transnetv2": {
        "plan": "90bf631430e3aac1df64a329532fa1a0273451c6c0b2da73bad02d11eb707ec7",
        "revision": "85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed",
        "archive": "transnetv2-85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed.tar.gz",
        "artifacts": [
            ("tensorflow-saved-model", True, "saved_model.pb", 5_933_260, "sha256",
             "8ac2a52c5719690d512805b6eaf5ce12097c1d8860b3d9de245dcbbc3100f554"),
            ("tensorflow-variables-data", True, "variables.data-00000-of-00001", 30_516_656,
             "sha256", "b8c9dc3eb807583e6215cabee9ca61737b3eb1bceff68418b43bf71459669367"),
            ("tensorflow-variables-index", True, "variables.index", 5_526, "sha256",
             "8b99e28b4ad11372d9a1ad9703298c2e370df14859da4245fdbe818e92dd403f"),
        ],
        "outputs": [("network", True, "transnetv2.onnx")],
        "fixture": ("transnetv2-parity-v1", 467_712,
                    "22695a91ca7749fc034f0a043746dc869a1403ffddd4f0e60f407ee0b61d82d8"),
        "frameworks": ["source-tensorflow", "source-pytorch", "onnxruntime-cpu"],
        "roles": ["single-frame-logits", "all-frame-logits", "boundaries"],
        "counts": {"single-frame-logits": 120, "all-frame-logits": 120},
        "comparisons": [
            (baseline, candidate, role, metric, maximum)
            for baseline, candidate in (
                ("source-tensorflow", "source-pytorch"),
                ("source-pytorch", "onnxruntime-cpu"),
            )
            for role, metric, maximum in (
                ("single-frame-logits", "maximum-absolute-error", 0.0001),
                ("all-frame-logits", "maximum-absolute-error", 0.0001),
                ("boundaries", "symmetric-index-difference", 0),
            )
        ],
    },
}


def candidate(candidate_id, plan_sha256):
    """Return one exact candidate or refuse identity substitution."""
    spec = CANDIDATES.get(candidate_id)
    if spec is None or plan_sha256 != spec["plan"]:
        raise ValueError("The candidate or canonical conversion-plan SHA-256 is invalid.")
    return spec
