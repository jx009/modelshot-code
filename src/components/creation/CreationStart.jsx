"use client";

import { useState } from "react";
import { ArrowUpRight, FileImage } from "lucide-react";
import { BrandMark } from "@/components/BrandLogo";
import CreationLauncher from "@/components/discover/CreationLauncher";
import WorkspaceSplit from "./WorkspaceSplit";
import { SLIDE_IDEAS } from "./CreationWorkspace";

// 从导航直接进入 PPT 时还没有项目：先展示与项目内一致的工作台，用户在左侧对话框描述需求，
// 首次发送时才创建项目（避免每次打开都产生空项目），创建成功后进入该项目继续对话。
export default function CreationStart({ userId, zh }) {
  const text = (cn, en) => zh ? cn : en;
  const [draft, setDraft] = useState({ prompt: "" }), [version, setVersion] = useState(0);
  const applyIdea = idea => { setDraft(current => ({ ...current, prompt: idea })); setVersion(value => value + 1); };
  return <section className="cw-workspace cw-start" data-mobile-tab="chat">
    <WorkspaceSplit userId={userId} zh={zh}>
      <aside className="cw-chat">
        <header><div className="cw-chat-heading"><strong>{text("创作对话", "Conversation")}</strong></div></header>
        <div className="cw-start-scroll">
          <div className="cw-chat-welcome ws-welcome"><span className="ws-orb" aria-hidden="true"><BrandMark size={28} /></span>
            <h2>{text("输入主题，一键生成 PPT", "Type a topic, get a deck")}</h2>
            <p>{text("写清主题、受众和页数，AI 先给出大纲供你确认，再逐页生成可编辑的幻灯片。", "Describe the topic, audience and length. Review the outline, then get editable slides page by page.")}</p>
            <div className="ws-suggestions">{SLIDE_IDEAS.map(([cn, en]) => <button type="button" key={cn} onClick={() => applyIdea(zh ? cn : en)}><span>{zh ? cn : en}</span><ArrowUpRight size={14} /></button>)}</div>
          </div>
        </div>
        <div className="cw-start-composer">
          <CreationLauncher key={version} kind="slides" userId={userId} zh={zh} initialDraft={draft} onDraft={setDraft} />
        </div>
      </aside>
      <div className="cw-work-area"><div className="cw-artwork-area"><div className="cw-artwork-content" style={{ display: "flex" }}>
        <div className="cw-empty-artwork"><FileImage size={40} strokeWidth={1} /><h2>{text("你的作品会在这里呈现", "Your artwork will appear here")}</h2><p>{text("在左侧描述需求，发送后自动创建项目并生成大纲。", "Describe your deck on the left. A project is created when you send it.")}</p></div>
      </div></div></div>
    </WorkspaceSplit>
  </section>;
}
