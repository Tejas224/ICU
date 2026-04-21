#!/usr/bin/env python3
import json
import os
import secrets
import urllib.error
import urllib.request
from copy import deepcopy
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4


ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "patients.json"
PORT = int(os.getenv("PORT", "8000"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


def generate_access_code():
    return secrets.token_hex(3).upper()


def create_seed_patient(name, age, room, phone, heart_rate, blood_pressure, oxygen, plan):
    return {
        "id": str(uuid4()),
        "name": name,
        "age": age,
        "room": room,
        "approvedPhone": phone,
        "accessCode": generate_access_code(),
        "codeExpiresAt": 4102444800000,
        "heartRate": heart_rate,
        "bloodPressure": blood_pressure,
        "oxygen": oxygen,
        "history": [],
        "treatmentPlan": plan,
        "aiRisk": "Low"
    }


def default_patients():
    return [
        create_seed_patient(
            "Tejas Patil",
            21,
            "101",
            "+1555000001",
            78,
            "120/80",
            98,
            "Standard observation. Check vitals every hour."
        ),
        create_seed_patient(
            "Sakshi Bandbe",
            72,
            "102",
            "+1555000002",
            92,
            "130/85",
            95,
            "Administer oxygen if SpO2 drops below 94%. Monitor blood pressure."
        )
    ]


def load_patient_store():
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass

    patients = default_patients()
    save_patient_store(patients)
    return patients


def save_patient_store(patients):
    DATA_FILE.write_text(json.dumps(patients, indent=2), encoding="utf-8")


PATIENTS = load_patient_store()


def find_patient(patient_id):
    for patient in PATIENTS:
        if patient["id"] == patient_id:
            return patient
    return None


def patient_public_summary(patient):
    return {
        "id": patient["id"],
        "name": patient["name"],
        "age": patient["age"],
        "room": patient["room"],
        "heartRate": patient["heartRate"],
        "bloodPressure": patient["bloodPressure"],
        "oxygen": patient["oxygen"],
        "aiRisk": patient.get("aiRisk", "Low"),
        "approvedPhoneMasked": mask_phone_number(patient.get("approvedPhone", "")),
        "history": patient.get("history", [])[-10:],
        "treatmentPlan": patient.get("treatmentPlan", "")
    }


def patient_mobile_view(patient):
    return {
        "name": patient["name"],
        "room": patient["room"],
        "heartRate": patient["heartRate"],
        "bloodPressure": patient["bloodPressure"],
        "oxygen": patient["oxygen"],
        "aiRisk": patient.get("aiRisk", "Low"),
        "treatmentPlan": patient.get("treatmentPlan", ""),
        "lastUpdated": patient.get("lastUpdated")
    }


def mask_phone_number(phone):
    if not phone or len(phone) < 4:
        return "***"
    return f"{'*' * max(0, len(phone) - 4)}{phone[-4:]}"


def heuristic_triage(patient):
    heart_rate = patient.get("heartRate", 0)
    oxygen = patient.get("oxygen", 0)

    if oxygen < 90 or heart_rate > 120 or heart_rate < 50:
        return {
            "summary": f"{patient['name']} needs urgent physician review due to unstable vitals.",
            "risk": "High",
            "actions": [
                "Call the ICU physician immediately.",
                "Verify oxygen delivery and repeat full vitals now.",
                "Prepare escalation for airway and circulation support."
            ],
            "watchouts": [
                f"Oxygen is {oxygen}%, which is critically low.",
                f"Heart rate is {heart_rate} bpm, outside the safe range."
            ]
        }

    if oxygen < 94 or heart_rate > 100 or heart_rate < 60:
        return {
            "summary": f"{patient['name']} shows concerning changes and should be reassessed soon.",
            "risk": "Medium",
            "actions": [
                "Repeat vitals within 5 minutes.",
                "Assess symptoms, airway comfort, and perfusion.",
                "Notify the assigned clinician if the trend worsens."
            ],
            "watchouts": [
                f"Oxygen is {oxygen}%, below the preferred target.",
                f"Heart rate is {heart_rate} bpm, which may indicate stress or deterioration."
            ]
        }

    return {
        "summary": f"{patient['name']} is currently stable on the available monitoring data.",
        "risk": "Low",
        "actions": [
            "Continue routine ICU monitoring.",
            "Document the current stability trend.",
            "Re-run AI triage after the next significant change."
        ],
        "watchouts": [
            "No critical warning signs detected from the current vitals."
        ]
    }


def heuristic_chat(payload):
    patient = payload["patient"]
    question = payload.get("question", "").strip()
    triage = heuristic_triage(patient)
    return {
        "answer": (
            f"For {patient['name']}, the current risk is {triage['risk']}. "
            f"Current triage summary: {triage['summary']} "
            f"Suggested actions: {' '.join(triage['actions'])} "
            f"Clinical watchouts: {' '.join(triage['watchouts'])} "
            f"Question: {question or 'No specific question provided.'}"
        ),
        "mode": "demo_fallback",
        "provider": "demo",
        "model": None
    }


def heuristic_health_recommendation(payload):
    patient = payload["patient"]
    triage = heuristic_triage(patient)
    return {
        "recommendation": triage["summary"],
        "care_plan": triage["actions"],
        "precautions": triage["watchouts"],
        "follow_up": "Recheck vitals within 5 to 10 minutes or sooner if the patient worsens.",
        "mode": "demo_fallback",
        "provider": "demo",
        "model": None
    }


def extract_output_text(response_json):
    for item in response_json.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text":
                return content.get("text", "")
    return ""


def extract_gemini_text(response_json):
    candidates = response_json.get("candidates", [])
    if not candidates:
        return ""

    parts = candidates[0].get("content", {}).get("parts", [])
    texts = [part.get("text", "") for part in parts if part.get("text")]
    return "".join(texts)


def get_active_provider():
    if GEMINI_API_KEY:
        return {"name": "gemini", "model": GEMINI_MODEL}
    if OPENAI_API_KEY:
        return {"name": "openai", "model": OPENAI_MODEL}
    return {"name": "demo", "model": None}


def call_openai_with_schema(payload, schema_name, schema, instruction):
    request_body = {
        "model": OPENAI_MODEL,
        "input": [
            {"role": "system", "content": instruction},
            {"role": "user", "content": json.dumps(payload)}
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": schema_name,
                "strict": True,
                "schema": schema
            }
        }
    }

    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(request_body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"},
        method="POST"
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        response_json = json.loads(response.read().decode("utf-8"))

    raw_text = extract_output_text(response_json)
    if not raw_text:
        raise ValueError("No structured output returned from OpenAI.")

    return json.loads(raw_text)


def call_gemini_json(payload, instruction):
    request_body = {
        "contents": [{"parts": [{"text": json.dumps({"instruction": instruction, "payload": payload})}]}],
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"}
    }

    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
        data=json.dumps(request_body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY},
        method="POST"
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        response_json = json.loads(response.read().decode("utf-8"))

    raw_text = extract_gemini_text(response_json)
    if not raw_text:
        raise ValueError("No JSON output returned from Gemini.")

    return json.loads(raw_text)


def call_openai_triage(payload):
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "summary": {"type": "string"},
            "risk": {"type": "string", "enum": ["Low", "Medium", "High"]},
            "actions": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 4},
            "watchouts": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 3}
        },
        "required": ["summary", "risk", "actions", "watchouts"]
    }
    result = call_openai_with_schema(
        payload,
        "icu_triage",
        schema,
        "Return strict JSON for ICU triage support. Base the answer only on the supplied patient data and alerts."
    )
    result["mode"] = "live_api"
    result["provider"] = "openai"
    result["model"] = OPENAI_MODEL
    return result


def call_gemini_triage(payload):
    result = call_gemini_json(
        payload,
        "Return valid JSON only with summary, risk, actions, and watchouts. Do not diagnose. Use only the supplied patient data."
    )
    result["mode"] = "live_api"
    result["provider"] = "gemini"
    result["model"] = GEMINI_MODEL
    return result


def call_openai_chat(payload):
    request_body = {
        "model": OPENAI_MODEL,
        "input": [
            {
                "role": "system",
                "content": (
                    "You are an ICU support assistant for clinicians. "
                    "Answer briefly and only from the supplied patient data. "
                    "Do not diagnose or claim certainty beyond the data."
                )
            },
            {"role": "user", "content": json.dumps(payload)}
        ]
    }

    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(request_body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {OPENAI_API_KEY}"},
        method="POST"
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        response_json = json.loads(response.read().decode("utf-8"))

    text = extract_output_text(response_json)
    if not text:
        raise ValueError("No chat response returned from OpenAI.")

    return {"answer": text, "mode": "live_api", "provider": "openai", "model": OPENAI_MODEL}


def call_gemini_chat(payload):
    result = call_gemini_json(
        payload,
        "Answer briefly for ICU staff using only the supplied patient data. Do not diagnose or claim certainty beyond the data."
    )
    answer = result["answer"] if isinstance(result, dict) and "answer" in result else json.dumps(result)
    return {"answer": answer, "mode": "live_api", "provider": "gemini", "model": GEMINI_MODEL}


def call_openai_health_recommendation(payload):
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "recommendation": {"type": "string"},
            "care_plan": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 5},
            "precautions": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 4},
            "follow_up": {"type": "string"}
        },
        "required": ["recommendation", "care_plan", "precautions", "follow_up"]
    }
    result = call_openai_with_schema(
        payload,
        "icu_health_recommendation",
        schema,
        "Return strict JSON for an ICU health recommendation. Use only the supplied patient data. Do not diagnose."
    )
    result["mode"] = "live_api"
    result["provider"] = "openai"
    result["model"] = OPENAI_MODEL
    return result


def call_gemini_health_recommendation(payload):
    result = call_gemini_json(
        payload,
        "Return valid JSON only with recommendation, care_plan, precautions, and follow_up. Provide an ICU health recommendation using only the supplied patient data. Do not diagnose."
    )
    result["mode"] = "live_api"
    result["provider"] = "gemini"
    result["model"] = GEMINI_MODEL
    return result


class SmartICUHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/config":
            provider = get_active_provider()
            self._send_json({"apiEnabled": provider["name"] != "demo", "provider": provider["name"], "model": provider["model"]})
            return

        if self.path == "/api/patients":
            self._send_json({"patients": [patient_public_summary(patient) for patient in PATIENTS]})
            return

        return super().do_GET()

    def do_POST(self):
        if self.path not in {
            "/api/triage",
            "/api/patient-chat",
            "/api/health-recommendation",
            "/api/patients",
            "/api/patients/sync",
            "/api/patient-access",
        }:
            self._send_json({"error": "Not found"}, status=404)
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)

        try:
            payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except json.JSONDecodeError as exc:
            self._send_json({"error": str(exc)}, status=400)
            return

        if self.path == "/api/patients":
            required_fields = ["name", "age", "room", "approvedPhone", "heartRate", "bloodPressure", "oxygen"]
            missing = [field for field in required_fields if field not in payload or payload[field] in ("", None)]
            if missing:
                self._send_json({"error": f"Missing fields: {', '.join(missing)}"}, status=400)
                return

            patient = {
                "id": str(uuid4()),
                "name": str(payload["name"]).strip(),
                "age": int(payload["age"]),
                "room": str(payload["room"]).strip(),
                "approvedPhone": str(payload["approvedPhone"]).strip(),
                "accessCode": generate_access_code(),
                "codeExpiresAt": payload.get("codeExpiresAt", 4102444800000),
                "heartRate": int(payload["heartRate"]),
                "bloodPressure": str(payload["bloodPressure"]).strip(),
                "oxygen": int(payload["oxygen"]),
                "history": payload.get("history", []),
                "treatmentPlan": payload.get("treatmentPlan", "New admission. Continue physician-directed ICU protocol."),
                "aiRisk": payload.get("aiRisk", "Low"),
                "lastUpdated": payload.get("lastUpdated")
            }
            PATIENTS.append(patient)
            save_patient_store(PATIENTS)
            self._send_json({"patient": patient_public_summary(patient), "accessCode": patient["accessCode"]})
            return

        if self.path == "/api/patients/sync":
            incoming_patients = payload.get("patients")
            if not isinstance(incoming_patients, list):
                self._send_json({"error": "Missing patients list."}, status=400)
                return

            incoming_by_id = {patient["id"]: patient for patient in incoming_patients if "id" in patient}
            for index, patient in enumerate(PATIENTS):
                updated = incoming_by_id.get(patient["id"])
                if not updated:
                    continue

                PATIENTS[index] = {
                    **patient,
                    **{key: value for key, value in updated.items() if key != "approvedPhoneMasked"}
                }

            save_patient_store(PATIENTS)
            self._send_json({"ok": True, "patients": [patient_public_summary(patient) for patient in PATIENTS]})
            return

        if self.path == "/api/patient-access":
            phone = str(payload.get("phone", "")).strip()
            code = str(payload.get("code", "")).strip().upper()
            patient = next(
                (item for item in PATIENTS if item.get("approvedPhone") == phone and item.get("accessCode") == code),
                None
            )
            if not patient:
                self._send_json({"error": "Access denied. Check phone number and access code."}, status=403)
                return

            self._send_json({"patient": patient_mobile_view(patient)})
            return

        if "patient" not in payload:
            self._send_json({"error": "Missing patient payload."}, status=400)
            return

        provider = get_active_provider()

        if self.path == "/api/health-recommendation":
            if provider["name"] == "demo":
                self._send_json(heuristic_health_recommendation(payload))
                return
            try:
                result = call_gemini_health_recommendation(payload) if provider["name"] == "gemini" else call_openai_health_recommendation(payload)
                self._send_json(result)
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as exc:
                fallback = heuristic_health_recommendation(payload)
                fallback["mode"] = "fallback_after_error"
                fallback["provider"] = provider["name"]
                fallback["model"] = provider["model"]
                fallback["error"] = str(exc)
                self._send_json(fallback)
            return

        if self.path == "/api/patient-chat":
            if provider["name"] == "demo":
                self._send_json(heuristic_chat(payload))
                return
            try:
                result = call_gemini_chat(payload) if provider["name"] == "gemini" else call_openai_chat(payload)
                self._send_json(result)
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as exc:
                fallback = heuristic_chat(payload)
                fallback["mode"] = "fallback_after_error"
                fallback["provider"] = provider["name"]
                fallback["model"] = provider["model"]
                fallback["error"] = str(exc)
                self._send_json(fallback)
            return

        if provider["name"] == "demo":
            self._send_json({**heuristic_triage(payload["patient"]), "mode": "demo_fallback", "provider": "demo", "model": None})
            return

        try:
            result = call_gemini_triage(payload) if provider["name"] == "gemini" else call_openai_triage(payload)
            self._send_json(result)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as exc:
            fallback = heuristic_triage(payload["patient"])
            fallback["mode"] = "fallback_after_error"
            fallback["provider"] = provider["name"]
            fallback["model"] = provider["model"]
            fallback["error"] = str(exc)
            self._send_json(fallback)


if __name__ == "__main__":
    os.chdir(ROOT)
    with ThreadingHTTPServer(("0.0.0.0", PORT), SmartICUHandler) as httpd:
        print(f"Server running at http://0.0.0.0:{PORT}/")
        print("Open locally at http://127.0.0.1:{PORT}/")
        print("Press Ctrl+C to stop")
        httpd.serve_forever()
