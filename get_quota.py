import sqlite3
import os
import re
import json

db_path = os.path.expanduser('~/.codex/logs_2.sqlite')

try:
    if not os.path.exists(db_path):
        print(json.dumps({"success": False, "error": "Logs database not found"}))
        exit(0)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("SELECT MAX(id) FROM logs")
    max_id_row = cursor.fetchone()
    max_id = max_id_row[0] if max_id_row else None

    found = None
    if max_id:
        chunk_size = 50000
        current_min = max_id - chunk_size
        # Limit search back to max 5 iterations to avoid spending too long
        iterations = 0
        while current_min > -chunk_size and iterations < 5:
            cursor.execute(
                "SELECT feedback_log_body FROM logs WHERE id > ? AND id <= ? AND feedback_log_body LIKE '%\"type\":\"codex.rate_limits\"%' ORDER BY id DESC LIMIT 1",
                (current_min, current_min + chunk_size)
            )
            row = cursor.fetchone()
            if row:
                found = row[0]
                break
            current_min -= chunk_size
            iterations += 1

    # Fallback to full scan if not found in recent chunks
    if not found:
        cursor.execute("SELECT feedback_log_body FROM logs WHERE feedback_log_body LIKE '%\"type\":\"codex.rate_limits\"%' ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        if row:
            found = row[0]

    if found:
        # Extract the JSON event using regex
        match = re.search(r'websocket event:\s*(\{.*\})', found)
        if match:
            event_data = json.loads(match.group(1))
            print(json.dumps({"success": True, "data": event_data}))
        else:
            print(json.dumps({"success": False, "error": "Websocket event JSON not found in log body"}))
    else:
        print(json.dumps({"success": False, "error": "No rate limit events found in logs"}))

except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
finally:
    try:
        conn.close()
    except:
        pass
