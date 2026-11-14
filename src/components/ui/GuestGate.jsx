"use client";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { sceneImage } from "@/components/discover/hero-wall";
import "./guest-gate.css";

// 未登录时的工作区入口：三张作品扇形叠放 + 标题 + 登录按钮。
// 视频、PPT 等需要登录的工作区共用，避免各自写一行灰字。
export default function GuestGate({ title, description, action, onAction, images }) {
  return <section className="guest-gate" aria-labelledby="guest-gate-title">
    <div className="guest-gate-art" aria-hidden="true">
      {images.map((file, index) => <span key={file} style={{ "--gg-i": index }}>
        <Image src={sceneImage(file)} alt="" width={360} height={450} unoptimized />
      </span>)}
    </div>
    <h1 id="guest-gate-title">{title}</h1>
    <p>{description}</p>
    <button type="button" onClick={onAction}>{action}<ArrowRight size={16} /></button>
  </section>;
}
