import "dotenv/config";
async function main() {
  const { renderMarkdown } = await import("@/lib/markdown/server");
  const md = "```mermaid\nflowchart TD\n  A-->B\n```\n\n```ts\nconst x = 1;\n```\n";
  const { html } = await renderMarkdown(md);
  console.log(html.slice(0, 1500));
  process.exit(0);
}
main();
