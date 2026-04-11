import http.server
import socketserver
import json
import os
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

# Manual .env loader
def load_env():
    env_path = ".env"
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ[key.strip()] = value.strip().strip('"').strip("'")

load_env()
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

def is_valid_key(key):
    return key and key != "your_gemini_api_key_here" and len(key) > 10

PORT = 3000
DIRECTORY = "public"
DATA_DIR = "data"

# Global upload state for status tracking
upload_state = {
    "status": "idle", # or 'processing', 'success', 'error'
    "message": "",
    "days": 0,
    "elapsed": 0
}


# ── Apple Health XML Parser ──────────────────────────────────────────────────

def parse_health_xml(filepath=None):
    """
    Parses exactly what the dashboard needs from export.xml using iterparse.
    Takes ~30-60s for a 1GB+ file depending on the system, keeping memory low.
    """
    hrv_by_date: Dict[str, List[float]] = defaultdict(list)
    rhr_by_date: Dict[str, List[float]] = defaultdict(list)
    sleep_by_date: Dict[str, Dict[str, float]] = defaultdict(lambda: {"deep": 0.0, "rem": 0.0, "core": 0.0})
    sleep_timing_by_date: Dict[str, Dict[str, Any]] = {} 
    workout_by_date: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    SLEEP_TYPE   = "HKCategoryTypeIdentifierSleepAnalysis"
    HRV_TYPE     = "HKQuantityTypeIdentifierHeartRateVariabilitySDNN"
    RHR_TYPE     = "HKQuantityTypeIdentifierRestingHeartRate"

    DEEP_VAL  = "HKCategoryValueSleepAnalysisAsleepDeep"
    REM_VAL   = "HKCategoryValueSleepAnalysisAsleepREM"
    CORE_VALS = {
        "HKCategoryValueSleepAnalysisAsleepCore",
        "HKCategoryValueSleepAnalysisAsleepUnspecified",
        "HKCategoryValueSleepAnalysisAsleep",
    }

    def _sleep_night(dt_str):
        """Map datetime to the 'Morning/Wakeup' date it belongs to.
           Example: Jan 15 11:00 PM -> Jan 16 11:00 AM -> Jan 16.
           Example: Jan 16 04:00 AM -> Jan 16 04:00 PM -> Jan 16.
        """
        try:
            fmt = "%Y-%m-%d %H:%M:%S %z"
            dt = datetime.strptime(dt_str, fmt)
            # Shift forward by 12 hours to align with the waking day
            return (dt + timedelta(hours=12)).strftime("%Y-%m-%d")
        except:
            return dt_str[:10]

    def _date(dt_str):
        """Extract YYYY-MM-DD from Apple Health datetime string."""
        if not dt_str: return ""
        return str(dt_str)[:10]

    def _minutes_between(start_str, end_str):
        """Return float minutes between two Apple Health datetime strings."""
        try:
            # Format: "2024-01-15 08:23:45 -0800"
            fmt = "%Y-%m-%d %H:%M:%S %z"
            s = datetime.strptime(start_str, fmt)
            e = datetime.strptime(end_str, fmt)
            return max(0.0, (e - s).total_seconds() / 60.0)
        except Exception:
            return 0.0

    try:
        for _event, elem in ET.iterparse(filepath, events=("end",)):
            tag = elem.tag

            if tag == "Record":
                rtype      = elem.get("type", "")
                start_date = elem.get("startDate", "")
                end_date   = elem.get("endDate", "")
                
                if rtype == HRV_TYPE:
                    date = _date(start_date)
                    try:
                        hrv_by_date[date].append(float(elem.get("value", 0)))
                    except ValueError:
                        pass
                elif rtype == RHR_TYPE:
                    date = _date(start_date)
                    try:
                        rhr_by_date[date].append(float(elem.get("value", 0)))
                    except ValueError:
                        pass
                elif rtype == SLEEP_TYPE:
                    sleep_val = elem.get("value", "")
                    mins = _minutes_between(start_date, end_date)
                    night_date = _sleep_night(start_date)

                    if sleep_val == DEEP_VAL:
                        sleep_by_date[night_date]["deep"] += mins
                    elif sleep_val == REM_VAL:
                        sleep_by_date[night_date]["rem"] += mins
                    elif sleep_val in CORE_VALS:
                        sleep_by_date[night_date]["core"] += mins
                    
                    if sleep_val == "HKCategoryValueSleepAnalysisInBed":
                        elem.clear()
                        continue
                        
                    if night_date not in sleep_timing_by_date:
                        sleep_timing_by_date[night_date] = {"start": None, "end": None, "segments": []}
                    
                    sleep_timing_by_date[night_date]["segments"].append({
                        "start": start_date, "end": end_date, "mins": mins, "type": sleep_val
                    })

            elif tag == "Workout":
                start_date = elem.get("startDate", "")
                date = _date(start_date)
                if date:
                    try:
                        duration = float(elem.get("duration", 0))  # minutes
                        w_type = elem.get("workoutActivityType", "HKWorkoutActivityTypeOther").replace("HKWorkoutActivityType", "")
                        workout_by_date[date].append({
                            "type": w_type,
                            "start": start_date,
                            "duration": duration
                        })
                    except ValueError:
                        pass

            elem.clear()

    except ET.ParseError as e:
        return {"error": f"XML parse error: {e}", "dates": [], "hrv": [], "rhr": [],
                "sleepDeep": [], "sleepREM": [], "sleepCore": [], "workoutMinutes": []}

    # ── Assemble sorted date arrays (Unlimited history per user request) ──
    all_dates_set: set[str] = set(hrv_by_date.keys()) | set(rhr_by_date.keys()) | set(sleep_by_date.keys()) | set(workout_by_date.keys())
    all_dates: list[str] = sorted(list(all_dates_set))  # type: ignore

    # ── Refine Sleep Timing (Primary Session Heuristic) ──
    # Heuristic: Pick segments that occur during traditional sleep hours (6 PM - 3 PM).
    # ── Refine Sleep Timing (Proximity Grouping Heuristic) ──
    # Heuristic: Group segments by Sleep Night. Merge segments if gap < 2h.
    # Pick the longest session as the Primary Night Session.
    for date, target_all in sleep_timing_by_date.items():
        # Filter for actual 'Asleep' segments (exclude 'InBed')
        segs = target_all.get("segments", [])
        asleep = [s for s in segs if s.get("type", "") != "HKCategoryValueSleepAnalysisInBed"]
        if not asleep: continue
        
        # Sort segments by start time
        asleep.sort(key=lambda x: x["start"])
        
        fmt = "%Y-%m-%d %H:%M:%S %z"
        sessions = []
        current_session = [asleep[0]]
        for i in range(1, len(asleep)):
            try:
                prev_end = datetime.strptime(current_session[-1]["end"], fmt)
                curr_start = datetime.strptime(asleep[i]["start"], fmt)
                # If gap is less than 2 hours, merge into the same session
                if (curr_start - prev_end).total_seconds() / 3600.0 < 2.0:
                    current_session.append(asleep[i])
                else:
                    sessions.append(current_session)
                    current_session = [asleep[i]]
            except:
                sessions.append(current_session)
                current_session = [asleep[i]]
        sessions.append(current_session)

        # Pick the longest total duration session group as 'Primary'
        session_stats = []
        for sess in sessions:
            total_m = sum(s["mins"] for s in sess)
            s_s = sess[0]["start"]
            s_e = sess[-1]["end"]
            session_stats.append({"start": s_s, "end": s_e, "total": total_m})
        
        session_stats.sort(key=lambda x: x["total"], reverse=True)
        best = session_stats[0]
        
        # Update the target date with the primary session start/end
        # Filter: Only count as 'Night Sleep' if it's > 3 hours
        if best["total"] >= 180:
            target_all["start"] = best["start"]
            target_all["end"] = best["end"]
        else:
            target_all["start"] = None
            target_all["end"] = None

    # ── Assemble sorted date arrays ──

    result: dict[str, Any] = {
        "dataSource": "xml",
        "parsedAt": datetime.now(timezone.utc).isoformat(),
        "dates": [],
        "hrv": [],
        "rhr": [],
        "sleepDeep": [],
        "sleepREM":  [],
        "sleepCore": [],
        "sleepInBedMins": [],
        "sleepBedtimes": [],
        "sleepWakeups": [],
        "workoutMinutes": [],
        "workouts": [],
    }

    def _avg(lst):
        return round(float(sum(lst)) / len(lst), 1) if lst else None  # type: ignore

    for date in all_dates:
        result["dates"].append(date)
        result["hrv"].append(_avg(hrv_by_date.get(date, [])))
        result["rhr"].append(_avg(rhr_by_date.get(date, [])))
        sleep = sleep_by_date.get(date, {"deep": 0, "rem": 0, "core": 0})
        result["sleepDeep"].append(round(float(sleep["deep"]), 1))  # type: ignore
        result["sleepREM"].append(round(float(sleep["rem"]), 1))  # type: ignore
        result["sleepCore"].append(round(float(sleep["core"]), 1))  # type: ignore
        
        timing = sleep_timing_by_date.get(date, {"start": None, "end": None})
        def _get_time(dt_str: Optional[str]) -> Optional[str]:
            if not dt_str or len(str(dt_str)) < 16: return None
            return str(dt_str)[11:16]

        # In-bed duration = primary session window (start → end of night)
        # This gives us real sleep efficiency without needing InBed records
        t_start = timing.get("start")
        t_end   = timing.get("end")
        in_bed_mins = _minutes_between(t_start, t_end) if (t_start and t_end) else 0.0
        result["sleepInBedMins"].append(round(in_bed_mins, 1))

        result["sleepBedtimes"].append(_get_time(timing["start"]))
        result["sleepWakeups"].append(_get_time(timing["end"]))

        daily_workouts = workout_by_date.get(date, [])
        result["workouts"].append(daily_workouts)
        daily_dur = sum(w["duration"] for w in daily_workouts)
        result["workoutMinutes"].append(round(daily_dur, 1))

    # Final structure for frontend compat
    result["sleep"] = {
        "deep": result["sleepDeep"],
        "rem": result["sleepREM"],
        "core": result["sleepCore"],
        "totalHoursLast": (result["sleepDeep"][-1] + result["sleepREM"][-1] + result["sleepCore"][-1]) / 60 if result["sleepDeep"] else 0
    }
    result["recovery"] = {
        "hrv": result["hrv"],
        "rhr": result["rhr"]
    }

    return result


# ── HTTP Handler ─────────────────────────────────────────────────────────────

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        # Suppress noisy access log; keep errors
        if "404" in str(args) or "500" in str(args):
            super().log_message(format, *args)

    # ── Routing ──────────────────────────────────────────────────────────────

    def do_GET(self):
        if "?" in self.path:
            self.path = self.path.split("?")[0]
            
        if self.path == "/api/health":
            self.handle_get_health()
        elif self.path == "/api/data" or self.path == "/api/health/sleep-schedule":
            self.handle_get_data()
        elif self.path == "/api/ai/insight":
            self.handle_get_ai_insight()
        elif self.path == "/api/ai/sleep-insight":
            self.handle_get_sleep_insight()
        elif self.path == "/api/upload/status":
            self.handle_get_upload_status()
        elif self.path == "/api/tags":
            self.handle_get_tags()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/sync":
            self.handle_post_sync()
        elif self.path == "/api/upload":
            self.handle_post_upload()
        elif self.path == "/api/tags":
            self.handle_post_tags()
        else:
            self.send_error(404, "Endpoint not found")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ── Helpers ───────────────────────────────────────────────────────────────

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length)

    # ── Endpoint Handlers ────────────────────────────────────────────────────

    def handle_get_health(self):
        """Return latest live-sync JSON (written by iOS Shortcut)."""
        filepath = os.path.join(DATA_DIR, "latest.json")
        if os.path.exists(filepath):
            with open(filepath, "r") as f:
                raw = f.read()
            body = raw.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        else:
            self._send_json({})

    def handle_get_data(self):
        """Return server-parsed structured data from export.xml."""
        filepath = os.path.join(DATA_DIR, "parsed.json")
        if os.path.exists(filepath):
            with open(filepath, "r") as f:
                raw = f.read()
            body = raw.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        else:
            self._send_json({"dataSource": "none"})

    def handle_post_sync(self):
        """Accept JSON from iOS Shortcut and persist it."""
        data = self._read_body()
        filepath = os.path.join(DATA_DIR, "latest.json")
        with open(filepath, "wb") as f:
            f.write(data)
        self._send_json({"status": "success", "message": "Synced successfully"})
        print(f"📲 Live sync received: {len(data)} bytes")

    def handle_post_upload(self):
        """Accept Apple Health export.xml and start a background parse thread."""
        xml_path = os.path.join(DATA_DIR, "export.xml")
        
        # 1. Received the file streamingly to disk
        content_length_str = self.headers.get("Content-Length")
        if content_length_str:
            content_length = int(content_length_str)
            print(f"📥 Receiving XML upload: {content_length / 1024 / 1024:.1f} MB…")
            with open(xml_path, "wb") as f:
                bytes_read = 0
                chunk_size = 1024 * 512
                while bytes_read < content_length:
                    to_read = min(chunk_size, content_length - bytes_read)
                    f.write(self.rfile.read(to_read))
                    bytes_read += to_read
        else:
            data = self.rfile.read()
            with open(xml_path, "wb") as f:
                f.write(data)

        # 2. Return an early ACK to the browser (avoiding timeouts on 1GB+ files)
        upload_state["status"] = "processing"
        upload_state["message"] = "File received. Parsing in progress..."
        self._send_json({"status": "processing", "message": "Parsing started on server."})

        # 3. Trigger worker thread
        def parse_worker():
            try:
                print("📂 Starting background parse…")
                start_t = time.time()
                parsed = parse_health_xml(xml_path)
                elapsed = time.time() - start_t
                
                # Save
                parsed_path = os.path.join(DATA_DIR, "parsed.json")
                with open(parsed_path, "w") as f:
                    json.dump(parsed, f)
                
                days = len(parsed.get('dates', []))
                upload_state["status"] = "success"
                upload_state["days"] = days
                upload_state["elapsed"] = round(elapsed, 1)
                upload_state["message"] = f"Finished parsing {days} days."
                print(f"✅ Background parse finished in {elapsed:.1f}s")
            except Exception as e:
                upload_state["status"] = "error"
                upload_state["message"] = f"Parse Error: {str(e)}"
                print(f"❌ Background parse failed: {e}")

        threading.Thread(target=parse_worker).start()

    def handle_get_upload_status(self):
        """Return the current status of a background upload/parse task."""
        self._send_json(upload_state)

    # ── Tags / Habits Persistence ─────────────────────────────────────────────

    _tags_lock = threading.Lock()

    def _tags_path(self):
        return os.path.join(DATA_DIR, "tags.json")

    def _load_tags(self):
        """Load tags from disk. Returns {habits: [...], log: {date: [...]}}."""
        p = self._tags_path()
        if os.path.exists(p):
            try:
                with open(p, "r") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"habits": ["alcohol", "supplements", "sauna", "cold_plunge", "heavy_leg_day"], "log": {}}

    def handle_get_tags(self):
        """Return the persisted habits list and daily log."""
        self._send_json(self._load_tags())

    def handle_post_tags(self):
        """Merge incoming tag data into tags.json.

        Accepts JSON body with any/all of:
          { date: "YYYY-MM-DD", tags: [...], habits: [...] }
        """
        try:
            body = self._read_body()
            incoming = json.loads(body.decode("utf-8"))
        except Exception as e:
            self._send_json({"error": f"Bad JSON: {e}"}, 400)
            return

        with Handler._tags_lock:
            data = self._load_tags()

            # Update the daily log for a specific date
            date = incoming.get("date")
            tags = incoming.get("tags")
            if date and tags is not None:
                data["log"][date] = tags

            # Update the master habits list if provided
            habits = incoming.get("habits")
            if habits is not None:
                data["habits"] = habits

            with open(self._tags_path(), "w") as f:
                json.dump(data, f, indent=2)

        self._send_json({"status": "ok"})

    def handle_get_ai_insight(self):
        """Generate a proactive health insight using Gemini 1.5 Flash."""
        if not is_valid_key(GOOGLE_API_KEY):
            self._send_json({
                "insight": "AI Insights require a valid Gemini API Key. Please replace the placeholder in your .env file.",
                "is_mock": True
            })
            return

        parsed_path = os.path.join(DATA_DIR, "parsed.json")
        if not os.path.exists(parsed_path):
            self._send_json({"insight": "No health data found. Upload your export.xml first."})
            return

        try:
            with open(parsed_path, "r") as f:
                data = json.load(f)
            
            # Extract last 14 days of key metrics
            lookback = 14
            dates = data.get("dates", [])[-lookback:]
            hrv = data.get("hrv", [])[-lookback:]
            rhr = data.get("rhr", [])[-lookback:]
            sleep_deep = data.get("sleepDeep", [])[-lookback:]
            sleep_rem = data.get("sleepREM", [])[-lookback:]
            workouts = data.get("workoutMinutes", [])[-lookback:]

            # Construct data summary for the prompt
            summary = []
            for i in range(len(dates)):
                daily = f"Date: {dates[i]}, HRV: {hrv[i]}ms, RHR: {rhr[i]}bpm, Deep Sleep: {sleep_deep[i]}m, REM: {sleep_rem[i]}m, Workouts: {workouts[i]}m"
                summary.append(daily)
            
            data_string = "\n".join(summary)
            
            # Gemini API call using urllib (v1beta) - Using 3.1 Flash Lite
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key={GOOGLE_API_KEY}"
            
            # Use current time to inject randomness/freshness
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            prompt = (
                f"CURRENT TIME: {now_str}\n" 
                "You are the Ekatra Health Coach. Analyze the last 14 days of health data. "
                "Provide a single, proactive, and FRESH health insight (max 2 sentences). "
                "If the data is stagnant compared to previous days, explicitly mention it or find a minor nuance to highlight. "
                "Avoid repeating generic advice. Be punchy.\n\n"
                f"DATA:\n{data_string}"
            )
            
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 1.0,  # Encourages diversity
                    "maxOutputTokens": 100,
                }
            }
            
            req_data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                url, 
                data=req_data,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            
            with urllib.request.urlopen(req, timeout=10) as response:
                res_body = response.read().decode("utf-8")
                res_json = json.loads(res_body)
            
            insight = res_json['candidates'][0]['content']['parts'][0]['text'].strip()
            self._send_json({"insight": insight})

        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            print(f"❌ [AI Debug] HTTP {e.code}: {error_body}")
            
            msg = f"AI Coach Error: {e.code}."
            if e.code == 429:
                msg = "AI Coach cooldown (throttle). Please wait 60s and try again."
            
            self._send_json({"insight": msg}, 500)
        except urllib.error.URLError as e:
            print(f"❌ Gemini API Network Error: {e}")
            self._send_json({"insight": "Network error reaching the AI Coach. Check your connection."}, 500)
        except Exception as e:
            print(f"❌ AI Insight Error: {e}")
            self._send_json({"insight": "The AI Coach is taking a breather. Try again in a moment."}, 500)
    def handle_get_sleep_insight(self):
        """Generate a specialized Sleep & Recovery insight using Gemini 2.5 Flash Lite."""
        if not is_valid_key(GOOGLE_API_KEY):
            self._send_json({"insight": "API Key Required."})
            return

        parsed_path = os.path.join(DATA_DIR, "parsed.json")
        if not os.path.exists(parsed_path):
            self._send_json({"insight": "No data found."})
            return

        try:
            with open(parsed_path, "r") as f:
                data = json.load(f)
            
            # Extract last 14 days
            lookback = 14
            all_dates = data.get("dates", [])
            dates = all_dates[-lookback:]
            hrv = data.get("hrv", [])[-lookback:]
            rhr = data.get("rhr", [])[-lookback:]
            deep = data.get("sleepDeep", [])[-lookback:]
            rem = data.get("sleepREM", [])[-lookback:]
            core = data.get("sleepCore", [])[-lookback:]
            bedtimes = data.get("sleepBedtimes", [])[-lookback:]
            wakeups = data.get("sleepWakeups", [])[-lookback:]
            
            summary = []
            for i in range(len(dates)):
                daily = (
                    f"Date: {dates[i]}, HRV: {hrv[i]}, RHR: {rhr[i]}, "
                    f"Deep: {deep[i]}m, REM: {rem[i]}m, Core: {core[i]}m, "
                    f"Bedtime: {bedtimes[i] if i < len(bedtimes) else 'N/A'}, "
                    f"Wakeup: {wakeups[i] if i < len(wakeups) else 'N/A'}"
                )
                summary.append(daily)
            
            data_string = "\n".join(summary)
            
            # Correct model name: gemini-2.5-flash-lite
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={GOOGLE_API_KEY}"
            
            prompt = (
                "You are the Ekatra Health Scientist. Analyze the last 14 days of Sleep and Recovery data.\n"
                "DATA CONTEXT: Sleep Trend, HRV/RHR, AND Sleep/Wake Schedule consistency.\n"
                "Provide a 3-part response that GUIDES the user:\n"
                "1. WHAT'S GOING WELL: Focus on wins (e.g., consistent bedtime or high deep sleep) (max 1 sentence).\n"
                "2. WHAT'S GOING WRONG: Focus on risks (e.g., erratic wake-up times or declining HRV) (max 1 sentence).\n"
                "3. WHAT DOES IT MEAN: Actionable meaning. How does their schedule consistency relate to their physical recovery score? (max 2 sentences).\n\n"
                "Be sophisticated with specific numbers (e.g., '6:30 AM wakeup', '45ms HRV'). Avoid generic advice.\n\n"
                f"DATA:\n{data_string}"
            )
            
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": { 
                    "temperature": 0.8, 
                    "maxOutputTokens": 400 
                }
            }
            
            req_data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=req_data, headers={"Content-Type": "application/json"}, method="POST")
            
            with urllib.request.urlopen(req, timeout=10) as response:
                res_body = response.read().decode("utf-8")
                res_json = json.loads(res_body)
            
            insight = res_json['candidates'][0]['content']['parts'][0]['text'].strip()
            self._send_json({"insight": insight})

        except Exception as e:
            print(f"❌ Sleep AI Error: {e}")
            self._send_json({"insight": "Sleep analysis engine is currently cooling down. Check back shortly."}, 500)


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    os.makedirs(DIRECTORY, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)

    # Warn if live data is stale
    live_path = os.path.join(DATA_DIR, "latest.json")
    if os.path.exists(live_path):
        age_hours = (time.time() - os.path.getmtime(live_path)) / 3600
        if age_hours > 12:
            print(f"⚠️  data/latest.json is {age_hours:.1f}h old — sync from iOS to refresh.")

    # Check if parsed XML already exists
    parsed_path = os.path.join(DATA_DIR, "parsed.json")
    if os.path.exists(parsed_path):
        with open(parsed_path) as f:
            try:
                pd = json.load(f)
                print(f"📊 Loaded existing parsed data: {len(pd.get('dates', []))} days, source={pd.get('dataSource','?')}")
            except Exception:
                pass
    else:
        # Auto-parse export.xml if it exists and is real (> 1 KB)
        xml_path = os.path.join(DATA_DIR, "export.xml")
        if os.path.exists(xml_path) and os.path.getsize(xml_path) > 1024:
            print("🔍 Detected export.xml — parsing on startup…")
            parsed = parse_health_xml(xml_path)
            with open(parsed_path, "w") as f:
                json.dump(parsed, f)
            print(f"✅ Pre-parsed {len(parsed.get('dates', []))} days of data")

    class ReusableTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
        allow_reuse_address = True

    with ReusableTCPServer(("", PORT), Handler) as httpd:
        print(f"🚀 Ekatra — Personal Health Intelligence → http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")
