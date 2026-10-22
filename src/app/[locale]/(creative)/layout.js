import CreativePages, { CreativePageContent } from "@/components/discover/CreativePages";

export default function CreativeLayout({ children }) {
  return <CreativePages><CreativePageContent>{children}</CreativePageContent></CreativePages>;
}
