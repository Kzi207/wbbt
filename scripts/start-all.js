const { spawn } = require("child_process");

function run(name, script) {
  const child = spawn("npm", ["run", script], {
    stdio: "inherit",
    shell: true,
    env: process.env
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });

  return child;
}

const bot = run("bot", "start:bot");
const web = run("web", "start:web");

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    if (!bot.killed) bot.kill();
  } catch (_) {}

  try {
    if (!web.killed) web.kill();
  } catch (_) {}

  setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

bot.on("exit", (code) => {
  if (!shuttingDown && code !== 0) shutdown();
});

web.on("exit", (code) => {
  if (!shuttingDown && code !== 0) shutdown();
});
