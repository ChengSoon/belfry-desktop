import { resolve } from "node:path";
import { scaffold, check, pack } from "./author.mjs";
import { PersonalMarket } from "./personal-market.mjs";

export async function main(argv) {
  const [command, ...args] = argv;
  const { values, options } = parseArguments(args);
  const directory = resolve(values[0] || ".");
  const handlers = {
    init: () => create(values, options), create: () => create(values, options),
    check: () => check(directory), pack: () => pack({ directory, out: options.out }),
    publish: () => publish(directory, options),
    "export-market": () => exportMarket(values, options),
  };
  if (!Object.hasOwn(handlers, command)) throw new Error("用法：belfry-plugin init / check / pack / publish / export-market");
  const result = await handlers[command]();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
function parseArguments(args) {
  const values = [], options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index].startsWith("--")) options[args[index].slice(2)] = args[++index];
    else values.push(args[index]);
  }
  return { values, options };
}
function create(values, options) {
  if (!values[1]) throw new Error("用法：init <panel-basic|agent-tool-basic|skill-pack|full-demo> <目录> [--id ID] [--name 名称]");
  return scaffold({ template: values[0], directory: values[1], id: options.id, name: options.name, author: options.author });
}
function publish(directory, options) {
  if (!options.market) throw new Error("用法：publish <插件目录> --market <自有市场目录> [--changelog 更新说明]");
  return new PersonalMarket(options.market).publish({ directory, changelog: options.changelog });
}
function exportMarket(values, options) {
  if (!values[0] || !options.out) throw new Error("用法：export-market <市场目录> --out <空目录>");
  return new PersonalMarket(values[0]).export(options.out);
}
