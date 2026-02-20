#!/bin/bash
# Agent Kanban - Development Startup Script
# Usage: ./dev.sh [backend|frontend|all]

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[Agent Kanban]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

cleanup() {
    log "Shutting down..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

# --- Backend setup ---
start_backend() {
    log "Starting backend..."

    if [ ! -d "$BACKEND_DIR/.venv" ]; then
        log "Creating Python virtual environment..."
        python3 -m venv "$BACKEND_DIR/.venv"
    fi

    source "$BACKEND_DIR/.venv/bin/activate"

    log "Installing Python dependencies..."
    pip install -q -r "$BACKEND_DIR/requirements.txt"

    log "Starting FastAPI server on port 8000..."
    cd "$BACKEND_DIR"
    python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
    BACKEND_PID=$!
    success "Backend started (PID: $BACKEND_PID)"
}

# --- Frontend setup ---
start_frontend() {
    log "Starting frontend..."

    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        log "Installing Node.js dependencies..."
        cd "$FRONTEND_DIR"
        npm install
    fi

    log "Starting Next.js dev server on port 3000..."
    cd "$FRONTEND_DIR"
    npm run dev &
    FRONTEND_PID=$!
    success "Frontend started (PID: $FRONTEND_PID)"
}

# --- Main ---
MODE="${1:-all}"

echo ""
echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  Agent Kanban Dev Environment  ${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

case "$MODE" in
    backend)
        start_backend
        ;;
    frontend)
        start_frontend
        ;;
    all)
        start_backend
        start_frontend
        echo ""
        success "All services started!"
        echo ""
        log "Backend:  http://localhost:8000"
        log "Frontend: http://localhost:3000"
        log "API Docs: http://localhost:8000/docs"
        echo ""
        log "Press Ctrl+C to stop all services"
        ;;
    *)
        error "Unknown mode: $MODE"
        echo "Usage: ./dev.sh [backend|frontend|all]"
        exit 1
        ;;
esac

wait
