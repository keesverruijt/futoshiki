PORT ?= 8000
URL  := http://localhost:$(PORT)/

.PHONY: local

local:
	@echo "Serving html/ on $(URL) — Ctrl-C to stop"
	@( sleep 1 && (open "$(URL)" 2>/dev/null || xdg-open "$(URL)" 2>/dev/null || python3 -m webbrowser -t "$(URL)") ) &
	@python3 -m http.server $(PORT) --bind 127.0.0.1 --directory html
