#!/usr/bin/env python3
"""
VIX Monitor — Fetches current CBOE VIX level and writes to SQLite DB.
Called by cron every 15 minutes during market hours.

Usage: python3 scripts/vix_monitor.py [--db path/to/sessions.db]
"""

import sys
import os
import sqlite3
import argparse
from datetime import datetime

def get_vix_level() -> float:
    """Fetch current VIX level using yfinance."""
    import yfinance as yf
    vix = yf.Ticker("^VIX")
    hist = vix.history(period="1d")
    if hist.empty:
        raise ValueError("No VIX data returned")
    return float(hist["Close"].iloc[-1])

def main():
    parser = argparse.ArgumentParser(description="VIX Monitor")
    parser.add_argument("--db", default=os.path.join(os.path.dirname(__file__), "..", "data", "sessions.db"))
    args = parser.parse_args()

    try:
        vix_level = get_vix_level()
    except Exception as e:
        print(f"[VIX Monitor] Failed to fetch VIX: {e}", file=sys.stderr)
        sys.exit(1)

    # Determine regime
    if vix_level > 35:
        regime = "crisis"
        multiplier = 0.25
    elif vix_level > 25:
        regime = "high_vol"
        multiplier = 0.5
    elif vix_level < 15:
        regime = "low_vol"
        multiplier = 1.5
    else:
        regime = "normal"
        multiplier = 1.0

    # Write to dynamic_risk_state table
    conn = sqlite3.connect(args.db)
    conn.execute("""
        INSERT INTO dynamic_risk_state (id, regime, vix_level, risk_multiplier, updated_at)
        VALUES (1, ?, ?, ?, strftime('%s','now'))
        ON CONFLICT(id) DO UPDATE SET
            regime = excluded.regime,
            vix_level = excluded.vix_level,
            risk_multiplier = excluded.risk_multiplier,
            updated_at = strftime('%s','now')
    """, (regime, vix_level, multiplier))
    conn.commit()
    conn.close()

    print(f"[VIX Monitor] VIX={vix_level:.2f} regime={regime} multiplier={multiplier}")

if __name__ == "__main__":
    main()
