# 网页端几个命令的短写法，真正干活的是 package.json 里的脚本
.DEFAULT_GOAL := help
.PHONY: help build clean web dev-web

PNPM ?= pnpm
ARGS ?=

help:
	@echo "make build        pnpm run build           complete repository build"
	@echo "make clean        pnpm run clean           remove build outputs and safe deleted-package residue"
	@echo "make web          pnpm run start:web       serve the built Web artifacts from source"
	@echo "make dev-web      pnpm run dev:web         build, serve, and rebuild Web on source edits"
	@echo "ARGS='--no-open --port 3081' forwards options to the launched application."

build:
	$(PNPM) run build

clean:
	$(PNPM) run clean

web:
	$(PNPM) run start:web $(ARGS)

dev-web:
	$(PNPM) run dev:web $(ARGS)
