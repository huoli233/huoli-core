# 构建和清理的短写法，真正干活的是 package.json 里的脚本
.DEFAULT_GOAL := help
.PHONY: help build clean

PNPM ?= pnpm

help:
	@echo "make build        pnpm run build           complete repository build"
	@echo "make clean        pnpm run clean           remove build outputs and safe deleted-package residue"

build:
	$(PNPM) run build

clean:
	$(PNPM) run clean
