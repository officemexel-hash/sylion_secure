process.env.SYLION_APP_UNDER_TEST = "protonmail";
process.env.SYLION_RUNTIME_MODE = process.env.SYLION_RUNTIME_MODE || "firecracker_gui";

await import("./workload-factual-human-runner.mjs");
