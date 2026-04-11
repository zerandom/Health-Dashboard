import server
import json
import os

print("🔄 Starting re-parse of data/export.xml...")
data = server.parse_health_xml("data/export.xml")
if "error" in data:
    print(f"❌ Error: {data['error']}")
else:
    with open("parsed.json", "w") as f:
        json.dump(data, f)
    print("✅ Success: parsed.json updated with Primary Sleep Session logic.")
