# SPDX-License-Identifier: AGPL-3.0-only

"""Offline, bounded Kokoro v1.0 G2P process intended for frozen per-target builds.

The caller must authenticate the frozen executable and all of its dependency/data
files before spawning it. This source is not a usable shipped runtime by itself.
"""

import json
import os
import re
import sys

MAXIMUM_INPUT_BYTES = 64 * 1024
MAXIMUM_CHUNKS = 128
MAXIMUM_PHONEMES = 510
LANGUAGES = frozenset("abefhijpz")
VOICE_PATTERN = re.compile(r"^[abefhijpz][fm]_[a-z]+$")


def split_text(text: str) -> list[str]:
    """Bound each publisher pipeline call so non-English text is never truncated."""
    pieces: list[str] = []
    remaining = text.strip()
    while remaining:
        if len(pieces) >= MAXIMUM_CHUNKS:
            raise ValueError("The Kokoro text exceeds the offline chunk bound.")
        if len(remaining) <= 80:
            pieces.append(remaining)
            break
        limit = remaining[:80]
        split = max((limit.rfind(character) for character in " \n.!?。！？、，"), default=-1)
        if split < 32:
            split = 80
        else:
            split += 1
        pieces.append(remaining[:split].strip())
        remaining = remaining[split:].strip()
    return pieces


def review_request(raw: bytes) -> tuple[str, str, str]:
    if not raw or len(raw) > MAXIMUM_INPUT_BYTES:
        raise ValueError("The Kokoro G2P request has an invalid byte length.")
    request = json.loads(raw.decode("utf-8", errors="strict"))
    if not isinstance(request, dict) or set(request) != {"language", "voice", "text"}:
        raise ValueError("The Kokoro G2P request schema is invalid.")
    language, voice, text = (request[key] for key in ("language", "voice", "text"))
    if (not isinstance(language, str) or language not in LANGUAGES
            or not isinstance(voice, str) or not VOICE_PATTERN.fullmatch(voice)
            or voice[0] != language or not isinstance(text, str)
            or not text.strip() or "\0" in text):
        raise ValueError("The Kokoro G2P language, voice, or text is invalid.")
    return language, voice, text


def phonemize(language: str, voice: str, text: str) -> list[str]:
    # The package build must include the English spaCy model, Unidic, eSpeak
    # NG and the other Misaki data files. Disable network-capable fallbacks.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["SPACY_WARNING_IGNORE"] = "W008"

    if language in "ab":
        import spacy
        if not spacy.util.is_package("en_core_web_sm"):
            raise RuntimeError("The frozen English spaCy model is unavailable.")

    from kokoro import KPipeline

    pipeline = KPipeline(
        lang_code=language,
        repo_id="hexgrad/Kokoro-82M",
        model=False,
    )
    chunks: list[str] = []
    for piece in split_text(text):
        for result in pipeline(piece, voice=voice):
            phonemes = result.phonemes
            if not isinstance(phonemes, str) or not phonemes:
                raise ValueError("The Kokoro G2P pipeline returned no phonemes.")
            if len(phonemes) > MAXIMUM_PHONEMES:
                raise ValueError("The Kokoro G2P pipeline exceeded one model context.")
            chunks.append(phonemes)
            if len(chunks) > MAXIMUM_CHUNKS:
                raise ValueError("The Kokoro G2P pipeline exceeded its chunk bound.")
    if not chunks:
        raise ValueError("The Kokoro G2P pipeline returned no audio-bearing chunks.")
    return chunks


def main() -> int:
    try:
        language, voice, text = review_request(sys.stdin.buffer.read(MAXIMUM_INPUT_BYTES + 1))
        chunks = phonemize(language, voice, text)
        body = json.dumps({"schemaVersion": 1, "chunks": chunks}, ensure_ascii=False)
        sys.stdout.buffer.write(body.encode("utf-8"))
        sys.stdout.buffer.flush()
        return 0
    except Exception as error:  # The supervised parent owns the diagnostic boundary.
        sys.stderr.write(f"Kokoro offline G2P failed: {type(error).__name__}: {error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
