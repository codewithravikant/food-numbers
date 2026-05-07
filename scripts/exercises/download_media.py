#!/usr/bin/env python3
"""
Download exercise images referenced in data/exercises/exercises.json into
public/exercises/media/ and set mediaLocalPath for each record.

Run after fetch_wger.py. Respects same license terms as SOURCES.txt.
"""
from __future__ import annotations

import json
import mimetypes
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests

TIMEOUT = 60
CHUNK = 65536


def ext_from_url(url: str, content_type: str | None) -> str:
    path = urlparse(url).path
    base = Path(path).suffix.lower()
    if base in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        return base
    if content_type:
        if "png" in content_type:
            return ".png"
        if "jpeg" in content_type or "jpg" in content_type:
            return ".jpg"
        if "gif" in content_type:
            return ".gif"
        if "webp" in content_type:
            return ".webp"
    guess, _ = mimetypes.guess_type(url)
    if guess == "image/png":
        return ".png"
    if guess in ("image/jpeg", "image/jpg"):
        return ".jpg"
    return ".bin"


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    data_path = root / "data" / "exercises" / "exercises.json"
    media_dir = root / "public" / "exercises" / "media"
    media_dir.mkdir(parents=True, exist_ok=True)

    payload = json.loads(data_path.read_text(encoding="utf-8"))
    exercises = payload.get("exercises") or []
    session = requests.Session()

    for ex in exercises:
        url = ex.get("mediaUrl")
        if not url:
            continue
        eid = ex.get("id") or "unknown"
        try:
            r = session.get(url, timeout=TIMEOUT, stream=True, headers={"Accept": "*/*"})
            r.raise_for_status()
            ext = ext_from_url(url, r.headers.get("Content-Type"))
            fname = f"{eid}{ext}"
            out = media_dir / fname
            with out.open("wb") as f:
                for chunk in r.iter_content(CHUNK):
                    if chunk:
                        f.write(chunk)
            ex["mediaLocalPath"] = f"/exercises/media/{fname}"
        except OSError as e:
            print(f"skip {eid}: {e}", file=sys.stderr)
            ex["mediaLocalPath"] = None
        except requests.RequestException as e:
            print(f"skip {eid}: {e}", file=sys.stderr)
            ex["mediaLocalPath"] = None

    data_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Updated {data_path} with local media paths under /exercises/media/", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
