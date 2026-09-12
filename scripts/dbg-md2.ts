import "dotenv/config";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { Root, Element } from "hast";

async function main() {
  let sawFigure = false;
  const probe = () => (tree: Root) => {
    visit(tree, "element", (n: Element) => {
      if (n.tagName === "figure") {
        sawFigure = true;
        console.log("figure props:", JSON.stringify(Object.keys(n.properties ?? {})), JSON.stringify(n.properties?.dataRehypePrettyCodeFigure));
      }
    });
  };
  const p = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypePrettyCode, { theme: { dark: "github-dark-dimmed", light: "github-light" }, keepBackground: true, defaultLang: "plaintext" })
    .use(probe)
    .use(rehypeStringify);
  await p.process("```mermaid\nflowchart TD\nA-->B\n```");
  console.log("sawFigure:", sawFigure);
  process.exit(0);
}
main();
