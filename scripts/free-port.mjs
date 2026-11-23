#!/usr/bin/env node
/**
 * Free port 3130 after an E2E run, and before a fresh one.
 *
 * The port is the one declared in `services.yaml` for this app, so a
 * port-based kill is allowed here. Only a `node` process is killed: a stray
 * listener on 3130 that is not our server is left alone and reported.
 *
 * When `PW_REUSE=1`, the suite is deliberately sharing a server the operator
 * started; both hooks exit without touching it.
 */
import { execFileSync } from "node:child_process";

const PORT = 3130;

if (process.env.PW_REUSE === "1") {
  console.log(`free-port: PW_REUSE=1, leaving port ${PORT} alone.`);
  process.exit(0);
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function listenerPids() {
  if (process.platform === "win32") {
    const output = run("netstat", ["-ano", "-p", "tcp"]);
    const pids = new Set();
    for (const line of output.split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 5) continue;
      const local = fields[1] ?? "";
      const state = fields[3] ?? "";
      if (!local.endsWith(`:${PORT}`) || state.toUpperCase() !== "LISTENING") continue;
      const pid = Number(fields[4]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  }

  const output = run("lsof", ["-ti", `:${PORT}`]);
  return output
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function imageName(pid) {
  if (process.platform === "win32") {
    const output = run("tasklist", [
      "/FI",
      `PID eq ${pid}`,
      "/FO",
      "CSV",
      "/NH",
    ]);
    const match = /^"([^"]+)"/.exec(output.trim());
    return match ? match[1] : "";
  }
  return run("ps", ["-o", "comm=", "-p", String(pid)]).trim();
}

const pids = listenerPids();
if (pids.length === 0) {
  console.log(`free-port: port ${PORT} is free.`);
  process.exit(0);
}

let killed = 0;
for (const pid of pids) {
  const image = imageName(pid).toLowerCase();
  if (!image.startsWith("node")) {
    console.log(
      `free-port: pid ${pid} on port ${PORT} is "${image || "unknown"}", not node; leaving it alone.`,
    );
    continue;
  }
  if (process.platform === "win32") {
    run("taskkill", ["/PID", String(pid), "/T", "/F"]);
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  killed += 1;
}

console.log(
  killed > 0
    ? `free-port: stopped ${killed} node process(es) on port ${PORT}.`
    : `free-port: nothing of ours to stop on port ${PORT}.`,
);
