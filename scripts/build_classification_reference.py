import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

TOKEN_PATTERN = re.compile(r"[a-z0-9]{2,}", re.IGNORECASE)
STOP_WORDS = {
    "ve", "ile", "bir", "olan", "olanlar", "diğer", "diger", "için", "icin",
    "ait", "gibi", "the", "and", "for", "olarak", "veya", "yada", "gore", "göre"
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

def load_json(path: Path):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"Error reading {path}: {e}")
    return {"items": []}

def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: python scripts/build_classification_reference.py <output-dir> <history-json-path>")
        return 1

    output_dir = Path(sys.argv[1])
    history_path = Path(sys.argv[2])
    
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. Load existing data as base
    nace_data = load_json(output_dir / "nace-codes.json")
    ea_data = load_json(output_dir / "ea-codes.json")
    scope_data = load_json(output_dir / "nace-scopes.json")

    # 2. Load history data
    history_data = load_json(history_path)
    history_items = history_data.get("items", [])
    print(f"Read {len(history_items)} items from history JSON")

    # Maps to hold merged data
    nace_map = {item["code"]: item for item in nace_data.get("items", []) if "code" in item}
    ea_map = {item["code"]: item for item in ea_data.get("items", []) if "code" in item}
    
    # Track existing scopes to avoid duplicates
    seen_scopes = set()
    for item in scope_data.get("items", []):
        key = (item.get("ea"), item.get("nace"), normalize_text(item.get("text", "")))
        seen_scopes.add(key)

    # 3. Merge history into reference
    new_scopes_count = 0
    for item in history_items:
        nace = str(item.get("nace") or "").strip()
        ea = str(item.get("ea") or "").strip()
        text = str(item.get("kapsam") or "").strip()
        
        if not nace or not text:
            continue
            
        # Add to unique scopes if not already there
        scope_key = (ea, nace, normalize_text(text))
        if scope_key not in seen_scopes:
            seen_scopes.add(scope_key)
            keywords = tokenize(text)[:12]
            scope_data["items"].append({
                "id": f"H-{ea or 'NA'}-{nace}-{len(scope_data['items']) + 1}",
                "label": text,
                "group": "SCOPE",
                "ea": ea,
                "nace": nace,
                "text": text,
                "keywords": keywords,
                "source": "history"
            })
            new_scopes_count += 1

        # Update or add NACE entry
        if nace not in nace_map:
            nace_map[nace] = {
                "id": nace,
                "label": nace,
                "code": nace,
                "group": "NACE",
                "ea": ea,
                "text": text,
                "scopeCount": 0,
                "samples": [],
                "keywords": []
            }
        
        n_item = nace_map[nace]
        n_item["scopeCount"] += 1
        
        # Add to samples if not already present
        if text not in n_item["samples"]:
            # Insert at beginning to prioritize history samples
            n_item["samples"].insert(0, text)
            n_item["samples"] = n_item["samples"][:6] # Keep top 6
            
        # Merge keywords
        new_kws = tokenize(text)
        current_kws = n_item.get("keywords", [])
        # Prioritize new keywords
        merged_kws = list(dict.fromkeys(new_kws + current_kws))[:20]
        n_item["keywords"] = merged_kws
        
        # Update EA if missing
        if ea and not n_item.get("ea"):
            n_item["ea"] = ea

        # Ensure EA entry exists
        if ea and ea not in ea_map:
            ea_map[ea] = {
                "id": ea,
                "label": f"EA {ea}",
                "code": ea,
                "group": "EA",
                "scopeCount": 0,
                "sampleCount": 0
            }
        if ea in ea_map:
            ea_map[ea]["scopeCount"] += 1

    # Finalize and Save
    nace_data["items"] = sorted(nace_map.values(), key=lambda x: x["code"])
    ea_data["items"] = sorted(ea_map.values(), key=lambda x: (int(x["code"]) if x["code"].isdigit() else x["code"]))

    (output_dir / "ea-codes.json").write_text(json.dumps(ea_data, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "nace-codes.json").write_text(json.dumps(nace_data, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "nace-scopes.json").write_text(json.dumps(scope_data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Added {new_scopes_count} new unique scope samples from history.")
    print(f"Updated {len(nace_data['items'])} NACE items.")
    print(f"Total reference items: {len(scope_data['items'])}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
