# Export (PHASE 9):
#   export_approved_json  -> pipeline/data/approved/activities.json (canonical)
#   export_gorgon_js      -> ui_kits/app/generated-data.js
#                            window.GORGON_GENERATED_DATA = [...]
#
# The Gorgon UI needs a few presentation fields (date label, day, distance,
# coord, price label...). They are DERIVED deterministically from the
# approved canonical records — no invented facts, only layout defaults.

import json
import math
from pathlib import Path

from pipeline.normalize.datetime import date_label, weekday_key
from pipeline.normalize.activity import price_label

# Presentation-only district centroids (lng, lat) for the demo map fallback.
_DISTRICT_CENTROIDS = {
    "黄浦": (121.484, 31.231), "徐汇": (121.463, 31.190), "长宁": (121.425, 31.221),
    "静安": (121.448, 31.230), "普陀": (121.397, 31.249), "虹口": (121.491, 31.268),
    "杨浦": (121.523, 31.301), "闵行": (121.382, 31.113), "宝山": (121.489, 31.399),
    "嘉定": (121.266, 31.376), "浦东": (121.544, 31.221), "金山": (121.342, 30.742),
    "松江": (121.224, 31.033), "青浦": (121.123, 31.150), "奉贤": (121.474, 30.918),
    "崇明": (121.398, 31.623),
}
# Demo user location mirrors ui_kits/app/data.js.
_USER_COORD = (121.51, 31.30)

# Deterministic keyword -> category mapping (checked in order).
_CATEGORY_RULES = [
    ("hackathon", ["黑客松", "hackathon"]),
    ("ai", ["ai", "大模型", "agent", "llm", "生成式", "gpt"]),
    ("exhibition", ["展览", "展会", "expo"]),
    ("art", ["艺术", "画展", "戏剧", "话剧", "美术馆"]),
    ("music", ["音乐", "livehouse", "演出", "演唱会", "民谣"]),
    ("sport", ["运动", "篮球", "足球", "羽毛球", "跑步", "骑行", "飞盘", "桨板"]),
    ("outdoor", ["徒步", "露营", "户外", "登山"]),
    ("market", ["市集", "集市", "咖啡节"]),
    ("talk", ["讲座", "沙龙", "分享会", "论坛", "公开课"]),
    ("study", ["工作坊", "课程", "培训", "实战", "训练营"]),
    ("campus", ["校园", "社团", "校内", "高校"]),
    ("charity", ["公益", "志愿", "慈善"]),
    ("food", ["美食", "咖啡", "品鉴", "烘焙"]),
    ("social", ["桌游", "剧本杀", "联谊", "狼人杀"]),
]

_KNOWN_CATEGORIES = {k for k, _ in _CATEGORY_RULES}


# Presentation label for the trust state. Derived from real pipeline signals
# only — never invented:
#   cross_source_conflict   -> 存在冲突
#   status == "approved"    -> 已确认
#   anything else           -> 待核验
_TRUST_LABEL = {"confirmed": "已确认", "pending": "待核验", "conflict": "存在冲突"}


def _trust_status(act):
    reasons = act.get("trustReasons") or []
    if "cross_source_conflict" in reasons or act.get("duplicateOf"):
        return "conflict"
    if act.get("status") == "approved":
        return "confirmed"
    return "pending"


def _match_category(act):
    if act.get("category") in _KNOWN_CATEGORIES:
        return act["category"]
    text = ((act.get("title") or "") + " " + " ".join(act.get("tags") or [])).casefold()
    for key, words in _CATEGORY_RULES:
        for w in words:
            if w in text:
                return key
    return "social"


def _haversine_km(lng1, lat1, lng2, lat2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _distance_label(coord):
    if not coord:
        return "—"
    km = _haversine_km(_USER_COORD[0], _USER_COORD[1], coord[0], coord[1])
    return "%.1fkm" % km


def _location_label(act):
    city = act.get("city") or "上海"
    district = act.get("district")
    return "%s·%s" % (city, district) if district else city


def to_gorgon_record(act):
    """Canonical approved activity -> Gorgon UI activity record."""
    coord = _DISTRICT_CENTROIDS.get(act.get("district"))
    tags = [t for t in (act.get("tags") or []) if isinstance(t, str)][:4]
    if act.get("priceType") == "free" and "免费" not in tags and len(tags) < 4:
        tags.append("免费")
    return {
        "id": act.get("id"),
        "demo": True,  # pipeline MVP output is still demo-tagged end to end
        "image": act.get("imageUrl"),
        "imageUrl": act.get("imageUrl"),
        "imageSource": act.get("imageSource"),
        "agenda": [dict(a) for a in (act.get("agenda") or [])],
        "trustStatus": _trust_status(act),
        "title": act.get("title") or "(无标题)",
        "category": _match_category(act),
        "date": date_label(act.get("startDate")) or "日期待定",
        "day": weekday_key(act.get("startDate")) or "tbd",
        "time": act.get("startTime") or "待定",
        "end": act.get("endTime"),
        "location": _location_label(act),
        "district": act.get("district"),
        "venue": act.get("venue") or "地点待定",
        "distance": _distance_label(coord),
        "address": act.get("address"),
        "coord": {"lng": coord[0], "lat": coord[1]} if coord else None,
        "price": price_label(act.get("priceType"), act.get("price")),
        "hot": False,
        "going": 0,
        "capacity": None,
        "spotsLeft": None,
        "tags": tags,
        "trust": "aggregated" if "confirmed_by_multiple_sources" in (act.get("trustReasons") or []) else "pipeline",
        "trustScore": act.get("trustScore"),
        "source": "DEMO DATA · pipeline (%s)" % (act.get("sourceName") or "unknown"),
        "updated": "今天",
        "host": act.get("organizer") or "主办方待确认",
        "contact": act.get("registrationUrl"),
        "desc": act.get("description") or "详情暂未提供。",
        "transit": [],
        "bring": [],
        "notes": "PIPELINE DEMO 数据，由 Gorgon data pipeline 自动生成。",
        "refund": None,
        "registrationUrl": act.get("registrationUrl"),
        "sourceUrl": act.get("sourceUrl"),
        "duplicateOf": act.get("duplicateOf"),
        # Human Review Loop provenance (PHASE 11)
        "reviewedBy": act.get("reviewedBy"),
        "reviewDecision": act.get("reviewDecision"),
        "reviewedAt": act.get("reviewedAt"),
        "humanEdited": act.get("humanEdited"),
    }


def export_approved_json(approved, out_path):
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "DEMO_DATA": True,
        "count": len(approved),
        "activities": approved,
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    return str(path)


def export_gorgon_js(approved, out_path):
    """Write ui_kits/app/generated-data.js: window.GORGON_GENERATED_DATA=[...]"""
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    records = [to_gorgon_record(a) for a in approved]
    header = (
        "// Gorgon generated data — DO NOT EDIT BY HAND.\n"
        "// ⚠️ DEMO DATA — produced by `python pipeline/run.py --export-gorgon`.\n"
        "// This file is a pipeline artifact; ui_kits/app/data.js stays untouched\n"
        "// and serves as fallback when this file is missing or empty.\n"
    )
    body = json.dumps(records, ensure_ascii=False, indent=2)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(header + "window.GORGON_GENERATED_DATA = " + body + ";\n")
    return str(path)
