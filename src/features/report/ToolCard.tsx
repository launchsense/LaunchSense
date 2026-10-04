import { toolCardSentence } from "../../../shared/reports/codingTool";
import type { CodingTool } from "../../../shared/reports/codingTool";

export function ToolCard(props: { tools: CodingTool[] }) {
  return (
    <aside className="tool-card" aria-label="Coding tool">
      <p>{toolCardSentence(props.tools)}</p>
    </aside>
  );
}
