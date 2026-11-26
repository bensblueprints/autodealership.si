"""Generate a transactional psql import for the private platform database.

Usage: python prepare.py OUTPUT.sql [--source-pdf reviewed.pdf]
The output contains private reference artwork. Keep it outside web and Git.
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

import pymupdf

ROOT = Path(__file__).resolve().parent


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def prepare(original, catalog):
    artwork = catalog["artwork"]
    digest = hashlib.sha256(original).hexdigest()
    if digest != artwork["sha256"]:
        raise ValueError("The manufacturer's filing changed. Review it before importing.")
    statements = ["\\set ON_ERROR_STOP on", "BEGIN;", (ROOT / "schema.sql").read_text()]
    source = catalog["sources"][artwork["source"]]["url"]
    for brand in catalog["brands"]:
        guidance = {"market": catalog["market"], "note": brand["note"],
                    "sources": [catalog["sources"][key] for key in brand["sources"]]}
        values = [brand["id"], brand["name"], json.dumps(guidance), catalog["reviewed"]]
        statements.append("INSERT INTO public.oem_brand_references(id,name,guidance,reviewed) VALUES (" +
                          ",".join(map(quote, values)) + ") ON CONFLICT(id) DO UPDATE SET "
                          "name=excluded.name,guidance=excluded.guidance,reviewed=excluded.reviewed;")
    with pymupdf.open(stream=original, filetype="pdf") as doc:
        xrefs = {image[0] for image in doc[0].get_images()}
        for asset in artwork["assets"]:
            if asset["object"] not in xrefs:
                raise ValueError("Referenced artwork missing from the reviewed page.")
            pixmap = pymupdf.Pixmap(doc, asset["object"])
            image = pixmap.tobytes("png")
            values = [asset["brand"], asset["object"], asset["label"], source, digest,
                      hashlib.sha256(image).hexdigest()]
            statements.append("INSERT INTO public.oem_brand_reference_art"
                              "(brand,object_id,label,source_url,source_digest,digest,image) VALUES (" +
                              ",".join(map(quote, values)) + ",decode(" + quote(image.hex()) + ",'hex')) "
                              "ON CONFLICT(brand,object_id) DO UPDATE SET label=excluded.label,"
                              "source_url=excluded.source_url,source_digest=excluded.source_digest,"
                              "digest=excluded.digest,image=excluded.image;")
    return "\n".join(statements + ["COMMIT;", ""])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source-pdf", type=Path)
    args = parser.parse_args()
    catalog = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    if args.source_pdf:
        original = args.source_pdf.read_bytes()
    else:
        url = catalog["sources"][catalog["artwork"]["source"]]["url"]
        with urlopen(Request(url, headers={"User-Agent":"AutoDealership.SI brand reference review/1"}), timeout=30) as response:
            original = response.read(4_000_001)
    args.output.write_text(prepare(original, catalog), encoding="utf-8")
    print(f"Prepared {len(catalog['brands'])} brands and {len(catalog['artwork']['assets'])} reference images.")
