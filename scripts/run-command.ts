import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node scripts/run-command.ts <command> [...args]");
  process.exit(1);
}

const executable = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? `${command}.cmd` : command);

const spawnCommand = process.platform === "win32" ? "cmd.exe" : executable;
const spawnArgs = process.platform === "win32"
  ? ["/d", "/c", executable, ...args]
  : args;

const child = spawn(spawnCommand, spawnArgs, {
  env: {
    ...process.env,
    ASTRO_TELEMETRY_DISABLED: "1",
  },
  stdio: "inherit",
});

child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
  if (signal) {
    console.error(`${command} exited with signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 0);
});
