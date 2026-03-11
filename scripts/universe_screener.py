#!/usr/bin/env python3
"""
Universe Screener — Automatically screen US stocks suitable for quantitative trading.

Filters:
  - Average daily volume > 1M shares (liquidity)
  - Market cap > $1B (avoid micro-caps)
  - Price between $5 and $500 (avoid penny stocks and ultra-high-price stocks)
  - ATR% between 1.5% and 8% (sufficient volatility for trading, not too wild)

Data source: yfinance (free, no API key needed)

Usage:
    python scripts/universe_screener.py [--pool sp500|nasdaq100|custom] [--symbols AAPL,MSFT,...]
    python scripts/universe_screener.py --pool sp500
    python scripts/universe_screener.py --pool nasdaq100
    python scripts/universe_screener.py --pool all

Output (stdout): JSON array of qualified symbols with metrics
"""

import sys
import json
import argparse
import yfinance as yf
import pandas as pd
import numpy as np


# Well-known US stock pools
SP500_TOP = [
    "AAPL", "MSFT", "AMZN", "NVDA", "GOOGL", "META", "TSLA", "BRK-B", "UNH", "XOM",
    "JNJ", "JPM", "V", "PG", "MA", "HD", "CVX", "MRK", "ABBV", "LLY",
    "PEP", "KO", "COST", "AVGO", "WMT", "MCD", "CSCO", "TMO", "ACN", "ABT",
    "DHR", "NEE", "LIN", "TXN", "PM", "UNP", "RTX", "LOW", "HON", "AMGN",
    "IBM", "QCOM", "SBUX", "GS", "CAT", "BA", "GE", "AMAT", "ISRG", "MDT",
    "BLK", "ADP", "DE", "GILD", "ADI", "VRTX", "SYK", "BKNG", "REGN", "MMC",
    "LRCX", "PANW", "KLAC", "SNPS", "CDNS", "MRVL", "FTNT", "NXPI", "ON", "MPWR",
    "CRM", "NOW", "ADBE", "ORCL", "INTU", "PLTR", "SNOW", "DDOG", "ZS", "CRWD",
]

NASDAQ100_TOP = [
    "AAPL", "MSFT", "AMZN", "NVDA", "GOOGL", "META", "TSLA", "AVGO", "COST", "NFLX",
    "AMD", "QCOM", "TXN", "INTC", "AMAT", "MU", "LRCX", "ADI", "KLAC", "SNPS",
    "CDNS", "MRVL", "NXPI", "ON", "MPWR", "FTNT", "PANW", "CRWD", "ZS", "DDOG",
    "CRM", "ADBE", "NOW", "INTU", "ORCL", "PLTR", "SNOW", "WDAY", "TEAM", "MNDY",
    "ABNB", "BKNG", "MELI", "PDD", "JD", "BIDU", "TCOM", "BABA",
    "PYPL", "SQ", "COIN", "HOOD", "SOFI",
    "ISRG", "DXCM", "ILMN", "MRNA", "REGN", "VRTX", "GILD", "AMGN", "BIIB",
    "PEP", "KO", "SBUX", "MCD", "CMG", "MNST",
    "TSM", "ASML", "ARM", "SMCI",
]

# High-volatility momentum stocks popular with quant traders
MOMENTUM_PICKS = [
    "TSLA", "NVDA", "AMD", "PLTR", "COIN", "HOOD", "SOFI", "MARA", "RIOT",
    "SQ", "SHOP", "RBLX", "SNAP", "PINS", "U", "DKNG", "PENN",
    "ENPH", "SEDG", "FSLR", "RUN",
    "SMCI", "ARM", "IONQ", "RGTI", "QUBT",
    "RIVN", "LCID", "NIO", "XPEV", "LI",
]


def get_pool_symbols(pool: str) -> list[str]:
    """Get symbol list based on pool name."""
    if pool == "sp500":
        return list(set(SP500_TOP))
    elif pool == "nasdaq100":
        return list(set(NASDAQ100_TOP))
    elif pool == "momentum":
        return list(set(MOMENTUM_PICKS))
    elif pool == "all":
        return list(set(SP500_TOP + NASDAQ100_TOP + MOMENTUM_PICKS))
    else:
        return list(set(SP500_TOP + NASDAQ100_TOP + MOMENTUM_PICKS))


def compute_atr_percent(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> float:
    """Compute ATR as percentage of price."""
    close_prev = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - close_prev).abs(),
        (low - close_prev).abs(),
    ], axis=1).max(axis=1)
    atr = tr.rolling(window=period).mean().iloc[-1]
    current_price = close.iloc[-1]
    if pd.isna(atr) or current_price <= 0:
        return 0.0
    return float(atr / current_price * 100)


def screen_symbol(symbol: str) -> dict | None:
    """Screen a single symbol. Returns metrics dict or None if filtered out."""
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="3mo")

        if hist.empty or len(hist) < 20:
            return None

        current_price = float(hist["Close"].iloc[-1])

        # Price filter: $5 - $500
        if current_price < 5 or current_price > 500:
            return None

        # Average volume filter: > 1M shares
        avg_volume = float(hist["Volume"].tail(20).mean())
        if avg_volume < 1_000_000:
            return None

        # ATR% filter: 1.5% - 8%
        atr_pct = compute_atr_percent(hist["High"], hist["Low"], hist["Close"])
        if atr_pct < 1.5 or atr_pct > 8.0:
            return None

        # Market cap (from info, may be slow)
        info = ticker.info or {}
        market_cap = info.get("marketCap", 0) or 0

        # Market cap filter: > $1B (skip if unavailable)
        if market_cap > 0 and market_cap < 1_000_000_000:
            return None

        # Compute additional metrics
        returns_20d = float((hist["Close"].iloc[-1] / hist["Close"].iloc[-20] - 1) * 100) if len(hist) >= 20 else 0
        avg_dollar_volume = avg_volume * current_price

        # SMA20 position
        sma20 = float(hist["Close"].tail(20).mean())
        above_sma20 = current_price > sma20

        # RSI(14)
        delta = hist["Close"].diff()
        gain = delta.where(delta > 0, 0.0).rolling(14).mean()
        loss = (-delta.where(delta < 0, 0.0)).rolling(14).mean()
        rs = gain.iloc[-1] / loss.iloc[-1] if loss.iloc[-1] != 0 else 100
        rsi = float(100 - (100 / (1 + rs)))

        return {
            "symbol": symbol,
            "price": round(current_price, 2),
            "avg_volume": int(avg_volume),
            "avg_dollar_volume": round(avg_dollar_volume, 0),
            "market_cap": market_cap,
            "atr_pct": round(atr_pct, 2),
            "returns_20d": round(returns_20d, 2),
            "rsi": round(rsi, 1),
            "above_sma20": above_sma20,
        }
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser(description="Screen US stocks for quant trading")
    parser.add_argument("--pool", default="all", choices=["sp500", "nasdaq100", "momentum", "all"],
                        help="Stock pool to screen")
    parser.add_argument("--symbols", default="", help="Comma-separated custom symbols (overrides pool)")
    parser.add_argument("--min-volume", type=int, default=1_000_000, help="Min avg daily volume")
    parser.add_argument("--min-price", type=float, default=5.0, help="Min price")
    parser.add_argument("--max-price", type=float, default=500.0, help="Max price")
    parser.add_argument("--min-atr", type=float, default=1.5, help="Min ATR%%")
    parser.add_argument("--max-atr", type=float, default=8.0, help="Max ATR%%")
    parser.add_argument("--top", type=int, default=100, help="Max number of results")
    args = parser.parse_args()

    if args.symbols:
        symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    else:
        symbols = get_pool_symbols(args.pool)

    results = []
    total = len(symbols)

    for i, symbol in enumerate(symbols):
        sys.stderr.write(f"\rScreening {i+1}/{total}: {symbol}    ")
        result = screen_symbol(symbol)
        if result is not None:
            results.append(result)

    sys.stderr.write(f"\rScreening complete: {len(results)}/{total} passed filters\n")

    # Sort by average dollar volume (liquidity) descending
    results.sort(key=lambda x: x["avg_dollar_volume"], reverse=True)

    # Limit to top N
    results = results[:args.top]

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
