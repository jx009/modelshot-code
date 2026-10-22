import Image from "next/image";
import chair from "../../../public/inspiration/chair.webp";
import skincare from "../../../public/inspiration/skincare.webp";
import sneaker from "../../../public/inspiration/sneaker.webp";
import perfume from "../../../public/inspiration/perfume.webp";
import headphones from "../../../public/inspiration/headphones.webp";
import citrus from "../../../public/inspiration/citrus.webp";
import interior from "../../../public/inspiration/interior.webp";
import camera from "../../../public/inspiration/camera.webp";

const artwork = { chair, skincare, sneaker, perfume, headphones, citrus, interior, camera };

// The photography is reference material; the typography and composition are our own.
export default function CaseArtwork({ item, zh, priority = false }) {
  return <div className={`cr-artwork cr-artwork-${item.image}`}>
    <Image src={artwork[item.image] || chair} unoptimized alt={zh ? item.product : item.productEn} fill priority={priority} sizes="(max-width:600px) 50vw, (max-width:1100px) 40vw, 28vw" />
    <div className="cr-artwork-copy"><span>{({ chair: "OBJECTS FOR A SLOWER LIFE", skincare: "BOTANICAL STUDY / 01", sneaker: "MOVE WITHOUT LIMITS", perfume: "EAU DE LUMIÈRE", headphones: "A PRIVATE SOUND EXPERIENCE", citrus: "FRESH FINDS — SEASON 09", interior: "SPACES TO FEEL AT HOME", camera: "THROUGH A DIFFERENT LENS" })[item.image]}</span><strong>{item.headline}</strong><p>{zh ? item.title : item.en}</p></div>
    <div className="cr-artwork-foot"><span>{item.category === "commerce" ? "PRODUCT EDITORIAL" : "VISUAL EXPLORATIONS"}</span><span>MS / 0{["chair", "skincare", "sneaker", "perfume", "headphones", "citrus", "interior", "camera"].indexOf(item.image) + 1}</span></div>
  </div>;
}
