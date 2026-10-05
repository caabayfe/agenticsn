"""Spike S1: generate extended hash vectors with the snagentic v1 implementation.

The expected hashes come from v1's own ``record_hash``, so the TypeScript kernel is
checked against the real contract, not against a re-implementation of it.

Usage (from the repository root, with v1 checked out next to this repository):

    ../snagentic/.venv/bin/python tools/spikes/s1_generate_hash_vectors.py \
        --v1 ../snagentic --out tests/fixtures/hash-vectors-extended.json
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

SEED = 20261005
COUNT = 2000
CLASSES = ["sys_script", "sys_script_include", "sys_script_client", "sp_widget",
           "sys_properties", "sys_ui_action", "sys_security_acl", "x_acme_table$"]

ASCII = [chr(c) for c in range(0x20, 0x7F)]
CONTROLS = [chr(c) for c in range(0x00, 0x20)] + ["\x7f"]
NEWLINES = ["\n", "\r", "\r\n", "\n\n", "\r\r"]
LATIN = [chr(c) for c in range(0xA0, 0x180)]
BMP_HIGH = ["�", "", "￯", " ", " ", "é", "中", "﻿"]
ASTRAL = ["\U0001f600", "\U00010000", "\U0010ffff", "\U0001d11e", "\U0002070e"]
LONE_SURROGATES = ["\ud800", "\udbff", "\udc00", "\udfff"]


def random_text(rng: random.Random, max_length: int) -> str:
    pools = [(ASCII, 60), (NEWLINES, 12), (CONTROLS, 6), (LATIN, 8), (BMP_HIGH, 6),
             (ASTRAL, 6), (LONE_SURROGATES, 2)]
    population = [pool for pool, _ in pools]
    weights = [weight for _, weight in pools]
    length = rng.randint(0, max_length)
    text = "".join(rng.choice(rng.choices(population, weights)[0]) for _ in range(length))
    if rng.random() < 0.25:
        text += rng.choice(["\n", "\n\n", "\r\n", "\r\n\r\n", "\r"])
    return text


def random_key(rng: random.Random) -> str:
    if rng.random() < 0.85:
        letters = "abcdefghijklmnopqrstuvwxyz_0123456789"
        return "".join(rng.choice(letters) for _ in range(rng.randint(1, 20)))
    return random_text(rng, 6) or "k"


def random_fields(rng: random.Random) -> dict[str, str]:
    fields: dict[str, str] = {}
    for _ in range(rng.randint(0, 12)):
        fields[random_key(rng)] = random_text(rng, rng.choice([0, 5, 40, 300]))
    return fields


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--v1", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    arguments = parser.parse_args()
    sys.path.insert(0, str((arguments.v1 / "src").resolve()))
    from snagentic.instance.records import record_hash  # noqa: PLC0415 (v1 import)

    rng = random.Random(SEED)
    vectors = []
    crafted = [
        ("sort-astral-vs-high-bmp", {"\U0001f600": "1", "�": "2", "": "3"}),
        ("del-and-controls", {"script": "\x7f\x00\x1f\t"}),
        ("only-newlines", {"script": "\r\n\r\n\n"}),
        ("trailing-spaces-kept", {"script": "a  \n"}),
        ("proto-key", {"__proto__": "x", "constructor": "y"}),
        ("lone-surrogates", {"script": "\ud800a\udfff"}),
    ]
    for name, fields in crafted:
        vectors.append({"name": name, "class": "sys_script", "fields": fields,
                        "hash": record_hash("sys_script", fields)})
    for index in range(COUNT):
        table = rng.choice(CLASSES)
        fields = random_fields(rng)
        vectors.append({"name": f"random-{index:04d}", "class": table, "fields": fields,
                        "hash": record_hash(table, fields)})

    document = {
        "hash_version": 1,
        "generator": "tools/spikes/s1_generate_hash_vectors.py",
        "seed": SEED,
        "source": "snagentic v1 snagentic.instance.records.record_hash",
        "vectors": vectors,
    }
    arguments.out.write_text(json.dumps(document, ensure_ascii=True, indent=1) + "\n",
                             encoding="utf-8")
    print(f"wrote {len(vectors)} vectors to {arguments.out}")


if __name__ == "__main__":
    main()
