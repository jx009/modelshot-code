"use client";

import { useLocale } from "next-intl";
import InspirationGallery from "./InspirationGallery";

export default function ExplorePage() {
  const zh = useLocale() === "zh";
  return <>
    <section className="cr-explore-heading">
      <span className="cr-overline">THE INSPIRATION LIBRARY</span>
      <h1>{zh ? "好作品，从灵感开始。" : "Good work starts with inspiration."}</h1>
      <p>{zh ? "拆解一份创意，带走一种风格。把喜欢的案例，变成自己的作品。" : "Explore a composition. Borrow an approach. Make something of your own."}</p>
    </section>
    <InspirationGallery zh={zh} explore />
  </>;
}
