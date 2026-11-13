#!/usr/bin/env python3
"""Audit the AstrBot companion reference without importing its runtime."""

from __future__ import annotations

import argparse
import ast
import collections
import csv
import json
import sys
from pathlib import Path


def dotted(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = dotted(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    if isinstance(node, ast.Call):
        return dotted(node.func)
    return ""


def number(node: ast.AST | None) -> float | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    return None


def module_name(root: Path, path: Path) -> str:
    rel = path.relative_to(root)
    if rel.name == "__init__.py":
        return ".".join(rel.parent.parts)
    return ".".join(rel.with_suffix("").parts)


def domain_of(name: str) -> str:
    parts = name.split(".")
    if parts[0] == "companion_v2" and len(parts) > 1:
        return f"companion_v2/{parts[1]}"
    if parts[0] == "astrbot_host":
        return f"astrbot_host/{parts[1]}" if len(parts) > 1 else "astrbot_host"
    return parts[0]


def source_roots(root: Path) -> list[Path]:
    files = [root / "main.py"]
    for dirname in ("companion_v2", "astrbot_host"):
        directory = root / dirname
        if directory.exists():
            files.extend(directory.rglob("*.py"))
    return sorted({path for path in files if path.exists()})


def imports_of(tree: ast.AST, name: str, path: Path) -> set[str]:
    package = "" if name == "main" else (name if path.name == "__init__.py" else name.rsplit(".", 1)[0])
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
            continue
        if not isinstance(node, ast.ImportFrom):
            continue
        if node.level == 0:
            if node.module:
                found.add(node.module)
            continue
        parts = package.split(".") if package else []
        trim = max(0, node.level - 1)
        if trim:
            parts = parts[:-trim]
        if node.module:
            parts.extend(node.module.split("."))
        if parts:
            found.add(".".join(parts))
    return found


def edge_targets(target: str, known: set[str]) -> set[str]:
    if target in known:
        return {target}
    return {name for name in known if name.startswith(target + ".")}


def inside_async(tree: ast.AST) -> list[tuple[ast.AsyncFunctionDef, ast.AST]]:
    found: list[tuple[ast.AsyncFunctionDef, ast.AST]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef):
            for child in ast.walk(node):
                if child is not node:
                    found.append((node, child))
    return found


def audit(root: Path) -> dict[str, object]:
    paths = source_roots(root)
    modules: dict[str, Path] = {module_name(root, path): path for path in paths}
    tests = sorted((root / "tests").rglob("test_*.py")) if (root / "tests").exists() else []
    test_text = "\n".join(path.read_text(encoding="utf-8-sig", errors="replace") for path in tests)
    parsed: dict[str, ast.AST] = {}
    failures: list[dict[str, str]] = []
    for name, path in modules.items():
        try:
            parsed[name] = ast.parse(path.read_text(encoding="utf-8-sig"))
        except Exception as error:
            failures.append({"module": name, "error": str(error)})

    edges: dict[str, set[str]] = {}
    reverse: dict[str, set[str]] = collections.defaultdict(set)
    known = set(modules)
    for name, tree in parsed.items():
        targets = set()
        for imported in imports_of(tree, name, modules[name]):
            targets.update(edge_targets(imported, known))
        edges[name] = targets
        for target in targets:
            reverse[target].add(name)

    reachable = {"main"} if "main" in modules else set()
    queue = ["main"]
    while queue:
        current = queue.pop()
        for target in edges.get(current, set()):
            if target not in reachable:
                reachable.add(target)
                queue.append(target)

    classes = 0
    functions = 0
    async_functions = 0
    decorators: collections.Counter[str] = collections.Counter()
    sleeps: list[dict[str, object]] = []
    blocking_io: list[dict[str, object]] = []
    sync_execute_in_async: list[dict[str, object]] = []
    network_no_timeout: list[dict[str, object]] = []
    subprocess_no_timeout: list[dict[str, object]] = []
    popen_calls: list[dict[str, object]] = []
    locks: collections.Counter[str] = collections.Counter()
    background_tasks: list[dict[str, object]] = []
    while_true: list[dict[str, object]] = []
    create_task: list[dict[str, object]] = []
    async_calls: collections.Counter[str] = collections.Counter()
    per_module: dict[str, dict[str, object]] = {}
    entrypoints: list[dict[str, object]] = []

    lock_names = ("Lock", "Semaphore", "Event", "Condition", "Queue")
    io_names = ("open", "read_text", "read_bytes", "write_text", "write_bytes")
    http_methods = ("get", "post", "put", "patch", "delete", "request")

    for name, tree in parsed.items():
        path = modules[name]
        rel = str(path.relative_to(root))
        stats = {"classes": 0, "functions": 0, "async_functions": 0}
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                classes += 1
                stats["classes"] += 1
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                functions += 1
                stats["functions"] += 1
                if isinstance(node, ast.AsyncFunctionDef):
                    async_functions += 1
                    stats["async_functions"] += 1
                for dec in node.decorator_list:
                    decorator = dotted(dec)
                    decorators[decorator] += 1
                    if any(token in decorator for token in ("filter.", "web.", "route", "command", "middleware")):
                        entrypoints.append({
                            "module": name,
                            "line": node.lineno,
                            "function": node.name,
                            "decorator": decorator,
                        })
            if isinstance(node, ast.While):
                test = node.test
                if isinstance(test, ast.Constant) and test.value is True:
                    while_true.append({"module": name, "line": node.lineno})
            if not isinstance(node, ast.Call):
                continue
            call = dotted(node.func)
            if call in ("time.sleep", "asyncio.sleep"):
                delay = number(node.args[0]) if node.args else None
                if delay is None or delay >= 0.25:
                    sleeps.append({"module": name, "line": node.lineno, "call": call, "seconds": delay})
            if "create_task" in call:
                create_task.append({"module": name, "line": node.lineno, "call": call})
            if call.endswith(".create_task") or call in ("asyncio.create_task", "asyncio.ensure_future"):
                background_tasks.append({"module": name, "line": node.lineno, "call": call})
            if any(call.endswith("." + suffix) and suffix in lock_names for suffix in lock_names):
                locks[call] += 1
            if call.startswith(("requests.", "httpx.", "aiohttp.")) and call.rsplit(".", 1)[-1] in http_methods:
                if not any(keyword.arg == "timeout" for keyword in node.keywords):
                    network_no_timeout.append({"module": name, "line": node.lineno, "call": call})
            if call in ("subprocess.run", "subprocess.call", "subprocess.check_call", "subprocess.check_output", "os.system"):
                if not any(keyword.arg == "timeout" for keyword in node.keywords):
                    subprocess_no_timeout.append({"module": name, "line": node.lineno, "call": call})
            if call in ("subprocess.Popen", "Popen"):
                popen_calls.append({"module": name, "line": node.lineno, "call": call})

        for function, child in inside_async(tree):
            if not isinstance(child, ast.Call):
                continue
            call = dotted(child.func)
            if call.startswith("await "):
                async_calls[call] += 1
            if call in io_names or call.endswith(tuple("." + item for item in io_names)):
                blocking_io.append({
                    "module": name,
                    "line": child.lineno,
                    "function": function.name,
                    "call": call,
                })
            if call.startswith("time.sleep"):
                blocking_io.append({
                    "module": name,
                    "line": child.lineno,
                    "function": function.name,
                    "call": call,
                })
            if call in ("session.execute", "connection.execute", "conn.execute", "cursor.execute"):
                sync_execute_in_async.append({
                    "module": name,
                    "line": child.lineno,
                    "function": function.name,
                    "call": call,
                })
        per_module[name] = {
            **stats,
            "path": rel,
            "domain": domain_of(name),
            "reachable": name in reachable,
            "imported_by": len(reverse.get(name, set())),
            "imports": len(edges.get(name, set())),
            "test_reference": name in test_text or name.removeprefix("companion_v2.").removeprefix("astrbot_host.") in test_text,
            "docstring": next(iter((ast.get_docstring(tree) or "").splitlines()), "")[:240],
        }

    domains = collections.Counter(domain_of(name) for name in modules)
    domain_summary: dict[str, dict[str, int]] = {}
    for name, row in per_module.items():
        domain = str(row["domain"])
        summary = domain_summary.setdefault(domain, {
            "files": 0, "classes": 0, "functions": 0, "async_functions": 0,
            "reachable": 0, "test_referenced": 0,
        })
        summary["files"] += 1
        summary["classes"] += int(row["classes"])
        summary["functions"] += int(row["functions"])
        summary["async_functions"] += int(row["async_functions"])
        summary["reachable"] += 1 if row["reachable"] else 0
        summary["test_referenced"] += 1 if row["test_reference"] else 0

    largest = sorted(
        ({"path": str(path.relative_to(root)), "lines": len(path.read_text(encoding="utf-8-sig", errors="replace").splitlines())} for path in paths),
        key=lambda row: row["lines"],
        reverse=True,
    )[:25]

    untested = []
    for name in sorted(modules):
        short = name.removeprefix("companion_v2.").removeprefix("astrbot_host.")
        if short not in test_text and name not in test_text:
            untested.append(name)

    unreachable = sorted(set(modules) - reachable)
    unreachable_non_extension = [name for name in unreachable if "native_extensions" not in name]
    return {
        "root": str(root),
        "source_files": len(modules),
        "test_files": len(tests),
        "classes": classes,
        "functions": functions,
        "async_functions": async_functions,
        "directories": domains.most_common(),
        "domain_summary": domain_summary,
        "module_inventory": per_module,
        "entrypoints": entrypoints,
        "parse_failures": failures,
        "reachable_modules": len(reachable - {"main"}),
        "unreachable_modules": len(unreachable),
        "unreachable_non_extension": len(unreachable_non_extension),
        "unreachable_sample": unreachable_non_extension[:120],
        "largest_files": largest,
        "decorators": decorators.most_common(40),
        "sleep_calls": sleeps,
        "blocking_io_in_async": blocking_io,
        "sync_execute_in_async": sync_execute_in_async,
        "network_without_timeout": network_no_timeout,
        "subprocess_without_timeout": subprocess_no_timeout,
        "popen_calls": popen_calls,
        "lock_calls": locks.most_common(),
        "background_tasks": background_tasks,
        "while_true": while_true,
        "tests_without_textual_module_reference": len(untested),
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--csv", type=Path)
    args = parser.parse_args()
    result = audit(args.root.resolve())
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(text + "\n", encoding="utf-8")
    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        fields = (
            "module", "path", "domain", "reachable", "test_reference", "classes",
            "functions", "async_functions", "imports", "imported_by", "docstring",
        )
        with args.csv.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for module, row in sorted(result["module_inventory"].items()):
                writer.writerow({"module": module, **row})
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
