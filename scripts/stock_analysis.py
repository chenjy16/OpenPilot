#!/usr/bin/env python3
"""
Stock Technical Analysis Script

Uses yfinance to fetch historical data and calculates technical indicators.
Outputs JSON to stdout.

Dependencies: yfinance, pandas (see requirements.txt)

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
import pandas as pd
import numpy as np


def output_error(error_type: str, message: str) -> None:
    """Output a structured error JSON to stdout and exit with code 1."""
    print(json.dumps({"error": error_type, "message": message}))
    sys.exit(1)


def safe_float(value, decimals=4):
    """Convert value to float, return None if NaN."""
    if pd.isna(value):
        return None
    return round(float(value), decimals)


def compute_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Compute Average True Range (ATR).

    TR = max(H-L, |H-Cp|, |L-Cp|)
    ATR = EMA(TR, period)

    Returns NaN for the first row (no previous close).
    """
    close_prev = close.shift(1)
    tr1 = high - low
    tr2 = (high - close_prev).abs()
    tr3 = (low - close_prev).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.ewm(span=period, adjust=False).mean()
    return atr


def compute_obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    """Compute On-Balance Volume (OBV).

    Add volume on up days, subtract on down days, unchanged on flat days.
    """
    direction = pd.Series(0.0, index=close.index)
    direction[close > close.shift(1)] = 1.0
    direction[close < close.shift(1)] = -1.0
    obv = (volume * direction).cumsum()
    return obv


def compute_vwap(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series) -> pd.Series:
    """Compute Volume Weighted Average Price (VWAP).

    VWAP = cumsum(TypicalPrice * Volume) / cumsum(Volume)
    TypicalPrice = (H + L + C) / 3
    """
    typical_price = (high + low + close) / 3.0
    cum_tp_vol = (typical_price * volume).cumsum()
    cum_vol = volume.cumsum()
    vwap = cum_tp_vol / cum_vol.replace(0, float("nan"))
    return vwap


def compute_kdj(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 9) -> tuple:
    """Compute KDJ indicator.

    RSV = (C - L_period) / (H_period - L_period) * 100
    K = 2/3 * K_prev + 1/3 * RSV  (initial K = 50)
    D = 2/3 * D_prev + 1/3 * K    (initial D = 50)
    J = 3K - 2D

    Returns (K, D, J) as pd.Series.
    """
    low_n = low.rolling(window=period).min()
    high_n = high.rolling(window=period).max()
    denom = high_n - low_n
    rsv = (close - low_n) / denom.replace(0, float("nan")) * 100.0

    k_values = pd.Series(index=close.index, dtype=float)
    d_values = pd.Series(index=close.index, dtype=float)
    k_prev = 50.0
    d_prev = 50.0
    for i in range(len(close)):
        if pd.isna(rsv.iloc[i]):
            k_values.iloc[i] = float("nan")
            d_values.iloc[i] = float("nan")
        else:
            k_val = 2.0 / 3.0 * k_prev + 1.0 / 3.0 * rsv.iloc[i]
            d_val = 2.0 / 3.0 * d_prev + 1.0 / 3.0 * k_val
            k_values.iloc[i] = k_val
            d_values.iloc[i] = d_val
            k_prev = k_val
            d_prev = d_val

    j_values = 3.0 * k_values - 2.0 * d_values
    return k_values, d_values, j_values


def compute_williams_r(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Compute Williams %R.

    Williams %R = (H_period - C) / (H_period - L_period) * (-100)
    """
    high_n = high.rolling(window=period).max()
    low_n = low.rolling(window=period).min()
    denom = high_n - low_n
    wr = (high_n - close) / denom.replace(0, float("nan")) * (-100.0)
    return wr

def determine_signal_direction(result: dict) -> str:
    """Determine the overall signal direction from indicator values.

    Direction is determined by three factors:
    - RSI trend: >50 = bullish, <=50 = bearish
    - MACD histogram sign: >0 = bullish, <=0 = bearish
    - SMA crossover: SMA20 > SMA50 = bullish, otherwise bearish

    Returns 'bullish', 'bearish', or 'neutral' (when indicators are None).
    """
    votes_bull = 0
    votes_bear = 0
    total = 0

    rsi = result.get("rsi14")
    if rsi is not None:
        total += 1
        if rsi > 50:
            votes_bull += 1
        else:
            votes_bear += 1

    macd_hist = result.get("macd_histogram")
    if macd_hist is not None:
        total += 1
        if macd_hist > 0:
            votes_bull += 1
        else:
            votes_bear += 1

    sma20 = result.get("sma20")
    sma50 = result.get("sma50")
    if sma20 is not None and sma50 is not None:
        total += 1
        if sma20 > sma50:
            votes_bull += 1
        else:
            votes_bear += 1

    if total == 0:
        return "neutral"
    if votes_bull > votes_bear:
        return "bullish"
    if votes_bear > votes_bull:
        return "bearish"
    return "neutral"


def compute_convergence_score(timeframe_results: dict) -> int:
    """Compute convergence score (0-100) for multi-timeframe analysis.

    Score is based on alignment of signal directions across timeframes.
    Each factor (RSI, MACD histogram, SMA crossover) across each timeframe
    contributes to the score. Full alignment = high score (>=80).

    Args:
        timeframe_results: dict with keys 'daily', 'weekly', 'monthly',
                          each containing indicator result dicts.

    Returns:
        Integer score in [0, 100].
    """
    timeframes = ["daily", "weekly", "monthly"]
    available = [tf for tf in timeframes if tf in timeframe_results and timeframe_results[tf] is not None]

    if len(available) == 0:
        return 0

    # Collect per-factor votes across timeframes
    # Factors: RSI trend, MACD histogram sign, SMA crossover
    factor_votes = {"rsi": [], "macd": [], "sma": []}

    for tf in available:
        r = timeframe_results[tf]

        rsi = r.get("rsi14")
        if rsi is not None:
            factor_votes["rsi"].append(1 if rsi > 50 else -1)

        macd_hist = r.get("macd_histogram")
        if macd_hist is not None:
            factor_votes["macd"].append(1 if macd_hist > 0 else -1)

        sma20 = r.get("sma20")
        sma50 = r.get("sma50")
        if sma20 is not None and sma50 is not None:
            factor_votes["sma"].append(1 if sma20 > sma50 else -1)

    # Calculate alignment score per factor
    # Each factor contributes up to ~33 points
    total_score = 0.0
    factor_count = 0

    for factor, votes in factor_votes.items():
        if len(votes) == 0:
            continue
        factor_count += 1
        # Alignment = how many agree / total
        bull_count = sum(1 for v in votes if v > 0)
        bear_count = sum(1 for v in votes if v < 0)
        max_agreement = max(bull_count, bear_count)
        alignment = max_agreement / len(votes)
        total_score += alignment

    if factor_count == 0:
        return 0

    # Normalize to 0-100
    raw_score = (total_score / factor_count) * 100.0

    # Check if ALL directions are the same across ALL timeframes
    directions = [determine_signal_direction(timeframe_results[tf]) for tf in available]
    non_neutral = [d for d in directions if d != "neutral"]

    if len(non_neutral) >= 2 and len(set(non_neutral)) == 1:
        # All non-neutral timeframes agree — ensure score >= 80
        raw_score = max(raw_score, 80.0)

    # Clamp to [0, 100]
    score = max(0, min(100, int(round(raw_score))))
    return score



def calculate_all_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate all technical indicators on a DataFrame with OHLCV columns.

    Expects columns: Open, High, Low, Close, Volume.
    Returns the DataFrame with indicator columns added.
    """
    close = df["Close"]
    high = df["High"]
    low = df["Low"]
    volume = df["Volume"]

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

    # ATR(14)
    df["ATR_14"] = compute_atr(high, low, close, 14)

    # OBV
    df["OBV"] = compute_obv(close, volume)

    # VWAP
    df["VWAP"] = compute_vwap(high, low, close, volume)

    # KDJ
    df["KDJ_K"], df["KDJ_D"], df["KDJ_J"] = compute_kdj(high, low, close, 9)

    # Williams %R(14)
    df["WILLIAMS_R"] = compute_williams_r(high, low, close, 14)

    return df


def extract_result(symbol: str, df: pd.DataFrame) -> dict:
    """Extract the latest indicator values into a result dictionary."""
    latest = df.iloc[-1]

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
        "atr14": safe_float(latest.get("ATR_14")),
        "obv": safe_float(latest.get("OBV"), 0),
        "vwap": safe_float(latest.get("VWAP")),
        "kdj_k": safe_float(latest.get("KDJ_K")),
        "kdj_d": safe_float(latest.get("KDJ_D")),
        "kdj_j": safe_float(latest.get("KDJ_J")),
        "williams_r": safe_float(latest.get("WILLIAMS_R")),
    }
    return result



def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Stock Technical Analysis")
    parser.add_argument("symbol", help="Stock ticker symbol (e.g. AAPL)")
    parser.add_argument("--timeframe", choices=["daily", "weekly", "monthly"],
                        default="daily", help="Analysis timeframe (default: daily)")
    parser.add_argument("--multi-timeframe", action="store_true",
                        help="Run multi-timeframe analysis (daily + weekly + monthly)")
    parser.add_argument("--history", action="store_true",
                        help="Output OHLCV history as JSON array (for K-line chart)")
    parser.add_argument("--period", default=None,
                        help="Data period for --history mode (e.g. 3mo, 6mo, 1y). Defaults per timeframe.")

    # Support legacy positional period argument for backward compatibility
    parser.add_argument("legacy_period", nargs="?", default=None,
                        help=argparse.SUPPRESS)

    args = parser.parse_args()

    # Merge legacy positional period into --period (named flag takes precedence)
    if args.period is None and args.legacy_period is not None:
        args.period = args.legacy_period

    symbol = args.symbol.strip().upper()
    if not symbol:
        output_error("INVALID_SYMBOL", "Stock symbol cannot be empty")

    # Import dependencies (after argument validation for faster error feedback)
    try:
        import yfinance as yf
    except ImportError as e:
        output_error("DEPENDENCY_ERROR", f"Missing required dependency: {e}. Install with: pip install -r scripts/requirements.txt")

    # Map timeframe to yfinance interval and period
    TIMEFRAME_CONFIG = {
        "daily": {"interval": "1d", "period": "3mo"},
        "weekly": {"interval": "1wk", "period": "1y"},
        "monthly": {"interval": "1mo", "period": "2y"},
    }

    if args.history:
        # History mode: output OHLCV array with indicator overlays for K-line chart
        cfg = TIMEFRAME_CONFIG[args.timeframe]
        period = args.period or cfg["period"]
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=period, interval=cfg["interval"])
        except Exception as e:
            output_error("FETCH_ERROR", f"Failed to fetch data for {symbol}: {e}")

        if df is None or df.empty:
            output_error("INVALID_SYMBOL",
                         f"No data available for symbol: {symbol}.")

        # Calculate indicators if enough data
        if len(df) >= 20:
            try:
                df = calculate_all_indicators(df)
            except Exception:
                pass  # indicators optional for history

        records = []
        for idx, row in df.iterrows():
            date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
            rec = {
                "date": date_str,
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            }
            # Add indicator overlays if available
            if "SMA_20" in df.columns and pd.notna(row.get("SMA_20")):
                rec["sma20"] = round(float(row["SMA_20"]), 2)
            else:
                rec["sma20"] = None
            if "SMA_50" in df.columns and pd.notna(row.get("SMA_50")):
                rec["sma50"] = round(float(row["SMA_50"]), 2)
            else:
                rec["sma50"] = None
            if "BBU_20_2.0" in df.columns and pd.notna(row.get("BBU_20_2.0")):
                rec["bollinger_upper"] = round(float(row["BBU_20_2.0"]), 2)
            else:
                rec["bollinger_upper"] = None
            if "BBL_20_2.0" in df.columns and pd.notna(row.get("BBL_20_2.0")):
                rec["bollinger_lower"] = round(float(row["BBL_20_2.0"]), 2)
            else:
                rec["bollinger_lower"] = None
            records.append(rec)

        print(json.dumps(records))
        sys.exit(0)

    if args.multi_timeframe:
        # Multi-timeframe mode: fetch all three timeframes
        timeframe_results = {}
        for tf in ["daily", "weekly", "monthly"]:
            cfg = TIMEFRAME_CONFIG[tf]
            try:
                ticker = yf.Ticker(symbol)
                df = ticker.history(period=cfg["period"], interval=cfg["interval"])
            except Exception as e:
                output_error("FETCH_ERROR", f"Failed to fetch {tf} data for {symbol}: {e}")

            if df is None or df.empty:
                output_error("INVALID_SYMBOL",
                             f"No data available for symbol: {symbol}. The symbol may be invalid or delisted.")

            if len(df) < 14:
                # Not enough data for this timeframe — store None
                timeframe_results[tf] = None
                continue

            try:
                df = calculate_all_indicators(df)
                timeframe_results[tf] = extract_result(symbol, df)
                timeframe_results[tf]["timeframe"] = tf
            except Exception as e:
                timeframe_results[tf] = None

        convergence = compute_convergence_score(timeframe_results)

        # Build output: use daily as the base result
        base = timeframe_results.get("daily")
        if base is None:
            output_error("INSUFFICIENT_DATA",
                         f"Insufficient daily data for {symbol}")

        base["timeframe"] = "daily"
        base["timeframe_analysis"] = {
            "daily": timeframe_results.get("daily"),
            "weekly": timeframe_results.get("weekly"),
            "monthly": timeframe_results.get("monthly"),
            "convergence_score": convergence,
        }

        print(json.dumps(base))
        sys.exit(0)
    else:
        # Single timeframe mode
        cfg = TIMEFRAME_CONFIG[args.timeframe]
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=cfg["period"], interval=cfg["interval"])
        except Exception as e:
            output_error("FETCH_ERROR", f"Failed to fetch data for {symbol}: {e}")

        if df is None or df.empty:
            output_error("INVALID_SYMBOL",
                         f"No data available for symbol: {symbol}. The symbol may be invalid or delisted.")

        if len(df) < 50:
            output_error("INSUFFICIENT_DATA",
                         f"Insufficient historical data for {symbol}: only {len(df)} data points (need at least 50)")

        try:
            df = calculate_all_indicators(df)
        except Exception as e:
            output_error("CALCULATION_ERROR",
                         f"Failed to calculate technical indicators for {symbol}: {e}")

        try:
            result = extract_result(symbol, df)
            result["timeframe"] = args.timeframe
        except Exception as e:
            output_error("PARSE_ERROR",
                         f"Failed to extract indicator values for {symbol}: {e}")

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
