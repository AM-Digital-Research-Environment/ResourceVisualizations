#!/usr/bin/env python3
"""
Build lemmatised word-frequency inputs for the DRE Visualizations word clouds.

Runs in CI (see .github/workflows/wordclouds.yml), NOT in Omeka. It reads each
corpus's text straight from the **public** Omeka REST API (public reads, no auth
or VPN), lemmatises it with spaCy (English + French), and writes a per-corpus
frequency file to ``asset/data/wordclouds/<corpus>.json``.

Those files are committed and consumed by the in-Omeka precompute
(``Runner::wordCloudInput``) — a static INPUT, like ``asset/data/geo/
countries.geojson`` — with an in-PHP tokeniser as the fallback when a file is
absent. So the word clouds work without this script (lower quality), and upgrade
to proper lemmatisation once it has run.

Output shape (per corpus)::

    {
      "corpus": "podcasts",
      "generated_utc": "2026-06-30T12:00:00Z",
      "source": "https://data.africamultiple.uni-bayreuth.de",
      "models": {"en": "en_core_web_sm", "fr": "fr_core_news_sm"},
      "items": {"total": 43, "en": 40, "fr": 4},
      "all": [{"name": "africa", "value": 434}, ...],   # combined, top N
      "en":  [...],                                      # English-only
      "fr":  [...]                                       # French-only (toggle-ready)
    }

Reusable: add an entry to CORPORA (item-set id + the text property) and it is
picked up automatically. On the PHP side, add the matching chart key to that
block's layout and read it via ``Runner::wordCloudInput``.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import spacy

API_BASE = os.environ.get(
    "OMEKA_API_BASE", "https://data.africamultiple.uni-bayreuth.de"
).rstrip("/")

TOP_N = 200       # words kept per bucket
MIN_COUNT = 2     # drop corpus-wide hapax
MIN_LEN = 3       # drop very short lemmas

# repo-root/asset/data/wordclouds — this file is tools/wordclouds/build_wordclouds.py
OUT_DIR = Path(__file__).resolve().parents[2] / "asset" / "data" / "wordclouds"

# Corpora to build: id -> Omeka item set + the property holding the text.
CORPORA = [
    {"id": "podcasts", "item_set": 39095, "field": "bibo:content"},      # transcripts
    {"id": "publications", "item_set": 29918, "field": "bibo:abstract"},
]

# Content words only — nouns, proper nouns, adjectives. Verbs are deliberately
# excluded: in spoken transcripts they are dominated by conversational fillers
# (know, think, come, mean, want, look, try) that lemmatisation only amplifies.
KEEP_POS = {"NOUN", "PROPN", "ADJ"}

# Domain / meta noise on top of spaCy's built-in stop words (lower-case lemmas).
EXTRA_STOP = {
    "podcast", "podcasts", "episode", "speaker", "music", "applause", "laughter",
    "intro", "outro", "welcome", "cluster", "conversation", "lecture", "session",
    "today", "talk", "hello", "everybody", "everyone", "thing", "stuff", "sort",
    "kind", "guess", "lot", "bit", "okay", "yeah", "actually", "basically",
    "really", "thank", "thanks",
    # French meta / fillers spaCy may surface as lemmas
    "épisode", "merci", "bonjour", "voilà",
}

CUE_RE = re.compile(r"\[[^\]]*\]")                          # [music], [applause]
SPEAKER_RE = re.compile(r"\bspeakers?\s*\d+\s*:?", re.I)    # "Speaker 1:" / "Speaker 2"
TAG_RE = re.compile(r"<[^>]+>")                             # strip HTML in abstracts


def clean(text: str) -> str:
    """Strip HTML, bracketed audio cues and 'Speaker N' diarisation labels."""
    text = TAG_RE.sub(" ", text)
    text = CUE_RE.sub(" ", text)
    return SPEAKER_RE.sub(" ", text)


def fetch_items(item_set: int) -> list[dict]:
    """All items of an item set from the public REST API (paginated)."""
    items: list[dict] = []
    page = 1
    while True:
        q = urlencode({"item_set_id": item_set, "per_page": 100, "page": page})
        req = Request(f"{API_BASE}/api/items?{q}", headers={"User-Agent": "dre-wordclouds/1.0"})
        with urlopen(req, timeout=60) as resp:
            batch = json.load(resp)
        if not batch:
            break
        items.extend(batch)
        if len(batch) < 100:
            break
        page += 1
        time.sleep(0.2)  # be gentle with the API
    return items


def text_of(item: dict, field: str) -> str:
    vals = item.get(field) or []
    return " ".join(v["@value"] for v in vals if isinstance(v, dict) and v.get("@value"))


def lang_of(item: dict) -> str:
    """'en' / 'fr' / '' from the item's dcterms:language (first wins)."""
    for v in item.get("dcterms:language") or []:
        label = (v.get("display_title") or v.get("@value") or "").lower()
        if "french" in label or "français" in label or label == "fr":
            return "fr"
        if "english" in label or label == "en":
            return "en"
    return ""


def lemmatise(text: str, nlp) -> list[str]:
    out: list[str] = []
    doc = nlp(text[: nlp.max_length])
    for tok in doc:
        if tok.pos_ not in KEEP_POS or not tok.is_alpha or tok.is_stop:
            continue
        lemma = tok.lemma_.lower().strip()
        if len(lemma) < MIN_LEN or lemma in EXTRA_STOP or nlp.vocab[lemma].is_stop:
            continue
        out.append(lemma)
    return out


def top(counter: Counter) -> list[dict]:
    return [{"name": w, "value": c} for w, c in counter.most_common(TOP_N) if c >= MIN_COUNT]


def main() -> int:
    print(f"Loading spaCy models (API: {API_BASE}) …")
    models = {
        "en": spacy.load("en_core_web_sm", disable=["parser", "ner"]),
        "fr": spacy.load("fr_core_news_sm", disable=["parser", "ner"]),
    }
    # Mark the domain stop words on each model's vocab so tok.is_stop catches them.
    for nlp in models.values():
        for w in EXTRA_STOP:
            nlp.vocab[w].is_stop = True

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for corpus in CORPORA:
        cid, field, item_set = corpus["id"], corpus["field"], corpus["item_set"]
        print(f"== {cid}: fetching item set {item_set} …")
        items = fetch_items(item_set)
        counts = {"all": Counter(), "en": Counter(), "fr": Counter()}
        lang_items = {"en": 0, "fr": 0}
        for it in items:
            text = clean(text_of(it, field))
            if not text.strip():
                continue
            lang = lang_of(it)
            lemmas = lemmatise(text, models["fr" if lang == "fr" else "en"])
            counts["all"].update(lemmas)
            if lang in ("en", "fr"):
                counts[lang].update(lemmas)
                lang_items[lang] += 1
        payload = {
            "corpus": cid,
            "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": API_BASE,
            "models": {"en": "en_core_web_sm", "fr": "fr_core_news_sm"},
            "items": {"total": len(items), **lang_items},
            "all": top(counts["all"]),
            "en": top(counts["en"]),
            "fr": top(counts["fr"]),
        }
        (OUT_DIR / f"{cid}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(
            f"   wrote asset/data/wordclouds/{cid}.json: "
            f"{len(payload['all'])} words from {len(items)} items "
            f"(en={lang_items['en']}, fr={lang_items['fr']})"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
