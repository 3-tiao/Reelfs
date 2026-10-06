// MetadataChips — pure presentational component (MetadataChips.tsx:1-22).
// Coverage: comma splitting with trim + empty-segment filtering, title render,
// and the null short-circuit for empty/missing input (MetadataChips.tsx:2-3).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MetadataChips from "../MetadataChips";

afterEach(cleanup);

describe("MetadataChips", () => {
  it("renders the title and one chip per comma-separated item", () => {
    render(<MetadataChips title="类型" items="科幻,剧情,动作" />);

    expect(screen.getByText("类型")).toBeInTheDocument();
    expect(screen.getByText("科幻")).toBeInTheDocument();
    expect(screen.getByText("剧情")).toBeInTheDocument();
    expect(screen.getByText("动作")).toBeInTheDocument();
  });

  it("trims whitespace around each item", () => {
    render(<MetadataChips title="演员" items=" 张三 ,  李四 " />);

    // Trimmed values are rendered; the raw untrimmed strings must not exist.
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();
    expect(screen.queryByText(" 张三 ")).not.toBeInTheDocument();
    expect(screen.queryByText(" 李四 ")).not.toBeInTheDocument();
  });

  it("drops empty segments produced by consecutive/trailing commas", () => {
    render(<MetadataChips title="类型" items="科幻,,剧情," />);

    expect(screen.getByText("科幻")).toBeInTheDocument();
    expect(screen.getByText("剧情")).toBeInTheDocument();
    // Only two chips rendered in total.
    const chips = screen.getByText("科幻").parentElement!;
    expect(chips.children).toHaveLength(2);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["blank-only segments", " , , "],
  ])("renders nothing for %s items", (_label, items) => {
    const { container } = render(<MetadataChips title="类型" items={items} />);

    expect(container).toBeEmptyDOMElement();
  });
});
