PORT      ?= 8000
URL       := http://localhost:$(PORT)/
DEPLOY_HOST := root@keversoft.com
DEPLOY_DIR  := /docker/futoshiki

.PHONY: local publish

local:
	@echo "Serving html/ on $(URL) — Ctrl-C to stop"
	@( sleep 1 && (open "$(URL)" 2>/dev/null || xdg-open "$(URL)" 2>/dev/null || python3 -m webbrowser -t "$(URL)") ) &
	@python3 -m http.server $(PORT) --bind 127.0.0.1 --directory html

publish:
	@echo "Pushing to Github and deploying on https://verruijt.net/futoshiki/"
	git push
	ssh $(DEPLOY_HOST) 'cd $(DEPLOY_DIR) && git pull'
