#!/usr/bin/env python3
"""
Stock Technical Analysis Script

Uses yfinance to fetch historical data and pandas_ta to calculate technical indicators.
Outputs JSON to stdout.

Dependencies: yfinance, pandas, pandas_ta (see requirements.txt)

Usage:
    python scripts/stock_analysis.py AAPL

Output (stdout):
    {"symbol":"AAPL","price":195.5,"sma20":192.3,...}

Error output (stdout):
    {"error":"INVALID_SYMBOL","message":"..."}

Exit codes:
    0 = success
    1 = error
"""

import sys
import json


def output_error(error_type: str, message: str) -> None:
    """Output a structured error JSON to stdout and exit with code 1."""
    print(json.dumps({"error": error_type, "message": message}))
    sys.exit(1)


def main() -> None:
    # Validate command-line arguments
    if len(sys.argv) < 2:
        output_error("MISSING_ARGUMENT", "Stock symbol is required. Usage: python stock_analysis.py SYMBOL")

    symbol = sys.argv[1].strip().upper()
    if not symbol:
        output_error("INVALID_SYMBOL", "Stock symbol cannot be empty")

    # Import dependencies (after argument validation for faster error feedback)
    try:
        import yfinance as yf
        import pandas as pd
    except ImportError as e:
        output_error("DEPENDENCY_ERROR", f"Missing required dependency: {e}. Install with: pip install -r scripts/requirements.txt")

    # Fetch historical data
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period="3mo")
    except Exception as e:
        output_error("FETCH_ERROR", f"Failed to fetch data for {symbol}: {e}")

    # Validate data
    if df is None or df.empty:
        output_error("INVALID_SYMBOL", f"No data available for symbol: {symbol}. The symbol may be invalid or delisted.")

    if len(df) < 50:
        output_error("INSUFFICIENT_DATA", f"Insufficient historical data for {symbol}: only {len(df)} data points (need at least 50)")

    # Calculate technical indicators (manual — no pandas_ta/numba dependency)
    try:
        close = df["Close"]

        # SMA (Simple Moving Average)
        df["SMA_20"] = close.rolling(window=20).mean()
        df["SMA_50"] = close.rolling(window=50).mean()

        # RSI (Relative Strength Index)
        delta = close.diff()
        gain = delta.where(delta > 0, 0.0).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0.0)).rolling(window=14).mean()
        rs = gain / loss.replace(0, float("nan"))
        df["RSI_14"] = 100 - (100 / (1 + rs))

        # MACD (Moving Average Convergence Divergence)
        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        df["MACD_12_26_9"] = ema12 - ema26
        df["MACDs_12_26_9"] = df["MACD_12_26_9"].ewm(span=9, adjust=False).mean()
        df["MACDh_12_26_9"] = df["MACD_12_26_9"] - df["MACDs_12_26_9"]

        # Bollinger Bands
        sma20 = df["SMA_20"]
        std20 = close.rolling(window=20).std()
        df["BBU_20_2.0"] = sma20 + 2 * std20
        df["BBL_20_2.0"] = sma20 - 2 * std20
    except Exception as e:
        output_error("CALCULATION_ERROR", f"Failed to calculate technical indicators for {symbol}: {e}")

    # Extract latest values
    try:
        latest = df.iloc[-1]

        def safe_float(value, decimals=4):
            """Convert value to float, return None if NaN."""
            if pd.isna(value):
                return None
            return round(float(value), decimals)

        # Build result
        result = {
            "symbol": symbol,
            "price": safe_float(latest["Close"], 2),
            "sma20": safe_float(latest.get("SMA_20")),
            "sma50": safe_float(latest.get("SMA_50")),
            "rsi14": safe_float(latest.get("RSI_14")),
            "macd_line": safe_float(latest.get("MACD_12_26_9")),
            "macd_signal": safe_float(latest.get("MACDs_12_26_9")),
            "macd_histogram": safe_float(latest.get("MACDh_12_26_9")),
            "bollinger_upper": safe_float(latest.get("BBU_20_2.0")),
            "bollinger_lower": safe_float(latest.get("BBL_20_2.0")),
            "volume_avg": safe_float(df["Volume"].tail(20).mean(), 0),
            "data_date": str(latest.name.date()) if hasattr(latest.name, "date") else str(latest.name),
        }
    except Exception as e:
        output_error("PARSE_ERROR", f"Failed to extract indicator values for {symbol}: {e}")

    # Output JSON to stdout
    print(json.dumps(result))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        # Catch-all for any unexpected exceptions
        output_error("UNEXPECTED_ERROR", f"An unexpected error occurred: {e}")
