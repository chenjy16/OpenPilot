#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# AI 量化交易系统 — 一键安装启动脚本
# =============================================================================
# 用法:
#   tar -xzf ai-assistant-mvp-v*.tar.gz
#   cd ai-assistant-mvp-v*
#   bash scripts/install.sh
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ---------- 1. 检查 Node.js ----------
info "检查 Node.js 环境..."
if ! command -v node &>/dev/null; then
  error "未找到 Node.js，请先安装 Node.js >= 20: https://nodejs.org/"
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  error "Node.js 版本过低 (当前 v$(node -v))，需要 >= 20"
fi
info "Node.js $(node -v) ✓"

# ---------- 2. 检查 Python (可选，用于股票分析脚本) ----------
if command -v python3 &>/dev/null; then
  info "Python3 $(python3 --version | awk '{print $2}') ✓"
else
  warn "未找到 Python3，股票分析脚本 (universe_screener, stock_analysis) 将不可用"
fi

# ---------- 3. 安装生产依赖 ----------
info "安装生产依赖..."
npm ci --production --ignore-scripts 2>&1 | tail -1
info "依赖安装完成 ✓"

# ---------- 4. 初始化 .env ----------
if [ ! -f .env ]; then
  cp .env.example .env
  info "已创建 .env 配置文件，请编辑填入 API Key"
  warn "至少需要配置一个 AI Provider: OPENAI_API_KEY 或 ANTHROPIC_API_KEY"
  echo ""
  echo "  编辑配置:  nano .env"
  echo ""
else
  info ".env 已存在，跳过 ✓"
fi

# ---------- 5. 创建数据目录 ----------
mkdir -p data
info "数据目录 data/ ✓"

# ---------- 6. 完成 ----------
echo ""
echo "============================================="
info "安装完成"
echo "============================================="
echo ""
echo "  1. 编辑配置文件:  nano .env"
echo "  2. 启动服务:      npm start"
echo "     或指定端口:    PORT=8080 npm start"
echo ""
echo "  服务启动后访问:   http://localhost:3000"
echo ""
echo "  更多文档:         docs/quant-trading-system.md"
echo "============================================="
