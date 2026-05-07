#!/usr/bin/env python3
"""Validate data/exercises/exercises.json: schema fields, duplicate ids."""
from __future__ import annotations

import json
import sys
from pathlib import Path

REQUIRED = [
    "id",
    "name",
    "bodyPart",
    "targetMuscle",
    "equipment",
    "instructions",
    "tips",
    "sourceName",
    "sourceUrl",
    "licenseType",
    "attribution",
]


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    path = root / "data" / "exercises" / "exercises.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    exercises = data.get("exercises")
    if not isinstance(exercises, list):
        print("error: exercises must be a list", file=sys.stderr)
        return 1

    seen: set[str] = set()
    errors = 0
    for i, ex in enumerate(exercises):
        if not isinstance(ex, dict):
            print(f"error: item {i} not an object", file=sys.stderr)
            errors += 1
            continue
        for k in REQUIRED:
            if k not in ex:
                print(f"error: {ex.get('id', '?')} missing {k}", file=sys.stderr)
                errors += 1
        eid = str(ex.get("id", ""))
        if eid in seen:
            print(f"error: duplicate id {eid}", file=sys.stderr)
            errors += 1
        seen.add(eid)

    if errors:
        print(f"validation failed: {errors} issue(s)", file=sys.stderr)
        return 1
    print(f"OK: {len(exercises)} exercises, unique ids", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
