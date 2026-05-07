#!/usr/bin/env python3
"""
Fetch normalized exercise records from wger public API (not HTML scraping).
Prioritizes exercises that have a main image in wger.
Writes data/exercises/exercises.json
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import requests

WGER = "https://wger.de/api/v2"
LANG_EN = 2
TARGET_COUNT = 100
PAGE_SIZE = 50
TIMEOUT = 60


def strip_html(html: str) -> str:
    if not html:
        return ""
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def pick_english_translation(translations: list[dict[str, Any]]) -> dict[str, Any] | None:
    for t in translations:
        if t.get("language") == LANG_EN:
            return t
    return None


def fetch_json(session: requests.Session, url: str) -> dict[str, Any]:
    r = session.get(url, timeout=TIMEOUT, headers={"Accept": "application/json"})
    r.raise_for_status()
    return r.json()


def collect_exercise_ids_with_main_image(session: requests.Session, max_ids: int) -> list[int]:
    """Paginate exerciseimage (main only) and return distinct exercise ids."""
    seen: set[int] = set()
    ordered: list[int] = []
    next_url: str | None = f"{WGER}/exerciseimage/?is_main=true&limit={PAGE_SIZE}"
    while next_url and len(ordered) < max_ids:
        data = fetch_json(session, next_url)
        for row in data.get("results") or []:
            eid = row.get("exercise")
            if eid is None or eid in seen:
                continue
            seen.add(int(eid))
            ordered.append(int(eid))
            if len(ordered) >= max_ids:
                break
        next_url = data.get("next") if len(ordered) < max_ids else None
    return ordered


def main_image_for(session: requests.Session, exercise_id: int) -> tuple[str | None, dict[str, Any]]:
    url = f"{WGER}/exerciseimage/?exercise={exercise_id}&is_main=true&limit=1"
    data = fetch_json(session, url)
    results = data.get("results") or []
    if not results:
        return None, {}
    img = results[0]
    return img.get("image"), {
        "license_title": img.get("license_title") or "",
        "license_author": img.get("license_author") or "",
    }


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    out_path = root / "data" / "exercises" / "exercises.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    # Prefer ids that have main images (extra buffer for skips)
    candidate_ids = collect_exercise_ids_with_main_image(session, max_ids=TARGET_COUNT + 80)

    records: list[dict[str, Any]] = []
    for eid in candidate_ids:
        if len(records) >= TARGET_COUNT:
            break
        info = fetch_json(session, f"{WGER}/exerciseinfo/{eid}/")
        tr = pick_english_translation(info.get("translations") or [])
        if not tr:
            continue

        name = (tr.get("name") or "").strip()
        if not name:
            continue

        desc_html = tr.get("description") or ""
        instructions = [strip_html(desc_html)] if strip_html(desc_html) else []

        category = info.get("category") or {}
        body_part = (category.get("name") or "").strip() or "General"

        muscles = info.get("muscles") or []
        sec = info.get("muscles_secondary") or []
        target_muscle = ""
        if muscles:
            target_muscle = (muscles[0].get("name_en") or muscles[0].get("name") or "").strip()
        secondary = [
            (m.get("name_en") or m.get("name") or "").strip()
            for m in sec
            if (m.get("name_en") or m.get("name"))
        ]

        equip = info.get("equipment") or []
        equipment = [e.get("name") for e in equip if e.get("name")]

        lic = info.get("license") or {}
        lic_short = (lic.get("short_name") or "").strip()
        lic_url = (lic.get("url") or "").strip()

        media_url, img_meta = main_image_for(session, eid)
        if not media_url:
            continue

        media_type = "image"

        attribution_parts = [info.get("license_author") or "", img_meta.get("license_author") or ""]
        attribution = " · ".join(p for p in attribution_parts if p)

        record = {
            "id": str(eid),
            "name": name,
            "bodyPart": body_part,
            "targetMuscle": target_muscle or body_part,
            "secondaryMuscles": secondary,
            "equipment": equipment,
            "difficulty": None,
            "instructions": instructions,
            "tips": [],
            "mediaType": media_type,
            "mediaUrl": media_url,
            "mediaLocalPath": None,
            "sourceName": "wger",
            "sourceUrl": f"{WGER}/exerciseinfo/{eid}/",
            "licenseType": lic_short or "See source",
            "licenseUrl": lic_url,
            "attribution": attribution or "wger community",
            "lastVerifiedAt": info.get("last_update_global") or info.get("last_update"),
        }
        records.append(record)

    meta = {
        "version": 1,
        "source": "wger",
        "fetchedCount": len(records),
        "note": "English translations only; exercises prioritized when a main image exists.",
    }
    payload = {"meta": meta, "exercises": records}

    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(records)} exercises to {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
