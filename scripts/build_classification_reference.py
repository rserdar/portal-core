import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path


NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

TOKEN_PATTERN = re.compile(r"[a-z0-9]{2,}", re.IGNORECASE)
STOP_WORDS = {
    "ve",
    "ile",
    "bir",
    "olan",
    "olanlar",
    "diğer",
    "diger",
    "için",
    "icin",
    "ait",
    "gibi",
    "the",
    "and",
    "for",
    "ile",
    "olan",
}


def normalize_text(value: str) -> str:
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("ı", "i")
        .replace("ğ", "g")
        .replace("ü", "u")
        .replace("ş", "s")
        .replace("ö", "o")
        .replace("ç", "c")
    )


def tokenize(value: str) -> list[str]:
    tokens = TOKEN_PATTERN.findall(normalize_text(value))
    return [token for token in tokens if token not in STOP_WORDS]


def read_xlsx_rows(path: Path) -> list[list[str]]:
    with zipfile.ZipFile(path) as archive:
        shared_strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("main:si", NS):
                parts = [node.text or "" for node in item.iterfind(".//main:t", NS)]
                shared_strings.append("".join(parts))

        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_map = {
            rel.attrib["Id"]: rel.attrib["Target"]
            for rel in relationships.findall("pkgrel:Relationship", NS)
        }
        first_sheet = workbook.find("main:sheets", NS)[0]
        relationship_id = first_sheet.attrib[
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        ]
        target = "xl/" + rel_map[relationship_id]
        sheet = ET.fromstring(archive.read(target))

        def cell_value(cell: ET.Element) -> str:
            cell_type = cell.attrib.get("t")
            if cell_type == "s":
                value = cell.find("main:v", NS)
                if value is None or value.text is None:
                    return ""
                return shared_strings[int(value.text)]
            if cell_type == "inlineStr":
                inline = cell.find("main:is", NS)
                if inline is None:
                    return ""
                return "".join((node.text or "") for node in inline.iterfind(".//main:t", NS))
            value = cell.find("main:v", NS)
            return value.text if value is not None and value.text is not None else ""

        rows = []
        for row in sheet.findall(".//main:sheetData/main:row", NS):
            values = [cell_value(cell).strip() for cell in row.findall("main:c", NS)]
            if values and any(values):
                rows.append(values)
        return rows


def build_reference(rows: list[list[str]]) -> tuple[dict, dict, dict]:
    data_rows = [row for row in rows[1:] if len(row) >= 3 and any(row[:3])]

    ea_to_naces: defaultdict[str, set[str]] = defaultdict(set)
    nace_to_scopes: defaultdict[str, list[dict]] = defaultdict(list)
    unique_scope_rows = []
    seen_scope_keys = set()

    for row in data_rows:
        ea = row[0].strip()
        nace = row[1].strip()
        text = row[2].strip()
        if not nace or not text:
            continue

        key = (ea, nace, text)
        if key in seen_scope_keys:
            continue
        seen_scope_keys.add(key)

        keywords = tokenize(text)[:12]
        unique_scope_rows.append(
            {
                "id": f"{ea or 'NA'}-{nace}-{len(unique_scope_rows) + 1:05d}",
                "label": text,
                "group": "SCOPE",
                "ea": ea,
                "nace": nace,
                "text": text,
                "keywords": keywords,
            }
        )

        if ea:
            ea_to_naces[ea].add(nace)

        nace_to_scopes[nace].append({"ea": ea, "text": text, "keywords": keywords})

    ea_items = [
        {
            "id": ea,
            "label": f"EA {ea}",
            "code": ea,
            "group": "EA",
            "scopeCount": sum(1 for item in unique_scope_rows if item["ea"] == ea),
            "sampleCount": len(ea_to_naces[ea]),
        }
        for ea in sorted(ea_to_naces, key=lambda value: (int(value) if value.isdigit() else value))
    ]

    nace_items = []
    for nace in sorted(nace_to_scopes):
        scope_entries = nace_to_scopes[nace]
        sample_texts = [entry["text"] for entry in scope_entries[:3]]
        top_ea = Counter(entry["ea"] for entry in scope_entries if entry["ea"]).most_common(1)
        representative = sample_texts[0] if sample_texts else nace
        nace_items.append(
            {
                "id": nace,
                "label": nace,
                "code": nace,
                "group": "NACE",
                "ea": top_ea[0][0] if top_ea else "",
                "text": representative,
                "scopeCount": len(scope_entries),
                "samples": sample_texts,
                "keywords": list(dict.fromkeys(token for entry in scope_entries[:5] for token in entry["keywords"]))[:12],
            }
        )

    return (
        {"items": ea_items},
        {"items": nace_items},
        {"items": unique_scope_rows},
    )


def main() -> int:
    if len(sys.argv) != 3:
      print("Usage: python scripts/build_classification_reference.py <xlsx-path> <output-dir>")
      return 1

    source = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)

    rows = read_xlsx_rows(source)
    ea_data, nace_data, scope_data = build_reference(rows)

    (output_dir / "ea-codes.json").write_text(json.dumps(ea_data, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "nace-codes.json").write_text(json.dumps(nace_data, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "nace-scopes.json").write_text(json.dumps(scope_data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Wrote {len(ea_data['items'])} EA items")
    print(f"Wrote {len(nace_data['items'])} NACE items")
    print(f"Wrote {len(scope_data['items'])} scope items")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
