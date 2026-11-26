"""Write a transactional psql import of a reviewed template artwork pack to stdout."""
import csv
import hashlib
import json
import sys
from pathlib import Path


def export_rows(directory):
    rows = json.loads((directory / "artwork.json").read_text(encoding="utf-8"))
    for row in rows:
        layout = row["template"]
        title = row["title"]
        if layout not in {"franchise", "independent", "bhph"} or not title.strip() or len(title) > 100 or any(ord(c) < 32 for c in title):
            raise ValueError("Invalid layout or artwork title")
        images = []
        digests = []
        for crop in ("desktop", "mobile"):
            spec = row["exports"][crop]
            path = (directory / spec["file"]).resolve()
            if path.parent != directory or path.stat().st_size > 2_400_000:
                raise ValueError("Expected a JPEG in the pack directory")
            data = path.read_bytes()
            digest = hashlib.sha256(data).digest()
            if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9") or digest.hex() != spec["sha256"]:
                raise ValueError(f"Invalid image or digest for {layout} {crop}")
            images.append(data.hex())
            digests.append(digest)
        asset_id = hashlib.sha256(b"".join(digests)).hexdigest()
        if row["asset_id"] != asset_id:
            raise ValueError("The crop pair differs from the reviewed version")
        yield [asset_id, layout, title, *images]


if __name__ == "__main__":
    rows = list(export_rows(Path(sys.argv[1]).resolve()))
    print(r"\set ON_ERROR_STOP 1")
    print("BEGIN;")
    print("CREATE TEMP TABLE art_import(id text, layout text, title text, desktop text, mobile text) ON COMMIT DROP;")
    print("COPY art_import FROM STDIN WITH (FORMAT csv);")
    csv.writer(sys.stdout, lineterminator="\n").writerows(rows)
    print(r"\.")
    print("""INSERT INTO public.template_hero_art(id,layout,title,desktop,mobile)
    SELECT id,layout,title,decode(desktop,'hex'),decode(mobile,'hex') FROM art_import
    ON CONFLICT(id) DO NOTHING;
    COMMIT;""")
