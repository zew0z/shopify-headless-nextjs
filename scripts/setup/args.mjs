/** `--flag` is true, `--key=value` keeps its value. A bare flag must never read as unset. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const args = [];
  for (const item of rest) {
    if (item.startsWith("--")) {
      const [key, ...value] = item.slice(2).split("=");
      flags[key] = value.length ? value.join("=") : true;
    } else args.push(item);
  }
  return { command, args, flags };
}
